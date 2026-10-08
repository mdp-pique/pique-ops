import type Anthropic from "@anthropic-ai/sdk";
import { askPique, type AskPiqueTurn } from "@/lib/ai/askPique";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, resolveActor } from "./data";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

/** Turns kept per Slack thread (question + answer each), so follow-ups have context. */
const MAX_TURNS = 12;

/** Slack rejects a section longer than 3000 characters. */
const SECTION_LIMIT = 2900;

export interface SlackQuestion {
  channel: string;
  /** The message's own ts; replies go in its thread (or the thread it's already in). */
  ts: string;
  threadTs?: string;
  user: string;
  text: string;
  botUserId?: string;
}

const PROPOSE_TOOL: Anthropic.Tool = {
  name: "propose_tech_request",
  description:
    "Offer to log a tech request for the Pique tech team. Call this (once) when the person asks for a new feature, a change to how Pique Ops / Pique-a-choo / an automation works, or reports a bug or something broken. Do NOT call it for ordinary questions about data. It creates nothing by itself: it shows the person a 'Log as tech request' button.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title for the tech team, under 80 characters." },
      summary: { type: "string", description: "1-3 sentences for the tech team: what's wanted or broken, and why, in plain words." },
    },
    required: ["title", "summary"],
  },
};

function slackSystem(name: string): string {
  const url = appUrl();
  return `You're answering in Slack. ${name} asked. Write for Slack:
- Short: lead with the answer, then at most ~10 lines of detail. No results table is shown in Slack, so include the key facts (names, units, dates, statuses) yourself.
- Slack formatting only: *bold* with single asterisks, bullet lines starting with "• ", links as <url|text>. No markdown headers, no tables, no code blocks.
- Times in America/Edmonton.${url ? `\n- Link a ticket as <${url}/?ticket=TICKET_ID|title> and a booking as <${url}/reservations?res=RESERVATION_ID|guest name> when it helps.` : ""}
- You can't change anything (tick items, message guests, move shifts). If asked, say so and point them to the ticket or the app.
- If they're asking for a feature, a change, or reporting a bug, call propose_tech_request and tell them they can tap the button below to log it.`;
}

/**
 * Pique-a-choo answering a DM or an @mention in Slack (MDP 10-08), in a thread. Only people
 * with a Pique Ops profile get answers; the database is read as that person (RLS applies) via
 * ask_pique_run_sql_as. Called from /api/slack/events after Slack has been acknowledged.
 */
export async function answerInSlack(admin: Admin, q: SlackQuestion) {
  const threadTs = q.threadTs ?? q.ts;
  const question = (q.botUserId ? q.text.replaceAll(`<@${q.botUserId}>`, "") : q.text).trim();
  if (!question) return;

  const actor = await resolveActor(admin, q.user, "");
  if (!actor.profileId) {
    await slackApi("chat.postMessage", {
      channel: q.channel,
      thread_ts: threadTs,
      text: "Sorry, I can only answer people with a Pique Ops login. Ask someone on the office team, or ask for a login.",
    });
    return;
  }
  const profileId = actor.profileId;

  const placeholder = await slackApi<{ ts?: string }>("chat.postMessage", { channel: q.channel, thread_ts: threadTs, text: ":hourglass_flowing_sand: Looking that up..." });

  const { data: thread } = await admin
    .from("slack_assistant_threads")
    .select("id, turns")
    .eq("channel_id", q.channel)
    .eq("thread_ts", threadTs)
    .maybeSingle();
  const history = ((thread?.turns ?? []) as unknown as AskPiqueTurn[]).slice(-MAX_TURNS);

  let proposal: { title: string; summary: string } | null = null;
  const result = await askPique(admin, question, history, {
    runSql: async (sql) => admin.rpc("ask_pique_run_sql_as", { query: sql, p_profile: profileId }),
    extraSystem: slackSystem(actor.name),
    extra: {
      tools: [PROPOSE_TOOL],
      handle: async (name, input) => {
        if (name !== PROPOSE_TOOL.name) return "Unknown tool.";
        const i = (input ?? {}) as { title?: string; summary?: string };
        if (!i.title || !i.summary) return "Need a title and a summary.";
        proposal = { title: i.title.slice(0, 120), summary: i.summary.slice(0, 1000) };
        return "Shown: a 'Log as tech request' button under your answer. Tell them they can tap it.";
      },
    },
  });

  const turns = [...history, { role: "user", content: question }, { role: "assistant", content: result.answer }].slice(-MAX_TURNS);
  const { data: saved } = await admin
    .from("slack_assistant_threads")
    .upsert({ channel_id: q.channel, thread_ts: threadTs, profile_id: profileId, turns, updated_at: new Date().toISOString() }, { onConflict: "channel_id,thread_ts" })
    .select("id")
    .single();

  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: result.answer.slice(0, SECTION_LIMIT) } }];
  const offered = proposal as { title: string; summary: string } | null;
  if (offered && saved) {
    const permalink = await slackApi<{ permalink?: string }>("chat.getPermalink", { channel: q.channel, message_ts: q.ts });
    const { data: row } = await admin
      .from("slack_assistant_tech_proposals")
      .insert({
        thread_id: saved.id,
        title: offered.title,
        summary: offered.summary,
        asked_by: profileId,
        question,
        slack_url: permalink.ok ? (permalink.permalink ?? null) : null,
      })
      .select("id")
      .single();
    if (row) {
      blocks.push(
        { type: "context", elements: [{ type: "mrkdwn", text: `:hammer_and_wrench: Tech request: *${offered.title.replace(/[<>&]/g, "")}*` }] },
        {
          type: "actions",
          block_id: `tech:${row.id}`,
          elements: [{ type: "button", action_id: "pique_bot_tech_request", style: "primary", text: { type: "plain_text", text: "Log as tech request" }, value: row.id }],
        },
      );
    }
  }

  const message = { channel: q.channel, text: result.answer.slice(0, 3000), blocks, unfurl_links: false };
  if (placeholder.ok && placeholder.ts) await slackApi("chat.update", { ...message, ts: placeholder.ts });
  else await slackApi("chat.postMessage", { ...message, thread_ts: threadTs });
}

/** Whether Pique-a-choo is already in this thread (follow-ups there don't need an @mention). */
export async function isAssistantThread(admin: Admin, channel: string, threadTs: string): Promise<boolean> {
  const { data } = await admin.from("slack_assistant_threads").select("id").eq("channel_id", channel).eq("thread_ts", threadTs).maybeSingle();
  return !!data;
}

/**
 * The "Log as tech request" tap: opens one tech_request ticket for the proposal (a second tap
 * changes nothing), swaps the button for a note, and posts it to the tech channel when one is
 * set (automation_flags.tech_requests_channel).
 */
export async function logTechRequest(
  admin: Admin,
  opts: { proposalId: string; slackUser: string; slackName: string; channel: string; messageTs: string; blocks: unknown[] },
) {
  const actor = await resolveActor(admin, opts.slackUser, opts.slackName);
  if (!actor.profileId) return;
  const { data: p } = await admin.from("slack_assistant_tech_proposals").select("*").eq("id", opts.proposalId).maybeSingle();
  if (!p) return;

  let ticketId = p.ticket_id as string | null;
  if (!ticketId) {
    const { data: askedBy } = p.asked_by ? await admin.from("profiles").select("display_name").eq("id", p.asked_by).maybeSingle() : { data: null };
    const { data: ticket, error } = await admin
      .from("tickets")
      .upsert(
        {
          type: "tech_request",
          status: "open",
          priority: "normal",
          source: "manual",
          created_by: actor.profileId,
          external_ref: `tech:${p.id}`,
          metadata: { title: p.title, summary: p.summary, question: p.question, slack_url: p.slack_url, asked_by_name: askedBy?.display_name ?? actor.name },
        },
        { onConflict: "external_ref", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (error) {
      console.error(`Pique Bot: tech request ticket failed: ${error.message}`);
      return;
    }
    if (ticket) {
      ticketId = ticket.id;
      await admin.from("ticket_items").insert([
        { ticket_id: ticket.id, label: "Reviewed by the tech team", sort_order: 0 },
        { ticket_id: ticket.id, label: "Built, fixed or answered", sort_order: 1 },
      ]);
      await admin.from("ticket_events").insert({
        ticket_id: ticket.id,
        event_type: "status_change",
        actor_id: actor.profileId,
        to_value: "open",
        note: `Logged from Slack by ${actor.name}`,
        payload: { source: "pique_bot", kind: "tech_request", proposal_id: p.id, slack_url: p.slack_url },
      });
      await admin.from("slack_assistant_tech_proposals").update({ ticket_id: ticket.id }).eq("id", p.id).is("ticket_id", null);
      await notifyTechChannel(admin, { ticketId: ticket.id, title: p.title, summary: p.summary, slackUrl: p.slack_url, by: actor.name });
    } else {
      const { data: existing } = await admin.from("tickets").select("id").eq("external_ref", `tech:${p.id}`).maybeSingle();
      ticketId = existing?.id ?? null;
    }
  }

  const url = appUrl();
  const note = `:white_check_mark: Logged as a tech request by ${actor.name}${url && ticketId ? ` · <${url}/?ticket=${ticketId}|Open>` : ""}`;
  const blocks = opts.blocks.filter((b) => (b as { type?: string }).type !== "actions");
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: note }] });
  await slackApi("chat.update", { channel: opts.channel, ts: opts.messageTs, blocks, text: `Logged as a tech request: ${p.title}` });
}

async function notifyTechChannel(admin: Admin, t: { ticketId: string; title: string; summary: string; slackUrl: string | null; by: string }) {
  const { data } = await admin.from("automation_flags").select("value").eq("key", "tech_requests_channel").maybeSingle();
  const channel = (data?.value ?? "").trim();
  if (!channel) return;
  const url = appUrl();
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const links = [t.slackUrl && `<${t.slackUrl}|Slack thread>`, url && `<${url}/?ticket=${t.ticketId}|Open>`].filter(Boolean).join(" · ");
  await slackApi("chat.postMessage", {
    channel,
    text: `New tech request: ${t.title}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `:hammer_and_wrench: *New tech request* · ${esc(t.title)}\n${esc(t.summary)}\nFrom ${esc(t.by)}${links ? ` · ${links}` : ""}` },
      },
    ],
    unfurl_links: false,
  });
}
