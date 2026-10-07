import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHANNELS } from "@/lib/pique-bot/config";
import { appUrl } from "@/lib/pique-bot/data";
import { slackApi } from "@/lib/pique-bot/slack";

type Admin = ReturnType<typeof createAdminClient>;

/** Stripe webhook signing: reject anything unsigned, forged, or older than 5 minutes. */
export function verifyStripeSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
  // Stripe sends one v1 signature per active secret (two while a secret is being rolled).
  return parts
    .filter(([k]) => k === "v1")
    .some(([, v]) => {
      const given = Buffer.from(v ?? "");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

type Charge = {
  id?: string;
  metadata?: Record<string, string>;
  billing_details?: { name?: string | null; email?: string | null } | null;
};

type PaymentIntent = {
  id: string;
  status: string;
  amount_received: number;
  currency: string;
  metadata?: Record<string, string>;
  latest_charge?: string | Charge | null;
  // Only on API versions before 2022-11-15; newer ones send latest_charge instead.
  charges?: { data?: Charge[] };
};

type Stay = {
  id: string;
  confirmation_code: string | null;
  check_in: string | null;
  check_out: string | null;
  properties: { property_name: string | null; public_name: string | null } | null;
};

/**
 * Replaces the "Stripe Payment Success Notification to Slack" Zap (docs/zapier-migration.md
 * P1-13): one FYI post per succeeded payment on the Pique Stripe account in
 * #stripe-payment-notification, with the stay found by the charge's reservation_code in our
 * own reservations (the Zap used the "Hospitable New Reservations" sheet). Claimed per payment
 * intent in stripe_payment_posts before posting, so Stripe's retries never post it twice; a
 * failed Slack post releases the claim and the route answers 500, so Stripe retries it.
 */
export async function handlePaymentSucceeded(admin: Admin, eventId: string, pi: PaymentIntent) {
  const charge = await chargeFor(pi);
  const code = (charge?.metadata?.reservation_code || pi.metadata?.reservation_code || "").trim();
  const stay = code ? await findStay(admin, code) : null;
  const name = charge?.billing_details?.name?.trim() || null;
  const amount = pi.amount_received / 100;
  const channel = CHANNELS.stripePayments;

  const { error: claimError } = await admin.from("stripe_payment_posts").insert({
    payment_intent_id: pi.id,
    event_id: eventId,
    reservation_id: stay?.id ?? null,
    reservation_code: code || null,
    customer_name: name,
    amount,
    currency: pi.currency,
    channel_id: channel,
  });
  if (claimError) return { payment: pi.id, skipped: "already posted" };

  const message = renderPayment(pi, { code, name, stay });
  const sent = await slackApi<{ ts?: string }>("chat.postMessage", { channel, text: message.text, blocks: message.blocks, unfurl_links: false });
  if (!sent.ok || !sent.ts) {
    await admin.from("stripe_payment_posts").delete().eq("payment_intent_id", pi.id);
    return { payment: pi.id, error: sent.error ?? "post failed" };
  }
  await admin.from("stripe_payment_posts").update({ slack_ts: sent.ts }).eq("payment_intent_id", pi.id);
  return { payment: pi.id, slack_ts: sent.ts };
}

/** The charge carries the reservation code and the card holder's name. */
async function chargeFor(pi: PaymentIntent): Promise<Charge | null> {
  const listed = pi.charges?.data?.[0];
  if (listed) return listed;
  if (pi.latest_charge && typeof pi.latest_charge === "object") return pi.latest_charge;
  // Newer API versions only send the charge id. Reading it needs a key (a restricted key with
  // Charges: read is enough); without one the post still goes out, from the payment intent alone.
  const key = process.env.STRIPE_API_KEY;
  if (!key || typeof pi.latest_charge !== "string") return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/charges/${encodeURIComponent(pi.latest_charge)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.error(`Stripe charge lookup failed: ${res.status}`);
      return null;
    }
    return (await res.json()) as Charge;
  } catch (e) {
    console.error(`Stripe charge lookup failed: ${(e as Error).message}`);
    return null;
  }
}

/** Direct bookings are HOST-XXXXXX in Hospitable; accept the code with or without the prefix. */
async function findStay(admin: Admin, code: string): Promise<Stay | null> {
  const upper = code.toUpperCase();
  const candidates = upper.startsWith("HOST-") ? [upper, upper.slice(5)] : [upper, `HOST-${upper}`];
  const { data } = await admin
    .from("reservations")
    .select("id, confirmation_code, check_in, check_out, properties(property_name, public_name)")
    .in("confirmation_code", candidates)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as unknown as Stay | undefined) ?? null;
}

function formatDate(date: string | null): string {
  if (!date) return "?";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderPayment(pi: PaymentIntent, found: { code: string; name: string | null; stay: Stay | null }): { text: string; blocks: unknown[] } {
  const currency = pi.currency.toUpperCase();
  let amount: string;
  try {
    amount = (pi.amount_received / 100).toLocaleString("en-US", { style: "currency", currency });
  } catch {
    amount = `${(pi.amount_received / 100).toFixed(2)} ${currency}`;
  }
  const { stay, code, name } = found;
  const unit = stay ? (stay.properties?.property_name || stay.properties?.public_name || "Unknown unit").replace(/\*+$/, "").trim() : null;
  const url = appUrl();

  const lines = [
    `:moneybag: *Payment received* · *${amount}*${unit ? ` · *${esc(unit)}*` : ""}`,
    `*${esc(name ?? "Name not on the payment")}*`,
    stay
      ? `${formatDate(stay.check_in)} → ${formatDate(stay.check_out)} · ${esc(stay.confirmation_code ?? code)}`
      : code
        ? `Reservation ${esc(code)} (not found in our bookings)`
        : "No reservation code on the payment",
    `Status: ${esc(pi.status)} · <https://dashboard.stripe.com/payments/${encodeURIComponent(pi.id)}|Stripe>` +
      (url && stay ? ` · <${url}/reservations?res=${stay.id}|Open>` : ""),
  ];
  return {
    text: `Payment received: ${amount}${name ? ` from ${name}` : ""}${unit ? ` - ${unit}` : ""}`,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }],
  };
}
