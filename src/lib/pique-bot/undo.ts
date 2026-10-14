import type { SupabaseClient } from "@supabase/supabase-js";
import { BOT_RULES, ticketTypeFor } from "./config";

/** Ticket types Pique-a-choo asks about (its BOT_RULES keys, mapped back to types). */
const BOT_TYPES = new Set(Object.keys(BOT_RULES).map(ticketTypeFor));

/**
 * Whether a finished ticket of this type can be reopened by anyone (Undo in Slack, Reopen in the app;
 * MDP 10-14, after Glenn's misclick on a guest count check). A damage report's choice opens a claim or
 * maintenance ticket, so it stays decided; the follow-up ticket can be closed instead.
 */
export function canUndo(type: string): boolean {
  return BOT_TYPES.has(type) && type !== "damage_report";
}

const FINISHED = ["resolved", "closed"];

/**
 * Reopens a finished ticket. When every checklist item is ticked (it was finished with Done), the
 * most recent tick is undone so the same question is asked again; a ticket closed as not needed is
 * just reopened. Logged as an item_done event with payload.kind "undo", which clears the Slack
 * "done by" / "not needed" state the posts draw from.
 */
export async function undoDone(
  db: SupabaseClient,
  ticketId: string,
  actor: { profileId: string | null; name: string },
  via: "slack" | "app",
): Promise<{ reopened: boolean; item: string | null }> {
  const { data: ticket } = await db.from("tickets").select("type, status").eq("id", ticketId).maybeSingle();
  if (!ticket || !canUndo(ticket.type) || !FINISHED.includes(ticket.status)) return { reopened: false, item: null };

  const { data: items } = await db.from("ticket_items").select("id, label, is_done, done_at").eq("ticket_id", ticketId);
  let item: string | null = null;
  if (items?.length && items.every((i) => i.is_done)) {
    const last = [...items].sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""))[0];
    await db.from("ticket_items").update({ is_done: false, done_by: null, done_at: null }).eq("id", last.id);
    item = last.label;
  }

  const where = via === "slack" ? "in Slack" : "in the app";
  await db.from("tickets").update({ status: "open", closed_at: null }).eq("id", ticketId);
  await db.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "status_change",
    actor_id: actor.profileId,
    from_value: ticket.status,
    to_value: "open",
    note: `Reopened ${where} by ${actor.name}`,
  });
  await db.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "item_done",
    actor_id: actor.profileId,
    to_value: "false",
    note: item ? `Undone ${where} by ${actor.name}: ${item}` : `Undone ${where} by ${actor.name}`,
    payload: { source: "pique_bot", kind: "undo", by: actor.name, via },
  });
  return { reopened: true, item };
}
