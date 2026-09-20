import Link from "next/link";
import type { SpineNode } from "@/lib/data/dashboard";

const HREF_BY_KEY: Record<string, string> = {
  book: "/reservations?bucket=booked",
  checkin: "/reservations?bucket=checkingin",
  stay: "/reservations?bucket=staying",
  checkout: "/reservations?bucket=checkingout",
  turnover: "/queue?type=clean",
  account: "/reservations?bucket=checkedout",
};

export function Hero({ nodes }: { nodes: SpineNode[] }) {
  return (
    <div className="hero">
      <div className="h-head">
        <h2>Portfolio right now</h2>
        <div className="live">
          <span className="dot" />
          <span>Live</span>
        </div>
      </div>
      <div className="hspine">
        {nodes.map((n) => (
          <Link key={n.key} href={HREF_BY_KEY[n.key] ?? "/reservations"} className={`hnode ${n.flagged > 0 ? "warn" : ""}`}>
            <div className="ring">
              <span className="n">{n.count}</span>
              {n.flagged > 0 && <span className="flag">{n.flagged}</span>}
            </div>
            <div className="txt">
              <span className="lbl">{n.label}</span>
              <span className="sub">{n.sub}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
