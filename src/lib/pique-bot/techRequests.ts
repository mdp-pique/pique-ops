import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, resolveActor } from "./data";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

/** The ticket's first comment holds the scope; it isn't "what was done" when the ticket closes. */
const SCOPE_HEADING = "Scope from Slack";

// Slack's answers when the place to reply is gone: retrying won't help.
const GONE = new Set(["not_in_channel", "channel_not_found", "is_archived", "thread_not_found", "message_not_found"]);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ticketLink(ticketId: string): string | null {
  const url = appUrl();
  return url ? `${url}/tickets/requests?ticket=${ticketId}` : null;
}

/**
 * The "Log as tech request" tap: opens one tech_request ticket for the proposal (a second tap
 * changes nothing) with the scope and the Slack conversation as its first comment, swaps the
 * button for a note, and posts it to the tech channel (automation_flags.tech_requests_channel).
 */
export async function logTechRequest(
  admin: Admin,
  opts: { proposalId: string; slackUser: string; slackName: string; channel: string; messageTs: string; blocks: unknown[] },
) {
  const actor = await resolveActor(admin, opts.slackUser, opts.slackName);
  if (!actor.profileId) return;
  const { data: p } = await admin.from("slack_assistant_tech_proposals").select("*").eq("id", opts.proposalId).maybeSingle();
  if (!p) return;

  let ticketId = p.ticket_id;
  if (!ticketId) {
    const { data: askedBy } = p.asked_by ? await admin.from("profiles").select("display_name").eq("id", p.asked_by).maybeSingle() : { data: null };
    const askedByName = askedBy?.display_name ?? actor.name;
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
          metadata: { title: p.title, summary: p.summary, slack_url: p.slack_url, asked_by_name: askedByName },
        },
        { onConflict: "external_ref", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (error) {
      console.error(`Pique-a-choo: tech request ticket failed: ${error.message}`);
      return;
    }
    if (ticket) {
      ticketId = ticket.id;
      await admin.from("ticket_items").insert([
        { ticket_id: ticket.id, label: "Reviewed by the tech team", sort_order: 0 },
        { ticket_id: ticket.id, label: "Built, fixed or answered", sort_order: 1 },
      ]);
      const body = [
        `${SCOPE_HEADING} (asked by ${askedByName})`,
        p.scope?.trim() || p.summary,
        p.context?.trim() ? `\nThe Slack conversation it came from:\n${p.context.trim()}` : "",
        p.slack_url ? `\nSlack: ${p.slack_url}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      await admin.from("ticket_comments").insert({ ticket_id: ticket.id, author_id: null, body: body.slice(0, 20_000) });
      await admin.from("ticket_events").insert({
        ticket_id: ticket.id,
        event_type: "status_change",
        actor_id: actor.profileId,
        to_value: "open",
        note: `Logged from Slack by ${actor.name}`,
        payload: { source: "pique_bot", kind: "tech_request", proposal_id: p.id, slack_url: p.slack_url },
      });
      await admin.from("slack_assistant_tech_proposals").update({ ticket_id: ticket.id }).eq("id", p.id).is("ticket_id", null);
      await notifyTechChannel(admin, { proposalId: p.id, ticketId: ticket.id, title: p.title, summary: p.summary, slackUrl: p.slack_url, by: askedByName });
    } else {
      const { data: existing } = await admin.from("tickets").select("id").eq("external_ref", `tech:${p.id}`).maybeSingle();
      ticketId = existing?.id ?? null;
    }
  }

  const link = ticketId ? ticketLink(ticketId) : null;
  const note = `:white_check_mark: Logged as a tech request by ${actor.name}${link ? ` · <${link}|Open>` : ""}. I'll post here when it's done.`;
  // Swap only the tapped button for the note; other requests offered in the same answer keep theirs.
  const tapped = `tech:${p.id}`;
  const blocks = opts.blocks.map((b) =>
    (b as { block_id?: string }).block_id === tapped ? { type: "context", block_id: tapped, elements: [{ type: "mrkdwn", text: note }] } : b,
  );
  await slackApi("chat.update", { channel: opts.channel, ts: opts.messageTs, blocks, text: `Logged as a tech request: ${p.title}` });
}

async function notifyTechChannel(
  admin: Admin,
  t: { proposalId: string; ticketId: string; title: string; summary: string; slackUrl: string | null; by: string },
) {
  const { data } = await admin.from("automation_flags").select("value").eq("key", "tech_requests_channel").maybeSingle();
  const channel = (data?.value ?? "").trim();
  if (!channel) return;
  const link = ticketLink(t.ticketId);
  const links = [t.slackUrl && `<${t.slackUrl}|Slack thread>`, link && `<${link}|Open>`].filter(Boolean).join(" · ");
  const sent = await slackApi<{ ts?: string }>("chat.postMessage", {
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
  if (sent.ok && sent.ts) {
    await admin.from("slack_assistant_tech_proposals").update({ tech_post_channel: channel, tech_post_ts: sent.ts }).eq("id", t.proposalId);
  }
}

type Finished = {
  id: string;
  title: string;
  summary: string;
  ticket_id: string;
  tech_post_channel: string | null;
  tech_post_ts: string | null;
  finished_notified_at: string | null;
  tickets: { status: string } | null;
  slack_assistant_threads: { channel_id: string; thread_ts: string } | null;
  profiles: { display_name: string | null; slack_user_id: string | null } | null;
};

const DONE_STATUSES = ["resolved", "closed"];

/**
 * When a tech request's ticket is resolved or closed (MDP 10-10): reply in the Slack thread it
 * was asked in, tagging the person who asked, reply under the #tech-support post, and (resolved
 * only) add a changelog entry, which runChangelog posts to #change-logs in the same run. "What was
 * done" is the ticket's latest comment, so whoever finishes one writes that first. Claimed per
 * proposal (finished_notified_at), so it goes out once; reopening the ticket clears the claim.
 */
export async function announceFinishedTechRequests(admin: Admin, opts: { dry: boolean }) {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data } = await admin
    .from("slack_assistant_tech_proposals")
    .select(
      "id, title, summary, ticket_id, tech_post_channel, tech_post_ts, finished_notified_at, tickets(status), slack_assistant_threads(channel_id, thread_ts), profiles!slack_assistant_tech_proposals_asked_by_fkey(display_name, slack_user_id)",
    )
    .not("ticket_id", "is", null)
    .gte("created_at", since);
  const rows = (data ?? []) as unknown as Finished[];

  const results: Record<string, unknown>[] = [];
  for (const row of rows) {
    const status = row.tickets?.status ?? "";
    const finished = DONE_STATUSES.includes(status);
    if (!finished && row.finished_notified_at) {
      // Reopened: tell them again when it's finished next time.
      if (!opts.dry) await admin.from("slack_assistant_tech_proposals").update({ finished_notified_at: null, finished_status: null }).eq("id", row.id);
      continue;
    }
    if (!finished || row.finished_notified_at) continue;

    const what = await whatWasDone(admin, row.ticket_id);
    const message = renderFinished(row, status, what);
    if (opts.dry) {
      results.push({ techRequest: row.id, status, text: message });
      continue;
    }
    const { data: claimed } = await admin
      .from("slack_assistant_tech_proposals")
      .update({ finished_notified_at: new Date().toISOString(), finished_status: status })
      .eq("id", row.id)
      .is("finished_notified_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const thread = row.slack_assistant_threads;
    if (thread) {
      const sent = await slackApi("chat.postMessage", { channel: thread.channel_id, thread_ts: thread.thread_ts, text: message, unfurl_links: false });
      if (!sent.ok && !GONE.has(sent.error ?? "")) {
        await admin.from("slack_assistant_tech_proposals").update({ finished_notified_at: null, finished_status: null }).eq("id", row.id);
        results.push({ techRequest: row.id, error: sent.error ?? "post failed" });
        continue;
      }
    }
    if (row.tech_post_channel && row.tech_post_ts) {
      const who = row.profiles?.display_name ? ` (asked by ${row.profiles.display_name})` : "";
      await slackApi("chat.postMessage", {
        channel: row.tech_post_channel,
        thread_ts: row.tech_post_ts,
        text: status === "resolved" ? `:white_check_mark: Done${who}. ${what ?? ""}`.trim() : `Closed, not going ahead${who}. ${what ?? ""}`.trim(),
        unfurl_links: false,
      });
    }
    if (status === "resolved") {
      const asker = row.profiles?.display_name ?? "the team";
      await admin.from("changelog_entries").insert({
        title: `Tech request done: ${row.title}`.slice(0, 200),
        body: [`• ${(what ?? row.summary).replace(/\n+/g, "\n• ")}`, `• Asked for by ${asker} through Pique-a-choo`].join("\n").slice(0, 3000),
        areas: ["app"],
      });
    }
    results.push({ techRequest: row.id, status, notified: true });
  }
  return results;
}

/** The ticket's latest comment that isn't the scope (what the tech team says it did), if any. */
async function whatWasDone(admin: Admin, ticketId: string): Promise<string | null> {
  const { data } = await admin
    .from("ticket_comments")
    .select("body")
    .eq("ticket_id", ticketId)
    .not("body", "like", `${SCOPE_HEADING}%`)
    .order("created_at", { ascending: false })
    .limit(1);
  const body = data?.[0]?.body?.trim();
  return body ? body.slice(0, 1500) : null;
}

function renderFinished(row: Finished, status: string, what: string | null): string {
  const who = row.profiles?.slack_user_id ? `<@${row.profiles.slack_user_id}> ` : "";
  const link = ticketLink(row.ticket_id);
  const head = status === "resolved" ? `${who}:white_check_mark: *Done:* ${esc(row.title)}` : `${who}*Closed, not going ahead:* ${esc(row.title)}`;
  return [head, what ? esc(what) : null, link ? `<${link}|Open the ticket>` : null].filter(Boolean).join("\n");
}
