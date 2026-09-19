"use client";

import type { ActivityItem } from "@/lib/data/dashboard";
import { useDrawer } from "@/components/pique/drawer/DrawerContext";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

export function LiveActivity({ items }: { items: ActivityItem[] }) {
  const { openTicket, openRes } = useDrawer();

  if (items.length === 0) {
    return (
      <div className="feed">
        <div className="fitem" style={{ borderTop: 0, color: "var(--ink-3)", fontSize: 12.5 }}>
          Nothing in the last 6 hours.
        </div>
      </div>
    );
  }

  return (
    <div className="feed">
      {items.map((item) => (
        <button
          key={item.id}
          className="fitem"
          onClick={() => {
            if (item.ticketId) openTicket(item.ticketId);
            else if (item.reservationId) openRes(item.reservationId);
          }}
          disabled={!item.ticketId && !item.reservationId}
        >
          <span className={`fd ${item.kind}`} />
          <span>
            <div className="ft">
              <b>{item.title}</b>
            </div>
            {item.detail && <div className="fm">{item.detail}</div>}
          </span>
          <span className="fw">{relativeTime(item.at)}</span>
        </button>
      ))}
    </div>
  );
}
