import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, loadRows, resolveActor } from "@/lib/pique-bot/data";
import { renderPost } from "@/lib/pique-bot/render";
import { slackApi, verifySlackSignature } from "@/lib/pique-bot/slack";

type Admin = ReturnType<typeof createAdminClient>;

interface SlackUser {
  id: string;
  username?: string;
  name?: string;
}

/**
 * Pique Bot button taps (Done / Not yet / Problem) and the Problem form.
 * Every request must carry a valid Slack signature. The ticket is only acted
 * on if it's in the list that post asked about (pique_bot_posts.ticket_ids,
 * stored server-side), and the checklist item must belong to that ticket.
 * Slack wants a reply within 3 seconds, so the database write happens first
 * and redrawing the message runs after the response.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifySlackSignature(raw, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}");
  const admin = createAdminClient();

  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (!action || action.action_id === "pique_bot_open") return new NextResponse(null, { status: 200 });

    const [postId, ticketId, itemId] = String(action.value ?? "").split("|");
    const post = await loadPost(admin, postId, ticketId);
    if (!post) return new NextResponse(null, { status: 200 });

    if (action.action_id === "pique_bot_problem") {
      await slackApi("views.open", { trigger_id: payload.trigger_id, view: textModal("pique_bot_problem", postId, ticketId) });
      return new NextResponse(null, { status: 200 });
    }
    if (action.action_id === "pique_bot_note") {
      await slackApi("views.open", { trigger_id: payload.trigger_id, view: textModal("pique_bot_note", postId, ticketId) });
      return new NextResponse(null, { status: 200 });
    }

    const actor = await resolveActor(admin, payload.user.id, slackName(payload.user));
    if (action.action_id === "pique_bot_done") await markDone(admin, ticketId, itemId, actor);
    if (action.action_id === "pique_bot_not_yet") {
      await admin.from("ticket_events").insert({
        ticket_id: ticketId,
        event_type: "comment",
        actor_id: actor.profileId,
        note: `Not yet (answered in Slack by ${actor.name})`,
        payload: { source: "pique_bot", kind: "not_yet", post_id: postId, by: actor.name },
      }).then(logError("not yet event"));
    }

    after(() => redraw(admin, post));
    return new NextResponse(null, { status: 200 });
  }

  const callback = payload.view?.callback_id;
  if (payload.type === "view_submission" && (callback === "pique_bot_problem" || callback === "pique_bot_note")) {
    const [postId, ticketId] = String(payload.view.private_metadata ?? "").split("|");
    const post = await loadPost(admin, postId, ticketId);
    const text: string = payload.view.state?.values?.text?.value?.value?.trim() ?? "";
    if (post && text) {
      const actor = await resolveActor(admin, payload.user.id, slackName(payload.user));
      const isProblem = callback === "pique_bot_problem";
      await admin.from("ticket_comments").insert({
        ticket_id: ticketId,
        author_id: actor.profileId,
        body: isProblem ? `Problem reported in Slack by ${actor.name}: ${text}` : `Note from Slack (${actor.name}): ${text}`,
      });
      await admin.from("ticket_events").insert({
        ticket_id: ticketId,
        event_type: "comment",
        actor_id: actor.profileId,
        note: isProblem ? `Problem reported in Slack by ${actor.name}` : `Note added in Slack by ${actor.name}`,
        payload: isProblem
          ? { source: "pique_bot", kind: "problem", post_id: postId, by: actor.name, problem: text }
          : { source: "pique_bot", kind: "note", post_id: postId, by: actor.name, note: text },
      }).then(logError(isProblem ? "problem event" : "note event"));
      after(() => redraw(admin, post));
    }
    // An empty body closes the form.
    return new NextResponse(null, { status: 200 });
  }

  return new NextResponse(null, { status: 200 });
}

// ticket_events only accepts its existing event types (a check constraint), so
// Slack answers use item_done / comment and are marked with payload.source.
function logError(what: string) {
  return ({ error }: { error: { message: string } | null }) => {
    if (error) console.error(`Pique Bot: ${what} failed: ${error.message}`);
  };
}

function slackName(user: SlackUser): string {
  return user.name || user.username || "someone on Slack";
}

async function loadPost(admin: Admin, postId: string, ticketId: string) {
  if (!postId || !ticketId) return null;
  const { data: post } = await admin
    .from("pique_bot_posts")
    .select("id, post_date, channel_id, slack_ts, ticket_ids, created_at")
    .eq("id", postId)
    .maybeSingle();
  if (!post || !post.ticket_ids.includes(ticketId)) return null;
  return post;
}

/** Ticks the item that was asked about; once nothing is left, resolves the ticket. */
async function markDone(admin: Admin, ticketId: string, itemId: string, actor: { profileId: string | null; name: string }) {
  const now = new Date().toISOString();
  const { data: item } = await admin
    .from("ticket_items")
    .update({ is_done: true, done_by: actor.profileId, done_at: now })
    .eq("id", itemId)
    .eq("ticket_id", ticketId)
    .eq("is_done", false)
    .select("label")
    .maybeSingle();
  if (!item) return; // already ticked, or not this ticket's item

  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "item_done",
    actor_id: actor.profileId,
    to_value: "true",
    note: `Checked off in Slack by ${actor.name}: ${item.label}`,
    payload: { source: "pique_bot", kind: "done", by: actor.name, item_id: itemId },
  }).then(logError("done event"));

  const { count } = await admin.from("ticket_items").select("id", { count: "exact", head: true }).eq("ticket_id", ticketId).eq("is_done", false);
  if (count !== 0) return;

  const { data: ticket } = await admin.from("tickets").select("status").eq("id", ticketId).maybeSingle();
  if (!ticket || !["open", "in_progress", "blocked"].includes(ticket.status)) return;
  await admin.from("tickets").update({ status: "resolved", closed_at: now }).eq("id", ticketId);
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "status_change",
    actor_id: actor.profileId,
    from_value: ticket.status,
    to_value: "resolved",
    note: `Resolved from Slack by ${actor.name} - every checklist item done`,
  });
}

async function redraw(admin: Admin, post: { id: string; post_date: string; channel_id: string; slack_ts: string | null; ticket_ids: string[]; created_at: string }) {
  if (!post.slack_ts) return;
  const rows = await loadRows(admin, { ticketIds: post.ticket_ids, since: post.created_at });
  const message = renderPost(rows, post.id, post.post_date, appUrl());
  await slackApi("chat.update", { channel: post.channel_id, ts: post.slack_ts, text: message.text, blocks: message.blocks });
}

const MODALS = {
  pique_bot_problem: { title: "What's the problem?", label: "It goes on the ticket as a comment", placeholder: "e.g. Guest won't send ID until check-in" },
  pique_bot_note: { title: "Add a note", label: "It goes on the ticket as a comment", placeholder: "e.g. Paid by e-transfer" },
} as const;

function textModal(callbackId: keyof typeof MODALS, postId: string, ticketId: string) {
  const m = MODALS[callbackId];
  return {
    type: "modal",
    callback_id: callbackId,
    private_metadata: `${postId}|${ticketId}`,
    title: { type: "plain_text", text: m.title },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "text",
        label: { type: "plain_text", text: m.label },
        element: { type: "plain_text_input", action_id: "value", multiline: true, placeholder: { type: "plain_text", text: m.placeholder } },
      },
    ],
  };
}
