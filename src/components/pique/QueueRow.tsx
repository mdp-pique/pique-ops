"use client";

import type { QueueRow as QueueRowData } from "@/lib/data/tickets";
import { useDrawer } from "./drawer/DrawerContext";

export function QueueRow({ row }: { row: QueueRowData }) {
  const { openTicket } = useDrawer();

  return (
    <button className="row" onClick={() => openTicket(row.id)}>
      <span className={`sev ${row.severity}`} />
      <span>
        <div className="t">{row.title}</div>
        <div className="d">
          <b>{row.typeLabel}</b>
          <span>{row.propertyName}</span>
          <span>
            {row.guestName ?? "—"} {row.dates ? `· ${row.dates}` : ""}
          </span>
          <span>{row.stageLabel}</span>
        </div>
      </span>
      <span className="right">
        <span className="status neutral">{row.ownerName}</span>
        <span className={`due ${row.due.late ? "late" : ""}`}>{row.due.text}</span>
      </span>
    </button>
  );
}
