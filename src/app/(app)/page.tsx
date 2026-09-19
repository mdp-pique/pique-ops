import { TopBar } from "@/components/pique/TopBar";
import { Tile } from "@/components/pique/primitives";
import { QueueRow } from "@/components/pique/QueueRow";
import { ReservationBubble } from "@/components/pique/ReservationBubble";
import { getTodaySummary } from "@/lib/data/today";
import { getNeedsHumanNow } from "@/lib/data/tickets";
import { getReservationCards } from "@/lib/data/reservations";
import Link from "next/link";

export default async function TodayPage() {
  const [summary, needsHuman, current] = await Promise.all([
    getTodaySummary(),
    getNeedsHumanNow(6),
    getReservationCards("current"),
  ]);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  return (
    <>
      <TopBar title="Today" subtitle={`${today} – Edmonton, Calgary, Canmore`} />

      <div className="tiles">
        <Tile href="/queue" variant="warn" eyebrow="Open tickets" value={summary.openTicketCount} label={`${summary.breachedCount} past SLA`} />
        <Tile href="/queue?type=msg" variant="crit" eyebrow="Unanswered" value={summary.unansweredCount} label="guest messages" />
        <Tile
          href="/reservations?bucket=future"
          variant="accent"
          eyebrow="Arriving"
          value={summary.arrivalsCount}
          label={`next 7 days – ${summary.arrivalsFlaggedCount} flagged`}
        />
        <Tile
          href="/reservations?bucket=current"
          variant="ok"
          eyebrow="In stay"
          value={summary.inStayCount}
          label={`${summary.inStayWithMaintenanceCount} with open maintenance`}
        />
      </div>

      <div className="section-h">
        <h2>Needs a human now</h2>
        <Link href="/queue">Open queue</Link>
      </div>
      <div className="list">
        {needsHuman.length === 0 && <div className="card">Nothing needs a human right now.</div>}
        {needsHuman.map((row) => (
          <QueueRow key={row.id} row={row} />
        ))}
      </div>

      <div className="section-h">
        <h2>In stay right now</h2>
        <Link href="/reservations?bucket=current">All current</Link>
      </div>
      <div className="grid">
        {current.slice(0, 8).map((card) => (
          <ReservationBubble key={card.id} card={card} />
        ))}
      </div>
    </>
  );
}
