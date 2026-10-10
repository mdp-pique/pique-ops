import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, pickAskAgain, type AskAgainPick } from "@/lib/pique-bot/askAgain";
import { BOT_RULES, ESCALATE_PROFILE_ID } from "@/lib/pique-bot/config";
import { appUrl, edmontonToday, loadRows, resolveActor } from "@/lib/pique-bot/data";
import { isFinished, nextItem, shortDate, type BotRow } from "@/lib/pique-bot/render";
import { POST_COLUMNS, redrawForTicket, type Post } from "@/lib/pique-bot/posts";
import { slackApi, verifySlackSignature } from "@/lib/pique-bot/slack";
import { logTechRequest } from "@/lib/pique-bot/techRequests";

type Admin = ReturnType<typeof createAdminClient>;

interface SlackUser {
  id: string;
  username?: string;
  name?: string;
}

/**
 * Pique Bot button taps (Done / Not yet / Add note) and their forms.
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

  // Slack shows an error if we take more than 3 seconds to answer, so every
  // tap is acknowledged at once and the work runs right after the response.
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (!action || action.action_id === "pique_bot_open") return new NextResponse(null, { status: 200 });

    // The assistant's "Log as tech request" button: value is the proposal id; logTechRequest
    // requires a Pique Ops profile and opens the ticket at most once.
    if (action.action_id === "pique_bot_tech_request") {
      after(() =>
        logTechRequest(admin, {
          proposalId: String(action.value ?? ""),
          slackUser: payload.user.id,
          slackName: slackName(payload.user),
          channel: payload.channel?.id ?? payload.container?.channel_id,
          messageTs: payload.message?.ts ?? payload.container?.message_ts,
          blocks: payload.message?.blocks ?? [],
        }),
      );
      return new NextResponse(null, { status: 200 });
    }

    const [postId, ticketId, itemId] = String(action.value ?? "").split("|");

    // Forms have to open within the 3 seconds (trigger_id expires); the
    // submission re-checks the post and ticket before saving anything.
    if (action.action_id === "pique_bot_note") {
      await slackApi("views.open", { trigger_id: payload.trigger_id, view: noteModal(postId, ticketId) });
      return new NextResponse(null, { status: 200 });
    }
    // Posts from before the redesign still carry a Problem button: same form, box pre-ticked.
    if (action.action_id === "pique_bot_not_yet" || action.action_id === "pique_bot_problem") {
      await slackApi("views.open", {
        trigger_id: payload.trigger_id,
        view: notYetModal(postId, ticketId, action.action_id === "pique_bot_problem"),
      });
      return new NextResponse(null, { status: 200 });
    }

    // Damage report: AirCover claim / Truvi claim / Wear and tear. decide_damage_report()
    // resolves it and opens the claim or maintenance ticket; a second tap changes nothing.
    const damageChoice = DAMAGE_CHOICES[action.action_id as string];
    if (damageChoice) {
      after(async () => {
        const post = await loadPost(admin, postId, ticketId);
        if (!post) return;
        const actor = await resolveActor(admin, payload.user.id, slackName(payload.user));
        const { error } = await admin.rpc("decide_damage_report", { p_ticket: ticketId, p_choice: damageChoice, p_actor: actor.profileId, p_actor_name: actor.name });
        if (error) console.error(`Pique Bot: damage decision failed: ${error.message}`);
        await redrawForTicket(admin, ticketId);
      });
      return new NextResponse(null, { status: 200 });
    }

    // Parking with no form from the guest: the team has told them there's no parking, so it's closed.
    if (action.action_id === "pique_bot_parking_none") {
      after(async () => {
        const post = await loadPost(admin, postId, ticketId);
        if (!post) return;
        const actor = await resolveActor(admin, payload.user.id, slackName(payload.user));
        await closeNoParking(admin, ticketId, actor);
        await redrawForTicket(admin, ticketId);
      });
      return new NextResponse(null, { status: 200 });
    }

    if (action.action_id === "pique_bot_done") {
      after(async () => {
        const post = await loadPost(admin, postId, ticketId);
        if (!post) return;
        const actor = await resolveActor(admin, payload.user.id, slackName(payload.user));
        await markDone(admin, ticketId, itemId, actor);
        await redrawForTicket(admin, ticketId);
      });
    }
    return new NextResponse(null, { status: 200 });
  }

  const callback = payload.view?.callback_id;
  if (payload.type === "view_submission" && callback === "pique_bot_note") {
    const [postId, ticketId] = String(payload.view.private_metadata ?? "").split("|");
    const text: string = payload.view.state?.values?.text?.value?.value?.trim() ?? "";
    after(async () => {
      const post = await loadPost(admin, postId, ticketId);
      if (!post || !text) return;
      const actor = await resolveActor(admin, payload.user.id, slackName(payload.user));
      await admin.from("ticket_comments").insert({ ticket_id: ticketId, author_id: actor.profileId, body: `Note from Slack (${actor.name}): ${text}` });
      await admin.from("ticket_events").insert({
        ticket_id: ticketId,
        event_type: "comment",
        actor_id: actor.profileId,
        note: `Note added in Slack by ${actor.name}`,
        payload: { source: "pique_bot", kind: "note", post_id: postId, by: actor.name, note: text },
      }).then(logError("note event"));
      await redrawForTicket(admin, ticketId);
    });
    // An empty body closes the form.
    return new NextResponse(null, { status: 200 });
  }

  if (payload.type === "view_submission" && callback === "pique_bot_not_yet") {
    const [postId, ticketId] = String(payload.view.private_metadata ?? "").split("|");
    const values = payload.view.state?.values ?? {};
    const note: string = values.note?.value?.value?.trim() ?? "";
    const typedDate: string | null = values.date?.value?.selected_date ?? null;
    const flags = new Set<string>((values.flags?.value?.selected_options ?? []).map((o: { value: string }) => o.value));
    const today = edmontonToday();
    if (typedDate && typedDate <= today && !flags.has("not_needed")) {
      return NextResponse.json({ response_action: "errors", errors: { date: "Pick a day after today, or leave it blank." } });
    }
    // Picking the date can take a few seconds, so the form turns into a
    // "Saving..." screen at once and then shows what was decided.
    const viewId: string = payload.view.id;
    after(async () => {
      let outcome = "Something went wrong saving this. Try again, or update the ticket in the app.";
      try {
        const post = await loadPost(admin, postId, ticketId);
        if (!post) {
          outcome = "This post is out of date, so nothing was saved. Use the latest morning post or the app.";
          return;
        }
        const actor = await resolveActor(admin, payload.user.id, slackName(payload.user));
        if (flags.has("not_needed")) {
          await closeNotNeeded(admin, postId, ticketId, note, actor);
          outcome = ":white_check_mark: Saved. The ticket is closed as not needed.";
        } else if (await isFinishedTicket(admin, ticketId)) {
          outcome = ":white_check_mark: This one is already done, so nothing was changed.";
        } else {
          const saved = await snooze(admin, post, ticketId, { note, typedDate, problem: flags.has("problem"), today }, actor);
          outcome = `:white_check_mark: Saved. I'll ask again *${shortDate(saved.askAfter)}*${saved.reason ? ` (${saved.reason})` : ""}.`;
          if (saved.escalated) outcome += "\nA manager has been tagged in the thread to take a look.";
        }
        await redrawForTicket(admin, ticketId);
      } finally {
        await slackApi("views.update", { view_id: viewId, view: messageView("Not yet", outcome) });
      }
    });
    return NextResponse.json({ response_action: "update", view: messageView("Not yet", ":hourglass_flowing_sand: Saving... picking a day to ask again.") });
  }

  return new NextResponse(null, { status: 200 });
}

const DAMAGE_CHOICES: Record<string, string> = {
  pique_bot_damage_aircover: "aircover",
  pique_bot_damage_truvi: "truvi",
  pique_bot_damage_wear: "wear",
};

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
    .select(POST_COLUMNS)
    .eq("id", postId)
    .maybeSingle();
  if (!post || !post.ticket_ids.includes(ticketId)) return null;
  return post;
}

/** "No parking": no form from the guest, so no vehicle is registered. Resolves the parking ticket. */
async function closeNoParking(admin: Admin, ticketId: string, actor: { profileId: string | null; name: string }) {
  const { data: ticket } = await admin.from("tickets").select("status, type").eq("id", ticketId).maybeSingle();
  if (!ticket || ticket.type !== "vehicle_registration" || !["open", "in_progress", "blocked"].includes(ticket.status)) return;
  await admin.from("tickets").update({ status: "resolved", closed_at: new Date().toISOString() }).eq("id", ticketId);
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "status_change",
    actor_id: actor.profileId,
    from_value: ticket.status,
    to_value: "resolved",
    note: `No parking (no form from the guest) - marked in Slack by ${actor.name}`,
    payload: { source: "pique_bot", kind: "done", by: actor.name, outcome: "no_parking" },
  }).then(logError("no parking event"));
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

/** "Not yet": save the note and when to ask again (typed, else picked from the note and check-in date). */
async function snooze(
  admin: Admin,
  post: Post,
  ticketId: string,
  answer: { note: string; typedDate: string | null; problem: boolean; today: string },
  actor: { profileId: string | null; name: string },
): Promise<{ askAfter: string; reason: string | null; escalated: boolean }> {
  const postId = post.id;
  const [row] = await loadRows(admin, { ticketIds: [ticketId] });
  let askAfter: string;
  let reason: string | null = null;
  let pick: AskAgainPick | null = null;
  if (answer.typedDate) {
    askAfter = answer.typedDate;
  } else {
    pick = await pickAskAgain({
      today: answer.today,
      checkIn: row?.checkIn ?? null,
      typeLabel: (row && BOT_RULES[row.ruleKey]?.label) || "Request",
      itemLabel: (row && nextItem(row)?.label) || "",
      note: answer.note,
    });
    askAfter = pick.date;
    reason = pick.reason;
  }
  askAfter = askAfter > answer.today ? askAfter : addDays(answer.today, 1);

  const kind = answer.problem ? "problem" : "not_yet";
  const label = answer.problem ? "Problem reported" : "Not yet";
  if (answer.note) {
    await admin.from("ticket_comments").insert({
      ticket_id: ticketId,
      author_id: actor.profileId,
      body: `${label} in Slack by ${actor.name}: ${answer.note}`,
    });
  }
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "comment",
    actor_id: actor.profileId,
    note: `${label} (answered in Slack by ${actor.name}) - asking again ${shortDate(askAfter)}`,
    payload: { source: "pique_bot", kind, post_id: postId, by: actor.name, note: answer.note || null, ask_after: askAfter, reason, needs_human: pick?.needsHuman ?? null },
  }).then(logError(`${kind} event`));

  // A person always hears about a flagged problem, a note the AI couldn't read, or the AI failing.
  const why = answer.problem ? "problem" : pick?.needsHuman;
  if (why) await escalate(admin, post, ticketId, row, { why, detail: pick?.detail ?? null, note: answer.note, by: actor.name, askAfter });
  return { askAfter, reason, escalated: !!why };
}

/**
 * Tags ESCALATE_PROFILE_ID in a thread on the post. If that can't be done (no
 * Slack account found, Slack refuses) or the AI itself failed, it also opens a
 * system_health ticket for them, so nothing depends on one channel working.
 */
async function escalate(
  admin: Admin,
  post: Post,
  ticketId: string,
  row: BotRow | undefined,
  info: { why: "problem" | "unsure" | "failed"; detail: string | null; note: string; by: string; askAfter: string },
) {
  const title = [row && (BOT_RULES[row.ruleKey]?.label ?? row.type), row?.guestName, row?.property].filter(Boolean).join(" · ") || "a request";
  const noteText = info.note ? `: "${info.note.slice(0, 300)}"` : " (no note)";
  const opener = {
    problem: `${info.by} flagged a problem on *${title}*${noteText}`,
    unsure: `${info.by} said not yet on *${title}*${noteText}. I couldn't tell when to ask again${info.detail ? ` (${info.detail})` : ""}`,
    failed: `${info.by} said not yet on *${title}*${noteText}. I couldn't pick a day to ask again - the AI step failed`,
  }[info.why];
  const link = appUrl() ? ` <${appUrl()}/tickets/requests?ticket=${ticketId}|Open the ticket>` : "";
  const nextAsk = info.why === "problem" ? "" : ` I'll ask again ${shortDate(info.askAfter)}.`;

  const slackId = await escalateSlackId(admin);
  let tagged = false;
  if (slackId && post.slack_ts) {
    const sent = await slackApi("chat.postMessage", {
      channel: post.channel_id,
      thread_ts: post.slack_ts,
      text: `<@${slackId}> can you take a look? ${opener}.${nextAsk}${link}`,
      unfurl_links: false,
    });
    tagged = sent.ok;
    if (!sent.ok) console.error(`Pique Bot: escalation post failed: ${sent.error}`);
  }
  if (tagged && info.why !== "failed") return;

  const ref = `pique_bot:escalation:${ticketId}:${info.askAfter}`;
  const { error } = await admin.from("tickets").upsert(
    {
      type: "system_health",
      source: "automation",
      external_ref: ref,
      assignee_id: ESCALATE_PROFILE_ID,
      metadata: {
        title: info.why === "failed" ? "Pique-a-choo couldn't pick an ask-again date" : "Pique-a-choo needs a person to look at an answer",
        about_ticket_id: ticketId,
        why: info.why,
        detail: info.detail,
        slack_tag_sent: tagged,
      },
    },
    { onConflict: "external_ref", ignoreDuplicates: true },
  );
  if (error) console.error(`Pique Bot: escalation ticket failed: ${error.message}`);
}

/** The escalation person's Slack id: saved on their profile, else looked up once by their sign-in email. */
async function escalateSlackId(admin: Admin): Promise<string | null> {
  const { data: profile } = await admin.from("profiles").select("slack_user_id").eq("id", ESCALATE_PROFILE_ID).maybeSingle();
  if (profile?.slack_user_id) return profile.slack_user_id;
  const { data } = await admin.auth.admin.getUserById(ESCALATE_PROFILE_ID);
  const email = data?.user?.email;
  if (!email) return null;
  const found = await slackApi<{ user?: { id?: string } }>("users.lookupByEmail", { email });
  const id = found.user?.id ?? null;
  if (id) await admin.from("profiles").update({ slack_user_id: id }).eq("id", ESCALATE_PROFILE_ID);
  return id;
}

async function isFinishedTicket(admin: Admin, ticketId: string): Promise<boolean> {
  const [row] = await loadRows(admin, { ticketIds: [ticketId] });
  return !row || isFinished(row);
}

/** "Not needed anymore": closes the ticket, whatever is left on its checklist. */
async function closeNotNeeded(admin: Admin, postId: string, ticketId: string, note: string, actor: { profileId: string | null; name: string }) {
  const { data: ticket } = await admin.from("tickets").select("status").eq("id", ticketId).maybeSingle();
  if (!ticket || !["open", "in_progress", "blocked"].includes(ticket.status)) return;
  await admin.from("tickets").update({ status: "resolved", closed_at: new Date().toISOString() }).eq("id", ticketId);
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "status_change",
    actor_id: actor.profileId,
    from_value: ticket.status,
    to_value: "resolved",
    note: `Closed from Slack by ${actor.name} - not needed anymore${note ? `: ${note}` : ""}`,
  }).then(logError("not needed status"));
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "comment",
    actor_id: actor.profileId,
    note: `Marked not needed in Slack by ${actor.name}`,
    payload: { source: "pique_bot", kind: "not_needed", post_id: postId, by: actor.name, note: note || null },
  }).then(logError("not needed event"));
  if (note) {
    await admin.from("ticket_comments").insert({ ticket_id: ticketId, author_id: actor.profileId, body: `Not needed anymore (${actor.name}, from Slack): ${note}` });
  }
}

function noteModal(postId: string, ticketId: string) {
  return {
    type: "modal",
    callback_id: "pique_bot_note",
    private_metadata: `${postId}|${ticketId}`,
    title: { type: "plain_text", text: "Add a note" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "text",
        label: { type: "plain_text", text: "It goes on the ticket as a comment" },
        element: { type: "plain_text_input", action_id: "value", multiline: true, placeholder: { type: "plain_text", text: "e.g. Paid by e-transfer" } },
      },
    ],
  };
}

/** A form screen with just a message and a Close button. */
function messageView(title: string, text: string) {
  return {
    type: "modal",
    title: { type: "plain_text", text: title },
    close: { type: "plain_text", text: "Close" },
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };
}

const PROBLEM_OPTION = { text: { type: "plain_text", text: ":warning: Flag as a problem" }, value: "problem" };

function notYetModal(postId: string, ticketId: string, problem: boolean) {
  return {
    type: "modal",
    callback_id: "pique_bot_not_yet",
    private_metadata: `${postId}|${ticketId}`,
    title: { type: "plain_text", text: "Not yet" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "note",
        optional: true,
        label: { type: "plain_text", text: "What's going on?" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          placeholder: { type: "plain_text", text: "e.g. Guest says they'll pay Thursday" },
        },
      },
      {
        type: "input",
        block_id: "date",
        optional: true,
        label: { type: "plain_text", text: "Ask again on" },
        hint: { type: "plain_text", text: "Leave blank and I'll pick a day from your note and the check-in date." },
        element: { type: "datepicker", action_id: "value", placeholder: { type: "plain_text", text: "Pick a day" } },
      },
      {
        type: "input",
        block_id: "flags",
        optional: true,
        label: { type: "plain_text", text: "Also" },
        element: {
          type: "checkboxes",
          action_id: "value",
          options: [PROBLEM_OPTION, { text: { type: "plain_text", text: "Not needed anymore (closes the ticket)" }, value: "not_needed" }],
          ...(problem ? { initial_options: [PROBLEM_OPTION] } : {}),
        },
      },
    ],
  };
}
