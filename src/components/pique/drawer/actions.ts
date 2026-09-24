"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getReservationDrawerData, type ReservationDrawerData } from "@/lib/data/reservations";
import { getTicketDrawerData, type TicketDrawerData } from "@/lib/data/tickets";

export async function fetchReservationPanel(id: string): Promise<ReservationDrawerData | null> {
  return getReservationDrawerData(id);
}

export async function fetchTicketPanel(id: string): Promise<TicketDrawerData | null> {
  return getTicketDrawerData(id);
}

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

/** Sets the ticket's assignee to anyone in the company, or clears it (assigneeId null = Unassigned). assigneeName is just for a readable history note - the caller already has the name from the same list it rendered the picker from. */
export async function assignTicket(ticketId: string, assigneeId: string | null, assigneeName?: string) {
  const { supabase, user } = await requireUser();

  await supabase.from("tickets").update({ assignee_id: assigneeId }).eq("id", ticketId);
  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "assignment",
    actor_id: user.id,
    to_value: assigneeId,
    note:
      assigneeId == null
        ? "Unassigned"
        : assigneeId === user.id
          ? "Self-assigned"
          : `Assigned to ${assigneeName ?? "someone"}`,
  });

  revalidatePath("/", "layout");
}

/** Auto-assign on taking an action (e.g. starting a review-removal decision) - claims the ticket only if nobody already owns it, never overriding an existing assignee. */
export async function claimTicketIfUnassigned(ticketId: string) {
  const { supabase, user } = await requireUser();

  const { data: ticket } = await supabase.from("tickets").select("assignee_id").eq("id", ticketId).maybeSingle();
  if (!ticket || ticket.assignee_id) return;

  await supabase.from("tickets").update({ assignee_id: user.id }).eq("id", ticketId);
  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "assignment",
    actor_id: user.id,
    to_value: user.id,
    note: "Auto-assigned by acting on this ticket",
  });

  revalidatePath("/", "layout");
}

export async function addTicketComment(ticketId: string, body: string) {
  if (!body.trim()) return;
  const { supabase, user } = await requireUser();

  await supabase.from("ticket_comments").insert({ ticket_id: ticketId, author_id: user.id, body });

  revalidatePath("/", "layout");
}

/**
 * Manual "mark answered" for unanswered_message tickets - the Slack-checkmark
 * equivalent inside the app. Must also resolve the underlying
 * unanswered_message_alerts row (via the admin client - that table has no
 * authenticated write policy, only service_role), or the still-open alert
 * would keep the n8n follow-up workflow escalating something staff already
 * handled here. Safe to run twice: the alerts update is a no-op once
 * resolved_at is already set.
 */
export async function markUnansweredMessageResolved(ticketId: string) {
  const { supabase, user } = await requireUser();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, status, metadata")
    .eq("id", ticketId)
    .eq("type", "unanswered_message")
    .maybeSingle();

  if (!ticket || ticket.status === "resolved") return;

  await supabase
    .from("tickets")
    .update({ status: "resolved", closed_at: new Date().toISOString() })
    .eq("id", ticketId);

  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "status_change",
    actor_id: user.id,
    from_value: ticket.status,
    to_value: "resolved",
    note: "Marked answered manually",
  });

  const hospitableMessageId = (ticket.metadata as Record<string, unknown> | null)?.hospitable_message_id;
  if (typeof hospitableMessageId === "string") {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    await admin
      .from("unanswered_message_alerts")
      .update({ resolved_at: new Date().toISOString(), resolved_by: "manual" })
      .eq("hospitable_message_id", hospitableMessageId)
      .is("resolved_at", null);
  }

  revalidatePath("/", "layout");
}

/** General ticket-level photo/document upload (the "Add photo" action) - not tied to any specific review-removal attempt, just filed against the ticket. */
export async function uploadTicketAttachment(ticketId: string, formData: FormData) {
  const { supabase, user } = await requireUser();

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  for (const file of files) {
    const path = `${ticketId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("ticket-attachments").upload(path, file);
    if (uploadError) continue;

    await supabase.from("ticket_attachments").insert({
      ticket_id: ticketId,
      storage_path: path,
      kind: file.type.startsWith("image/") ? "photo" : "document",
      uploaded_by: user.id,
    });
  }

  revalidatePath("/", "layout");
}

const ROLLOVER_ESCALATE_AT = 3;

/**
 * PRD §8 rollover: the visit is resolved as partial, a follow-up ticket opens
 * with the undone items, and the third rollover escalates (urgent, and
 * reassigned to an ops_manager when one exists).
 */
export async function rollOverTicket(ticketId: string): Promise<{ id: string } | { error: string }> {
  const { supabase, user } = await requireUser();

  const { data: t } = await supabase
    .from("tickets")
    .select("type, status, priority, stage, property_id, reservation_id, guest_name, staff_ref, assignee_id, metadata, rollover_count, due_at")
    .eq("id", ticketId)
    .maybeSingle();
  if (!t) return { error: "Ticket not found." };
  if (t.type !== "maintenance_ticket") return { error: "Only maintenance tickets roll over." };
  if (t.status === "resolved" || t.status === "closed") return { error: "This ticket is already closed." };

  const { data: undone } = await supabase
    .from("ticket_items")
    .select("label, sort_order")
    .eq("ticket_id", ticketId)
    .eq("is_done", false)
    .order("sort_order");
  if (!undone?.length) return { error: "Every item is done - resolve it instead." };

  const count = (t.rollover_count ?? 0) + 1;
  const escalate = count >= ROLLOVER_ESCALATE_AT;
  let assigneeId = t.assignee_id;
  if (escalate) {
    const { data: manager } = await supabase.from("profiles").select("id").eq("role", "ops_manager").limit(1).maybeSingle();
    if (manager) assigneeId = manager.id;
  }

  const { data: child, error } = await supabase
    .from("tickets")
    .insert({
      type: t.type,
      status: "open",
      priority: escalate ? "urgent" : t.priority,
      stage: t.stage,
      property_id: t.property_id,
      reservation_id: t.reservation_id,
      guest_name: t.guest_name,
      staff_ref: t.staff_ref,
      assignee_id: assigneeId,
      created_by: user.id,
      source: "manual",
      parent_ticket_id: ticketId,
      rollover_count: count,
      due_at: t.due_at,
      metadata: t.metadata,
    })
    .select("id")
    .single();
  if (error || !child) {
    console.error("rollOverTicket:", error);
    return { error: "Couldn't create the follow-up ticket." };
  }

  await supabase.from("ticket_items").insert(undone.map((i, idx) => ({ ticket_id: child.id, label: i.label, sort_order: idx })));

  await supabase
    .from("tickets")
    .update({ status: "resolved", closed_at: new Date().toISOString(), metadata: { ...(t.metadata as Record<string, unknown>), partial: true } })
    .eq("id", ticketId);

  const n = undone.length;
  await supabase.from("ticket_events").insert([
    {
      ticket_id: ticketId,
      event_type: "rollover",
      actor_id: user.id,
      from_value: t.status,
      to_value: "resolved",
      note: `Resolved as partial - ${n} item${n === 1 ? "" : "s"} rolled over to a follow-up ticket`,
      payload: { child_ticket_id: child.id },
    },
    {
      ticket_id: child.id,
      event_type: "rollover",
      actor_id: user.id,
      to_value: String(count),
      note: `Rolled over from an earlier visit (rollover #${count})`,
      payload: { parent_ticket_id: ticketId },
    },
    ...(escalate
      ? [
          {
            ticket_id: child.id,
            event_type: "escalation",
            actor_id: user.id,
            to_value: String(count),
            note: `Escalated - rolled over ${count} times${assigneeId !== t.assignee_id ? ", reassigned to ops manager" : ""}`,
          },
        ]
      : []),
  ]);

  revalidatePath("/", "layout");
  return { id: child.id };
}
