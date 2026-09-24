"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./actions";
import { specFor, defaultDueDate } from "@/lib/pique-ui/domains";
import { todayLocal, edmontonDateTimeToISO } from "@/lib/pique-ui/dates";

export interface ReservationOption {
  id: string;
  guestName: string;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  bookedAt: string | null;
}

export interface NewTicketOptions {
  properties: { id: string; name: string }[];
  users: { id: string; name: string }[];
}

export async function getNewTicketOptions(): Promise<NewTicketOptions> {
  const { supabase } = await requireUser();
  const [{ data: properties }, { data: users }] = await Promise.all([
    supabase.from("properties").select("id, property_name, public_name").eq("is_active", true).order("property_name"),
    supabase.from("profiles").select("id, display_name").order("display_name"),
  ]);
  return {
    properties: (properties ?? []).map((p) => ({ id: p.id, name: p.public_name ?? p.property_name ?? "Unnamed property" })),
    users: (users ?? []).map((u) => ({ id: u.id, name: u.display_name ?? "Unnamed" })),
  };
}

/** Guest name, confirmation code, or property name. Newest check-in first. */
export async function searchReservations(query: string): Promise<ReservationOption[]> {
  const { supabase } = await requireUser();
  // Strip PostgREST filter syntax so the term can't alter the .or() expression.
  const q = query.replace(/[,()*%\\:"']/g, " ").trim();
  if (q.length < 2) return [];

  const [{ data: guests }, { data: props }] = await Promise.all([
    supabase.from("guests").select("id").ilike("full_name", `%${q}%`).limit(50),
    supabase.from("properties").select("id").or(`property_name.ilike.%${q}%,public_name.ilike.%${q}%`).limit(20),
  ]);

  const clauses = [`confirmation_code.ilike.%${q}%`];
  if (guests?.length) clauses.push(`guest_id.in.(${guests.map((g) => g.id).join(",")})`);
  if (props?.length) clauses.push(`property_id.in.(${props.map((p) => p.id).join(",")})`);

  const { data } = await supabase
    .from("reservations")
    .select("id, check_in, check_out, booked_at, property:properties(property_name, public_name), guest:guests(full_name)")
    .or(clauses.join(","))
    .order("check_in", { ascending: false })
    .limit(10);

  return (data ?? []).map((r) => ({
    id: r.id,
    guestName: r.guest?.full_name ?? "Unknown guest",
    propertyName: r.property?.public_name ?? r.property?.property_name ?? "Unknown property",
    checkIn: r.check_in,
    checkOut: r.check_out,
    bookedAt: r.booked_at,
  }));
}

export interface CreateTicketInput {
  type: string;
  reservationId: string | null;
  propertyId: string | null;
  title: string;
  fields: Record<string, string>;
  priority: string;
  assigneeId: string | null;
  dueDate: string | null;
}

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createManualTicket(input: CreateTicketInput): Promise<{ id: string } | { error: string }> {
  const { supabase, user } = await requireUser();

  const spec = specFor(input.type);
  if (!spec) return { error: "That ticket type can't be created by hand." };

  const title = input.title.trim();
  if (!title) return { error: "Add a short summary." };
  if (!PRIORITIES.has(input.priority)) return { error: "Pick a priority." };
  if (input.dueDate && !DATE_RE.test(input.dueDate)) return { error: "Due date isn't a valid date." };

  const fields: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = (input.fields[f.key] ?? "").trim();
    if (f.required && !v) return { error: `${f.label} is required.` };
    if (!v) continue;
    if (f.kind === "select" && f.options && !f.options.includes(v)) return { error: `Pick a valid ${f.label.toLowerCase()}.` };
    if (f.kind === "date" && !DATE_RE.test(v)) return { error: `${f.label} isn't a valid date.` };
    if (f.kind === "number" && Number.isNaN(Number(v))) return { error: `${f.label} must be a number.` };
    fields[f.key] = v;
  }

  // Property comes from the reservation when there is one, never from the client.
  let reservation: { id: string; property_id: string; check_in: string; check_out: string; booked_at: string | null; guest: { full_name: string | null } | null } | null = null;
  let propertyId: string | null = null;
  if (input.reservationId) {
    const { data } = await supabase
      .from("reservations")
      .select("id, property_id, check_in, check_out, booked_at, guest:guests(full_name)")
      .eq("id", input.reservationId)
      .maybeSingle();
    if (!data) return { error: "Reservation not found." };
    reservation = data;
    propertyId = data.property_id;
  } else if (spec.needsReservation) {
    return { error: "Pick the reservation this is about." };
  } else if (input.propertyId) {
    const { data } = await supabase.from("properties").select("id").eq("id", input.propertyId).maybeSingle();
    if (!data) return { error: "Property not found." };
    propertyId = data.id;
  } else {
    return { error: "Pick a reservation or a property." };
  }

  const dueDate =
    input.dueDate ||
    defaultDueDate(
      spec,
      reservation ? { checkIn: reservation.check_in, checkOut: reservation.check_out, bookedAt: reservation.booked_at } : null,
      fields,
      todayLocal(),
    );

  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({
      type: spec.type,
      status: "open",
      priority: input.priority,
      stage: spec.stage,
      property_id: propertyId,
      reservation_id: reservation?.id ?? null,
      guest_name: reservation?.guest?.full_name ?? null,
      assignee_id: input.assigneeId || null,
      created_by: user.id,
      source: "manual",
      due_at: dueDate ? edmontonDateTimeToISO(dueDate) : null,
      metadata: { title, ...fields },
    })
    .select("id")
    .single();
  if (error || !ticket) {
    console.error("createManualTicket:", error);
    return { error: "Couldn't create the ticket." };
  }

  const itemLabels = spec.itemsFromField
    ? (fields[spec.itemsFromField] ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
    : spec.items;
  if (itemLabels.length) {
    await supabase.from("ticket_items").insert(itemLabels.map((label, i) => ({ ticket_id: ticket.id, label, sort_order: i })));
  }

  await supabase.from("ticket_events").insert({
    ticket_id: ticket.id,
    event_type: "status_change",
    actor_id: user.id,
    to_value: "open",
    note: "Created manually",
  });

  revalidatePath("/", "layout");
  return { id: ticket.id };
}

const SETTABLE_STATUSES = new Set(["open", "in_progress", "blocked", "resolved"]);

/** Only for manually creatable types - automation-mirrored tickets get their status from their source table. */
export async function setTicketStatus(ticketId: string, status: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!SETTABLE_STATUSES.has(status)) return { error: "Invalid status." };

  const { data: ticket } = await supabase.from("tickets").select("type, status").eq("id", ticketId).maybeSingle();
  if (!ticket) return { error: "Ticket not found." };
  if (!specFor(ticket.type)) return { error: "This ticket's status is managed by its automation." };
  if (ticket.status === status) return {};

  let note: string | undefined;
  if (status === "resolved") {
    const { count } = await supabase
      .from("ticket_items")
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", ticketId)
      .eq("is_done", false);
    if (count) note = `Resolved with ${count} checklist item${count === 1 ? "" : "s"} not done`;
  }

  await supabase
    .from("tickets")
    .update({ status, closed_at: status === "resolved" ? new Date().toISOString() : null })
    .eq("id", ticketId);
  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "status_change",
    actor_id: user.id,
    from_value: ticket.status,
    to_value: status,
    note,
  });

  revalidatePath("/", "layout");
  return {};
}

export async function toggleTicketItem(ticketId: string, itemId: string, done: boolean) {
  const { supabase, user } = await requireUser();

  const { data: item } = await supabase
    .from("ticket_items")
    .update({ is_done: done, done_by: done ? user.id : null, done_at: done ? new Date().toISOString() : null })
    .eq("id", itemId)
    .eq("ticket_id", ticketId)
    .select("label")
    .maybeSingle();
  if (!item) return;

  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "item_done",
    actor_id: user.id,
    to_value: String(done),
    note: `${done ? "Checked off" : "Un-checked"}: ${item.label}`,
  });

  revalidatePath("/", "layout");
}

export async function addTicketItem(ticketId: string, label: string) {
  const text = label.trim();
  if (!text) return;
  const { supabase } = await requireUser();

  const { data: last } = await supabase
    .from("ticket_items")
    .select("sort_order")
    .eq("ticket_id", ticketId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  await supabase.from("ticket_items").insert({ ticket_id: ticketId, label: text, sort_order: (last?.sort_order ?? -1) + 1 });

  revalidatePath("/", "layout");
}
