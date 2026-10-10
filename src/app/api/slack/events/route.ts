import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { answerInSlack, isAssistantThread } from "@/lib/pique-bot/assistant";
import { saveThreadFiles, type SlackFile } from "@/lib/pique-bot/threadFiles";
import { verifySlackSignature } from "@/lib/pique-bot/slack";

// Answering can take a few database lookups and model calls; saving videos from a thread takes longer.
export const maxDuration = 300;

type SlackEvent = {
  type: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  channel: string;
  channel_type?: string;
  ts: string;
  thread_ts?: string;
  files?: SlackFile[];
};

/**
 * Pique-a-choo's Slack events (MDP 10-08): an @mention in a channel, a DM, or a follow-up in a
 * thread it's already answering. Every request must carry a valid Slack signature. Slack wants
 * a reply within 3 seconds and retries otherwise, so each event is claimed once
 * (slack_assistant_events) and answered after the response.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifySlackSignature(raw, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }
  const body = JSON.parse(raw) as {
    type: string;
    challenge?: string;
    event_id?: string;
    event?: SlackEvent;
    authorizations?: { user_id?: string }[];
  };
  if (body.type === "url_verification") return NextResponse.json({ challenge: body.challenge });
  if (body.type !== "event_callback" || !body.event || !body.event_id) return new NextResponse(null, { status: 200 });

  const ev = body.event;
  const botUserId = body.authorizations?.[0]?.user_id;
  // Ignore bots (including itself), edits and deletions; a message with files ("file_share") counts.
  if (ev.bot_id || (ev.subtype && ev.subtype !== "file_share") || !ev.user || ev.user === botUserId) return new NextResponse(null, { status: 200 });
  const text = ev.text ?? "";
  const isDm = ev.type === "message" && ev.channel_type === "im";
  // Photos or videos posted in a thread: saved to the ticket when the thread is under a Pique-a-choo ticket post.
  const threadFiles = ev.type === "message" && !isDm && !!ev.files?.length && !!ev.thread_ts && ev.thread_ts !== ev.ts;
  if (!text && !threadFiles) return new NextResponse(null, { status: 200 });

  const admin = createAdminClient();
  const mentionsBot = !!botUserId && text.includes(`<@${botUserId}>`);
  // A channel message that @mentions the bot also arrives as app_mention; answer that one only.
  // A reply that tags someone else (e.g. "@Tammy like this ^") is for them, not Pique-a-choo.
  const mentionsOthers = /<@[UW][A-Z0-9]+>/.test(text);
  const threadFollowUp = ev.type === "message" && !isDm && !!ev.thread_ts && !mentionsBot && !mentionsOthers && !threadFiles;
  if (ev.type !== "app_mention" && !isDm && !threadFollowUp && !threadFiles) return new NextResponse(null, { status: 200 });

  const { error: claimError } = await admin.from("slack_assistant_events").insert({ event_id: body.event_id });
  if (claimError) return new NextResponse(null, { status: 200 });

  after(async () => {
    try {
      if (threadFiles) {
        await saveThreadFiles(admin, { channel: ev.channel, threadTs: ev.thread_ts!, ts: ev.ts, user: ev.user!, files: ev.files! });
        return;
      }
      if (threadFollowUp && !(await isAssistantThread(admin, ev.channel, ev.thread_ts!))) return;
      await answerInSlack(admin, { channel: ev.channel, ts: ev.ts, threadTs: ev.thread_ts, user: ev.user!, text, botUserId });
    } catch (e) {
      console.error(`Pique-a-choo assistant failed: ${(e as Error).message}`);
    }
  });
  return new NextResponse(null, { status: 200 });
}
