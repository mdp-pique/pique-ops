import { createClient } from "@/lib/supabase/server";
import { todayLocal } from "@/lib/pique-ui/dates";
import { OPEN_STATUSES, isHiddenTicketType } from "@/lib/pique-ui/mappings";

export interface SpineNode {
  key: string;
  label: string;
  count: number;
  sub: string;
  flagged: number;
}

const FLAG_TYPES: Record<string, string[]> = {
  book: ["guest_vetting", "direct_booking_id_check", "pet_fee"],
  checkin: ["unanswered_message", "pack_n_play"],
  stay: ["maintenance_ticket", "maintenance_access", "extension_request"],
  turnover: ["cleaner_late_noshow", "incomplete_cleaning_form", "cleaning_overtime_approval"],
  account: ["review_removal_case", "review_action_item", "claim_tracker", "cleaning_issue"],
};

async function countOpenTicketsFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reservationIds: string[],
  types: string[],
): Promise<number> {
  if (reservationIds.length === 0) return 0;
  const { data } = await supabase
    .from("tickets")
    .select("id, type, reservation_id")
    .in("reservation_id", reservationIds)
    .in("type", types)
    .in("status", OPEN_STATUSES as unknown as string[]);
  return (data ?? []).filter((t) => !isHiddenTicketType(t.type)).length;
}

/**
 * Portfolio-wide "reservation spine" for the Dashboard hero (UI spec §9.1).
 * Counts are reservation cohorts (which stage a unit is at right now);
 * flagged is the open-ticket count of the types listed for that node, scoped
 * to that same cohort - most of those types aren't automated yet (M2/M4 not
 * built), so a 0 there is accurate, not a bug.
 */
export async function getPortfolioSpine(): Promise<SpineNode[]> {
  const supabase = await createClient();
  const today = todayLocal();
  const turnoverSince = new Date(Date.now() - 2 * 86400000);
  const turnoverSinceStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(turnoverSince);

  const [bookedRes, checkinRes, stayRes, checkoutRes, turnoverRes, accountability] = await Promise.all([
    supabase.from("reservations").select("id").gt("check_in", today),
    supabase.from("reservations").select("id").eq("check_in", today),
    supabase.from("reservations").select("id").lt("check_in", today).gt("check_out", today),
    supabase.from("reservations").select("id").eq("check_out", today),
    supabase.from("reservations").select("id").gt("check_out", turnoverSinceStr).lte("check_out", today),
    supabase
      .from("tickets")
      .select("id, type, reservation_id")
      .eq("stage", "accountability")
      .in("status", OPEN_STATUSES as unknown as string[]),
  ]);

  const bookedIds = (bookedRes.data ?? []).map((r) => r.id);
  const checkinIds = (checkinRes.data ?? []).map((r) => r.id);
  const stayIds = (stayRes.data ?? []).map((r) => r.id);
  const checkoutIds = (checkoutRes.data ?? []).map((r) => r.id);
  const turnoverIds = (turnoverRes.data ?? []).map((r) => r.id);

  const accountabilityRows = (accountability.data ?? []).filter((t) => !isHiddenTicketType(t.type));
  const accountResIds = new Set(accountabilityRows.filter((t) => t.reservation_id).map((t) => t.reservation_id as string));

  const [bookFlag, checkinFlag, stayFlag, checkoutFlag, turnoverFlag] = await Promise.all([
    countOpenTicketsFor(supabase, bookedIds, FLAG_TYPES.book),
    countOpenTicketsFor(supabase, checkinIds, FLAG_TYPES.checkin),
    countOpenTicketsFor(supabase, stayIds, FLAG_TYPES.stay),
    // "anything open on a departing reservation" - no type filter
    (async () => {
      if (checkoutIds.length === 0) return 0;
      const { count } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .in("reservation_id", checkoutIds)
        .in("status", OPEN_STATUSES as unknown as string[]);
      return count ?? 0;
    })(),
    countOpenTicketsFor(supabase, turnoverIds, FLAG_TYPES.turnover),
  ]);

  return [
    { key: "book", label: "Book", count: bookedIds.length, sub: "upcoming", flagged: bookFlag },
    { key: "checkin", label: "Check-in", count: checkinIds.length, sub: "arriving", flagged: checkinFlag },
    { key: "stay", label: "Stay", count: stayIds.length, sub: "in house", flagged: stayFlag },
    { key: "checkout", label: "Check-out", count: checkoutIds.length, sub: "departing", flagged: checkoutFlag },
    { key: "turnover", label: "Turnover", count: turnoverIds.length, sub: "cleaning", flagged: turnoverFlag },
    { key: "account", label: "Account", count: accountResIds.size, sub: "post-stay", flagged: accountabilityRows.length },
  ];
}

export interface DashboardKpis {
  openTickets: number;
  openTicketsPastSla: number;
  awaitingMessages: number;
  awaitingCalls: number;
  cleansInFlight: number;
  cleansLate: number;
  cleansFormIncomplete: number;
  openClaims: number;
  nextClaimDeadlineDays: number | null;
}

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const supabase = await createClient();

  const [{ data: openTicketsRaw }, { count: missedCalls }, { data: claimTickets }] = await Promise.all([
    supabase.from("tickets").select("type, sla_breached").in("status", OPEN_STATUSES as unknown as string[]),
    supabase.from("calls").select("id", { count: "exact", head: true }).eq("call_status", "missed"),
    supabase.from("tickets").select("due_at, metadata").eq("type", "claim_tracker").in("status", OPEN_STATUSES as unknown as string[]),
  ]);

  const visible = (openTicketsRaw ?? []).filter((t) => !isHiddenTicketType(t.type));
  const countByType = (types: string[]) => visible.filter((t) => types.includes(t.type)).length;

  const today = new Date();
  const deadlines = (claimTickets ?? [])
    .map((t) => {
      const raw = t.due_at ?? (t.metadata as Record<string, unknown> | null)?.filing_deadline;
      return typeof raw === "string" ? new Date(raw) : null;
    })
    .filter((d): d is Date => d != null && !isNaN(d.getTime()));
  const nextDeadline = deadlines.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return {
    openTickets: visible.length,
    openTicketsPastSla: visible.filter((t) => t.sla_breached).length,
    awaitingMessages: countByType(["unanswered_message"]),
    awaitingCalls: missedCalls ?? 0,
    cleansInFlight: countByType(["cleaner_late_noshow", "incomplete_cleaning_form", "cleaning_overtime_approval"]),
    cleansLate: countByType(["cleaner_late_noshow"]),
    cleansFormIncomplete: countByType(["incomplete_cleaning_form"]),
    openClaims: (claimTickets ?? []).length,
    nextClaimDeadlineDays: nextDeadline ? Math.max(0, Math.round((nextDeadline.getTime() - today.getTime()) / 86400000)) : null,
  };
}

export interface Sparkline {
  points: { label: string; value: number }[];
  current: number;
  delta: number;
  deltaGood: boolean;
}

/** One query per source, aggregated in JS - not per-bucket queries, since the dashboard refetches on every visit (no client cache). */
export async function getTrends(): Promise<{ rating: Sparkline; openTickets: Sparkline; cleanliness: Sparkline }> {
  const supabase = await createClient();
  const since13mo = new Date();
  since13mo.setMonth(since13mo.getMonth() - 13);

  const [{ data: reviews }, { data: tickets }] = await Promise.all([
    supabase
      .from("reviews")
      .select("review_date, overall_rating, cleanliness_rating")
      .gte("review_date", since13mo.toISOString().slice(0, 10))
      .not("review_date", "is", null),
    supabase.from("tickets").select("type, created_at, closed_at").gte("created_at", new Date(Date.now() - 15 * 86400000).toISOString()),
  ]);

  const monthKey = (d: string) => d.slice(0, 7);
  const monthlyAvg = (field: "overall_rating" | "cleanliness_rating") => {
    const byMonth = new Map<string, { sum: number; n: number }>();
    for (const r of reviews ?? []) {
      const v = r[field];
      if (v == null || !r.review_date) continue;
      const k = monthKey(r.review_date);
      const cur = byMonth.get(k) ?? { sum: 0, n: 0 };
      cur.sum += v;
      cur.n += 1;
      byMonth.set(k, cur);
    }
    const months: string[] = [];
    const cursor = new Date(since13mo);
    for (let i = 0; i < 12; i++) {
      months.push(cursor.toISOString().slice(0, 7));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months.map((m) => {
      const agg = byMonth.get(m);
      return { label: m, value: agg ? Math.round((agg.sum / agg.n) * 100) / 100 : 0 };
    });
  };

  const ratingPoints = monthlyAvg("overall_rating");
  const cleanlinessPoints = monthlyAvg("cleanliness_rating");

  // Open-ticket backlog for each of the last 14 days, derived from one fetch (created/closed timestamps),
  // filtered to visible types the same way the rest of the app hides cleaner_late_noshow etc.
  const visibleTickets = (tickets ?? []).filter((t) => !isHiddenTicketType(t.type));
  const dayPoints: { label: string; value: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    const count = visibleTickets.filter((t) => {
      const created = new Date(t.created_at);
      const closed = t.closed_at ? new Date(t.closed_at) : null;
      return created <= dayEnd && (!closed || closed > dayEnd);
    }).length;
    dayPoints.push({ label: day.toISOString().slice(0, 10), value: count });
  }

  const lastNonZero = (pts: { value: number }[]) => [...pts].reverse().find((p) => p.value !== 0)?.value ?? pts.at(-1)?.value ?? 0;
  const delta = (pts: { value: number }[]) => {
    const nonZero = pts.filter((p) => p.value !== 0);
    if (nonZero.length < 2) return 0;
    return nonZero.at(-1)!.value - nonZero[0].value;
  };

  const ratingDelta = delta(ratingPoints);
  const ticketsDelta = delta(dayPoints);
  const cleanlinessDelta = delta(cleanlinessPoints);

  return {
    rating: { points: ratingPoints, current: lastNonZero(ratingPoints), delta: ratingDelta, deltaGood: ratingDelta >= 0 },
    openTickets: { points: dayPoints, current: dayPoints.at(-1)?.value ?? 0, delta: ticketsDelta, deltaGood: ticketsDelta <= 0 },
    cleanliness: {
      points: cleanlinessPoints,
      current: lastNonZero(cleanlinessPoints),
      delta: cleanlinessDelta,
      deltaGood: cleanlinessDelta >= 0,
    },
  };
}

export interface ActivityItem {
  id: string;
  kind: "ok" | "warn" | "crit" | "accent";
  title: string;
  detail: string;
  at: string;
  ticketId: string | null;
  reservationId: string | null;
}

export async function getLiveActivity(limit = 20): Promise<ActivityItem[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 6 * 3600000).toISOString();

  const [{ data: events }, { data: messages }, { data: calls }, { data: reviews }] = await Promise.all([
    supabase
      .from("ticket_events")
      .select("id, event_type, note, created_at, ticket_id, tickets(type, reservation_id)")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("messages")
      .select("id, body, sent_at, reservation_id")
      .eq("direction", "inbound")
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(limit),
    supabase
      .from("calls")
      .select("id, call_status, phone_number, occurred_at, conversation_id")
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(limit),
    supabase
      .from("reviews")
      .select("id, overall_rating, reviewer_name, created_at, reservation_id")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const items: ActivityItem[] = [];

  for (const e of events ?? []) {
    const ticket = e.tickets as unknown as { type: string; reservation_id: string | null } | null;
    if (ticket && isHiddenTicketType(ticket.type)) continue;
    items.push({
      id: `event-${e.id}`,
      kind: e.event_type === "escalation" ? "crit" : e.event_type === "status_change" ? "ok" : "accent",
      title: e.event_type.replace(/_/g, " "),
      detail: e.note ?? "",
      at: e.created_at,
      ticketId: e.ticket_id,
      reservationId: ticket?.reservation_id ?? null,
    });
  }
  for (const m of messages ?? []) {
    items.push({
      id: `msg-${m.id}`,
      kind: "warn",
      title: "Guest message",
      detail: (m.body ?? "").slice(0, 80),
      at: m.sent_at ?? new Date(0).toISOString(),
      ticketId: null,
      reservationId: m.reservation_id,
    });
  }
  for (const c of calls ?? []) {
    items.push({
      id: `call-${c.id}`,
      kind: c.call_status === "missed" ? "crit" : "accent",
      title: c.call_status === "missed" ? "Missed call" : "Call",
      detail: c.phone_number ?? "",
      at: c.occurred_at,
      ticketId: null,
      reservationId: null,
    });
  }
  for (const r of reviews ?? []) {
    items.push({
      id: `review-${r.id}`,
      kind: (r.overall_rating ?? 5) <= 3 ? "crit" : "accent",
      title: "New review",
      detail: `${r.reviewer_name ?? "Guest"} · ${r.overall_rating ?? "?"}★`,
      at: r.created_at ?? new Date(0).toISOString(),
      ticketId: null,
      reservationId: r.reservation_id,
    });
  }

  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
