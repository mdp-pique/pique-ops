import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, edmontonToday, loadRows } from "./data";
import { renderPost } from "./render";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

export type Post = { id: string; post_date: string; channel_id: string; slack_ts: string | null; ticket_ids: string[]; created_at: string };

// Older posts stay in sync for this long; past that nobody scrolls back to them.
const SYNC_DAYS = 14;
const POST_COLUMNS = "id, post_date, channel_id, slack_ts, ticket_ids, created_at";

function syncFrom(): string {
  const d = new Date(`${edmontonToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - SYNC_DAYS);
  return d.toISOString().slice(0, 10);
}

/** Redraws one post from the tickets' current state. */
export async function redraw(admin: Admin, post: Post) {
  if (!post.slack_ts) return;
  const rows = await loadRows(admin, { ticketIds: post.ticket_ids, since: post.created_at });
  const message = renderPost(rows, post.id, post.post_date, appUrl());
  await slackApi("chat.update", { channel: post.channel_id, ts: post.slack_ts, text: message.text, blocks: message.blocks });
}

/**
 * An item can sit in several days' posts (asked yesterday, asked again today).
 * After any answer, every recent post that lists it is redrawn, so a tap on an
 * old post and a tap on today's end up looking the same everywhere.
 */
export async function redrawForTicket(admin: Admin, ticketId: string) {
  const { data: posts } = await admin
    .from("pique_bot_posts")
    .select(POST_COLUMNS)
    .contains("ticket_ids", [ticketId])
    .gte("post_date", syncFrom())
    .not("slack_ts", "is", null);
  for (const post of posts ?? []) await redraw(admin, post);
}

/** The morning run catches up earlier posts with anything finished in the app since. */
export async function redrawEarlier(admin: Admin, channel: string, today: string) {
  const { data: posts } = await admin
    .from("pique_bot_posts")
    .select(POST_COLUMNS)
    .eq("channel_id", channel)
    .lt("post_date", today)
    .gte("post_date", syncFrom())
    .not("slack_ts", "is", null);
  for (const post of posts ?? []) await redraw(admin, post);
}
