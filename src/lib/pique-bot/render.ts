// Pure layout for Pique Bot's Slack messages - no I/O, so it can be checked on
// its own. The same function draws the 7 AM post and every update after a tap.
import { domainForType } from "@/lib/pique-ui/domains";
import { BOT_RULES, mention, OVERDUE_LIMIT_DAYS, type Tier } from "./config";

export interface BotItem {
  id: string;
  label: string;
  isDone: boolean;
}

export interface BotRow {
  ticketId: string;
  type: string;
  /** The BOT_RULES key: the type, or "email:{rule}" for email alerts. */
  ruleKey: string;
  /** Email alerts: sender, subject and link, shown instead of the check-in date. */
  context: { from: string | null; subject: string | null; url: string | null; receivedAt: string | null; snippet: string | null } | null;
  /** Damage reports and claims: what was reported and its photos, shown instead of the check-in date
   * (pet fees: the stay, shown under the check-in line, withCheckIn). */
  details: { lines: string[]; photos: string[]; decision: string | null; withCheckIn?: boolean } | null;
  status: string;
  guestName: string | null;
  property: string | null;
  /** Local YYYY-MM-DD: the reservation's check-in, or the ticket's due date when it has no reservation. */
  checkIn: string | null;
  /** When the ticket was created (ISO). */
  createdAt: string;
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

function receivedText(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Edmonton" });
}

/** Gmail snippets come HTML-escaped. */
function unescapeHtml(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Sender, subject and link for an email alert (Slack link text can't contain | or >). */
function emailLines(c: NonNullable<BotRow["context"]>, withSnippet: boolean): string {
  const lines: string[] = [];
  if (c.from) lines.push(`From: ${esc(c.from)}`);
  if (c.subject) lines.push(`Subject: ${esc(c.subject)}`);
  if (withSnippet && c.snippet) lines.push(`> ${esc(unescapeHtml(c.snippet)).replace(/\s+/g, " ").trim()}...`);
  const received = c.receivedAt ? receivedText(c.receivedAt) : "";
  const link = c.url ? `<${c.url}|Open the email>` : "";
  if (received || link) lines.push([received && `Received ${received}`, link].filter(Boolean).join(" · "));
  return lines.join("\n");
}

function detailLines(d: NonNullable<BotRow["details"]>): string {
  const lines = d.lines.map(esc);
  // The photos open in the app's gallery (Open); links straight to the Connecteam CDN download instead of showing.
  if (d.photos.length) lines.push(`:camera: ${d.photos.length} photo${d.photos.length === 1 ? "" : "s"} - tap *Open* to see them`);
  return lines.join("\n");
}

function whenText(row: BotRow, postDate: string): string {
  if (row.context) return emailLines(row.context, !!BOT_RULES[row.ruleKey]?.snippet);
  if (row.details && !row.details.withCheckIn) return detailLines(row.details);
  const checkIn = checkInText(row, postDate);
  return row.details ? `${checkIn}\n${detailLines(row.details)}` : checkIn;
}

function checkInText(row: BotRow, postDate: string): string {
  if (!row.checkIn) return "No check-in date";
  const d = daysBetween(postDate, row.checkIn);
  if (d < 0) return `:warning: *Overdue* - checked in ${shortDate(row.checkIn)}`;
  if (d === 0) return ":rotating_light: *Checks in today*";
  if (d === 1) return "Checks in tomorrow";
  return `Checks in ${shortDate(row.checkIn)}`;
}

function question(row: BotRow, item: BotItem): string {
  if (row.type === "damage_report") return "AirCover claim, Truvi claim, or wear and tear?";
  if (row.type === "pack_n_play") return `Was the pack 'n play brought to ${esc(row.property ?? "the unit")}?`;
  if (row.ruleKey === "parking:no_form") return "Get the plate from the guest, or make sure they know there's no parking";
  return `${esc(item.label)}?`;
}

function owner(row: BotRow): string {
  if (row.assigneeSlackId) return ` <@${row.assigneeSlackId}>`;
  if (row.assigneeName) return ` (${esc(row.assigneeName)})`;
  if (row.teamName) return ` (${esc(row.teamName)})`;
  return "";
}

const TIER_RANK: Record<Tier, number> = { urgent: 0, today: 1, morning: 2 };

function tierRank(row: BotRow): number {
  return TIER_RANK[BOT_RULES[row.ruleKey]?.tier ?? "morning"];
}

/** Sort order: urgent items first, then overdue, today, later, each by check-in. */
export function sortRows(rows: BotRow[]): BotRow[] {
  return [...rows].sort((a, b) => tierRank(a) - tierRank(b) || (a.checkIn ?? "9999").localeCompare(b.checkIn ?? "9999"));
}

function titleOf(row: BotRow): string {
  const rule = BOT_RULES[row.ruleKey];
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

/**
 * An item that still needs an answer: the question plus Done / Not yet / Open.
 * Once it's been answered for later, only Open is left - it's off today's list,
 * and anyone who finishes it early ticks it in the app.
 */
export function renderOpenRow(row: BotRow, postId: string, postDate: string, appUrl: string | null): Block[] {
  const later = isSnoozed(row, postDate);
  const item = nextItem(row)!;
  const lines = [titleOf(row), whenText(row, postDate), `${question(row, item)}${owner(row)}`];
  if (row.lastAnswer?.kind === "done") lines.push(`:white_check_mark: Previous step ticked by ${esc(row.lastAnswer.by)}`);
  lines.push(...waitingLines(row, postDate), ...noteLines(row));

  const value = `${postId}|${row.ticketId}|${item.id}`;
  const notYet: Block = { type: "button", action_id: "pique_bot_not_yet", text: { type: "plain_text", text: "Not yet" }, value };
  // A damage report is a choice, not a tick: each button opens the matching follow-up ticket.
  const answers: Block[] =
    row.type === "damage_report"
      ? [
          { type: "button", action_id: "pique_bot_damage_aircover", style: "primary", text: { type: "plain_text", text: "AirCover claim" }, value },
          { type: "button", action_id: "pique_bot_damage_truvi", style: "primary", text: { type: "plain_text", text: "Truvi claim" }, value },
          { type: "button", action_id: "pique_bot_damage_wear", text: { type: "plain_text", text: "Wear and tear" }, value },
          notYet,
        ]
      : row.ruleKey === "parking:no_form"
        ? [
            // Got the plate ticks "Plate received from guest", which moves it to the 11:00 register post.
            { type: "button", action_id: "pique_bot_done", style: "primary", text: { type: "plain_text", text: "Got the plate" }, value },
            { type: "button", action_id: "pique_bot_parking_none", text: { type: "plain_text", text: "No parking" }, value },
            notYet,
          ]
        : [{ type: "button", action_id: "pique_bot_done", style: "primary", text: { type: "plain_text", text: "Done" }, value }, notYet];
  const elements: Block[] = later ? [] : answers;
  if (row.doneBy && !later) elements.push(noteButton(row, postId));
  if (appUrl) {
    const domain = domainForType(row.type) ?? "requests";
    elements.push({ type: "button", action_id: "pique_bot_open", text: { type: "plain_text", text: "Open" }, url: `${appUrl}/tickets/${domain}?ticket=${row.ticketId}` });
  }

  const section: Block = { type: "section", block_id: `t:${row.ticketId}`, text: { type: "mrkdwn", text: lines.join("\n") } };
  return elements.length ? [section, { type: "actions", block_id: `a:${row.ticketId}`, elements }] : [section];
}

/** A finished item, collapsed to one crossed-out line (plus any notes), with Add note on the right. */
export function renderDoneRow(row: BotRow, postId: string): Block {
  const plainTitle = titleOf(row).replace(/\*/g, "");
  const how = row.notNeeded
    ? ` - not needed (${esc(row.notNeeded.by)})${row.notNeeded.note ? `: "${esc(row.notNeeded.note.slice(0, 200))}"` : ""}`
    : row.details?.decision
      ? ` - ${esc(row.details.decision)}${row.doneBy ? ` (${esc(row.doneBy)})` : ""}`
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

  // Morning-tier rules are only ever asked here, so their tags (e.g. @customerservice for parking) go on this post.
  const tags = [
    ...new Set(
      open.flatMap((r) => {
        const rule = BOT_RULES[r.ruleKey];
        return rule?.tier === "morning" && !r.assigneeSlackId ? (rule.tag ?? []) : [];
      }),
    ),
  ].map(mention);
  const blocks: Block[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:sunrise: *Morning check-ins - ${shortDate(postDate)}*${tags.length ? ` ${tags.join(" ")}` : ""}\n${
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
    blocks.push({ type: "divider" }, { type: "section", text: { type: "mrkdwn", text: `:white_check_mark: *Done (${done.length})*` } });
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

/**
 * What the morning post for one channel asks about: not finished, not waiting on
 * a later ask-again date, and either due within the type's lead time (overdue
 * up to the limit), or - for types asked from creation - created before this
 * morning and not older than the limit.
 */
export function pickForMorning(rows: BotRow[], today: string, channel: string, createdDate: (iso: string) => string): BotRow[] {
  return rows.filter((r) => {
    const rule = BOT_RULES[r.ruleKey];
    if (!rule || rule.channel !== channel || isFinished(r) || isSnoozed(r, today)) return false;
    // Posted on its own later in the day (alerts.ts), not in the 7 AM post.
    if (rule.askAt != null) return false;
    if (rule.askFrom === "created") {
      const age = daysBetween(createdDate(r.createdAt), today);
      return age >= 0 && age <= OVERDUE_LIMIT_DAYS;
    }
    if (!r.checkIn) return false;
    const d = daysBetween(today, r.checkIn);
    return d <= rule.leadDays && d >= -OVERDUE_LIMIT_DAYS;
  });
}

const ALERT_HEADING: Record<Exclude<Tier, "morning">, string> = {
  urgent: ":rotating_light: *Urgent*",
  today: ":large_yellow_circle: *New*",
};

/**
 * A post about one ticket, sent the moment it comes in (urgent / today tiers).
 * Same buttons as the morning post; collapses to a crossed-out line once done.
 */
export function renderAlert(row: BotRow, postId: string, postDate: string, appUrl: string | null): { text: string; blocks: Block[] } {
  const rule = BOT_RULES[row.ruleKey];
  const tier = rule?.tier === "urgent" ? "urgent" : "today";
  const finished = isFinished(row);
  const tags = !finished && rule?.tag?.length && !row.assigneeSlackId ? ` ${rule.tag.map(mention).join(" ")}` : "";
  const heading: Block = { type: "context", elements: [{ type: "mrkdwn", text: finished ? ":white_check_mark: *Handled*" : `${ALERT_HEADING[tier]}${tags}` }] };
  const body = finished ? [renderDoneRow(row, postId)] : renderOpenRow(row, postId, postDate, appUrl);
  const title = titleOf(row).replace(/\*/g, "");
  // Mentions also go in the fallback text, which is what Slack notifies from.
  return { text: `${finished ? "Done: " : tier === "urgent" ? "Urgent: " : ""}${title}${tags}`, blocks: [heading, ...body] };
}
