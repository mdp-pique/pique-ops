import { createClient } from "@/lib/supabase/server";
import { todayLocal, bucketFor, type Bucket, type ReservationStage } from "@/lib/pique-ui/dates";
import { computeStages, type StageTicketInfo } from "@/lib/pique-ui/spine";
import { ticketTagClass, ticketTypeLabel, OPEN_STATUSES, isHiddenTicketType } from "@/lib/pique-ui/mappings";
import type { StageState } from "@/lib/pique-ui/mappings";
import { hospitableThreadUrl } from "@/lib/pique-ui/hospitable";

export interface ReservationCard {
  id: string;
  propertyName: string;
  city: string | null;
  checkIn: string;
  checkOut: string;
  guestName: string;
  bucket: Bucket;
  stages: StageState[];
  tags: { cls: string; label: string }[];
  reviewStars: number | null;
}

const BUCKET_LIMIT = 60;

export async function getReservationBucketCounts(): Promise<Record<ReservationStage, number>> {
  const supabase = await createClient();
  const today = todayLocal();

  const [booked, checkingin, staying, checkingout, checkedout] = await Promise.all([
    supabase.from("reservations").select("id", { count: "exact", head: true }).gt("check_in", today),
    supabase.from("reservations").select("id", { count: "exact", head: true }).eq("check_in", today),
    supabase.from("reservations").select("id", { count: "exact", head: true }).lt("check_in", today).gt("check_out", today),
    supabase.from("reservations").select("id", { count: "exact", head: true }).eq("check_out", today),
    supabase.from("reservations").select("id", { count: "exact", head: true }).lt("check_out", today),
  ]);

  return {
    booked: booked.count ?? 0,
    checkingin: checkingin.count ?? 0,
    staying: staying.count ?? 0,
    checkingout: checkingout.count ?? 0,
    checkedout: checkedout.count ?? 0,
  };
}

export async function getReservationCards(stage: ReservationStage): Promise<ReservationCard[]> {
  const supabase = await createClient();
  const today = todayLocal();

  let query = supabase
    .from("reservations")
    .select(
      `id, check_in, check_out,
       property:properties(property_name, public_name, city),
       guest:guests(full_name)`,
    );

  if (stage === "booked") {
    query = query.gt("check_in", today).order("check_in", { ascending: true });
  } else if (stage === "checkingin") {
    query = query.eq("check_in", today).order("check_out", { ascending: true });
  } else if (stage === "staying") {
    query = query.lt("check_in", today).gt("check_out", today).order("check_out", { ascending: true });
  } else if (stage === "checkingout") {
    query = query.eq("check_out", today).order("check_in", { ascending: true });
  } else {
    query = query.lt("check_out", today).order("check_out", { ascending: false });
  }

  const { data: reservations, error } = await query.limit(BUCKET_LIMIT);
  if (error) {
    console.error("getReservationCards:", error);
    return [];
  }
  if (!reservations?.length) return [];

  return attachTicketsAndReviews(reservations);
}

async function attachTicketsAndReviews(
  reservations: {
    id: string;
    check_in: string;
    check_out: string;
    property: { property_name: string | null; public_name: string | null; city: string | null } | null;
    guest: { full_name: string | null } | null;
  }[],
): Promise<ReservationCard[]> {
  const supabase = await createClient();
  const ids = reservations.map((r) => r.id);

  const [{ data: tickets }, { data: reviews }] = await Promise.all([
    supabase
      .from("tickets")
      .select("reservation_id, type, stage, status, priority, sla_breached")
      .in("reservation_id", ids),
    supabase.from("reviews").select("reservation_id, overall_rating").in("reservation_id", ids).is("removed_at", null),
  ]);

  const ticketsByRes = new Map<string, NonNullable<typeof tickets>>();
  for (const t of tickets ?? []) {
    if (!t.reservation_id || isHiddenTicketType(t.type)) continue;
    const arr = ticketsByRes.get(t.reservation_id) ?? [];
    arr.push(t);
    ticketsByRes.set(t.reservation_id, arr);
  }
  const reviewByRes = new Map((reviews ?? []).map((r) => [r.reservation_id, r.overall_rating]));

  return reservations.map((r) => {
    const resTickets = ticketsByRes.get(r.id) ?? [];
    const openTickets = resTickets.filter((t) => (OPEN_STATUSES as readonly string[]).includes(t.status));
    const stageTickets: StageTicketInfo[] = resTickets.map((t) => ({
      stage: t.stage,
      status: t.status,
      priority: t.priority,
      sla_breached: t.sla_breached,
    }));

    const rating = reviewByRes.get(r.id);
    const bucket = bucketFor(r.check_in, r.check_out);

    return {
      id: r.id,
      propertyName: r.property?.public_name ?? r.property?.property_name ?? "Unknown property",
      city: r.property?.city ?? null,
      checkIn: r.check_in,
      checkOut: r.check_out,
      guestName: r.guest?.full_name ?? "Unknown guest",
      bucket,
      stages: computeStages(r.check_in, r.check_out, stageTickets, bucket),
      tags: [...new Set(openTickets.map((t) => t.type))].map((type) => ({
        cls: ticketTagClass(type),
        label: ticketTypeLabel(type),
      })),
      reviewStars: rating != null ? Math.round(rating) : null,
    };
  });
}

export interface ReservationDrawerData {
  id: string;
  propertyName: string;
  city: string | null;
  checkIn: string;
  checkOut: string;
  guestName: string;
  bucket: Bucket;
  stages: StageState[];
  tickets: {
    id: string;
    type: string;
    typeLabel: string;
    title: string;
    stage: string | null;
    ownerName: string;
    dueText: string;
    isOpen: boolean;
  }[];
  review: {
    stars: number;
    text: string | null;
    subs: { label: string; value: number | null }[];
  } | null;
  thread: { direction: string; body: string; sentAt: string; isAuto: boolean }[] | null;
  hospitableUrl: string | null;
}

export async function getReservationDrawerData(id: string): Promise<ReservationDrawerData | null> {
  const supabase = await createClient();
  const { data: r, error } = await supabase
    .from("reservations")
    .select(
      `id, check_in, check_out,
       property:properties(property_name, public_name, city),
       guest:guests(full_name)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) console.error("getReservationDrawerData:", error);
  if (!r) return null;

  const { bucketFor } = await import("@/lib/pique-ui/dates");
  const bucket = bucketFor(r.check_in, r.check_out);

  const [{ data: tickets }, { data: review }, { data: messages }] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        `id, type, stage, status, priority, sla_breached, due_at, created_at, closed_at, metadata,
         assignee:profiles!tickets_assignee_id_fkey(display_name)`,
      )
      .eq("reservation_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("reviews")
      .select("overall_rating, cleanliness_rating, communication_rating, checkin_rating, accuracy_rating, value_rating, review_text")
      .eq("reservation_id", id)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("direction, body, sent_at, raw_hospitable_data")
      .eq("reservation_id", id)
      .order("sent_at", { ascending: true })
      .limit(30),
  ]);

  const { ticketTitle, dueText } = await import("@/lib/pique-ui/ticket-display");

  const visibleTickets = (tickets ?? []).filter((t) => !isHiddenTicketType(t.type));

  const stageTickets: StageTicketInfo[] = visibleTickets.map((t) => ({
    stage: t.stage,
    status: t.status,
    priority: t.priority,
    sla_breached: t.sla_breached,
  }));

  // Every ticket tied to this reservation, not just the open ones - a
  // resolved review case or a fixed maintenance issue is still part of
  // "everything that happened here" and shouldn't vanish once it's done.
  // Open items sort first (each group by most recent), so what still needs
  // attention stays on top.
  const allTickets = visibleTickets
    .map((t) => {
      const isOpen = (OPEN_STATUSES as readonly string[]).includes(t.status);
      return {
        id: t.id,
        type: t.type,
        typeLabel: ticketTypeLabel(t.type),
        title: ticketTitle(t as { type: string; metadata: Record<string, unknown> }),
        stage: t.stage,
        ownerName: t.assignee?.display_name ?? "Unassigned",
        dueText: isOpen ? dueText(t).text : t.closed_at ? `Resolved ${new Date(t.closed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Resolved",
        isOpen,
      };
    })
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen));

  return {
    id: r.id,
    propertyName: r.property?.public_name ?? r.property?.property_name ?? "Unknown property",
    city: r.property?.city ?? null,
    checkIn: r.check_in,
    checkOut: r.check_out,
    guestName: r.guest?.full_name ?? "Unknown guest",
    bucket,
    stages: computeStages(r.check_in, r.check_out, stageTickets, bucket),
    tickets: allTickets,
    review: review
      ? {
          stars: Math.round(review.overall_rating ?? 0),
          text: review.review_text,
          subs: [
            { label: "Clean", value: review.cleanliness_rating },
            { label: "Comm", value: review.communication_rating },
            { label: "Check-in", value: review.checkin_rating },
            { label: "Accuracy", value: review.accuracy_rating },
            { label: "Value", value: review.value_rating },
          ],
        }
      : null,
    hospitableUrl: hospitableThreadUrl(
      (messages?.[0]?.raw_hospitable_data as { conversation_id?: string } | null)?.conversation_id,
    ),
    thread: messages?.length
      ? messages.map((m) => ({
          direction: m.direction ?? "inbound",
          body: m.body ?? "",
          sentAt: m.sent_at ?? "",
          isAuto: (m.raw_hospitable_data as { source?: string } | null)?.source === "automated",
        }))
      : null,
  };
}
