import { notFound } from "next/navigation";
import { TopBar } from "@/components/pique/TopBar";
import { Segmented, ChipLink } from "@/components/pique/primitives";
import { QueueRow } from "@/components/pique/QueueRow";
import { getDomainData, type DomainSegment, type QueueRow as QueueRowData } from "@/lib/data/tickets";
import { domainFor, isDomainKey, type DomainKey } from "@/lib/pique-ui/domains";
import { ticketTypeLabel } from "@/lib/pique-ui/mappings";
import { todayLocal } from "@/lib/pique-ui/dates";
import { createClient } from "@/lib/supabase/server";

const SEGMENTS: { key: DomainSegment; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Mine" },
  { key: "unassigned", label: "Unassigned" },
  { key: "breached", label: "Breached" },
  { key: "resolved", label: "Resolved" },
];

const EMPTY: Record<DomainKey, string> = {
  reviews: "No review work open.",
  maintenance: "No maintenance open. Log an issue with New ticket.",
  claims: "No open claims. Start one from the reservation, or with New ticket.",
  requests: "No requests open.",
};

function localDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(new Date(iso));
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Requests and claims are about a date, so group by when they're due. */
function groupByDue(rows: QueueRowData[]): { label: string; rows: QueueRowData[] }[] {
  const today = todayLocal();
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  const order = ["Overdue", "Today", "Tomorrow", "Next 7 days", "Later", "No due date"];
  const buckets = new Map<string, QueueRowData[]>(order.map((l) => [l, []]));
  for (const r of rows) {
    let label = "No due date";
    if (r.dueAt) {
      const d = localDate(r.dueAt);
      label = d < today ? "Overdue" : d === today ? "Today" : d === tomorrow ? "Tomorrow" : d <= weekEnd ? "Next 7 days" : "Later";
    }
    buckets.get(label)!.push(r);
  }
  for (const list of buckets.values()) list.sort((a, b) => (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~"));
  return order.map((label) => ({ label, rows: buckets.get(label)! })).filter((g) => g.rows.length > 0);
}

/** Maintenance is worked unit by unit. */
function groupByProperty(rows: QueueRowData[]): { label: string; rows: QueueRowData[] }[] {
  const byProp = new Map<string, QueueRowData[]>();
  for (const r of rows) byProp.set(r.propertyName, [...(byProp.get(r.propertyName) ?? []), r]);
  return [...byProp.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([label, rows]) => ({ label, rows }));
}

export default async function DomainTicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ type?: string; segment?: string }>;
}) {
  const { domain: domainKey } = await params;
  if (!isDomainKey(domainKey)) notFound();
  const domain = domainFor(domainKey);

  const sp = await searchParams;
  const type = sp.type && domain.types.includes(sp.type) ? sp.type : "all";
  const segment = SEGMENTS.find((s) => s.key === sp.segment)?.key ?? "open";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { rows, countsByType } = await getDomainData({ domain: domainKey, type, segment, userId: user?.id });

  const qs = (o: { type?: string; segment?: string }) => {
    const p = new URLSearchParams();
    const t = o.type ?? type;
    const s = o.segment ?? segment;
    if (t !== "all") p.set("type", t);
    if (s !== "open") p.set("segment", s);
    const str = p.toString();
    return `/tickets/${domainKey}${str ? `?${str}` : ""}`;
  };

  const groups =
    segment === "resolved"
      ? [{ label: "", rows }]
      : domainKey === "requests" || domainKey === "claims"
        ? groupByDue(rows)
        : domainKey === "maintenance"
          ? groupByProperty(rows)
          : [{ label: "", rows }];

  return (
    <>
      <TopBar title={domain.label} subtitle={domain.blurb} newTicketDomain={domainKey} />
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Ticket type">
          <ChipLink href={qs({ type: "all" })} active={type === "all"}>
            All <span className="cnt num" style={{ opacity: 0.7 }}>{countsByType.all ?? 0}</span>
          </ChipLink>
          {domain.types.map((t) => (
            <ChipLink key={t} href={qs({ type: t })} active={type === t}>
              {ticketTypeLabel(t)} <span className="cnt num" style={{ opacity: 0.7 }}>{countsByType[t] ?? 0}</span>
            </ChipLink>
          ))}
        </div>
        <Segmented active={segment} options={SEGMENTS} hrefFor={(key) => qs({ segment: key })} />
      </div>
      {rows.length === 0 ? (
        <div className="card">{segment === "open" ? EMPTY[domainKey] : "Nothing here."}</div>
      ) : (
        groups.map((g) => (
          <section key={g.label || "all"} className="tsection">
            {g.label && (
              <h2 className={`tsection-h ${g.label === "Overdue" ? "late" : ""}`}>
                {g.label} <span className="num">{g.rows.length}</span>
              </h2>
            )}
            <div className="list">
              {g.rows.map((row) => (
                <QueueRow key={row.id} row={row} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
