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

async function requireUser() {
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
