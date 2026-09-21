import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES, ticketTagClass, ticketTypeLabel, typesForTagClass, isHiddenTicketType } from "@/lib/pique-ui/mappings";
import { ticketTitle, unansweredMessageTitle, dueText } from "@/lib/pique-ui/ticket-display";
import { STAGE_KEYS, STAGE_LABELS_LG } from "@/lib/pique-ui/mappings";
import { formatShortDate } from "@/lib/pique-ui/dates";

const PRIORITY_WEIGHT: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const QUEUE_SELECT = `
  id, type, stage, status, priority, sla_breached, due_at, created_at, guest_name, assignee_id, metadata, reservation_id,
  property:properties(property_name, public_name),
  reservation:reservations(check_in, check_out, guest:guests(full_name)),
  assignee:profiles!tickets_assignee_id_fkey(display_name)
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
  guest_name: string | null;
  assignee_id: string | null;
  metadata: Record<string, unknown>;
  reservation_id: string | null;
  property: { property_name: string | null; public_name: string | null } | null;
  reservation: { check_in: string; check_out: string; guest: { full_name: string | null } | null } | null;
  assignee: { display_name: string | null } | null;
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
    ownerName: t.assignee?.display_name ?? "Unassigned",
    due: due,
    severity: t.sla_breached || t.priority === "urgent" || t.status === "blocked" ? "crit" : "warn",
  };
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
    filtered = filtered.filter((t) => t.assignee_id === opts.userId);
  } else if (opts.segment === "breached") {
    filtered = filtered.filter((t) => t.sla_breached);
  }

  filtered.sort((a, b) => {
    if (a.sla_breached !== b.sla_breached) return a.sla_breached ? -1 : 1;
    const pw = (PRIORITY_WEIGHT[a.priority] ?? 9) - (PRIORITY_WEIGHT[b.priority] ?? 9);
    if (pw !== 0) return pw;
    return (a.due_at ?? a.created_at) < (b.due_at ?? b.created_at) ? -1 : 1;
  });

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
  assignableUsers: { id: string; name: string }[];
  due: { text: string; late: boolean };
  status: string;
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
}

export async function getTicketDrawerData(id: string): Promise<TicketDrawerData | null> {
  const supabase = await createClient();

  const { data: t, error } = await supabase
    .from("tickets")
    .select(
      `id, type, stage, status, priority, sla_breached, due_at, created_at, guest_name, metadata, reservation_id, assignee_id,
       property:properties(property_name, public_name, city),
       reservation:reservations(check_in, check_out, guest:guests(full_name)),
       assignee:profiles!tickets_assignee_id_fkey(display_name)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) console.error("getTicketDrawerData:", error);
  if (!t) return null;

  const [{ data: items }, { data: events }, { data: comments }, { data: siblingTickets }, { data: assignableProfiles }] = await Promise.all([
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
  ]);

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
    ownerName: t.assignee?.display_name ?? "Unassigned",
    assigneeId: t.assignee_id,
    assignableUsers: (assignableProfiles ?? []).map((p) => ({ id: p.id, name: p.display_name ?? "Unnamed" })),
    due: dueText(t),
    status: t.status,
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
