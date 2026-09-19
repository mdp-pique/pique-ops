"use client";

import { useTransition } from "react";
import type { InboxRow as InboxRowData } from "@/lib/data/inbox";
import { useDrawer } from "./drawer/DrawerContext";
import { markUnansweredMessageResolved } from "./drawer/actions";
import { HospitableLink } from "./HospitableLink";

export function InboxRow({ row }: { row: InboxRowData }) {
  const { openRes } = useDrawer();
  const [isPending, startTransition] = useTransition();

  const open = () => openRes(row.reservationId);

  return (
    <div
      className="row"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <span className={`sev ${row.unanswered ? "warn" : "ok"}`} />
      <span>
        <div className="t">
          {row.guestName} &middot; {row.propertyName}
        </div>
        <div className="d">{row.preview}</div>
      </span>
      <span className="right">
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {row.unanswered && row.ticketId ? (
            <button
              className="btn"
              disabled={isPending}
              onClick={(e) => {
                e.stopPropagation();
                startTransition(() => markUnansweredMessageResolved(row.ticketId!));
              }}
            >
              {isPending ? "Marking…" : "Mark answered"}
            </button>
          ) : (
            <span className={`status ${row.unanswered ? "warn" : "neutral"}`}>{row.unanswered ? "Unanswered" : "Replied"}</span>
          )}
          <HospitableLink href={row.hospitableUrl} label="Open thread in Hospitable" />
        </span>
        <span className="due">{new Date(row.sentAt).toLocaleString()}</span>
      </span>
    </div>
  );
}
