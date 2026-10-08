import { createAdminClient } from "@/lib/supabase/admin";
import { BOT_RULES, OPEN_STATUSES } from "./config";
import { edmontonToday, loadRows } from "./data";
import { POST_COLUMNS, type Post } from "./posts";
import type { BotRow } from "./render";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

/** Slack shows at most this many photos in one thread reply. */
const PHOTO_LIMIT = 10;

const IMAGE = /\.(jpe?g|png|gif)(\?|$)/i;

/**
 * The photos on a damage report (or claim), shown in the post's thread as images so they open
 * in Slack instead of downloading (Tammy, 10-08). One reply per ticket per post, logged as a
 * ticket event (payload.kind = 'photos') so a re-run never posts them twice. Videos and other
 * files stay as links. If Slack can't load an image, the reply falls back to plain links.
 */
export async function postPhotosInThread(admin: Admin, row: BotRow, post: { id: string; channel: string; ts: string }) {
  const photos = row.details?.photos ?? [];
  if (!photos.length) return null;

  const { data: already } = await admin
    .from("ticket_events")
    .select("id")
    .eq("ticket_id", row.ticketId)
    .contains("payload", { source: "pique_bot", kind: "photos", post_id: post.id })
    .limit(1);
  if (already?.length) return null;

  const title = [BOT_RULES[row.ruleKey]?.label ?? "Photos", row.guestName, row.property].filter(Boolean).join(" · ");
  const images = photos.filter((url) => IMAGE.test(url)).slice(0, PHOTO_LIMIT);
  const others = photos.filter((url) => !IMAGE.test(url) || !images.includes(url));
  const links = (urls: string[]) => urls.map((url, i) => `<${url}|${i + 1}>`).join(" ");
  const heading = { type: "context", elements: [{ type: "mrkdwn", text: `:camera: *${title}*` }] };
  const blocks: unknown[] = [heading, ...images.map((url, i) => ({ type: "image", image_url: url, alt_text: `Photo ${i + 1}` }))];
  if (others.length) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `More (videos, files): ${links(others)}` }] });

  const base = { channel: post.channel, thread_ts: post.ts, text: `Photos: ${title}`, unfurl_links: false, unfurl_media: false };
  let sent = await slackApi<{ ts?: string }>("chat.postMessage", { ...base, blocks });
  if (!sent.ok) {
    // An image Slack couldn't fetch fails the whole message: send the links instead.
    sent = await slackApi<{ ts?: string }>("chat.postMessage", {
      ...base,
      blocks: [heading, { type: "section", text: { type: "mrkdwn", text: `Photos: ${links(photos)}` } }],
    });
  }
  if (!sent.ok) return { ticket: row.ticketId, error: sent.error ?? "photo reply failed" };

  const { error } = await admin.from("ticket_events").insert({
    ticket_id: row.ticketId,
    event_type: "comment",
    note: "Photos shown in the Slack thread by Pique-a-choo",
    payload: { source: "pique_bot", kind: "photos", post_id: post.id, channel: post.channel, slack_ts: sent.ts },
  });
  if (error) console.error(`Pique Bot: logging photos failed: ${error.message}`);
  return { ticket: row.ticketId, photos: photos.length };
}

/**
 * Today's posts (7 AM and immediate) that list an open ticket with photos but have no photo
 * reply yet: covers the morning post, and anything posted before photo replies existed.
 */
export async function postMissingPhotos(admin: Admin, now = new Date()) {
  const today = edmontonToday(now);
  const { data } = await admin.from("pique_bot_posts").select(POST_COLUMNS).eq("post_date", today).not("slack_ts", "is", null);
  const posts = (data ?? []) as unknown as Post[];
  const ids = [...new Set(posts.flatMap((p) => p.ticket_ids))];
  if (!ids.length) return [];
  const rows = (await loadRows(admin, { ticketIds: ids })).filter((r) => (r.details?.photos?.length ?? 0) > 0 && OPEN_STATUSES.includes(r.status));
  const results: Record<string, unknown>[] = [];
  for (const post of posts) {
    for (const row of rows.filter((r) => post.ticket_ids.includes(r.ticketId))) {
      const result = await postPhotosInThread(admin, row, { id: post.id, channel: post.channel_id, ts: post.slack_ts! });
      if (result) results.push(result);
    }
  }
  return results;
}
