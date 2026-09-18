import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TICKET_STATUSES } from "@/lib/types";
import { addComment, assignToMe, toggleItem, unassign, updateStatus } from "./actions";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: ticket, error } = await supabase
    .from("tickets")
    .select(
      `*,
       property:properties(property_name, public_name),
       reservation:reservations(confirmation_code, check_in, check_out),
       assignee:profiles!tickets_assignee_id_fkey(id, display_name),
       created_by_profile:profiles!tickets_created_by_fkey(display_name)`
    )
    .eq("id", id)
    .maybeSingle();

  if (error) console.error("Failed to load ticket:", error);
  if (!ticket) notFound();

  const [{ data: items }, { data: comments }, { data: events }, { data: profiles }] = await Promise.all([
    supabase.from("ticket_items").select("*").eq("ticket_id", id).order("sort_order"),
    supabase
      .from("ticket_comments")
      .select("*, author:profiles(display_name)")
      .eq("ticket_id", id)
      .order("created_at"),
    supabase
      .from("ticket_events")
      .select("*, actor:profiles(display_name)")
      .eq("ticket_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, display_name, role").order("display_name"),
  ]);

  const timeline = [
    ...(comments ?? []).map((c) => ({
      kind: "comment" as const,
      at: c.created_at,
      actor: c.author?.display_name ?? "Someone",
      text: c.body,
    })),
    ...(events ?? []).map((e) => ({
      kind: "event" as const,
      at: e.created_at,
      actor: e.actor?.display_name ?? "System",
      text: describeEvent(e),
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/" className="text-sm text-gray-500 hover:underline">
        ← Queue
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{ticket.type}</h1>
        <form action={updateStatus.bind(null, ticket.id)} className="flex items-center gap-2">
          <select
            name="status"
            defaultValue={ticket.status}
            className="rounded border border-gray-700 bg-black px-2 py-1 text-sm"
          >
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="rounded border border-gray-700 px-3 py-1 text-sm hover:bg-gray-900">
            Update
          </button>
        </form>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-gray-800 p-4 text-sm">
        <Field label="Priority" value={ticket.priority} />
        <Field label="Stage" value={ticket.stage ?? "—"} />
        <Field label="Property" value={ticket.property?.public_name ?? ticket.property?.property_name ?? "—"} />
        <div className="contents">
          <dt className="text-gray-500">Reservation</dt>
          <dd>
            {ticket.reservation_id ? (
              <Link href={`/reservations/${ticket.reservation_id}`} className="text-blue-400 hover:underline">
                {ticket.reservation?.confirmation_code ?? "view timeline"} ({ticket.reservation?.check_in} →{" "}
                {ticket.reservation?.check_out})
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <Field label="Guest" value={ticket.guest_name ?? "—"} />
        <Field label="Source" value={ticket.source} />
        <Field label="Created by" value={ticket.created_by_profile?.display_name ?? "Automation"} />
        <Field label="SLA breached" value={ticket.sla_breached ? "Yes" : "No"} />

        <div className="col-span-2 flex items-center gap-2 border-t border-gray-800 pt-2">
          <dt className="w-24 text-gray-500">Assignee</dt>
          <dd className="flex items-center gap-2">
            {ticket.assignee?.display_name ?? "Unassigned"}
            <form action={assignToMe.bind(null, ticket.id)}>
              <button className="text-xs text-blue-400 hover:underline">assign to me</button>
            </form>
            {ticket.assignee_id && (
              <form action={unassign.bind(null, ticket.id)}>
                <button className="text-xs text-gray-500 hover:underline">unassign</button>
              </form>
            )}
          </dd>
        </div>
      </dl>

      {ticket.metadata && Object.keys(ticket.metadata).length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-800 p-4 text-sm">
          <h2 className="mb-2 text-xs uppercase text-gray-500">Details</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            {Object.entries(ticket.metadata as Record<string, unknown>).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-gray-500">{k}</dt>
                <dd className="truncate">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-800 p-4 text-sm">
          <h2 className="mb-2 text-xs uppercase text-gray-500">Checklist</h2>
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.id}>
                <form action={toggleItem.bind(null, ticket.id, item.id, item.is_done)}>
                  <button type="submit" className="flex items-center gap-2 text-left hover:underline">
                    <span>{item.is_done ? "☑" : "☐"}</span>
                    <span className={item.is_done ? "text-gray-500 line-through" : ""}>{item.label}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-gray-800 p-4 text-sm">
        <h2 className="mb-2 text-xs uppercase text-gray-500">Activity</h2>
        <form action={addComment.bind(null, ticket.id)} className="mb-4 flex gap-2">
          <input
            name="body"
            placeholder="Add a comment…"
            className="flex-1 rounded border border-gray-700 bg-black px-3 py-1.5"
          />
          <button className="rounded border border-gray-700 px-3 py-1.5 hover:bg-gray-900">Post</button>
        </form>
        <ul className="space-y-3">
          {timeline.map((entry, i) => (
            <li key={i} className="border-t border-gray-800 pt-2 first:border-0 first:pt-0">
              <div className="flex justify-between text-xs text-gray-500">
                <span>{entry.actor}</span>
                <span>{new Date(entry.at).toLocaleString()}</span>
              </div>
              <p className={entry.kind === "event" ? "text-gray-400" : ""}>{entry.text}</p>
            </li>
          ))}
          {timeline.length === 0 && <li className="text-gray-500">No activity yet.</li>}
        </ul>
      </div>

      {profiles && profiles.length <= 1 && (
        <p className="mt-4 text-xs text-gray-600">
          Only one profile exists yet — invite the rest of the team to see assignment in action.
        </p>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function describeEvent(e: { event_type: string; from_value: string | null; to_value: string | null; note: string | null }) {
  switch (e.event_type) {
    case "status_change":
      return `Status changed ${e.from_value ?? "—"} → ${e.to_value}`;
    case "assignment":
      return e.note ?? "Assignment changed";
    case "escalation":
      return e.note ?? `Escalated (#${e.to_value})`;
    case "item_done":
      return e.to_value === "true" ? "Checked off an item" : "Un-checked an item";
    case "rollover":
      return e.note ?? "Rolled over";
    default:
      return e.note ?? e.event_type;
  }
}
