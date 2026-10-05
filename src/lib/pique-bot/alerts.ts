import { createAdminClient } from "@/lib/supabase/admin";
import { BOT_RULES, OPEN_STATUSES, QUIET_HOURS, REMIND_AFTER_MINUTES } from "./config";
import { appUrl, edmontonToday, loadRows } from "./data";
import { POST_COLUMNS, type Post } from "./posts";
import { isFinished, renderAlert, type BotRow } from "./render";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

/** Edmonton wall-clock hour, minute and second right now. */
function edmontonClock(now: Date): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Edmonton",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { h: get("hour"), m: get("minute"), s: get("second") };
}

export function isQuietHours(now = new Date()): boolean {
  const { h } = edmontonClock(now);
  return h >= QUIET_HOURS.from || h < QUIET_HOURS.until;
}

/** Today's end of quiet hours (7:00 Edmonton) as an instant; only meaningful outside quiet hours. */
function quietHoursEnded(now: Date): Date {
  const { h, m, s } = edmontonClock(now);
  return new Date(now.getTime() - ((h - QUIET_HOURS.until) * 3600 + m * 60 + s) * 1000);
}

/** Gated ticket types switched on in automation_flags.pique_bot_alerts_live_types. */
export async function loadLiveTypes(admin: Admin): Promise<Set<string>> {
  const { data } = await admin.from("automation_flags").select("value").eq("key", "pique_bot_alerts_live_types").maybeSingle();
  return new Set(
    (data?.value ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

/** Whether Pique Bot may post about this type at all: ungated, or switched on. */
export function isLive(type: string, live: Set<string>): boolean {
  const rule = BOT_RULES[type];
  return !!rule && (!rule.gated || live.has(type));
}

/** Types posted the moment they come in: urgent / today tier, and live. */
async function alertTypes(admin: Admin): Promise<string[]> {
  const live = await loadLiveTypes(admin);
  return Object.entries(BOT_RULES)
    .filter(([type, rule]) => (rule.tier === "urgent" || rule.tier === "today") && isLive(type, live))
    .map(([type]) => type);
}

/**
 * Posts urgent / today tickets the moment they come in, and reminds once on an
 * unanswered urgent post. Anything that arrives in quiet hours is left for the
 * 7 AM post (it only picks tickets created since quiet hours ended), so nothing
 * is posted twice. Each ticket gets at most one immediate post: the
 * pique_bot_posts row is claimed first (unique per ticket for kind = 'alert').
 */
export async function runAlerts(admin: Admin, opts: { dry: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  const types = await alertTypes(admin);
  if (isQuietHours(now)) return { quiet: true, types, posted: [], reminded: [] };
  if (types.length === 0) return { quiet: false, types, posted: [], reminded: [] };

  const since = quietHoursEnded(now).toISOString();
  const today = edmontonToday(now);
  const posted = await postNew(admin, { types, since, today, dry: opts.dry });
  const reminded = await remind(admin, { types, since, now, dry: opts.dry });
  return { quiet: false, types, posted, reminded };
}

async function postNew(admin: Admin, ctx: { types: string[]; since: string; today: string; dry: boolean }) {
  const { data: fresh } = await admin
    .from("tickets")
    .select("id")
    .in("type", ctx.types)
    .in("status", OPEN_STATUSES)
    .gte("created_at", ctx.since);
  const ids = (fresh ?? []).map((t) => t.id);
  if (!ids.length) return [];

  const { data: already } = await admin.from("pique_bot_posts").select("ticket_ids").eq("kind", "alert").overlaps("ticket_ids", ids);
  const done = new Set((already ?? []).flatMap((p) => p.ticket_ids as string[]));
  const pending = ids.filter((id) => !done.has(id));
  if (!pending.length) return [];
  const rows = (await loadRows(admin, { ticketIds: pending })).filter((r) => !isFinished(r));

  const results: Record<string, unknown>[] = [];
  for (const row of rows) {
    const channel = BOT_RULES[row.type].channel;
    if (ctx.dry) {
      results.push({ ticket: row.ticketId, channel, message: renderAlert(row, "dry-run", ctx.today, appUrl()) });
      continue;
    }
    results.push(await postOne(admin, row, channel, ctx.today));
  }
  return results;
}

async function postOne(admin: Admin, row: BotRow, channel: string, today: string) {
  const { data: post, error: claimError } = await admin
    .from("pique_bot_posts")
    .insert({ kind: "alert", post_date: today, channel_id: channel, ticket_ids: [row.ticketId] })
    .select("id")
    .single();
  if (claimError || !post) return { ticket: row.ticketId, skipped: "already posted" };

  const message = renderAlert(row, post.id, today, appUrl());
  const sent = await slackApi<{ ts?: string }>("chat.postMessage", { channel, text: message.text, blocks: message.blocks, unfurl_links: false });
  if (!sent.ok || !sent.ts) {
    // Release the claim so the next run can try again.
    await admin.from("pique_bot_posts").delete().eq("id", post.id);
    return { ticket: row.ticketId, error: sent.error ?? "post failed" };
  }
  await admin.from("pique_bot_posts").update({ slack_ts: sent.ts, updated_at: new Date().toISOString() }).eq("id", post.id);
  const { error } = await admin.from("ticket_events").insert({
    ticket_id: row.ticketId,
    event_type: "comment",
    note: "Posted by Pique Bot",
    payload: { source: "pique_bot", kind: "asked", alert: true, post_id: post.id, channel, slack_ts: sent.ts },
  });
  if (error) console.error(`Pique Bot: logging alert failed: ${error.message}`);
  return { ticket: row.ticketId, channel, slack_ts: sent.ts };
}

/** One reminder in the thread when nobody has touched an urgent post for an hour. */
async function remind(admin: Admin, ctx: { types: string[]; since: string; now: Date; dry: boolean }) {
  const cutoff = new Date(ctx.now.getTime() - REMIND_AFTER_MINUTES * 60_000).toISOString();
  const { data: posts } = await admin
    .from("pique_bot_posts")
    .select(POST_COLUMNS)
    .eq("kind", "alert")
    .is("reminded_at", null)
    .not("slack_ts", "is", null)
    .gte("created_at", ctx.since)
    .lte("created_at", cutoff);

  const results: Record<string, unknown>[] = [];
  for (const post of (posts ?? []) as Post[]) {
    const [row] = await loadRows(admin, { ticketIds: post.ticket_ids, since: post.created_at });
    const rule = row && BOT_RULES[row.type];
    const untouched = row && rule?.tier === "urgent" && ctx.types.includes(row.type) && !isFinished(row) && !row.waiting && !row.doneBy && row.status === "open";
    if (!untouched) {
      if (!ctx.dry) await admin.from("pique_bot_posts").update({ reminded_at: ctx.now.toISOString() }).eq("id", post.id);
      continue;
    }
    const who = row.assigneeSlackId ? `<@${row.assigneeSlackId}>` : (rule.tag ?? []).map((id) => `<@${id}>`).join(" ");
    const text = `${who} this is still open - can someone take it? Tap *Done* or *Not yet* above.`.trim();
    if (ctx.dry) {
      results.push({ ticket: row.ticketId, text });
      continue;
    }
    const sent = await slackApi("chat.postMessage", { channel: post.channel_id, thread_ts: post.slack_ts, text });
    if (sent.ok) await admin.from("pique_bot_posts").update({ reminded_at: ctx.now.toISOString() }).eq("id", post.id);
    results.push({ ticket: row.ticketId, reminded: sent.ok, error: sent.ok ? undefined : sent.error });
  }
  return results;
}
