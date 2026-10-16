import { createAdminClient } from "@/lib/supabase/admin";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

/** A question stays open for replies this long (unless closed_at is set first). */
const OPEN_DAYS = 7;

/**
 * Replies to a question Pique-a-choo DMed someone for the tech team (pique_bot_questions, MDP 10-16).
 * Forwarded to forward_to (MDP) as Pique-a-choo with who it's from, the topic and a link: anything in
 * the question's thread, and the person's first top-level DM after it (saved as reply_ts) plus that
 * message's thread. Later top-level DMs are new questions for the assistant (Laurice DMs it her own).
 * The person gets one short "passed it on" reply per question. Returns false when nothing matched.
 */
export async function forwardQuestionReply(
  admin: Admin,
  m: { channel: string; ts: string; threadTs?: string; user: string; text: string; fileCount: number },
): Promise<boolean> {
  const since = new Date(Date.now() - OPEN_DAYS * 86_400_000).toISOString();
  const { data: open } = await admin
    .from("pique_bot_questions")
    .select("id, ts, reply_ts, topic, forward_to, acked_at")
    .eq("slack_user_id", m.user)
    .eq("channel", m.channel)
    .is("closed_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (!open?.length) return false;
  const inThread = m.threadTs && m.threadTs !== m.ts;
  const q = inThread ? open.find((o) => o.ts === m.threadTs || o.reply_ts === m.threadTs) : open.find((o) => !o.reply_ts && !o.acked_at);
  if (!q) return false;
  if (!inThread) {
    // Claim the top-level reply, so a second top-level DM isn't taken as the answer too.
    const { data: claimed } = await admin.from("pique_bot_questions").update({ reply_ts: m.ts }).eq("id", q.id).is("reply_ts", null).select("id");
    if (!claimed?.length) return false;
  }

  const [{ data: who }, link] = await Promise.all([
    admin.from("profiles").select("display_name").eq("slack_user_id", m.user).maybeSingle(),
    slackApi<{ permalink?: string }>("chat.getPermalink", { channel: m.channel, message_ts: m.ts }),
  ]);
  const name = who?.display_name ?? `<@${m.user}>`;
  const files = m.fileCount ? `\n_(+ ${m.fileCount} file${m.fileCount === 1 ? "" : "s"})_` : "";
  const quoted = (m.text || "(no text)").split("\n").map((l) => `> ${l}`).join("\n");
  const res = await slackApi("chat.postMessage", {
    channel: q.forward_to,
    text: `*${name}* replied about *${q.topic}*:\n${quoted}${files}${link.permalink ? `\n<${link.permalink}|Open in Slack>` : ""}`,
    unfurl_links: false,
  });
  if (!res.ok) {
    console.error(`Pique-a-choo: forwarding a reply failed: ${res.error}`);
    return false;
  }
  await admin.from("pique_bot_questions").update({ last_forwarded_at: new Date().toISOString() }).eq("id", q.id);

  if (!q.acked_at) {
    const { data: claimed } = await admin
      .from("pique_bot_questions")
      .update({ acked_at: new Date().toISOString() })
      .eq("id", q.id)
      .is("acked_at", null)
      .select("id");
    if (claimed?.length) {
      await slackApi("chat.postMessage", {
        channel: m.channel,
        thread_ts: inThread ? m.threadTs : m.ts,
        text: "Thanks! Passed that on to Michael. Anything else you add in this thread goes to him too.",
      });
    }
  }
  return true;
}
