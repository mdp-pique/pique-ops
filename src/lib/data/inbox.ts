import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES } from "@/lib/pique-ui/mappings";
import { hospitableThreadUrl } from "@/lib/pique-ui/hospitable";

export interface InboxRow {
  reservationId: string;
  ticketId: string | null;
  guestName: string;
  propertyName: string;
  preview: string;
  unanswered: boolean;
  sentAt: string;
  hospitableUrl: string | null;
}

const RECENT_MESSAGE_SAMPLE = 400;
const MAX_ROWS = 40;

export async function getInboxRows(): Promise<InboxRow[]> {
  const supabase = await createClient();

  const [{ data: messages, error }, { data: openUnansweredTickets }] = await Promise.all([
    supabase
      .from("messages")
      .select(
        `id, direction, body, sent_at, reservation_id, raw_hospitable_data,
         reservation:reservations(guest:guests(full_name), property:properties(property_name, public_name))`,
      )
      .not("reservation_id", "is", null)
      .order("sent_at", { ascending: false })
      .limit(RECENT_MESSAGE_SAMPLE),
    supabase
      .from("tickets")
      .select("id, reservation_id")
      .eq("type", "unanswered_message")
      .in("status", OPEN_STATUSES as unknown as string[])
      .not("reservation_id", "is", null),
  ]);

  if (error) {
    console.error("getInboxRows:", error);
    return [];
  }

  // "Unanswered" here means the automation actually flagged it - a last
  // inbound message alone isn't enough (e.g. a "thanks!" or an emoji that
  // Claude already judged doesn't need a reply), so this stays in sync
  // with what Queue/Today count instead of guessing from message direction.
  const openUnansweredTicketByRes = new Map((openUnansweredTickets ?? []).map((t) => [t.reservation_id, t.id]));

  const seen = new Set<string>();
  const rows: InboxRow[] = [];

  for (const m of messages ?? []) {
    if (!m.reservation_id || seen.has(m.reservation_id)) continue;
    seen.add(m.reservation_id);

    rows.push({
      reservationId: m.reservation_id,
      ticketId: openUnansweredTicketByRes.get(m.reservation_id) ?? null,
      guestName: m.reservation?.guest?.full_name ?? "Unknown guest",
      propertyName: m.reservation?.property?.public_name ?? m.reservation?.property?.property_name ?? "Unknown property",
      preview: (m.body ?? "").slice(0, 90) + ((m.body?.length ?? 0) > 90 ? "…" : ""),
      unanswered: openUnansweredTicketByRes.has(m.reservation_id),
      sentAt: m.sent_at ?? new Date(0).toISOString(),
      hospitableUrl: hospitableThreadUrl((m.raw_hospitable_data as { conversation_id?: string } | null)?.conversation_id),
    });

    if (rows.length >= MAX_ROWS) break;
  }

  return rows;
}
