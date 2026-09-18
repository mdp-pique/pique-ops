import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TicketStage, TicketStatus } from "@/lib/types";

const STAGES: { key: TicketStage; label: string }[] = [
  { key: "book", label: "Book" },
  { key: "checkin", label: "Check-in" },
  { key: "stay", label: "Stay" },
  { key: "checkout", label: "Check-out" },
  { key: "turnover", label: "Turnover" },
  { key: "accountability", label: "Accountability" },
];

const OPEN_STATUSES: TicketStatus[] = ["open", "in_progress", "blocked"];

function stageColor(tickets: { status: string; priority: string }[]) {
  const open = tickets.filter((t) => OPEN_STATUSES.includes(t.status as TicketStatus));
  if (open.length === 0) return "border-green-900 bg-green-950/40";
  if (open.some((t) => t.priority === "urgent" || t.status === "blocked")) return "border-red-900 bg-red-950/40";
  return "border-amber-900 bg-amber-950/40";
}

export default async function ReservationTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: reservation, error } = await supabase
    .from("reservations")
    .select(
      `id, confirmation_code, check_in, check_out, status, booking_source,
       property:properties(property_name, public_name),
       guest:guests(full_name, email, phone)`
    )
    .eq("id", id)
    .maybeSingle();

  if (error) console.error("Failed to load reservation:", error);
  if (!reservation) notFound();

  const [{ data: tickets }, { data: reviews }] = await Promise.all([
    supabase
      .from("tickets")
      .select("id, type, status, priority, stage, created_at")
      .eq("reservation_id", id)
      .order("created_at"),
    supabase
      .from("reviews")
      .select("overall_rating, cleanliness_rating, review_text, review_date")
      .eq("reservation_id", id),
  ]);

  const byStage = new Map<string, typeof tickets>();
  const unstaged: NonNullable<typeof tickets> = [];
  for (const t of tickets ?? []) {
    if (t.stage) {
      byStage.set(t.stage, [...(byStage.get(t.stage) ?? []), t]);
    } else {
      unstaged.push(t);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/reservations" className="text-sm text-gray-500 hover:underline">
        ← Reservations
      </Link>

      <div className="mt-2 mb-6">
        <h1 className="text-xl font-semibold">
          {reservation.guest?.full_name ?? "Unknown guest"} ·{" "}
          {reservation.property?.public_name ?? reservation.property?.property_name}
        </h1>
        <p className="text-sm text-gray-500">
          {reservation.check_in} → {reservation.check_out} · {reservation.confirmation_code ?? "no code"} ·{" "}
          {reservation.status} · {reservation.booking_source}
        </p>
      </div>

      <div className="grid grid-cols-6 gap-3">
        {STAGES.map((s) => {
          const stageTickets = byStage.get(s.key) ?? [];
          return (
            <div key={s.key} className={`rounded-lg border p-3 ${stageColor(stageTickets)}`}>
              <h2 className="mb-2 text-xs uppercase text-gray-400">{s.label}</h2>
              <ul className="space-y-1">
                {stageTickets.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tickets/${t.id}`} className="block text-xs hover:underline">
                      {t.type}
                      <span className="block text-gray-500">{t.status}</span>
                    </Link>
                  </li>
                ))}
                {s.key === "accountability" &&
                  reviews?.map((r, i) => (
                    <li key={i} className="text-xs text-gray-400">
                      ★ {r.overall_rating ?? "—"} ({r.review_date})
                    </li>
                  ))}
                {stageTickets.length === 0 && !(s.key === "accountability" && reviews?.length) && (
                  <li className="text-xs text-gray-600">—</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>

      {unstaged.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-800 p-3">
          <h2 className="mb-2 text-xs uppercase text-gray-500">Not stage-specific</h2>
          <ul className="flex flex-wrap gap-2">
            {unstaged.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tickets/${t.id}`}
                  className="rounded border border-gray-700 px-2 py-1 text-xs hover:bg-gray-900"
                >
                  {t.type} · {t.status}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
