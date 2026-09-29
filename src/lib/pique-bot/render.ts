// Pure layout for Pique Bot's Slack messages - no I/O, so it can be checked on
// its own. The same function draws the 7 AM post and every update after a tap.
import { BOT_RULES, OVERDUE_LIMIT_DAYS } from "./config";

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
  /** A step ticked from this post (the next step is now showing). */
  lastAnswer: { kind: "done"; by: string } | null;
  /** Who last ticked a step from this post - unlocks "Add note". */
  doneBy: string | null;
  /** Notes added from this post, oldest first. */
  notes: { by: string; text: string }[];
  /** The latest "Not yet" with nothing ticked since. until: the morning to ask again (null on old answers). */
  waiting: { kind: "not_yet" | "problem"; by: string; note: string | null; until: string | null; reason: string | null } | null;
  /** Closed from Slack as not needed anymore. */
  notNeeded: { by: string; note: string | null } | null;
}

// Slack block kit is loosely typed on purpose: only the shapes used here.
export type Block = Record<string, unknown>;

export function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10));
  const b = Date.UTC(+toDate.slice(0, 4), +toDate.slice(5, 7) - 1, +toDate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function shortDate(date: string): string {
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

function titleOf(row: BotRow): string {
  const rule = BOT_RULES[row.type];
  return [`*${rule?.label ?? row.type}*`, row.guestName && esc(row.guestName), row.property && esc(row.property)]
    .filter(Boolean)
    .join(" · ");
}

function noteLines(row: BotRow): string[] {
  return row.notes.slice(-2).map((n) => `:memo: ${esc(n.by)}: "${esc(n.text.slice(0, 200))}"`);
}

function noteButton(row: BotRow, postId: string): Block {
  return { type: "button", action_id: "pique_bot_note", text: { type: "plain_text", text: "Add note" }, value: `${postId}|${row.ticketId}` };
}

/** Waiting on a later day: it stays quiet in the morning post until then. */
export function isSnoozed(row: BotRow, date: string): boolean {
  return !!row.waiting?.until && row.waiting.until > date;
}

function waitingLines(row: BotRow, postDate: string): string[] {
  const w = row.waiting;
  if (!w) return [];
  const label = w.kind === "problem" ? ":warning: *Problem*" : ":hourglass_flowing_sand: Not yet";
  const lines = [`${label} - ${esc(w.by)}${w.note ? `: "${esc(w.note.slice(0, 200))}"` : ""}`];
  if (w.until && w.until > postDate) lines.push(`I'll ask again ${shortDate(w.until)}${w.reason ? ` (${esc(w.reason)})` : ""}`);
  return lines;
}

/** An item that still needs an answer: the question plus Done / Not yet / Open. */
export function renderOpenRow(row: BotRow, postId: string, postDate: string, appUrl: string | null): Block[] {
  const item = nextItem(row)!;
  const lines = [titleOf(row), whenText(row, postDate), `${question(row, item)}${owner(row)}`];
  if (row.lastAnswer?.kind === "done") lines.push(`:white_check_mark: Previous step ticked by ${esc(row.lastAnswer.by)}`);
  lines.push(...waitingLines(row, postDate), ...noteLines(row));

  const value = `${postId}|${row.ticketId}|${item.id}`;
  const elements: Block[] = [
    { type: "button", action_id: "pique_bot_done", style: "primary", text: { type: "plain_text", text: "Done" }, value },
    { type: "button", action_id: "pique_bot_not_yet", text: { type: "plain_text", text: "Not yet" }, value },
  ];
  if (row.doneBy) elements.push(noteButton(row, postId));
  if (appUrl) {
    elements.push({ type: "button", action_id: "pique_bot_open", text: { type: "plain_text", text: "Open" }, url: `${appUrl}/tickets/requests?ticket=${row.ticketId}` });
  }

  return [
    { type: "section", block_id: `t:${row.ticketId}`, text: { type: "mrkdwn", text: lines.join("\n") } },
    { type: "actions", block_id: `a:${row.ticketId}`, elements },
  ];
}

/** A finished item, collapsed to one crossed-out line (plus any notes), with Add note on the right. */
export function renderDoneRow(row: BotRow, postId: string): Block {
  const plainTitle = titleOf(row).replace(/\*/g, "");
  const how = row.notNeeded
    ? ` - not needed (${esc(row.notNeeded.by)})${row.notNeeded.note ? `: "${esc(row.notNeeded.note.slice(0, 200))}"` : ""}`
    : row.doneBy
      ? ` - done by ${esc(row.doneBy)}`
      : " - done";
  const lines = [`:white_check_mark: ~${plainTitle}~${how}`, ...noteLines(row)];
  const section: Block = { type: "section", block_id: `t:${row.ticketId}`, text: { type: "mrkdwn", text: lines.join("\n") } };
  if (row.doneBy) section.accessory = noteButton(row, postId);
  return section;
}

/** Slack's limit is 50 blocks per message. */
const BLOCK_BUDGET = 50;

export function renderPost(rows: BotRow[], postId: string, postDate: string, appUrl: string | null): { text: string; blocks: Block[] } {
  const sorted = sortRows(rows);
  const open = sorted.filter((r) => !isFinished(r) && !isSnoozed(r, postDate));
  const later = sorted.filter((r) => !isFinished(r) && isSnoozed(r, postDate));
  const done = sorted.filter((r) => isFinished(r));

  const blocks: Block[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:sunrise: *Morning check-ins - ${shortDate(postDate)}*\n${
          open.length === 0
            ? "All done for today :tada:"
            : "Tap *Done* when it's handled, or *Not yet* to say what's going on and when to ask again. Anything else still open comes back tomorrow at 7."
        }`,
      },
    },
  ];

  // Reserve room for the done section header and one "+N more" line, then fill open items first.
  let budget = BLOCK_BUDGET - blocks.length - 3;
  let hidden = 0;

  const openSection = (rows: BotRow[], heading: string) => {
    if (!rows.length) return;
    blocks.push({ type: "divider" }, { type: "section", text: { type: "mrkdwn", text: heading } });
    budget -= 2;
    rows.forEach((row, i) => {
      const cost = i === 0 ? 2 : 3;
      if (cost > budget) {
        hidden++;
        return;
      }
      if (i > 0) blocks.push({ type: "divider" });
      blocks.push(...renderOpenRow(row, postId, postDate, appUrl));
      budget -= cost;
    });
  };
  openSection(open, `:red_circle: *Still open (${open.length})*`);
  openSection(later, `:hourglass_flowing_sand: *Asking again later (${later.length})*`);

  if (done.length) {
    blocks.push({ type: "divider" }, { type: "section", text: { type: "mrkdwn", text: `:white_check_mark: *Done today (${done.length})*` } });
    budget -= 2;
    for (const row of done) {
      if (budget < 1) {
        hidden++;
        continue;
      }
      blocks.push(renderDoneRow(row, postId));
      budget -= 1;
    }
  }

  if (hidden > 0) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `+${hidden} more - see Requests in the Pique app.` }] });
  }

  return { text: `Morning check-ins - ${open.length + later.length} still open, ${done.length} done`, blocks };
}

/** What the morning post for one channel asks about: due within the type's lead time, or overdue up to the limit, not finished, and not waiting on a later ask-again date. */
export function pickForMorning(rows: BotRow[], today: string, channel: string): BotRow[] {
  return rows.filter((r) => {
    const rule = BOT_RULES[r.type];
    if (!rule || rule.channel !== channel || !r.checkIn || isFinished(r) || isSnoozed(r, today)) return false;
    const d = daysBetween(today, r.checkIn);
    return d <= rule.leadDays && d >= -OVERDUE_LIMIT_DAYS;
  });
}
