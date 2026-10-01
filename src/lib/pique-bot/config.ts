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

/**
 * Who Pique Bot tags when it can't handle an answer on its own (a "Not yet"
 * note it can't read, or the AI call failing). A Pique profile id; the Slack
 * account is found from its sign-in email the first time and saved.
 */
export const ESCALATE_PROFILE_ID = "64320472-4508-4e15-aebd-71296c7b2ed9"; // MDP
