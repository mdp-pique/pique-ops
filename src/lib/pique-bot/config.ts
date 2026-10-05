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
 * gated: a type taken over from a Zap. Pique Bot says nothing about it (no
 * immediate post, nothing in the 7 AM post) until it's listed in
 * automation_flags.pique_bot_alerts_live_types, so it can run in shadow first.
 */
export const CHANNELS = {
  teamChat: "C0574PA8KJT", // #pique-team-chat
  canmoreCleaning: "C057L8Z2DUK", // #canmore-cleaning
  cancellations: "C0ACP3E9LEA", // where "Cancelled Reservation -> Slack Notification" posted
  guestCount: "C0A1G739VFW", // where "New Reservations - 1 Guest Only" posted
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
}

// The four people "Cancelled Reservation -> Slack Notification" tagged.
const BOOKINGS_TEAM = ["U078P07JGGY", "U077KS6VC7R", "U06SZU27S5B", "U051SQ08E75"];

export const BOT_RULES: Record<string, BotRule> = {
  // Due before check-in: start asking two mornings ahead, urgent on the day.
  pet_fee: { label: "Pet fee", channel: CHANNELS.teamChat, leadDays: 2, tier: "morning" },
  direct_booking_id_check: { label: "Direct booking ID", channel: CHANNELS.teamChat, leadDays: 2, tier: "morning" },
  vehicle_registration: { label: "Parking registration", channel: CHANNELS.teamChat, leadDays: 2, tier: "morning" },
  // Brought the morning of check-in, so only asked that morning.
  pack_n_play: { label: "Pack 'n play", channel: CHANNELS.canmoreCleaning, leadDays: 0, tier: "morning" },
  // Booking events (replace Zaps; docs/zapier-migration.md lane B).
  save_booking: { label: "Cancelled booking - try to save it", channel: CHANNELS.cancellations, leadDays: 0, tier: "urgent", askFrom: "created", tag: BOOKINGS_TEAM, gated: true },
  guest_count_check: { label: "Only 1 guest - confirm the count", channel: CHANNELS.guestCount, leadDays: 0, tier: "morning", askFrom: "created", gated: true },
};

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
