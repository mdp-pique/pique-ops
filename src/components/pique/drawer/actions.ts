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

export async function assignTicketToMe(ticketId: string) {
  const { supabase, user } = await requireUser();

  await supabase.from("tickets").update({ assignee_id: user.id }).eq("id", ticketId);
  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "assignment",
    actor_id: user.id,
    to_value: user.id,
    note: "Self-assigned",
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

export async function rollOverTicket(ticketId: string) {
  // Rollover automation (PRD §8) isn't built yet - this is a placeholder so the
  // button in the spec's Actions row doesn't silently do nothing forever.
  const { supabase, user } = await requireUser();
  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "field_change",
    actor_id: user.id,
    note: "Rollover requested (manual - automated rollover not implemented yet)",
  });
  revalidatePath("/", "layout");
}
