import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { TicketStatus } from "@/lib/types";

const STATUS_COLORS: Record<TicketStatus, string> = {
  open: "bg-blue-950 text-blue-300",
  in_progress: "bg-amber-950 text-amber-300",
  blocked: "bg-red-950 text-red-300",
  resolved: "bg-green-950 text-green-300",
  closed: "bg-gray-800 text-gray-400",
};

const VIEWS = [
  { key: "all", label: "All" },
  { key: "mine", label: "Mine" },
  { key: "unassigned", label: "Unassigned" },
  { key: "breached", label: "Breached" },
] as const;

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string }>;
}) {
  const { view = "all", status } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let query = supabase
    .from("tickets")
    .select(
      `id, type, status, priority, stage, guest_name, created_at, due_at, sla_breached,
       property:properties(property_name, public_name),
       assignee:profiles!tickets_assignee_id_fkey(display_name)`
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (view === "mine" && user) query = query.eq("assignee_id", user.id);
  if (view === "unassigned") query = query.is("assignee_id", null);
  if (view === "breached") query = query.eq("sla_breached", true);
  if (status) query = query.eq("status", status);

  const { data: tickets, error } = await query;

  if (error) console.error("Failed to load tickets:", error);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-4 text-lg font-semibold">Queue</h1>

      <div className="mb-4 flex gap-2 text-sm">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "all" ? "/" : `/?view=${v.key}`}
            className={`rounded-md px-3 py-1.5 ${
              view === v.key ? "bg-white text-black" : "border border-gray-700 text-gray-300 hover:bg-gray-900"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Priority</th>
              <th className="px-4 py-2">Property</th>
              <th className="px-4 py-2">Guest</th>
              <th className="px-4 py-2">Assignee</th>
              <th className="px-4 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {tickets?.map((t) => (
              <tr key={t.id} className="border-t border-gray-800 hover:bg-gray-900">
                <td className="px-4 py-2">
                  <Link href={`/tickets/${t.id}`} className="hover:underline">
                    {t.type}
                  </Link>
                  {t.sla_breached && <span className="ml-2 text-xs text-red-400">SLA</span>}
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[t.status as TicketStatus]}`}>
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-400">{t.priority}</td>
                <td className="px-4 py-2 text-gray-400">
                  {t.property?.public_name ?? t.property?.property_name ?? "—"}
                </td>
                <td className="px-4 py-2 text-gray-400">{t.guest_name ?? "—"}</td>
                <td className="px-4 py-2 text-gray-400">{t.assignee?.display_name ?? "Unassigned"}</td>
                <td className="px-4 py-2 text-gray-500">
                  {new Date(t.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {tickets?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No tickets in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
