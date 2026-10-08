// How a guest review reads in Slack, shared by the review feed (reviews.ts, every
// review) and the cleaning_issue ticket a low cleanliness score opens (data.ts).
// Plain lines; the caller escapes them for Slack.

export interface ReviewSummary {
  platform: string | null;
  checkIn: string | null;
  checkOut: string | null;
  /** Edmonton only; Canmore and Calgary leave the cleaner out (MDP 10-07). */
  market: string | null;
  cleaningDate: string | null;
  cleanerNames: string | null;
  /** All out of 5 (Booking.com's out-of-10 categories already halved). */
  overall: number | null;
  cleanliness: number | null;
  accuracy: number | null;
  checkin: number | null;
  communication: number | null;
  location: number | null;
  value: number | null;
  cleanlinessComment: string | null;
  /** The guest's private notes on the other categories (check-in, accuracy...). */
  otherNotes?: { label: string; text: string }[];
  publicReview: string | null;
  privateFeedback: string | null;
}

const PLATFORM_LABEL: Record<string, string> = { airbnb: "Airbnb", booking: "Booking.com", direct: "Direct", vrbo: "Vrbo", homeaway: "Vrbo" };

const TEXT_LIMIT = 600;

function day(date: string | null): string | null {
  if (!date) return null;
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

function score(n: number | null): string | null {
  return n == null || n === 0 ? null : String(Math.round(n * 10) / 10);
}

function quote(text: string): string {
  return `"${text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}...` : text}"`;
}

export function reviewLines(r: ReviewSummary): string[] {
  const lines: string[] = [];
  const stay = r.checkIn && r.checkOut ? `${day(r.checkIn)} → ${day(r.checkOut)}` : null;
  const platform = r.platform ? (PLATFORM_LABEL[r.platform] ?? r.platform) : null;
  if (stay || platform) lines.push([stay && `Stay ${stay}`, platform].filter(Boolean).join(" · "));

  const remote = r.market === "Canmore" || r.market === "Calgary";
  if (r.cleanerNames) lines.push(`Cleaner: ${r.cleanerNames}${r.cleaningDate ? ` (cleaned ${day(r.cleaningDate)})` : ""}`);
  else if (!remote && r.checkOut) lines.push("Cleaner: no Connecteam shift found");

  const scores = (
    [
      ["Overall", r.overall],
      ["Cleanliness", r.cleanliness],
      ["Accuracy", r.accuracy],
      ["Check-in", r.checkin],
      ["Communication", r.communication],
      ["Location", r.location],
      ["Value", r.value],
    ] as const
  )
    .map(([label, n]) => (score(n) ? `${label} ${score(n)}` : null))
    .filter(Boolean);
  if (scores.length) lines.push(scores.join(" · "));

  if (r.cleanlinessComment) lines.push(`Cleanliness note: ${quote(r.cleanlinessComment)}`);
  for (const n of r.otherNotes ?? []) lines.push(`${n.label} note: ${quote(n.text)}`);
  if (r.publicReview) lines.push(`Public: ${quote(r.publicReview)}`);
  if (r.privateFeedback) lines.push(`Private: ${quote(r.privateFeedback)}`);
  return lines;
}

const CATEGORY_LABEL: Record<string, string> = {
  accuracy: "Accuracy",
  checkin: "Check-in",
  communication: "Communication",
  location: "Location",
  value: "Value",
};

/** Private per-category comments from Hospitable's raw review, other than cleanliness (shown on its own). */
export function otherCategoryNotes(raw: unknown): { label: string; text: string }[] {
  const ratings = (raw as { private?: { detailed_ratings?: { type?: string; comment?: string | null }[] } } | null)?.private?.detailed_ratings ?? [];
  return ratings
    .filter((d) => d.type && d.type !== "cleanliness" && d.comment?.trim())
    .map((d) => ({ label: CATEGORY_LABEL[d.type!] ?? d.type!, text: d.comment!.trim() }));
}

/** The ticket's metadata (record_review_qc) as a summary. */
export function summaryFromMetadata(m: Record<string, unknown>): ReviewSummary {
  const str = (k: string) => (typeof m[k] === "string" && m[k] ? (m[k] as string) : null);
  const num = (k: string) => (m[k] == null || m[k] === "" ? null : Number(m[k]));
  return {
    platform: str("platform"),
    checkIn: str("check_in"),
    checkOut: str("check_out"),
    market: str("market"),
    cleaningDate: str("cleaning_date"),
    cleanerNames: str("cleaner_names"),
    overall: num("overall"),
    cleanliness: num("cleanliness"),
    accuracy: num("accuracy"),
    checkin: num("checkin"),
    communication: num("communication"),
    location: num("location"),
    value: num("value"),
    cleanlinessComment: str("cleanliness_comment"),
    publicReview: str("public_review"),
    privateFeedback: str("private_feedback"),
  };
}
