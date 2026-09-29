// Pure layout for Pique Bot's Slack messages - no I/O, so it can be checked on
// its own. The same function draws the 7 AM post and every update after a tap.
import { BOT_RULES, MAX_ROWS_PER_POST, OVERDUE_LIMIT_DAYS } from "./config";

export interface BotItem {
  id: string;
  label: string;
  isDone: boolean;
}

export interface BotRow {
  ticketId: string;
  type: string;
  status: string;
  guestName: string | null;
  property: string | null;
  /** Local YYYY-MM-DD: the reservation's check-in, or the ticket's due date when it has no reservation. */
  checkIn: string | null;
  items: BotItem[];
  /** Slack user id to tag, when the assignee has linked Slack. */
  assigneeSlackId: string | null;
  assigneeName: string | null;
  teamName: string | null;
  /** The latest Slack answer since this post went out. */
  lastAnswer: { kind: "done" | "not_yet" | "problem"; by: string; note?: string } | null;
  /** Who last ticked a step from this post - unlocks "Add note". */
  doneBy: string | null;
  /** Notes added from this post, oldest first. */
  notes: { by: string; text: string }[];
}

// Slack block kit is loosely typed on purpose: only the shapes used here.
export type Block = Record<string, unknown>;

export function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10));
  const b = Date.UTC(+toDate.slice(0, 4), +toDate.slice(5, 7) - 1, +toDate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Slack mrkdwn: & < > must be escaped in anything that came from a guest or a listing. */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function nextItem(row: BotRow): BotItem | null {
  return row.items.find((i) => !i.isDone) ?? null;
}

export function isFinished(row: BotRow): boolean {
  return !["open", "in_progress", "blocked"].includes(row.status) || nextItem(row) === null;
}

function whenText(row: BotRow, postDate: string): string {
  if (!row.checkIn) return "No check-in date";
  const d = daysBetween(postDate, row.checkIn);
  if (d < 0) return `:warning: *Overdue* - checked in ${shortDate(row.checkIn)}`;
  if (d === 0) return ":rotating_light: *Checks in today*";
  if (d === 1) return "Checks in tomorrow";
  return `Checks in ${shortDate(row.checkIn)}`;
}

function question(row: BotRow, item: BotItem): string {
  if (row.type === "pack_n_play") return `Was the pack 'n play brought to ${esc(row.property ?? "the unit")}?`;
  return `${esc(item.label)}?`;
}

function owner(row: BotRow): string {
  if (row.assigneeSlackId) return ` <@${row.assigneeSlackId}>`;
  if (row.assigneeName) return ` (${esc(row.assigneeName)})`;
  if (row.teamName) return ` (${esc(row.teamName)})`;
  return "";
}

/** Sort order: overdue first, then today, then later, each by check-in. */
export function sortRows(rows: BotRow[]): BotRow[] {
  return [...rows].sort((a, b) => (a.checkIn ?? "9999").localeCompare(b.checkIn ?? "9999"));
}

export function renderRow(row: BotRow, postId: string, postDate: string, appUrl: string | null): Block[] {
  const rule = BOT_RULES[row.type];
  const title = [`*${rule?.label ?? row.type}*`, row.guestName && esc(row.guestName), row.property && esc(row.property)]
    .filter(Boolean)
    .join(" · ");

  const item = nextItem(row);
  const lines = [title, whenText(row, postDate)];

  const noteLines = row.notes.slice(-2).map((n) => `:memo: ${esc(n.by)}: "${esc(n.text.slice(0, 200))}"`);
  const noteButton: Block = {
    type: "button",
    action_id: "pique_bot_note",
    text: { type: "plain_text", text: "Add note" },
    value: `${postId}|${row.ticketId}`,
  };

  if (isFinished(row)) {
    lines.push(`:white_check_mark: Done${row.doneBy ? ` by ${esc(row.doneBy)}` : ""}`, ...noteLines);
    const section: Block = { type: "section", block_id: `t:${row.ticketId}`, text: { type: "mrkdwn", text: lines.join("\n") } };
    // Done stays one tap; the note is optional, offered once someone has ticked it here.
    if (!row.doneBy) return [section];
    return [section, { type: "actions", block_id: `a:${row.ticketId}`, elements: [noteButton] }];
  }

  lines.push(`${question(row, item!)}${owner(row)}`);
  if (row.lastAnswer?.kind === "not_yet") lines.push(`:hourglass_flowing_sand: Not yet - ${esc(row.lastAnswer.by)}`);
  if (row.lastAnswer?.kind === "problem") {
    lines.push(`:warning: Problem - ${esc(row.lastAnswer.by)}${row.lastAnswer.note ? `: "${esc(row.lastAnswer.note.slice(0, 200))}"` : ""}`);
  }
  if (row.lastAnswer?.kind === "done") lines.push(`:white_check_mark: Ticked by ${esc(row.lastAnswer.by)} - next step above`);
  lines.push(...noteLines);

  const value = `${postId}|${row.ticketId}|${item!.id}`;
  const elements: Block[] = [
    { type: "button", action_id: "pique_bot_done", style: "primary", text: { type: "plain_text", text: "Done" }, value },
    { type: "button", action_id: "pique_bot_not_yet", text: { type: "plain_text", text: "Not yet" }, value },
    { type: "button", action_id: "pique_bot_problem", style: "danger", text: { type: "plain_text", text: "Problem" }, value },
  ];
  if (row.doneBy) elements.push(noteButton);
  if (appUrl) {
    elements.push({
      type: "button",
      action_id: "pique_bot_open",
      text: { type: "plain_text", text: "Open" },
      url: `${appUrl}/tickets/requests?ticket=${row.ticketId}`,
    });
  }

  return [
    { type: "section", block_id: `t:${row.ticketId}`, text: { type: "mrkdwn", text: lines.join("\n") } },
    { type: "actions", block_id: `a:${row.ticketId}`, elements },
  ];
}

export function renderPost(rows: BotRow[], postId: string, postDate: string, appUrl: string | null): { text: string; blocks: Block[] } {
  const sorted = sortRows(rows);
  const shown = sorted.slice(0, MAX_ROWS_PER_POST);
  const open = sorted.filter((r) => !isFinished(r)).length;

  const blocks: Block[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:sunrise: *Morning check-ins - ${shortDate(postDate)}*\n${
          open === 0 ? "All done for today :tada:" : `${open} to confirm. Tap *Done* when it's handled - anything still open comes back tomorrow at 7.`
        }`,
      },
    },
    { type: "divider" },
  ];
  for (const row of shown) blocks.push(...renderRow(row, postId, postDate, appUrl));
  if (sorted.length > shown.length) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `+${sorted.length - shown.length} more - see Requests in the Pique app.` }],
    });
  }

  return { text: `Morning check-ins - ${open} to confirm`, blocks };
}

/** What the morning post for one channel asks about: due within the type's lead time, or overdue up to the limit, and not already finished. */
export function pickForMorning(rows: BotRow[], today: string, channel: string): BotRow[] {
  return rows.filter((r) => {
    const rule = BOT_RULES[r.type];
    if (!rule || rule.channel !== channel || !r.checkIn || isFinished(r)) return false;
    const d = daysBetween(today, r.checkIn);
    return d <= rule.leadDays && d >= -OVERDUE_LIMIT_DAYS;
  });
}
