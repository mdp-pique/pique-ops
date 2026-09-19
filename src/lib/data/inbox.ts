import { createClient } from "@/lib/supabase/server";

export interface InboxRow {
  reservationId: string;
  guestName: string;
  propertyName: string;
  preview: string;
  unanswered: boolean;
  sentAt: string;
}

const RECENT_MESSAGE_SAMPLE = 400;
const MAX_ROWS = 40;

export async function getInboxRows(): Promise<InboxRow[]> {
  const supabase = await createClient();

  const { data: messages, error } = await supabase
    .from("messages")
    .select(
      `id, direction, body, sent_at, reservation_id,
       reservation:reservations(guest:guests(full_name), property:properties(property_name, public_name))`,
    )
    .not("reservation_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(RECENT_MESSAGE_SAMPLE);

  if (error) {
    console.error("getInboxRows:", error);
    return [];
  }

  const seen = new Set<string>();
  const rows: InboxRow[] = [];

  for (const m of messages ?? []) {
    if (!m.reservation_id || seen.has(m.reservation_id)) continue;
    seen.add(m.reservation_id);

    rows.push({
      reservationId: m.reservation_id,
      guestName: m.reservation?.guest?.full_name ?? "Unknown guest",
      propertyName: m.reservation?.property?.public_name ?? m.reservation?.property?.property_name ?? "Unknown property",
      preview: (m.body ?? "").slice(0, 90) + ((m.body?.length ?? 0) > 90 ? "…" : ""),
      unanswered: m.direction === "inbound",
      sentAt: m.sent_at ?? new Date(0).toISOString(),
    });

    if (rows.length >= MAX_ROWS) break;
  }

  return rows;
}
