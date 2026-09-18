"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TICKET_STATUSES, type TicketStatus } from "@/lib/types";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

export async function updateStatus(ticketId: string, formData: FormData) {
  const newStatus = formData.get("status") as TicketStatus;
  if (!TICKET_STATUSES.includes(newStatus)) throw new Error("Invalid status");

  const { supabase, user } = await requireUser();

  const { data: ticket } = await supabase.from("tickets").select("status").eq("id", ticketId).single();
  if (!ticket) throw new Error("Ticket not found");

  const isClosing = newStatus === "resolved" || newStatus === "closed";

  await supabase
    .from("tickets")
    .update({ status: newStatus, closed_at: isClosing ? new Date().toISOString() : null })
    .eq("id", ticketId);

  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "status_change",
    actor_id: user.id,
    from_value: ticket.status,
    to_value: newStatus,
  });

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/");
}

export async function assignToMe(ticketId: string) {
  const { supabase, user } = await requireUser();

  await supabase.from("tickets").update({ assignee_id: user.id }).eq("id", ticketId);

  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "assignment",
    actor_id: user.id,
    to_value: user.id,
    note: "Self-assigned",
  });

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/");
}

export async function unassign(ticketId: string) {
  const { supabase, user } = await requireUser();

  await supabase.from("tickets").update({ assignee_id: null }).eq("id", ticketId);

  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "assignment",
    actor_id: user.id,
    to_value: null,
    note: "Unassigned",
  });

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/");
}

export async function addComment(ticketId: string, formData: FormData) {
  const body = (formData.get("body") as string)?.trim();
  if (!body) return;

  const { supabase, user } = await requireUser();

  await supabase.from("ticket_comments").insert({
    ticket_id: ticketId,
    author_id: user.id,
    body,
  });

  revalidatePath(`/tickets/${ticketId}`);
}

export async function toggleItem(ticketId: string, itemId: string, isDone: boolean) {
  const { supabase, user } = await requireUser();

  await supabase
    .from("ticket_items")
    .update({
      is_done: !isDone,
      done_by: !isDone ? user.id : null,
      done_at: !isDone ? new Date().toISOString() : null,
    })
    .eq("id", itemId);

  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "item_done",
    actor_id: user.id,
    to_value: (!isDone).toString(),
  });

  revalidatePath(`/tickets/${ticketId}`);
}
