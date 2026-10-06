import { createAdminClient } from "@/lib/supabase/admin";
import { CHANNELS } from "./config";
import { appUrl } from "./data";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

/** Bookings made longer ago than this are never posted (keeps a long outage from flooding the channel). */
const LOOKBACK_HOURS = 24;

const SOURCE_LABEL: Record<string, string> = { airbnb: "Airbnb", booking: "Booking.com", direct: "Direct", vrbo: "Vrbo", homeaway: "Vrbo" };

type Booking = {
  id: string;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  guest_count: number | null;
  booking_source: string | null;
  host_payout: number | null;
  booked_at: string | null;
  created_at: string;
  raw_hospitable_data: unknown;
  properties: { property_name: string | null; public_name: string | null } | null;
};

/**
 * The booking feed (replaces the "New Reservations" Zap): one FYI post per new
 * accepted reservation, around the clock. Nobody is tagged and nothing needs
 * answering, so quiet hours don't apply. Each reservation is claimed in
 * pique_bot_booking_posts before posting, so a re-run never posts it twice.
 */
export async function runBookingFeed(admin: Admin, opts: { dry: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000).toISOString();
  const { data } = await admin
    .from("reservations")
    .select("id, check_in, check_out, nights, guest_count, booking_source, host_payout, booked_at, created_at, raw_hospitable_data, properties(property_name, public_name)")
    .eq("status", "accepted")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  const bookings = (data ?? []) as unknown as Booking[];
  if (!bookings.length) return [];

  const { data: done } = await admin
    .from("pique_bot_booking_posts")
    .select("reservation_id")
    .in("reservation_id", bookings.map((b) => b.id));
  const posted = new Set((done ?? []).map((d) => d.reservation_id));

  const results: Record<string, unknown>[] = [];
  for (const booking of bookings.filter((b) => !posted.has(b.id))) {
    const message = renderBooking(booking);
    if (opts.dry) {
      results.push({ reservation: booking.id, text: message.text });
      continue;
    }
    results.push(await postOne(admin, booking.id, message));
  }
  return results;
}

async function postOne(admin: Admin, reservationId: string, message: { text: string; blocks: unknown[] }) {
  const channel = CHANNELS.newBookings;
  const { error: claimError } = await admin.from("pique_bot_booking_posts").insert({ reservation_id: reservationId, channel_id: channel });
  if (claimError) return { reservation: reservationId, skipped: "already posted" };

  const sent = await slackApi<{ ts?: string }>("chat.postMessage", { channel, text: message.text, blocks: message.blocks, unfurl_links: false });
  if (!sent.ok || !sent.ts) {
    // Release the claim so the next run can try again.
    await admin.from("pique_bot_booking_posts").delete().eq("reservation_id", reservationId);
    return { reservation: reservationId, error: sent.error ?? "post failed" };
  }
  await admin.from("pique_bot_booking_posts").update({ slack_ts: sent.ts }).eq("reservation_id", reservationId);
  return { reservation: reservationId, slack_ts: sent.ts };
}

function formatDate(date: string | null): string {
  if (!date) return "?";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Edmonton", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function renderBooking(b: Booking): { text: string; blocks: unknown[] } {
  const raw = (b.raw_hospitable_data ?? {}) as {
    guest?: { first_name?: string; last_name?: string };
    guests?: { total?: number };
    financials?: { host?: { revenue?: { formatted?: string } } };
  };
  const unit = (b.properties?.property_name || b.properties?.public_name || "Unknown unit").replace(/\*+$/, "").trim();
  const guest = [raw.guest?.first_name, raw.guest?.last_name].filter(Boolean).join(" ") || "Guest";
  const guests = raw.guests?.total ?? b.guest_count;
  const source = b.booking_source ? (SOURCE_LABEL[b.booking_source] ?? b.booking_source) : "Unknown source";
  const payout = raw.financials?.host?.revenue?.formatted ?? (b.host_payout != null ? `CA$${Number(b.host_payout).toFixed(2)}` : null);
  const nights = b.nights ? ` (${b.nights} night${b.nights === 1 ? "" : "s"})` : "";
  const url = appUrl();

  const lines = [
    `:house_with_garden: *New booking* · *${unit}*`,
    `*${guest}*${guests ? ` · ${guests} guest${guests === 1 ? "" : "s"}` : ""}`,
    `${formatDate(b.check_in)} → ${formatDate(b.check_out)}${nights}`,
    `${source}${payout ? ` · ${payout} payout` : ""}`,
    `Booked ${formatTime(b.booked_at ?? b.created_at)}${url ? ` · <${url}/reservations?res=${b.id}|Open>` : ""}`,
  ];
  return {
    text: `New booking: ${unit} - ${guest}, ${formatDate(b.check_in)} to ${formatDate(b.check_out)}`,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }],
  };
}
