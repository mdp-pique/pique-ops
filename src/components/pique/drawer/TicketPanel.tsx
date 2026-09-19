"use client";

import { useState, useTransition } from "react";
import type { TicketDrawerData } from "@/lib/data/tickets";
import { Spine } from "@/components/pique/Spine";
import { Tag, StatusPill, Btn, IconBtn } from "@/components/pique/primitives";
import { useDrawer } from "./DrawerContext";
import { assignTicketToMe, addTicketComment, rollOverTicket, markUnansweredMessageResolved } from "./actions";

export function TicketPanel({ data }: { data: TicketDrawerData }) {
  const { openRes, back, close, hasBack } = useDrawer();
  const [, startTransition] = useTransition();
  const [comment, setComment] = useState("");

  const timeline = [
    ...data.comments.map((c) => ({ kind: "comment" as const, at: c.at, actor: c.author, text: c.body })),
    ...data.events.map((e) => ({ kind: "event" as const, at: e.at, actor: "System", text: e.text })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <>
      <div className="d-top">
        <div className="crumbs">
          {hasBack && (
            <IconBtn label="Back" onClick={back}>
              <svg viewBox="0 0 24 24">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </IconBtn>
          )}
          <span>{data.typeLabel}</span>
          <span>&rsaquo;</span>
          <b>{data.reservationSummary?.propertyName ?? "—"}</b>
        </div>
        <IconBtn label="Close" onClick={close}>
          <svg viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </IconBtn>
      </div>
      <div className="d-body">
        <div className="d-hero">
          <Tag cls={data.tagClass}>
            {data.typeLabel} &middot; {data.stageLabel}
          </Tag>
          <h2>{data.title}</h2>
          <div className="m">
            <StatusPill variant="neutral">{data.ownerName}</StatusPill>
            <StatusPill variant={data.due.late ? "crit" : "neutral"}>{data.due.text}</StatusPill>
          </div>
        </div>

        {data.reservationSummary && (
          <button
            className="card"
            style={{ textAlign: "left", cursor: "pointer", width: "100%" }}
            onClick={() => data.reservationId && openRes(data.reservationId)}
          >
            <h3>
              Reservation{" "}
              <span className="mono" style={{ color: "var(--accent)" }}>
                Open &rarr;
              </span>
            </h3>
            <div style={{ fontWeight: 600 }}>
              {data.reservationSummary.guestName} &middot; {data.reservationSummary.propertyName}
            </div>
            <div className="d" style={{ color: "var(--ink-3)", fontSize: 12, margin: "2px 0 10px" }}>
              {data.reservationSummary.city} &middot; {data.reservationSummary.checkIn} &ndash; {data.reservationSummary.checkOut}
            </div>
            <Spine stages={data.reservationStages} />
          </button>
        )}

        <div className="card">
          <h3>Details</h3>
          <div style={{ fontSize: "13.5px", color: "var(--ink-2)" }}>
            {Object.keys(data.metadata).length === 0 ? (
              <span style={{ color: "var(--ink-3)" }}>No additional details recorded.</span>
            ) : (
              <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", margin: 0 }}>
                {Object.entries(data.metadata).map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt style={{ color: "var(--ink-3)" }}>{k}</dt>
                    <dd style={{ margin: 0, wordBreak: "break-word" }}>{String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        {data.items.length > 0 && (
          <div className="card">
            <h3>
              Checklist{" "}
              <span className="mono">
                {data.items.filter((i) => i.isDone).length}/{data.items.length}
              </span>
            </h3>
            <ul className="items">
              {data.items.map((i) => (
                <li key={i.id} className={i.isDone ? "done" : ""}>
                  <i />
                  <span>{i.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="actions">
          <Btn variant="primary" onClick={() => startTransition(() => assignTicketToMe(data.id))}>
            Assign to me
          </Btn>
          <Btn>Add photo</Btn>
          <Btn
            onClick={() => {
              const body = comment.trim();
              if (!body) return;
              setComment("");
              startTransition(() => addTicketComment(data.id, body));
            }}
          >
            Comment
          </Btn>
          {data.tagClass === "maint" && <Btn onClick={() => startTransition(() => rollOverTicket(data.id))}>Roll over</Btn>}
          {data.type === "unanswered_message" && data.status !== "resolved" && (
            <Btn variant="primary" onClick={() => startTransition(() => markUnansweredMessageResolved(data.id))}>
              Mark answered
            </Btn>
          )}
        </div>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment…"
          style={{
            borderRadius: 999,
            border: "1px solid var(--line-2)",
            background: "var(--surface-solid)",
            padding: "8px 14px",
            color: "var(--ink)",
            font: "inherit",
          }}
        />

        <div className="card">
          <h3>History</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {timeline.length === 0 && <span style={{ color: "var(--ink-3)", fontSize: 12.5 }}>No activity yet.</span>}
            {timeline.map((entry, i) => (
              <div key={i} style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                <b style={{ color: "var(--ink-2)" }}>{entry.actor}</b> &middot; {new Date(entry.at).toLocaleString()}
                <div style={{ color: entry.kind === "comment" ? "var(--ink)" : "var(--ink-3)" }}>{entry.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
