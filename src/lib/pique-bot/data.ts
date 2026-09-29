import { createAdminClient } from "@/lib/supabase/admin";
import { BOT_RULES, OPEN_STATUSES } from "./config";
import type { BotRow } from "./render";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

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
    .select("id, type, status, guest_name, due_at, property_id, reservation_id, assignee_id, assignee_team_id")
    .in("type", Object.keys(BOT_RULES));
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
    opts.since
      ? admin
          .from("ticket_events")
          .select("ticket_id, event_type, note, payload, created_at")
          .in("ticket_id", ids)
          .in("event_type", ["item_done", "comment"])
          .contains("payload", { source: "pique_bot" })
          .gte("created_at", opts.since)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as { ticket_id: string; event_type: string; note: string | null; payload: unknown }[] }),
  ]);

  const checkInById = new Map((reservations.data ?? []).map((r) => [r.id, r.check_in as string | null]));
  // The team's own names (e.g. "Boho 2 BDRM 2.0"), not the Airbnb listing title; the trailing "*" is a sync marker.
  const propById = new Map((properties.data ?? []).map((p) => [p.id, (p.property_name || p.public_name || "").replace(/\*+$/, "").trim() || null]));
  const profById = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const teamById = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
  const lastAnswer = new Map<string, BotRow["lastAnswer"]>();
  const doneBy = new Map<string, string>();
  const notes = new Map<string, BotRow["notes"]>();
  for (const e of answers.data ?? []) {
    const payload = (e.payload ?? {}) as { kind?: string; by?: string; problem?: string; note?: string };
    if (payload.kind === "note" && payload.note) {
      notes.set(e.ticket_id, [...(notes.get(e.ticket_id) ?? []), { by: payload.by ?? "someone", text: payload.note }]);
      continue;
    }
    if (payload.kind === "done") doneBy.set(e.ticket_id, payload.by ?? "someone");
    if (payload.kind !== "done" && payload.kind !== "not_yet" && payload.kind !== "problem") continue;
    lastAnswer.set(e.ticket_id, { kind: payload.kind, by: payload.by ?? "someone", note: payload.problem });
  }

  return tickets.map((t) => {
    const prof = t.assignee_id ? profById.get(t.assignee_id) : undefined;
    const checkIn = (t.reservation_id && checkInById.get(t.reservation_id)) || (t.due_at ? edmontonToday(new Date(t.due_at)) : null);
    return {
      ticketId: t.id,
      type: t.type,
      status: t.status,
      guestName: t.guest_name,
      property: (t.property_id && propById.get(t.property_id)) || null,
      checkIn,
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
    };
  });
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
