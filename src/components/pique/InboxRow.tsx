"use client";

import type { InboxRow as InboxRowData } from "@/lib/data/inbox";
import { useDrawer } from "./drawer/DrawerContext";

export function InboxRow({ row }: { row: InboxRowData }) {
  const { openRes } = useDrawer();
  return (
    <button className="row" onClick={() => openRes(row.reservationId)}>
      <span className={`sev ${row.unanswered ? "warn" : "ok"}`} />
      <span>
        <div className="t">
          {row.guestName} &middot; {row.propertyName}
        </div>
        <div className="d">{row.preview}</div>
      </span>
      <span className="right">
        <span className={`status ${row.unanswered ? "warn" : "neutral"}`}>{row.unanswered ? "Unanswered" : "Replied"}</span>
        <span className="due">{new Date(row.sentAt).toLocaleString()}</span>
      </span>
    </button>
  );
}
