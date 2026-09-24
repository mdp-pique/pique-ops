"use client";

import type { QueueRow as QueueRowData } from "@/lib/data/tickets";
import { healthLabel, healthVariant } from "@/lib/pique-ui/clock";
import { useDrawer } from "./drawer/DrawerContext";

const STRIPE: Record<string, string> = { ok: "ok", warn: "warn", crit: "crit", missed: "crit", neutral: "" };

export function QueueRow({ row }: { row: QueueRowData }) {
  const { openTicket } = useDrawer();
  const variant = healthVariant(row.health);
  const stripe = row.health ? STRIPE[variant] : row.severity;

  return (
    <button className="row" onClick={() => openTicket(row.id)}>
      <span className={`sev ${stripe}`} />
      <span>
        <div className="t">{row.title}</div>
        <div className="d">
          <b>{row.typeLabel}</b>
          <span>{row.propertyName}</span>
          <span>
            {row.guestName ?? "—"} {row.dates ? `· ${row.dates}` : ""}
          </span>
          <span>{row.ownerName}</span>
        </div>
      </span>
      <span className="right">
        {row.health ? <span className={`status ${variant}`}>{healthLabel(row.health)}</span> : <span className="status neutral">No due date</span>}
        {row.clock && (
          <span className={`clock ${variant}`}>
            <span className="clock-label">{row.clock.label}</span>
            <span className="clock-bar" aria-hidden="true">
              <i style={{ width: `${Math.round(row.clock.pct * 100)}%` }} />
            </span>
          </span>
        )}
      </span>
    </button>
  );
}
