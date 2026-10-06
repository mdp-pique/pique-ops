import { createAdminClient } from "@/lib/supabase/admin";
import { BOT_RULES, OPEN_STATUSES, ruleKeyFor, ticketTypeFor } from "./config";
import type { BotRow } from "./render";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

const ANSWER_WINDOW_DAYS = 45;

export function edmontonToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(now);
}

export function appUrl(): string | null {
  return process.env.PIQUE_APP_URL?.replace(/\/$/, "") || null;
}

/**
 * Loads tickets as bot rows. Used both to pick what the morning post asks and
 * to redraw a post after a tap (then with the post's own ticket ids, including
 * ones that have since been resolved).
 */
export async function loadRows(admin: Admin, opts: { ticketIds?: string[]; since?: string }): Promise<BotRow[]> {
  let query = admin
    .from("tickets")
    .select("id, type, status, guest_name, due_at, property_id, reservation_id, assignee_id, assignee_team_id, created_at, metadata")
    .in("type", [...new Set(Object.keys(BOT_RULES).map(ticketTypeFor))]);
  query = opts.ticketIds ? query.in("id", opts.ticketIds) : query.in("status", OPEN_STATUSES);
  const { data: tickets } = await query;
  if (!tickets?.length) return [];

  const ids = tickets.map((t) => t.id);
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];

  const [items, reservations, properties, profiles, teams, answers] = await Promise.all([
    admin.from("ticket_items").select("id, ticket_id, label, is_done, sort_order").in("ticket_id", ids),
    admin.from("reservations").select("id, check_in").in("id", uniq(tickets.map((t) => t.reservation_id))),
    admin.from("properties").select("id, property_name, public_name").in("id", uniq(tickets.map((t) => t.property_id))),
    admin.from("profiles").select("id, display_name, slack_user_id").in("id", uniq(tickets.map((t) => t.assignee_id))),
    admin.from("teams").select("id, name").in("id", uniq(tickets.map((t) => t.assignee_team_id))),
    // The bot's own answers from the last few weeks: a "Not yet" keeps an item
    // quiet until its ask-again date across posts, so it can't be limited to this post.
    admin
      .from("ticket_events")
      .select("ticket_id, event_type, note, payload, created_at")
      .in("ticket_id", ids)
      .in("event_type", ["item_done", "comment"])
      .contains("payload", { source: "pique_bot" })
      .gte("created_at", new Date(Date.now() - ANSWER_WINDOW_DAYS * 86_400_000).toISOString())
      .order("created_at", { ascending: true }),
  ]);

  const checkInById = new Map((reservations.data ?? []).map((r) => [r.id, r.check_in as string | null]));
  // The team's own names (e.g. "Boho 2 BDRM 2.0"), not the Airbnb listing title; the trailing "*" is a sync marker.
  const propById = new Map((properties.data ?? []).map((p) => [p.id, (p.property_name || p.public_name || "").replace(/\*+$/, "").trim() || null]));
  const profById = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const teamById = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
  const lastAnswer = new Map<string, BotRow["lastAnswer"]>();
  const doneBy = new Map<string, string>();
  const notes = new Map<string, BotRow["notes"]>();
  const waiting = new Map<string, BotRow["waiting"]>();
  const notNeeded = new Map<string, BotRow["notNeeded"]>();
  for (const e of answers.data ?? []) {
    const payload = (e.payload ?? {}) as { kind?: string; by?: string; problem?: string; note?: string; ask_after?: string; reason?: string };
    const by = payload.by ?? "someone";
    const note = payload.note ?? payload.problem ?? null;
    // Anything newer than a "Not yet" (a tick, another answer) replaces it.
    if (payload.kind === "done") waiting.delete(e.ticket_id);
    if (payload.kind === "not_yet" || payload.kind === "problem") {
      waiting.set(e.ticket_id, { kind: payload.kind, by, note, until: payload.ask_after ?? null, reason: payload.reason ?? null });
    }
    if (payload.kind === "not_needed") notNeeded.set(e.ticket_id, { by, note });

    // The rest only counts for the post being drawn.
    if (!opts.since || Date.parse(e.created_at) < Date.parse(opts.since)) continue;
    if (payload.kind === "note" && payload.note) {
      notes.set(e.ticket_id, [...(notes.get(e.ticket_id) ?? []), { by, text: payload.note }]);
      continue;
    }
    if (payload.kind === "done") {
      doneBy.set(e.ticket_id, by);
      lastAnswer.set(e.ticket_id, { kind: "done", by });
    }
  }

  return tickets.map((t) => {
    const prof = t.assignee_id ? profById.get(t.assignee_id) : undefined;
    const checkIn = (t.reservation_id && checkInById.get(t.reservation_id)) || (t.due_at ? edmontonToday(new Date(t.due_at)) : null);
    return {
      ticketId: t.id,
      type: t.type,
      ruleKey: ruleKeyFor(t.type, t.metadata),
      context: emailContext(t.type, t.metadata),
      details: detailsFor(t.type, t.metadata, t.due_at),
      status: t.status,
      guestName: t.guest_name,
      property: (t.property_id && propById.get(t.property_id)) || null,
      checkIn,
      createdAt: t.created_at,
      items: (items.data ?? [])
        .filter((i) => i.ticket_id === t.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => ({ id: i.id, label: i.label, isDone: i.is_done })),
      assigneeSlackId: prof?.slack_user_id ?? null,
      assigneeName: prof?.display_name ?? null,
      teamName: (t.assignee_team_id && teamById.get(t.assignee_team_id)) || null,
      lastAnswer: lastAnswer.get(t.id) ?? null,
      doneBy: doneBy.get(t.id) ?? null,
      notes: notes.get(t.id) ?? [],
      waiting: waiting.get(t.id) ?? null,
      notNeeded: notNeeded.get(t.id) ?? null,
    };
  });
}

/** For email alerts: who sent it, the subject, and a link, shown in place of the check-in date. */
function emailContext(type: string, metadata: unknown): BotRow["context"] {
  if (type !== "email_alert" || !metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : "");
  return {
    from: [str("from_name"), str("from_email") && `<${str("from_email")}>`].filter(Boolean).join(" ") || null,
    subject: str("subject") || null,
    url: str("gmail_url") || null,
    receivedAt: str("received_at") || null,
  };
}

const DECISION_LABEL: Record<string, string> = { aircover: "AirCover claim", truvi: "Truvi claim", wear: "Wear and tear" };

/** Damage reports and the claims they open: what was reported, by whom, the photos, and the decision. */
function detailsFor(type: string, metadata: unknown, dueAt: string | null): BotRow["details"] {
  if ((type !== "damage_report" && type !== "claim_tracker") || !metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : "");
  const photos = Array.isArray(m.photos) ? m.photos.filter((p): p is string => typeof p === "string") : [];
  const lines: string[] = [];
  if (type === "damage_report") {
    if (str("location")) lines.push(`Where: ${str("location").replace(/\*+$/, "")}`);
    if (str("description")) lines.push(`"${str("description").slice(0, 500)}"`);
    const when = str("submitted_at") ? new Date(str("submitted_at")).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Edmonton" }) : "";
    if (str("submitted_by") || when) lines.push(`Reported${str("submitted_by") ? ` by ${str("submitted_by")}` : ""}${when ? ` · ${when}` : ""}`);
  } else {
    if (str("platform")) lines.push(`${str("platform")} claim${str("location") ? ` · ${str("location").replace(/\*+$/, "")}` : ""}`);
    if (str("charges_summary")) lines.push(`"${str("charges_summary").slice(0, 500)}"`);
    if (dueAt) lines.push(`File by ${new Date(dueAt).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Edmonton" })}`);
  }
  return { lines, photos, decision: DECISION_LABEL[str("decision")] ?? null };
}

/**
 * Who tapped the button, as a Pique profile when we can tell. Matches the
 * saved profiles.slack_user_id first, then the Slack account's email against
 * the Google sign-in email, and remembers the link for next time.
 */
// Slack users with no app login (e.g. staff who only use Slack), remembered for
// an hour per server instance so each tap doesn't repeat the slow user search.
const unlinked = new Map<string, { name: string; until: number }>();

export async function resolveActor(admin: Admin, slackUserId: string, slackName: string): Promise<{ profileId: string | null; name: string }> {
  const { data: linked } = await admin.from("profiles").select("id, display_name").eq("slack_user_id", slackUserId).maybeSingle();
  if (linked) return { profileId: linked.id, name: linked.display_name || slackName };

  const cached = unlinked.get(slackUserId);
  if (cached && cached.until > Date.now()) return { profileId: null, name: cached.name };
  const actor = await matchByEmail(admin, slackUserId, slackName);
  if (!actor.profileId) unlinked.set(slackUserId, { name: actor.name, until: Date.now() + 3_600_000 });
  return actor;
}

async function matchByEmail(admin: Admin, slackUserId: string, slackName: string): Promise<{ profileId: string | null; name: string }> {
  const info = await slackApi<{ user?: { real_name?: string; profile?: { email?: string; real_name?: string } } }>("users.info", { user: slackUserId });
  const name = info.user?.profile?.real_name || info.user?.real_name || slackName;
  const email = info.user?.profile?.email?.toLowerCase();
  if (!email) return { profileId: null, name };

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const authUser = users?.users.find((u) => u.email?.toLowerCase() === email);
  if (!authUser) return { profileId: null, name };

  const { data: profile } = await admin.from("profiles").select("id, display_name").eq("id", authUser.id).maybeSingle();
  if (!profile) return { profileId: null, name };
  await admin.from("profiles").update({ slack_user_id: slackUserId }).eq("id", profile.id);
  return { profileId: profile.id, name: profile.display_name || name };
}
