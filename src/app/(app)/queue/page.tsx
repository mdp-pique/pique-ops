import { TopBar } from "@/components/pique/TopBar";
import { Segmented, ChipLink } from "@/components/pique/primitives";
import { QueueRow } from "@/components/pique/QueueRow";
import { getQueueData } from "@/lib/data/tickets";
import { QUEUE_TYPE_FILTERS } from "@/lib/pique-ui/mappings";
import { createClient } from "@/lib/supabase/server";

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; segment?: string }>;
}) {
  const sp = await searchParams;
  const tagClass = sp.type ?? "all";
  const segment = sp.segment === "mine" || sp.segment === "breached" ? sp.segment : "open";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { rows, countsByTagClass } = await getQueueData({ tagClass, segment, userId: user?.id });

  const qs = (overrides: { type?: string; segment?: string }) => {
    const params = new URLSearchParams();
    const t = overrides.type ?? tagClass;
    const s = overrides.segment ?? segment;
    if (t !== "all") params.set("type", t);
    if (s !== "open") params.set("segment", s);
    const str = params.toString();
    return str ? `/queue?${str}` : "/queue";
  };

  return (
    <>
      <TopBar title="Queue" subtitle="Every open item across every reservation. Same tickets, different lens." />
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Ticket type">
          {QUEUE_TYPE_FILTERS.map((f) => (
            <ChipLink key={f.key} href={qs({ type: f.key })} active={tagClass === f.key}>
              {f.label} <span className="cnt num" style={{ opacity: 0.7 }}>{countsByTagClass[f.key] ?? 0}</span>
            </ChipLink>
          ))}
        </div>
        <Segmented
          active={segment}
          options={[
            { key: "open", label: "Open" },
            { key: "mine", label: "Mine" },
            { key: "breached", label: "Breached" },
          ]}
          hrefFor={(key) => qs({ segment: key })}
        />
      </div>
      <div className="list">
        {rows.length === 0 && <div className="card">Nothing open of this type.</div>}
        {rows.map((row) => (
          <QueueRow key={row.id} row={row} />
        ))}
      </div>
    </>
  );
}
