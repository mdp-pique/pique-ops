import { TopBar } from "@/components/pique/TopBar";
import { Tile } from "@/components/pique/primitives";
import { QueueRow } from "@/components/pique/QueueRow";
import { Hero } from "@/components/pique/dashboard/Hero";
import { Sparkline } from "@/components/pique/dashboard/Sparkline";
import { LiveActivity } from "@/components/pique/dashboard/LiveActivity";
import { AskPique } from "@/components/pique/dashboard/AskPique";
import { getNeedsHumanNow } from "@/lib/data/tickets";
import { getPortfolioSpine, getDashboardKpis, getTrends, getLiveActivity } from "@/lib/data/dashboard";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [spine, kpis, trends, activity, needsHuman, { count: propertyCount }] = await Promise.all([
    getPortfolioSpine(),
    getDashboardKpis(),
    getTrends(),
    getLiveActivity(),
    getNeedsHumanNow(5),
    supabase.from("properties").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);

  return (
    <>
      <TopBar title="Dashboard" subtitle={`Live state across ${propertyCount ?? 0} properties – Edmonton, Calgary, Canmore`} />

      <Hero nodes={spine} />

      <AskPique />

      <div className="tiles">
        <Tile href="/tickets/reviews" variant="warn" eyebrow="Open tickets" value={kpis.openTickets} label={`${kpis.openTicketsPastSla} past SLA`} />
        <Tile
          href="/inbox"
          variant="crit"
          eyebrow="Awaiting reply"
          value={kpis.awaitingMessages + kpis.awaitingCalls}
          label={`${kpis.awaitingMessages} messages · ${kpis.awaitingCalls} calls`}
        />
        <Tile
          href="/reservations?bucket=checkingout"
          variant="accent"
          eyebrow="Cleans in flight"
          value={kpis.cleansInFlight}
          label={`${kpis.cleansLate} late · ${kpis.cleansFormIncomplete} form incomplete`}
        />
        <Tile
          href="/tickets/claims"
          variant="warn"
          eyebrow="Open claims"
          value={kpis.openClaims}
          label={kpis.nextClaimDeadlineDays != null ? `next deadline in ${kpis.nextClaimDeadlineDays} days` : "no deadlines on file"}
        />
      </div>

      <div className="section-h">
        <h2>Trends</h2>
      </div>
      <div className="sparks">
        <Sparkline
          title="Account rating"
          qualifier="trailing 12mo"
          data={trends.rating}
          decimals={2}
          threshold={{ value: 4.8, label: "4.8 Superhost" }}
        />
        <Sparkline title="Open tickets" qualifier="last 14 days" data={trends.openTickets} decimals={0} />
        <Sparkline title="Cleanliness subscore" qualifier="monthly avg" data={trends.cleanliness} decimals={2} />
      </div>

      <div className="section-h">
        <h2>Needs a human now</h2>
        <Link href="/tickets/reviews">Tickets</Link>
      </div>
      <div className="list">
        {needsHuman.length === 0 && <div className="card">Nothing needs a human right now.</div>}
        {needsHuman.map((row) => (
          <QueueRow key={row.id} row={row} />
        ))}
      </div>

      <div className="section-h">
        <h2>Live activity</h2>
      </div>
      <LiveActivity items={activity} />
    </>
  );
}
