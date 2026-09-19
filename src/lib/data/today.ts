import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES, isHiddenTicketType } from "@/lib/pique-ui/mappings";
import { todayLocal } from "@/lib/pique-ui/dates";

export interface TodaySummary {
  openTicketCount: number;
  breachedCount: number;
  unansweredCount: number;
  arrivalsCount: number;
  arrivalsFlaggedCount: number;
  inStayCount: number;
  inStayWithMaintenanceCount: number;
}

export async function getTodaySummary(): Promise<TodaySummary> {
  const supabase = await createClient();
  const today = todayLocal();
  const in7 = new Date(Date.now() + 7 * 86400000);
  const in7Str = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(in7);

  const [{ data: openTickets, error: tErr }, { data: arrivals, error: aErr }, { data: currentRes, error: cErr }] =
    await Promise.all([
      supabase.from("tickets").select("type, sla_breached, reservation_id").in("status", OPEN_STATUSES as unknown as string[]),
      supabase.from("reservations").select("id").gt("check_in", today).lte("check_in", in7Str),
      supabase.from("reservations").select("id").lte("check_in", today).gt("check_out", today),
    ]);

  if (tErr) console.error("getTodaySummary tickets:", tErr);
  if (aErr) console.error("getTodaySummary arrivals:", aErr);
  if (cErr) console.error("getTodaySummary current:", cErr);

  const tickets = (openTickets ?? []).filter((t) => !isHiddenTicketType(t.type));
  const resWithOpenTicket = new Set(tickets.filter((t) => t.reservation_id).map((t) => t.reservation_id));
  const arrivalIds = new Set((arrivals ?? []).map((r) => r.id));
  const currentIds = new Set((currentRes ?? []).map((r) => r.id));

  const maintenanceTypes = new Set(["maintenance_ticket", "maintenance_access", "cleaning_issue"]);
  const currentWithMaintenance = tickets.filter(
    (t) => t.reservation_id && currentIds.has(t.reservation_id) && maintenanceTypes.has(t.type),
  );

  return {
    openTicketCount: tickets.length,
    breachedCount: tickets.filter((t) => t.sla_breached).length,
    unansweredCount: tickets.filter((t) => t.type === "unanswered_message").length,
    arrivalsCount: arrivalIds.size,
    arrivalsFlaggedCount: [...arrivalIds].filter((id) => resWithOpenTicket.has(id)).length,
    inStayCount: currentIds.size,
    inStayWithMaintenanceCount: new Set(currentWithMaintenance.map((t) => t.reservation_id)).size,
  };
}
