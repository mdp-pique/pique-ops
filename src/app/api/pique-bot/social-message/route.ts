import { NextResponse, type NextRequest } from "next/server";
import { CHANNELS } from "@/lib/pique-bot/config";
import { slackApi } from "@/lib/pique-bot/slack";

/**
 * An Instagram / Facebook message from N2P (GHL), forwarded by n8n Pique-N2P-Social-Messages with the
 * same shared secret as the other Pique Bot routes. Posts the Zap's "Response Inside CRM" message to
 * #pique-social-media-msg as Pique-a-choo (n8n's own Slack login posts as MDP). Body is N2P's webhook
 * body: { first_name, last_name, message: { body }, contact_id }. A failed post answers 502 so n8n's
 * error alert fires.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PIQUE_BOT_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    first_name?: string;
    last_name?: string;
    message?: { body?: string } | null;
    message_body?: string;
    contact_id?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "body needs N2P's webhook fields" }, { status: 400 });

  const name = [body.first_name, body.last_name].filter(Boolean).join(" ");
  const said = body.message?.body ?? body.message_body ?? "";
  const contact = encodeURIComponent(body.contact_id ?? "");
  const text = [
    "Response Inside CRM.",
    escapeSlack(name),
    escapeSlack(said),
    `https://app.nurture2profit.com/v2/location/u73d3C5ZwI041uuXCERc/contacts/detail/${contact}`,
  ].join("\n");

  const sent = await slackApi<{ ts?: string }>("chat.postMessage", { channel: CHANNELS.socialMessages, text, unfurl_links: false });
  if (!sent.ok) return NextResponse.json({ error: sent.error ?? "post failed" }, { status: 502 });
  return NextResponse.json({ ok: true, slack_ts: sent.ts });
}

/** Guest text can't ping anyone or break formatting: Slack only treats &, < and > specially. */
function escapeSlack(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
