import { createAdminClient } from "@/lib/supabase/admin";
import { CHANNELS } from "./config";
import { slackApi } from "./slack";
import { announceFinishedTechRequests } from "./techRequests";

type Admin = ReturnType<typeof createAdminClient>;

type Entry = {
  id: number;
  title: string;
  body: string;
  areas: string[];
  commit_sha: string | null;
  created_at: string;
};

const AREA_LABEL: Record<string, string> = { app: "App", database: "Database", n8n: "n8n", zapier: "Zapier", slack: "Slack", other: "Other" };

// Slack's answers when the bot can't reach the channel: nothing to retry until someone invites it.
const NOT_IN_CHANNEL = new Set(["not_in_channel", "channel_not_found", "is_archived"]);

/**
 * Posts changelog entries (public.changelog_entries) to #change-logs, oldest
 * first, each once. An entry is claimed (posted_at) before posting and released
 * if the post fails, so overlapping runs never double-post. If Pique Bot isn't
 * in the channel yet the run stops quietly and the entries wait; the daily
 * silence check reports any entry still unposted after an hour.
 */
export async function runChangelog(admin: Admin, opts: { dry: boolean }) {
  // Finished tech requests: the reply in their Slack thread, and a changelog entry posted below.
  const techRequests = await announceFinishedTechRequests(admin, opts);
  const { data } = await admin
    .from("changelog_entries")
    .select("id, title, body, areas, commit_sha, created_at")
    .is("slack_ts", null)
    .is("posted_at", null)
    .order("id", { ascending: true })
    .limit(20);
  const entries = (data ?? []) as Entry[];

  const results: Record<string, unknown>[] = [];
  for (const entry of entries) {
    const message = renderEntry(entry);
    if (opts.dry) {
      results.push({ entry: entry.id, text: message.text });
      continue;
    }
    const { data: claimed } = await admin
      .from("changelog_entries")
      .update({ posted_at: new Date().toISOString() })
      .eq("id", entry.id)
      .is("posted_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const sent = await slackApi<{ ts?: string }>("chat.postMessage", { channel: CHANNELS.changelog, text: message.text, blocks: message.blocks, unfurl_links: false });
    if (!sent.ok || !sent.ts) {
      await admin.from("changelog_entries").update({ posted_at: null }).eq("id", entry.id);
      if (sent.error && NOT_IN_CHANNEL.has(sent.error)) {
        results.push({ entry: entry.id, waiting: "Pique-a-choo is not in #change-logs yet" });
        break;
      }
      results.push({ entry: entry.id, error: sent.error ?? "post failed" });
      break;
    }
    await admin.from("changelog_entries").update({ slack_ts: sent.ts }).eq("id", entry.id);
    results.push({ entry: entry.id, slack_ts: sent.ts });
  }
  return techRequests.length ? [...techRequests, ...results] : results;
}

export function renderEntry(e: Entry): { text: string; blocks: unknown[] } {
  const when = new Date(e.created_at).toLocaleString("en-US", { timeZone: "America/Edmonton", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const areas = e.areas.map((a) => AREA_LABEL[a] ?? a).join(" · ");
  const footer = [areas, e.commit_sha ? `commit \`${e.commit_sha.slice(0, 7)}\`` : null, when].filter(Boolean).join("  |  ");
  return {
    text: `#${e.id} ${e.title}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `:rocket: *#${e.id} · ${e.title}*\n${e.body}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: footer }] },
    ],
  };
}
