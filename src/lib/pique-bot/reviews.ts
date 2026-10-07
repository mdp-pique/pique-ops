import { createAdminClient } from "@/lib/supabase/admin";
import { CHANNELS } from "./config";
import { appUrl } from "./data";
import { reviewLines, type ReviewSummary } from "./reviewFormat";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

/** Reviews recorded longer ago than this are never posted (keeps a long outage from flooding the channel). */
const LOOKBACK_DAYS = 3;

const QC_COLUMNS =
  "review_id, reservation_id, cleaning_date, cleaner_names, cleanliness, channel_id, slack_ts, " +
  "reviews(reviewer_name, booking_source, overall_rating, accuracy_rating, checkin_rating, communication_rating, location_rating, value_rating, review_text, raw_hospitable_data), " +
  "properties(property_name, public_name, market), reservations(check_in, check_out)";

type QcRow = {
  review_id: string;
  reservation_id: string | null;
  cleaning_date: string | null;
  cleaner_names: string | null;
  cleanliness: number | null;
  channel_id: string | null;
  slack_ts: string | null;
  reviews: {
    reviewer_name: string | null;
    booking_source: string | null;
    overall_rating: number | null;
    accuracy_rating: number | null;
    checkin_rating: number | null;
    communication_rating: number | null;
    location_rating: number | null;
    value_rating: number | null;
    review_text: string | null;
    raw_hospitable_data: unknown;
  } | null;
  properties: { property_name: string | null; public_name: string | null; market: string | null } | null;
  reservations: { check_in: string | null; check_out: string | null } | null;
};

/**
 * The review feed (replaces the review QC Zaps, docs/zapier-migration.md lane Q):
 * one FYI post per guest review in #quality-control-reviews, with the cleaner of
 * the checkout clean (Edmonton) and the scores. A review with cleanliness below 5
 * is not posted here: it opened a cleaning_issue ticket (record_review_qc), which
 * Pique Bot posts in the same channel with Done / Not yet, tagging nobody (rule
 * review_qc). Nothing to answer here, so it posts around the clock. Each review
 * is claimed (review_qc.posted_at) before posting, so a re-run never posts it twice.
 */
export async function runReviewFeed(admin: Admin, opts: { dry: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  // The sync links a review to its stay at the end of its run, and the trigger records it then.
  // Reviews that never get linked are recorded without a stay after 10 minutes.
  if (!opts.dry) {
    const { error } = await admin.rpc("record_unlinked_review_qc");
    if (error) console.error(`Review feed: recording unlinked reviews failed: ${error.message}`);
  }
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data } = await admin
    .from("review_qc")
    .select(QC_COLUMNS)
    .eq("flagged", false)
    .is("posted_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as unknown as QcRow[];

  const results: Record<string, unknown>[] = [];
  for (const row of rows) {
    const message = renderReview(row);
    if (opts.dry) {
      results.push({ review: row.review_id, text: message.text });
      continue;
    }
    results.push(await postOne(admin, row.review_id, message));
  }
  return results;
}

/** Redraws posts already sent (e.g. after their stay or cleaner was filled in). */
export async function redrawReviews(admin: Admin, reviewIds: string[], opts: { dry: boolean }) {
  const { data } = await admin.from("review_qc").select(QC_COLUMNS).in("review_id", reviewIds).not("slack_ts", "is", null);
  const results: Record<string, unknown>[] = [];
  for (const row of (data ?? []) as unknown as QcRow[]) {
    const message = renderReview(row);
    if (opts.dry) {
      results.push({ review: row.review_id, text: message.text });
      continue;
    }
    const sent = await slackApi("chat.update", { channel: row.channel_id, ts: row.slack_ts, text: message.text, blocks: message.blocks });
    results.push(sent.ok ? { review: row.review_id, redrawn: true } : { review: row.review_id, error: sent.error ?? "update failed" });
  }
  return results;
}

async function postOne(admin: Admin, reviewId: string, message: { text: string; blocks: unknown[] }) {
  const channel = CHANNELS.qualityControl;
  const { data: claimed } = await admin
    .from("review_qc")
    .update({ posted_at: new Date().toISOString(), channel_id: channel })
    .eq("review_id", reviewId)
    .is("posted_at", null)
    .select("review_id");
  if (!claimed?.length) return { review: reviewId, skipped: "already posted" };

  const sent = await slackApi<{ ts?: string }>("chat.postMessage", { channel, text: message.text, blocks: message.blocks, unfurl_links: false });
  if (!sent.ok || !sent.ts) {
    // Release the claim so the next run can try again.
    await admin.from("review_qc").update({ posted_at: null, channel_id: null }).eq("review_id", reviewId);
    return { review: reviewId, error: sent.error ?? "post failed" };
  }
  await admin.from("review_qc").update({ slack_ts: sent.ts }).eq("review_id", reviewId);
  return { review: reviewId, slack_ts: sent.ts };
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderReview(row: QcRow): { text: string; blocks: unknown[] } {
  const r = row.reviews;
  const raw = (r?.raw_hospitable_data ?? {}) as { private?: { feedback?: string | null; detailed_ratings?: { type?: string; comment?: string | null }[] } };
  // Booking.com scores its categories out of 10; everything shows out of 5.
  const scale = r?.booking_source === "booking" ? 2 : 1;
  const cat = (n: number | null | undefined) => (n ? Number(n) / scale : null);
  const unit = (row.properties?.property_name || row.properties?.public_name || "Unknown unit").replace(/\*+$/, "").trim();
  const guest = r?.reviewer_name?.trim() || "Guest";

  const summary: ReviewSummary = {
    platform: r?.booking_source ?? null,
    checkIn: row.reservations?.check_in ?? null,
    checkOut: row.reservations?.check_out ?? null,
    market: row.properties?.market ?? null,
    cleaningDate: row.cleaning_date,
    cleanerNames: row.cleaner_names,
    overall: r?.overall_rating ? Number(r.overall_rating) : null,
    cleanliness: row.cleanliness == null ? null : Number(row.cleanliness),
    accuracy: cat(r?.accuracy_rating),
    checkin: cat(r?.checkin_rating),
    communication: cat(r?.communication_rating),
    location: cat(r?.location_rating),
    value: cat(r?.value_rating),
    cleanlinessComment: raw.private?.detailed_ratings?.find((d) => d.type === "cleanliness")?.comment?.trim() || null,
    publicReview: r?.review_text?.trim() || null,
    privateFeedback: raw.private?.feedback?.trim() || null,
  };

  const heading =
    summary.cleanliness != null
      ? `:sparkles: *${esc(unit)}* · 5 for cleanliness${row.cleaner_names ? " - the cleaner might need a congrats" : ""}`
      : `:star: *New review* · *${esc(unit)}*`;
  const url = appUrl();
  const lines = [heading, `*${esc(guest)}*`, ...reviewLines(summary).map(esc)];
  if (url && row.reservation_id) lines.push(`<${url}/reservations?res=${row.reservation_id}|Open>`);
  return {
    text: `New review: ${unit} - ${guest}${summary.overall ? `, ${summary.overall} overall` : ""}`,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }],
  };
}
