import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHANNELS } from "@/lib/pique-bot/config";
import { appUrl, edmontonToday, loadRows } from "@/lib/pique-bot/data";
import { pickForMorning, renderPost } from "@/lib/pique-bot/render";
import { slackApi } from "@/lib/pique-bot/slack";

/**
 * The 7 AM check-in. Called by n8n (Pique-Bot-Morning) with the shared secret.
 * One post per channel per day: the pique_bot_posts row is claimed before
 * posting, so a retry or a second call the same morning skips that channel.
 * ?dry=1 returns what would be posted without posting or saving anything
 * (&date=YYYY-MM-DD to preview another day).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PIQUE_BOT_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const dateParam = request.nextUrl.searchParams.get("date");
  const today = dry && dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : edmontonToday();

  const admin = createAdminClient();
  const all = await loadRows(admin, {});
  const results: Record<string, unknown>[] = [];

  for (const channel of Object.values(CHANNELS)) {
    const rows = pickForMorning(all, today, channel);
    if (rows.length === 0) {
      results.push({ channel, asked: 0 });
      continue;
    }

    if (dry) {
      results.push({ channel, asked: rows.length, message: renderPost(rows, "dry-run", today, appUrl()) });
      continue;
    }

    const { data: post, error: claimError } = await admin
      .from("pique_bot_posts")
      .insert({ post_date: today, channel_id: channel, ticket_ids: rows.map((r) => r.ticketId) })
      .select("id")
      .single();
    if (claimError || !post) {
      results.push({ channel, skipped: "already posted today" });
      continue;
    }

    const message = renderPost(rows, post.id, today, appUrl());
    const sent = await slackApi<{ ts?: string }>("chat.postMessage", { channel, text: message.text, blocks: message.blocks, unfurl_links: false });
    if (!sent.ok || !sent.ts) {
      // Release the claim so the next call can try again.
      await admin.from("pique_bot_posts").delete().eq("id", post.id);
      results.push({ channel, error: sent.error ?? "post failed" });
      continue;
    }

    await admin.from("pique_bot_posts").update({ slack_ts: sent.ts, updated_at: new Date().toISOString() }).eq("id", post.id);
    const { error: logError } = await admin.from("ticket_events").insert(
      rows.map((r) => ({
        ticket_id: r.ticketId,
        event_type: "comment",
        note: "Asked in the Pique Bot morning check-in",
        payload: { source: "pique_bot", kind: "asked", post_id: post.id, channel, slack_ts: sent.ts },
      })),
    );
    if (logError) console.error(`Pique Bot: logging asks failed: ${logError.message}`);
    results.push({ channel, asked: rows.length, slack_ts: sent.ts });
  }

  return NextResponse.json({ date: today, dry, results });
}
