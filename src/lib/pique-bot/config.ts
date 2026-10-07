/**
 * Which tickets Pique Bot asks about, where, and how early.
 *
 * leadDays: first morning to ask, in days before check-in. Anything still open
 * after check-in keeps coming back as overdue (up to OVERDUE_LIMIT_DAYS) until
 * someone answers it.
 *
 * tier (docs/pique-bot-notification-legend.md): "morning" items are only asked
 * in the 7 AM post. "urgent" and "today" items are also posted the moment they
 * come in, and an urgent one gets a single reminder if nobody answers within the hour.
 *
 * Rules are keyed by ticket type, except email_alert tickets, keyed
 * "email:{rule}" (their email_alert_rules key), damage_report tickets, keyed
 * "damage:{form}", because each posts to its own channel, and cleaning_issue
 * tickets opened from a guest review, keyed "review_qc" - see ruleKeyFor().
 *
 * gated: a type taken over from a Zap. Pique Bot says nothing about it (no
 * immediate post, nothing in the 7 AM post) until it's listed in
 * automation_flags.pique_bot_alerts_live_types, so it can run in shadow first.
 */
export const CHANNELS = {
  teamChat: "C0574PA8KJT", // #pique-team-chat
  canmoreCleaning: "C057L8Z2DUK", // #canmore-cleaning
  cancellations: "C0ACP3E9LEA", // where "Cancelled Reservation -> Slack Notification" posted
  guestCount: "C0A1G739VFW", // where "New Reservations - 1 Guest Only" posted
  newBookings: "C09PB2MBJC9", // #new-reservations, where the "New Reservations" Zap posted (booking feed, bookings.ts)
  changelog: "C0C6QFWPJET", // #change-logs (changelog.ts)
  damages: "C05SX0T7NKE", // #damages-complaints-refunds-notification, where "Connecteam to Slack - Damages" posted
  linens: "C08BWP97S3Z", // #damaged-linens-by-guests-notification, where the linens form Zap posted
  newClaims: "C09P72Z8RK8", // #new-claim-notification, where the Truvi / Aircover claim Zaps posted
  qualityControl: "C09T31NSAPR", // #quality-control-reviews, where the review QC Zaps posted (review feed, reviews.ts)
  petBookings: "C0A9RLU3F6H", // #new-reservation-with-pet, where the "New Reservations - Pet" Zap posted
  // #pique-internal-cleaning-operations (private; id to fill in when Pique Bot is invited - the rule is gated until then).
  cleaningOps: "C_PENDING_CLEANING_OPS",
} as const;

export type Tier = "urgent" | "today" | "morning";

export interface BotRule {
  label: string;
  channel: string;
  leadDays: number;
  tier: Tier;
  /** "created": asked from the first morning after the ticket appears, not counted from check-in. */
  askFrom?: "checkin" | "created";
  /** Slack user ids tagged on the immediate post and its reminder (the people the Zap tagged). */
  tag?: string[];
  /** Silent until listed in automation_flags.pique_bot_alerts_live_types. */
  gated?: boolean;
  /** Where the immediate post goes, when it isn't the morning post's channel. */
  alertChannel?: string;
  /** Email alerts: also show the start of the email (the Gmail snippet). */
  snippet?: boolean;
}

// The four people "Cancelled Reservation -> Slack Notification" tagged.
const BOOKINGS_TEAM = ["U078P07JGGY", "U077KS6VC7R", "U06SZU27S5B", "U051SQ08E75"];
// Tagged by the Robert / Aircover / Truvi / Ondilo Zaps.
const LAURICE = "U049F2880MR";
const TAMMY = "U05QG0BUP0E";
const CRISTINE = "U077KS6VC7R";

/** Email rules (email_alert_rules.key), posted where each Zap posted and tagging who it tagged. */
function emailRule(label: string, channel: string, tier: Tier, tag?: string[]): BotRule {
  return { label, channel, leadDays: 0, tier, askFrom: "created", tag, gated: true };
}

export const BOT_RULES: Record<string, BotRule> = {
  // Due before check-in: start asking two mornings ahead, urgent on the day.
  // Posted in the pet channel as soon as the booking comes in, to request the fee (MDP 10-07, like the
  // old Zap); the 7 AM post in #pique-team-chat asks from 2 days before check-in until it's collected.
  pet_fee: { label: "Pet fee", channel: CHANNELS.teamChat, alertChannel: CHANNELS.petBookings, leadDays: 2, tier: "today" },
  direct_booking_id_check: { label: "Direct booking ID", channel: CHANNELS.teamChat, leadDays: 2, tier: "morning" },
  vehicle_registration: { label: "Parking registration", channel: CHANNELS.teamChat, leadDays: 2, tier: "morning" },
  // Brought the morning of check-in, so only asked that morning.
  pack_n_play: { label: "Pack 'n play", channel: CHANNELS.canmoreCleaning, leadDays: 0, tier: "morning" },
  // Booking events (replace Zaps; docs/zapier-migration.md lane B).
  save_booking: { label: "Cancelled booking - try to save it", channel: CHANNELS.cancellations, leadDays: 0, tier: "urgent", askFrom: "created", tag: BOOKINGS_TEAM, gated: true },
  guest_count_check: { label: "Only 1 guest - confirm the count", channel: CHANNELS.guestCount, leadDays: 0, tier: "today", askFrom: "created", gated: true },
  // Email alerts (replace ten Zaps; docs/zapier-migration.md lane E).
  "email:airbnb_support": emailRule("Airbnb Support email", "C09NZ05SYQ6", "urgent", ["U078P07JGGY", "U051SQ08E75", CRISTINE, "U06SZU27S5B"]),
  "email:robert_reply": emailRule("Reply from Robert", "C09DPRG1CD9", "urgent", [LAURICE, TAMMY]),
  "email:aircover": emailRule("Airbnb reimbursement email", "C08JYPWKV09", "today", [LAURICE]),
  "email:truvi": emailRule("Truvi resolution email", "C08JYPWKV09", "today", [LAURICE]),
  "email:ondilo": emailRule("Ondilo / Booking.com email", "C0ATUL9R3C1", "today", [LAURICE]),
  "email:mykey": emailRule("MyKey housing request", "C04B37U1SSJ", "today"),
  "email:sinistar": emailRule("Sinistar rental offer", "C04B37U1SSJ", "today"),
  "email:invoice": emailRule("Invoice to review", "C07VCQ4ECBV", "today"),
  "email:invoice_reviewed": emailRule("Enter invoice in QBO and Plooto", "C07VCQ4ECBV", "today", [CRISTINE]),
  "email:etransfer": emailRule("Interac e-Transfer", "C09RZ1ERTK8", "today"),
  // Replaces the n8n "Chrangela & PEKA Email → Slack Alert" workflow (MDP 10-07), without its @channel.
  "email:chrangela_peka": { ...emailRule("Email from Chrangela / PEKA", CHANNELS.teamChat, "today"), snippet: true },
  // Damage forms from Connecteam (replace four Zaps; docs/zapier-migration.md lane C). The post
  // asks AirCover claim / Truvi claim / Wear and tear instead of Done (see render.ts); a claim
  // opens a claim_tracker ticket, asked in #new-claim-notification tagging Laurice.
  "damage:damage": { label: "Damage reported", channel: CHANNELS.damages, leadDays: 0, tier: "today", askFrom: "created", gated: true },
  "damage:linens": { label: "Linens damaged by guest", channel: CHANNELS.linens, leadDays: 0, tier: "today", askFrom: "created", gated: true },
  claim_tracker: { label: "Claim to prepare", channel: CHANNELS.newClaims, leadDays: 0, tier: "today", askFrom: "created", tag: [LAURICE], gated: true },
  // A guest rated cleanliness below 5 (replaces the review QC Zaps; docs/zapier-migration.md lane Q).
  // Every other review is an FYI post in the same channel from the review feed (reviews.ts).
  review_qc: { label: "Cleanliness below 5", channel: CHANNELS.qualityControl, leadDays: 0, tier: "today", askFrom: "created", gated: true },
  // Joint-listing separator doors: lock on a checkout, unlock on a check-in. Tickets are made by the
  // 7 AM run itself (create_separator_door_tickets) and asked in that post (replaces an n8n @channel).
  separator_door: { label: "Separator door", channel: CHANNELS.cleaningOps, leadDays: 0, tier: "morning", askFrom: "created", gated: true },
};

/** The BOT_RULES key for a ticket: its type, or "email:{rule}" for email alerts. */
export function ruleKeyFor(type: string, metadata: unknown): string {
  const m = metadata as { rule?: unknown; form?: unknown; source?: unknown } | null;
  if (type === "email_alert") return typeof m?.rule === "string" ? `email:${m.rule}` : type;
  if (type === "damage_report") return `damage:${m?.form === "linens" ? "linens" : "damage"}`;
  // Only review-flagged cleaning issues are posted; ones made by hand have no rule.
  if (type === "cleaning_issue") return m?.source === "review" ? "review_qc" : type;
  return type;
}

/** The ticket type a BOT_RULES key belongs to. */
export function ticketTypeFor(ruleKey: string): string {
  if (ruleKey.startsWith("email:")) return "email_alert";
  if (ruleKey.startsWith("damage:")) return "damage_report";
  if (ruleKey === "review_qc") return "cleaning_issue";
  return ruleKey;
}

export const OVERDUE_LIMIT_DAYS = 30;

export const OPEN_STATUSES = ["open", "in_progress", "blocked"];

/** Nothing posts right away between these hours (Edmonton); it waits for the 7 AM post. */
export const QUIET_HOURS = { from: 21, until: 7 };

/** An unanswered urgent post gets one reminder in its thread after this long. */
export const REMIND_AFTER_MINUTES = 60;

/**
 * Who Pique Bot tags when it can't handle an answer on its own (a "Not yet"
 * note it can't read, or the AI call failing). A Pique profile id; the Slack
 * account is found from its sign-in email the first time and saved.
 */
export const ESCALATE_PROFILE_ID = "64320472-4508-4e15-aebd-71296c7b2ed9"; // MDP
