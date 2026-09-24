// Ticket clock + health presentation (PRD §8.2). Health itself is computed in
// the database; this only turns started/due into "Day 9 of 14" style labels.

export type Health = "on_track" | "attention" | "behind" | "missed" | "waiting";

const RANK: Record<string, number> = { missed: 0, behind: 1, attention: 2, waiting: 3, on_track: 4 };

export function healthRank(h: string | null): number {
  return h ? (RANK[h] ?? 5) : 5;
}

const LABEL: Record<string, string> = {
  on_track: "On track",
  attention: "Needs attention",
  behind: "Behind",
  missed: "Missed",
  waiting: "Waiting",
};

export function healthLabel(h: string | null): string {
  return h ? (LABEL[h] ?? h) : "No due date";
}

export function healthVariant(h: string | null): "ok" | "warn" | "crit" | "neutral" | "missed" {
  switch (h) {
    case "on_track":
      return "ok";
    case "attention":
      return "warn";
    case "behind":
      return "crit";
    case "missed":
      return "missed";
    default:
      return "neutral";
  }
}

export interface Clock {
  label: string;
  pct: number;
  overdue: boolean;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function span(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))}m`;
  if (ms < 2 * DAY) return `${Math.round(ms / HOUR)}h`;
  return `${Math.round(ms / DAY)}d`;
}

function localDay(ms: number): number {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(ms);
  return Date.parse(`${ymd}T00:00:00Z`) / DAY;
}

/**
 * Day-scale clocks count property-local calendar days from the anchor (a claim
 * that started at checkout on the 15th and is due the 29th is "Day 9 of 14" on
 * the 24th); short ones (30 min, 2 h) read "18m left".
 */
export function clockFor(startedAt: string | null, dueAt: string | null, now = Date.now()): Clock | null {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  const start = startedAt ? Date.parse(startedAt) : due;
  const total = due - start;
  const overdue = now > due;
  const pct = total > 0 ? Math.min(1, Math.max(0, (now - start) / total)) : overdue ? 1 : 0;

  if (overdue) return { label: `${span(now - due)} overdue`, pct: 1, overdue };
  if (total < 36 * HOUR) return { label: `${span(due - now)} left`, pct, overdue };

  const daysToDue = localDay(due) - localDay(now);
  if (daysToDue === 0) return { label: "Due today", pct, overdue };
  if (daysToDue === 1) return { label: "Due tomorrow", pct, overdue };
  const totalDays = Math.max(1, localDay(due) - localDay(start));
  const day = Math.min(totalDays, Math.max(1, localDay(now) - localDay(start)));
  return { label: `Day ${day} of ${totalDays}`, pct, overdue };
}

export function formatClockDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Edmonton" });
}
