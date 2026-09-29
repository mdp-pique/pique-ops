/**
 * Which tickets Pique Bot asks about, where, and how early.
 *
 * leadDays: first morning to ask, in days before check-in. Anything still open
 * after check-in keeps coming back as overdue (up to OVERDUE_LIMIT_DAYS) until
 * someone answers it.
 */
export const CHANNELS = {
  teamChat: "C0574PA8KJT", // #pique-team-chat
  canmoreCleaning: "C057L8Z2DUK", // #canmore-cleaning
} as const;

export interface BotRule {
  label: string;
  channel: string;
  leadDays: number;
}

export const BOT_RULES: Record<string, BotRule> = {
  // Due before check-in: start asking two mornings ahead, urgent on the day.
  pet_fee: { label: "Pet fee", channel: CHANNELS.teamChat, leadDays: 2 },
  direct_booking_id_check: { label: "Direct booking ID", channel: CHANNELS.teamChat, leadDays: 2 },
  vehicle_registration: { label: "Parking registration", channel: CHANNELS.teamChat, leadDays: 2 },
  // Brought the morning of check-in, so only asked that morning.
  pack_n_play: { label: "Pack 'n play", channel: CHANNELS.canmoreCleaning, leadDays: 0 },
};

export const OVERDUE_LIMIT_DAYS = 30;

export const OPEN_STATUSES = ["open", "in_progress", "blocked"];

/** Slack allows 50 blocks per message; each ticket uses two. */
export const MAX_ROWS_PER_POST = 22;
