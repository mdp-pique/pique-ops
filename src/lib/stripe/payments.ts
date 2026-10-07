import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHANNELS } from "@/lib/pique-bot/config";
import { appUrl } from "@/lib/pique-bot/data";
import { slackApi } from "@/lib/pique-bot/slack";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Stripe webhook signing: reject anything unsigned, forged, or older than 5 minutes.
 * STRIPE_WEBHOOK_SECRET may list several secrets, comma-separated, one per endpoint
 * (e.g. if disputes come from a second Stripe account).
 */
export function verifyStripeSignature(rawBody: string, header: string | null): boolean {
  const secrets = (process.env.STRIPE_WEBHOOK_SECRET ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!secrets.length || !header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  // Stripe sends one v1 signature per active secret (two while a secret is being rolled).
  const given = parts.filter(([k]) => k === "v1").map(([, v]) => Buffer.from(v ?? ""));
  return secrets.some((secret) => {
    const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
    return given.some((g) => g.length === expected.length && timingSafeEqual(g, expected));
  });
}

type Charge = {
  id?: string;
  description?: string | null;
  metadata?: Record<string, string>;
  billing_details?: { name?: string | null; email?: string | null } | null;
};

type PaymentIntent = {
  id: string;
  status: string;
  amount: number;
  amount_received: number;
  currency: string;
  description?: string | null;
  metadata?: Record<string, string>;
  last_payment_error?: {
    code?: string;
    decline_code?: string;
    message?: string;
    payment_method?: { billing_details?: { name?: string | null; email?: string | null } | null } | null;
  } | null;
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
 * #stripe-payment-success-notification, with the stay found by the charge's reservation_code in our
 * own reservations (the Zap used the "Hospitable New Reservations" sheet). Claimed per payment
 * intent in stripe_payment_posts before posting, so Stripe's retries never post it twice; a
 * failed Slack post releases the claim and the route answers 500, so Stripe retries it.
 */
export async function handlePaymentSucceeded(pi: PaymentIntent, admin: Admin, eventId: string) {
  const charge = await chargeFor(pi);
  const code = reservationCode(charge, pi);
  // A payment that went through closes the failed-payment ticket for the same booking.
  const { error: resolveError } = await admin.rpc("resolve_stripe_payment_failed", { p_code: code, p_payment_intent: pi.id });
  if (resolveError) console.error(`Stripe: resolving failed-payment ticket failed: ${resolveError.message}`);
  const stay = code ? await findStay(admin, code) : null;
  const name = charge?.billing_details?.name?.trim() || null;
  const amount = pi.amount_received / 100;
  const channel = CHANNELS.stripePayments;

  const { error: claimError } = await admin.from("stripe_payment_posts").insert({
    payment_intent_id: pi.id,
    event_id: eventId,
    reservation_id: stay?.id ?? null,
    reservation_code: code,
    customer_name: name,
    amount,
    currency: pi.currency,
    channel_id: channel,
  });
  if (claimError) return { payment: pi.id, skipped: "already posted" };

  const message = renderPayment(pi, { code: code ?? "", name, stay });
  const sent = await slackApi<{ ts?: string }>("chat.postMessage", { channel, text: message.text, blocks: message.blocks, unfurl_links: false });
  if (!sent.ok || !sent.ts) {
    await admin.from("stripe_payment_posts").delete().eq("payment_intent_id", pi.id);
    return { payment: pi.id, error: sent.error ?? "post failed" };
  }
  await admin.from("stripe_payment_posts").update({ slack_ts: sent.ts }).eq("payment_intent_id", pi.id);
  return { payment: pi.id, slack_ts: sent.ts };
}

/**
 * A failed payment opens (or adds to) a payment_failed ticket for the booking, asked by Pique Bot
 * in #stripe-payment-failed-notification (rule payment_failed). A failed call answers 500 so
 * Stripe retries; the function is idempotent per booking, so a retry only adds a note.
 */
export async function handlePaymentFailed(pi: PaymentIntent, admin: Admin) {
  const err = pi.last_payment_error;
  const charge = pi.charges?.data?.[0] ?? (pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null);
  const { data, error } = await admin.rpc("record_stripe_payment_failed", {
    p: {
      payment_intent: pi.id,
      code: reservationCode(charge, pi),
      name: err?.payment_method?.billing_details?.name ?? charge?.billing_details?.name ?? null,
      amount: pi.amount / 100,
      currency: pi.currency,
      reason: [err?.decline_code || err?.code, err?.message].filter(Boolean).join(" - ") || null,
    },
  });
  if (error) return { payment: pi.id, error: error.message };
  return { payment: pi.id, ticket: data };
}

type Dispute = {
  id: string;
  amount: number;
  currency: string;
  reason?: string | null;
  status?: string | null;
  charge?: string | Charge | null;
  payment_intent?: string | null;
  evidence_details?: { due_by?: number | null } | null;
};

/**
 * A new charge dispute opens a payment_dispute ticket, due when Stripe's evidence window closes
 * (rule payment_dispute, same channel). Name, email and booking come from the disputed charge,
 * which needs STRIPE_API_KEY; without it the ticket still opens with the amount and reason.
 */
export async function handleDisputeCreated(dispute: Dispute, admin: Admin) {
  const charge = typeof dispute.charge === "object" ? dispute.charge : await fetchCharge(dispute.charge ?? null);
  const dueBy = dispute.evidence_details?.due_by;
  const { data, error } = await admin.rpc("record_stripe_dispute", {
    p: {
      dispute: dispute.id,
      payment_intent: dispute.payment_intent ?? null,
      code: reservationCode(charge, null),
      name: charge?.billing_details?.name ?? null,
      email: charge?.billing_details?.email ?? null,
      amount: dispute.amount / 100,
      currency: dispute.currency,
      reason: dispute.reason?.replace(/_/g, " ") ?? null,
      due_by: dueBy ? new Date(dueBy * 1000).toISOString() : null,
    },
  });
  if (error) return { dispute: dispute.id, error: error.message };
  return { dispute: dispute.id, ticket: data };
}

export async function handleDisputeClosed(dispute: Dispute, admin: Admin) {
  const { error } = await admin.rpc("resolve_stripe_dispute", { p_dispute: dispute.id, p_status: dispute.status ?? "closed" });
  if (error) return { dispute: dispute.id, error: error.message };
  return { dispute: dispute.id, resolved: true };
}

/** The booking code: the charge's reservation_code metadata, else "Booking HOST-XXXXXX" in a description. */
function reservationCode(charge: Charge | null, pi: PaymentIntent | null): string | null {
  const meta = (charge?.metadata?.reservation_code || pi?.metadata?.reservation_code || "").trim();
  if (meta) return meta;
  const text = `${charge?.description ?? ""} ${pi?.description ?? ""}`;
  return text.match(/\bHOST-[A-Z0-9]+\b/i)?.[0] ?? null;
}

/** The charge carries the reservation code and the card holder's name. */
async function chargeFor(pi: PaymentIntent): Promise<Charge | null> {
  const listed = pi.charges?.data?.[0];
  if (listed) return listed;
  if (pi.latest_charge && typeof pi.latest_charge === "object") return pi.latest_charge;
  return fetchCharge(typeof pi.latest_charge === "string" ? pi.latest_charge : null);
}

/**
 * Newer API versions only send the charge id. Reading it needs a key (a restricted key with
 * Charges: read is enough); without one the post still goes out, from the payment intent alone.
 */
async function fetchCharge(chargeId: string | null): Promise<Charge | null> {
  const key = process.env.STRIPE_API_KEY;
  if (!key || !chargeId) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/charges/${encodeURIComponent(chargeId)}`, {
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
