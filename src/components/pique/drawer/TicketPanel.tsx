"use client";

import { useRef, useState, useTransition } from "react";
import type { TicketDrawerData } from "@/lib/data/tickets";
import { Spine } from "@/components/pique/Spine";
import { Tag, StatusPill, Btn, IconBtn } from "@/components/pique/primitives";
import { useDrawer } from "./DrawerContext";
import { assignTicket, addTicketComment, rollOverTicket, markUnansweredMessageResolved, uploadTicketAttachment } from "./actions";
import { ReviewRemovalPanel } from "./ReviewRemovalPanel";
import { setTicketStatus, toggleTicketItem, addTicketItem } from "./ticketActions";
import { specFor } from "@/lib/pique-ui/domains";

const STATUS_OPTIONS = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "resolved", label: "Resolved" },
];

export function TicketPanel({
  data,
  onOpenReservation,
  onMutated,
}: {
  data: TicketDrawerData;
  onOpenReservation?: () => void;
  onMutated?: () => void;
}) {
  const { close, openTicket } = useDrawer();
  const [isPending, startTransition] = useTransition();
  const [comment, setComment] = useState("");
  const [newItem, setNewItem] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);
  const spec = specFor(data.type);
  const fieldLabels = new Map(spec?.fields.map((f) => [f.key, f.label]) ?? []);
  const details = Object.entries(data.metadata).filter(([k]) => !(spec && k === "title"));
  const undone = data.items.filter((i) => !i.isDone).length;

  const changeStatus = (status: string) => {
    if (status === "resolved" && undone > 0 && !window.confirm(`${undone} checklist item${undone === 1 ? " is" : "s are"} not done. Resolve anyway?`)) return;
    setStatusError(null);
    startTransition(async () => {
      const result = await setTicketStatus(data.id, status);
      if (result.error) setStatusError(result.error);
      onMutated?.();
    });
  };
  const fileInputRef = useRef<HTMLInputElement>(null);

  const timeline = [
    ...data.comments.map((c) => ({ kind: "comment" as const, at: c.at, actor: c.author, text: c.body })),
    ...data.events.map((e) => ({ kind: "event" as const, at: e.at, actor: "System", text: e.text })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const runAction = (action: () => Promise<unknown>) => {
    startTransition(async () => {
      await action();
      onMutated?.();
    });
  };

  return (
    <>
      <div className="d-top">
        <div className="crumbs">
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
            <select
              aria-label="Assignee"
              value={data.assigneeId ?? ""}
              disabled={isPending}
              onChange={(e) => {
                const id = e.target.value || null;
                const name = data.assignableUsers.find((u) => u.id === id)?.name;
                runAction(() => assignTicket(data.id, id, name));
              }}
              style={{
                borderRadius: 999,
                border: "1px solid var(--line-2)",
                background: "var(--surface-2)",
                color: "var(--ink)",
                font: "inherit",
                fontSize: 12.5,
                fontWeight: 600,
                padding: "6px 10px",
              }}
            >
              <option value="" style={{ background: "var(--surface-solid)", color: "var(--ink)" }}>
                Unassigned
              </option>
              {data.assignableUsers.map((u) => (
                <option key={u.id} value={u.id} style={{ background: "var(--surface-solid)", color: "var(--ink)" }}>
                  {u.name}
                </option>
              ))}
            </select>
            <StatusPill variant={data.due.late ? "crit" : "neutral"}>{data.due.text}</StatusPill>
          </div>
          {spec && (
            <div className="status-seg" role="group" aria-label="Status">
              {STATUS_OPTIONS.map((o) => (
                <button key={o.key} aria-pressed={data.status === o.key} disabled={isPending} onClick={() => changeStatus(o.key)}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {statusError && (
            <p className="form-err" role="alert">
              {statusError}
            </p>
          )}
        </div>

        {data.reservationSummary && (
          <button
            className="card"
            style={{ textAlign: "left", cursor: "pointer", width: "100%" }}
            onClick={() => data.reservationId && onOpenReservation?.()}
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
            {details.length === 0 ? (
              <span style={{ color: "var(--ink-3)" }}>No additional details recorded.</span>
            ) : (
              <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", margin: 0 }}>
                {details.map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt style={{ color: "var(--ink-3)" }}>{fieldLabels.get(k) ?? k.replace(/_/g, " ")}</dt>
                    <dd style={{ margin: 0, wordBreak: "break-word", whiteSpace: "pre-line" }}>{String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        {data.type === "review_removal_case" && typeof data.metadata.review_id === "string" && (
          <ReviewRemovalPanel ticketId={data.id} reviewId={data.metadata.review_id} onMutated={onMutated} />
        )}

        {data.type === "review_flag" && typeof data.metadata.review_flags_id === "number" && (
          <ReviewRemovalPanel
            ticketId={data.id}
            reservationId={data.reservationId}
            flagReviewFlagsId={data.metadata.review_flags_id}
            onMutated={onMutated}
          />
        )}

        {data.attachments.length > 0 && (
          <div className="card">
            <h3>Attachments</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {data.attachments.map((a) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "block", width: 72, height: 72, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line-2)" }}
                >
                  {a.kind === "photo" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 11, color: "var(--ink-3)" }}>
                      File
                    </div>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {(data.items.length > 0 || spec) && (
          <div className="card">
            <h3>
              Checklist{" "}
              <span className="mono">
                {data.items.length - undone}/{data.items.length}
              </span>
            </h3>
            <ul className="items">
              {data.items.map((i) => (
                <li key={i.id} className={i.isDone ? "done" : ""}>
                  <button
                    role="checkbox"
                    aria-checked={i.isDone}
                    disabled={isPending}
                    onClick={() => runAction(() => toggleTicketItem(data.id, i.id, !i.isDone))}
                  >
                    <i />
                    <span>{i.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="add-item"
              onSubmit={(e) => {
                e.preventDefault();
                const label = newItem.trim();
                if (!label) return;
                setNewItem("");
                runAction(() => addTicketItem(data.id, label));
              }}
            >
              <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item…" aria-label="New checklist item" />
              <Btn type="submit" disabled={isPending || !newItem.trim()}>
                Add
              </Btn>
            </form>
          </div>
        )}

        <div className="actions">
          <Btn onClick={() => {
            const body = comment.trim();
            if (!body) return;
            setComment("");
            runAction(() => addTicketComment(data.id, body));
          }}>
            Comment
          </Btn>
          <Btn onClick={() => fileInputRef.current?.click()}>Add photo</Btn>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              const files = e.target.files;
              if (!files || files.length === 0) return;
              const formData = new FormData();
              for (const f of Array.from(files)) formData.append("files", f);
              e.target.value = "";
              runAction(() => uploadTicketAttachment(data.id, formData));
            }}
          />
          {data.type === "maintenance_ticket" && undone > 0 && data.status !== "resolved" && (
            <Btn
              disabled={isPending}
              onClick={() => {
                if (!window.confirm(`Close this visit as partly done and open a follow-up with the ${undone} unfinished item${undone === 1 ? "" : "s"}?`)) return;
                startTransition(async () => {
                  const result = await rollOverTicket(data.id);
                  if ("error" in result) setStatusError(result.error);
                  else openTicket(result.id);
                });
              }}
            >
              Roll over
            </Btn>
          )}
          {data.type === "unanswered_message" && data.status !== "resolved" && (
            <Btn variant="primary" onClick={() => runAction(() => markUnansweredMessageResolved(data.id))}>
              Mark answered
            </Btn>
          )}
        </div>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment…"
          aria-label="Comment"
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
