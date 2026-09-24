import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES, ticketTagClass, ticketTypeLabel, typesForTagClass, isHiddenTicketType } from "@/lib/pique-ui/mappings";
import { ticketTitle, unansweredMessageTitle, dueText } from "@/lib/pique-ui/ticket-display";
import { STAGE_KEYS, STAGE_LABELS_LG } from "@/lib/pique-ui/mappings";
import { formatShortDate } from "@/lib/pique-ui/dates";
import { DOMAINS, domainFor, type DomainKey } from "@/lib/pique-ui/domains";
import { clockFor, healthRank, type Clock } from "@/lib/pique-ui/clock";

const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const QUEUE_SELECT = `
  id, type, stage, status, priority, sla_breached, due_at, created_at, guest_name, assignee_id, metadata, reservation_id,
  started_at, target_at, health,
  property:properties(property_name, public_name),
  reservation:reservations(check_in, check_out, guest:guests(full_name)),
  assignee:profiles!tickets_assignee_id_fkey(display_name),
  assignee_team_id,
  team:teams!tickets_assignee_team_id_fkey(name)
`;

export interface QueueRow {
  id: string;
  type: string;
  typeLabel: string;
  tagClass: string;
  title: string;
  propertyName: string;
  guestName: string | null;
  dates: string | null;
  stageLabel: string;
  ownerName: string;
  due: { text: string; late: boolean };
  dueAt: string | null;
  health: string | null;
  clock: Clock | null;
  severity: "warn" | "crit";
}

type RawTicketRow = {
  id: string;
  type: string;
  stage: string | null;
  status: string;
  priority: string;
  sla_breached: boolean;
  due_at: string | null;
  created_at: string;
  started_at: string | null;
  target_at: string | null;
  health: string | null;
  guest_name: string | null;
  assignee_id: string | null;
  metadata: Record<string, unknown>;
  reservation_id: string | null;
  property: { property_name: string | null; public_name: string | null } | null;
  reservation: { check_in: string; check_out: string; guest: { full_name: string | null } | null } | null;
  assignee: { display_name: string | null } | null;
  assignee_team_id: string | null;
  team: { name: string } | null;
};

function toQueueRow(t: RawTicketRow, messageBody?: string | null): QueueRow {
  const due = dueText(t);
  const guestName = t.reservation?.guest?.full_name ?? t.guest_name;
  const title =
    t.type === "unanswered_message"
      ? unansweredMessageTitle(guestName, messageBody ?? null)
      : ticketTitle({ type: t.type, metadata: (t.metadata as Record<string, unknown>) ?? {} });

  return {
    id: t.id,
    type: t.type,
    typeLabel: ticketTypeLabel(t.type),
    tagClass: ticketTagClass(t.type),
    title,
    propertyName: t.property?.public_name ?? t.property?.property_name ?? "Unknown property",
    guestName,
    dates: t.reservation ? `${formatShortDate(t.reservation.check_in)}–${formatShortDate(t.reservation.check_out)}` : null,
    stageLabel: t.stage ? STAGE_LABELS_LG[STAGE_KEYS.indexOf(t.stage as (typeof STAGE_KEYS)[number])] : "Any stage",
    ownerName: ownerLabel(t.assignee?.display_name, t.team?.name),
    due: due,
    dueAt: t.due_at,
    health: t.health,
    clock: clockFor(t.started_at, t.due_at),
    severity: t.sla_breached || t.priority === "urgent" || t.status === "blocked" ? "crit" : "warn",
  };
}

/** A person wins over the team; a team-only ticket reads "Maintenance team". */
function ownerLabel(person: string | null | undefined, team: string | null | undefined): string {
  if (person) return person;
  if (team) return `${team} team`;
  return "Unassigned";
}

function isMine(t: RawTicketRow, userId: string | undefined, myTeams: Set<string>): boolean {
  if (!userId) return false;
  return t.assignee_id === userId || (!t.assignee_id && !!t.assignee_team_id && myTeams.has(t.assignee_team_id));
}

async function teamIdsFor(supabase: Awaited<ReturnType<typeof createClient>>, userId: string | undefined): Promise<Set<string>> {
  if (!userId) return new Set();
  const { data } = await supabase.from("team_members").select("team_id").eq("profile_id", userId);
  return new Set((data ?? []).map((r) => r.team_id));
}

export interface QueueData {
  rows: QueueRow[];
  countsByTagClass: Record<string, number>;
  totalOpen: number;
}

export async function getQueueData(opts: { tagClass: string; segment: "open" | "mine" | "breached"; userId?: string }): Promise<QueueData> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tickets")
    .select(QUEUE_SELECT)
    .in("status", OPEN_STATUSES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("getQueueData:", error);
    return { rows: [], countsByTagClass: {}, totalOpen: 0 };
  }

  const all = (data ?? []).filter((t) => !isHiddenTicketType(t.type)) as unknown as RawTicketRow[];

  const countsByTagClass: Record<string, number> = { all: all.length };
  for (const t of all) {
    const cls = ticketTagClass(t.type);
    countsByTagClass[cls] = (countsByTagClass[cls] ?? 0) + 1;
  }

  let filtered = all;
  if (opts.tagClass !== "all") {
    const types = new Set(typesForTagClass(opts.tagClass));
    filtered = filtered.filter((t) => types.has(t.type));
  }
  if (opts.segment === "mine" && opts.userId) {
    const myTeams = await teamIdsFor(supabase, opts.userId);
    filtered = filtered.filter((t) => isMine(t, opts.userId, myTeams));
  } else if (opts.segment === "breached") {
    filtered = filtered.filter(isBehind);
  }

  filtered.sort(sortOpen);

  const messageBodyById = await fetchUnansweredMessageBodies(supabase, filtered);

  return { rows: filtered.map((t) => toQueueRow(t, messageBodyById.get(t.id))), countsByTagClass, totalOpen: all.length };
}

/** unanswered_message tickets only store hospitable_message_id in metadata (not the text) - join it back to messages for a real title instead of a generic one. */
async function fetchUnansweredMessageBodies(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tickets: RawTicketRow[],
): Promise<Map<string, string>> {
  const byHospitableId = new Map<string, string>(); // hospitable_message_id -> ticket id
  for (const t of tickets) {
    if (t.type !== "unanswered_message") continue;
    const hid = t.metadata?.hospitable_message_id;
    if (typeof hid === "string") byHospitableId.set(hid, t.id);
  }
  if (byHospitableId.size === 0) return new Map();

  const { data: messages } = await supabase
    .from("messages")
    .select("hospitable_message_id, body")
    .in("hospitable_message_id", [...byHospitableId.keys()]);

  const result = new Map<string, string>();
  for (const m of messages ?? []) {
    const ticketId = m.hospitable_message_id ? byHospitableId.get(m.hospitable_message_id) : undefined;
    if (ticketId && m.body) result.set(ticketId, m.body);
  }
  return result;
}

function isBehind(t: RawTicketRow): boolean {
  return t.health === "behind" || t.health === "missed" || t.sla_breached;
}

export type DomainSegment = "open" | "mine" | "unassigned" | "breached" | "resolved";

export interface DomainData {
  rows: QueueRow[];
  countsByType: Record<string, number>;
}

function sortOpen(a: RawTicketRow, b: RawTicketRow): number {
  const hr = healthRank(a.health) - healthRank(b.health);
  if (hr !== 0) return hr;
  if (a.sla_breached !== b.sla_breached) return a.sla_breached ? -1 : 1;
  const pw = (PRIORITY_WEIGHT[a.priority] ?? 9) - (PRIORITY_WEIGHT[b.priority] ?? 9);
  if (pw !== 0) return pw;
  return (a.due_at ?? a.created_at) < (b.due_at ?? b.created_at) ? -1 : 1;
}

export async function getDomainData(opts: { domain: DomainKey; type: string; segment: DomainSegment; userId?: string }): Promise<DomainData> {
  const supabase = await createClient();
  const types = domainFor(opts.domain).types;

  const { data: openData, error } = await supabase
    .from("tickets")
    .select(QUEUE_SELECT)
    .in("type", types)
    .in("status", OPEN_STATUSES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("getDomainData:", error);
    return { rows: [], countsByType: {} };
  }
  const open = (openData ?? []) as unknown as RawTicketRow[];

  const countsByType: Record<string, number> = { all: open.length };
  for (const t of open) countsByType[t.type] = (countsByType[t.type] ?? 0) + 1;

  let rows: RawTicketRow[];
  if (opts.segment === "resolved") {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data } = await supabase
      .from("tickets")
      .select(QUEUE_SELECT)
      .in("type", opts.type === "all" ? types : [opts.type])
      .in("status", ["resolved", "closed"])
      .gte("closed_at", since)
      .order("closed_at", { ascending: false })
      .limit(200);
    rows = (data ?? []) as unknown as RawTicketRow[];
  } else {
    rows = open.filter((t) => opts.type === "all" || t.type === opts.type);
    if (opts.segment === "mine") {
      const myTeams = await teamIdsFor(supabase, opts.userId);
      rows = rows.filter((t) => isMine(t, opts.userId, myTeams));
    } else if (opts.segment === "unassigned") rows = rows.filter((t) => !t.assignee_id && !t.assignee_team_id);
    else if (opts.segment === "breached") rows = rows.filter(isBehind);
    rows.sort(sortOpen);
  }

  const messageBodyById = await fetchUnansweredMessageBodies(supabase, rows);
  return { rows: rows.map((t) => toQueueRow(t, messageBodyById.get(t.id))), countsByType };
}

export async function getOpenCountsByDomain(): Promise<Record<DomainKey, number>> {
  const supabase = await createClient();
  const results = await Promise.all(
    DOMAINS.map((d) =>
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .in("type", d.types)
        .in("status", OPEN_STATUSES as unknown as string[]),
    ),
  );
  return Object.fromEntries(DOMAINS.map((d, i) => [d.key, results[i].count ?? 0])) as Record<DomainKey, number>;
}

export async function getNeedsHumanNow(limit = 6): Promise<QueueRow[]> {
  const { rows } = await getQueueData({ tagClass: "all", segment: "open" });
  return rows.slice(0, limit);
}

export interface TicketDrawerData {
  id: string;
  type: string;
  typeLabel: string;
  tagClass: string;
  title: string;
  stageLabel: string;
  ownerName: string;
  assigneeId: string | null;
  assigneeTeamId: string | null;
  assignableUsers: { id: string; name: string }[];
  assignableTeams: { id: string; name: string }[];
  due: { text: string; late: boolean };
  health: string | null;
  clock: Clock | null;
  startedAt: string | null;
  targetAt: string | null;
  dueAt: string | null;
  status: string;
  propertyName: string | null;
  reservationId: string | null;
  reservationSummary: {
    guestName: string;
    propertyName: string;
    city: string | null;
    checkIn: string;
    checkOut: string;
  } | null;
  metadata: Record<string, unknown>;
  reservationStages: import("@/lib/pique-ui/mappings").StageState[];
  items: { id: string; label: string; isDone: boolean }[];
  events: { id: string; at: string; text: string }[];
  comments: { id: string; at: string; author: string; body: string }[];
  attachments: { id: string; url: string; kind: string }[];
}

const ATTACHMENT_BUCKET = "ticket-attachments";
const SIGNED_URL_TTL_SECONDS = 3600;

export async function getTicketDrawerData(id: string): Promise<TicketDrawerData | null> {
  const supabase = await createClient();

  const { data: t, error } = await supabase
    .from("tickets")
    .select(
      `id, type, stage, status, priority, sla_breached, due_at, created_at, guest_name, metadata, reservation_id, assignee_id,
       started_at, target_at, health,
       property:properties(property_name, public_name, city),
       reservation:reservations(check_in, check_out, guest:guests(full_name)),
       assignee:profiles!tickets_assignee_id_fkey(display_name),
       assignee_team_id,
       team:teams!tickets_assignee_team_id_fkey(name)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) console.error("getTicketDrawerData:", error);
  if (!t) return null;

  const [{ data: items }, { data: events }, { data: comments }, { data: siblingTickets }, { data: assignableProfiles }, { data: attachmentRows }, { data: teamRows }] =
    await Promise.all([
    supabase.from("ticket_items").select("id, label, is_done").eq("ticket_id", id).order("sort_order"),
    supabase
      .from("ticket_events")
      .select("id, event_type, from_value, to_value, note, created_at")
      .eq("ticket_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("ticket_comments")
      .select("id, body, created_at, author:profiles(display_name)")
      .eq("ticket_id", id)
      .order("created_at", { ascending: false }),
    t.reservation_id
      ? supabase.from("tickets").select("type, stage, status, priority, sla_breached").eq("reservation_id", t.reservation_id)
      : Promise.resolve({ data: null }),
    supabase.from("profiles").select("id, display_name").order("display_name"),
    supabase
      .from("ticket_attachments")
      .select("id, storage_path, kind")
      .eq("ticket_id", id)
      .is("review_removal_draft_id", null)
      .order("created_at", { ascending: false }),
    supabase.from("teams").select("id, name").order("name"),
  ]);

  const { data: signedAttachments } = attachmentRows?.length
    ? await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrls(
        attachmentRows.map((a) => a.storage_path),
        SIGNED_URL_TTL_SECONDS,
      )
    : { data: null };
  const signedUrlByPath = new Map((signedAttachments ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl!]));
  const attachments = (attachmentRows ?? [])
    .map((a) => ({ id: a.id, url: signedUrlByPath.get(a.storage_path), kind: a.kind }))
    .filter((a): a is { id: string; url: string; kind: string } => !!a.url);

  const { computeStages } = await import("@/lib/pique-ui/spine");
  const { bucketFor } = await import("@/lib/pique-ui/dates");

  const guestName = t.reservation?.guest?.full_name ?? t.guest_name;
  let title: string;
  if (t.type === "unanswered_message") {
    const hid = (t.metadata as Record<string, unknown> | null)?.hospitable_message_id;
    const { data: msg } = typeof hid === "string"
      ? await supabase.from("messages").select("body").eq("hospitable_message_id", hid).maybeSingle()
      : { data: null };
    title = unansweredMessageTitle(guestName, msg?.body ?? null);
  } else {
    title = ticketTitle({ type: t.type, metadata: (t.metadata as Record<string, unknown>) ?? {} });
  }

  return {
    id: t.id,
    type: t.type,
    typeLabel: ticketTypeLabel(t.type),
    tagClass: ticketTagClass(t.type),
    title,
    stageLabel: t.stage ? STAGE_LABELS_LG[STAGE_KEYS.indexOf(t.stage as (typeof STAGE_KEYS)[number])] : "Any stage",
    ownerName: ownerLabel(t.assignee?.display_name, t.team?.name),
    assigneeId: t.assignee_id,
    assigneeTeamId: t.assignee_team_id,
    assignableTeams: (teamRows ?? []).map((tm) => ({ id: tm.id, name: tm.name })),
    assignableUsers: (assignableProfiles ?? []).map((p) => ({ id: p.id, name: p.display_name ?? "Unnamed" })),
    due: dueText(t),
    health: t.health,
    clock: clockFor(t.started_at, t.due_at),
    startedAt: t.started_at,
    targetAt: t.target_at,
    dueAt: t.due_at,
    status: t.status,
    propertyName: t.property?.public_name ?? t.property?.property_name ?? null,
    reservationId: t.reservation_id,
    reservationSummary: t.reservation
      ? {
          guestName: t.reservation.guest?.full_name ?? t.guest_name ?? "Unknown guest",
          propertyName: t.property?.public_name ?? t.property?.property_name ?? "Unknown property",
          city: t.property?.city ?? null,
          checkIn: t.reservation.check_in,
          checkOut: t.reservation.check_out,
        }
      : null,
    metadata: (t.metadata as Record<string, unknown>) ?? {},
    reservationStages: t.reservation
      ? computeStages(
          t.reservation.check_in,
          t.reservation.check_out,
          (siblingTickets ?? []).filter((s) => !isHiddenTicketType(s.type)),
          bucketFor(t.reservation.check_in, t.reservation.check_out),
        )
      : [],
    items: (items ?? []).map((i) => ({ id: i.id, label: i.label, isDone: i.is_done })),
    events: (events ?? []).map((e) => ({ id: e.id, at: e.created_at, text: describeEvent(e) })),
    comments: (comments ?? []).map((c) => ({
      id: c.id,
      at: c.created_at,
      author: c.author?.display_name ?? "Someone",
      body: c.body,
    })),
    attachments,
  };
}

function describeEvent(e: { event_type: string; from_value: string | null; to_value: string | null; note: string | null }): string {
  switch (e.event_type) {
    case "status_change":
      return e.note ?? `Status changed ${e.from_value ?? "—"} → ${e.to_value}`;
    case "assignment":
      return e.note ?? "Assignment changed";
    case "escalation":
      return e.note ?? `Escalated (#${e.to_value})`;
    case "item_done":
      return e.to_value === "true" ? "Checked off an item" : "Un-checked an item";
    default:
      return e.note ?? e.event_type;
  }
}
