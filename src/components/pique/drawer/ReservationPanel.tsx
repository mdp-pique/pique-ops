"use client";

import type { ReservationDrawerData } from "@/lib/data/reservations";
import { Spine } from "@/components/pique/Spine";
import { StatusPill, IconBtn } from "@/components/pique/primitives";
import { statusPillFor } from "@/lib/pique-ui/status-pill";
import { useDrawer } from "./DrawerContext";
import { HospitableLink } from "@/components/pique/HospitableLink";
import { DOMAINS, domainForType } from "@/lib/pique-ui/domains";

export function ReservationPanel({ data, onSelectTicket }: { data: ReservationDrawerData; onSelectTicket: (ticketId: string) => void }) {
  const { close, openNew } = useDrawer();
  const pill = statusPillFor(data.bucket, data.stages);

  // Same grouping as the Tickets sections, so a ticket lives in one mental place wherever it's opened from.
  const groups = [
    ...DOMAINS.map((d) => ({ key: d.key, label: d.label, tickets: data.tickets.filter((t) => domainForType(t.type) === d.key) })),
    { key: "other", label: "Messages & other", tickets: data.tickets.filter((t) => domainForType(t.type) == null) },
  ].filter((g) => g.tickets.length > 0);

  const addTicket = () =>
    openNew({
      reservation: {
        id: data.id,
        guestName: data.guestName,
        propertyName: data.propertyName,
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        bookedAt: null,
      },
    });

  return (
    <>
      <div className="d-top">
        <div className="crumbs">
          <span>Reservation</span>
          <span>&rsaquo;</span>
          <b>{data.propertyName}</b>
        </div>
        <IconBtn label="Close" onClick={close}>
          <svg viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </IconBtn>
      </div>
      <div className="d-body">
        <div className="d-hero">
          <h2>
            {data.guestName} at {data.propertyName}
          </h2>
          <div className="m">
            <span>{data.city}</span>
            <span>
              {data.checkIn} &ndash; {data.checkOut}
            </span>
            <StatusPill variant={pill.variant}>{pill.label}</StatusPill>
          </div>
        </div>

        <div className="card">
          <Spine stages={data.stages} lg />
        </div>

        <div className="card">
          <h3>
            <span>
              Tickets on this reservation{" "}
              <span className="mono">
                {data.tickets.filter((t) => t.isOpen).length} open &middot; {data.tickets.length} total
              </span>
            </span>
            <button className="go" onClick={addTicket}>
              + Add ticket
            </button>
          </h3>
          {data.tickets.length === 0 ? (
            <div className="d" style={{ color: "var(--ink-3)" }}>
              Nothing on file. Clean run.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="tgroup">
                <div className="mono">
                  {g.label} &middot; {g.tickets.filter((t) => t.isOpen).length} open
                </div>
                {g.tickets.map((t) => (
                  <div className="issue" key={t.id} style={t.isOpen ? undefined : { opacity: 0.6 }}>
                    <div>
                      <div className="t">{t.title}</div>
                      <div className="d">
                        {t.typeLabel} &middot; {t.ownerName} &middot; {t.dueText}
                      </div>
                    </div>
                    <button className="go" onClick={() => onSelectTicket(t.id)}>
                      Open
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {data.thread && (
          <div className="card">
            <h3 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>
                Conversation <span className="mono">Hospitable</span>
              </span>
              <HospitableLink href={data.hospitableUrl} label="Open thread in Hospitable" />
            </h3>
            <div className="thread">
              {data.thread.map((m, i) => (
                <div key={i} className={`msg ${m.direction === "inbound" ? "in" : "out"} ${m.isAuto ? "auto" : ""}`}>
                  {m.body}
                  <small>
                    {m.isAuto ? "Auto-reply · " : ""}
                    {m.sentAt ? new Date(m.sentAt).toLocaleString() : ""}
                  </small>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.review && (
          <div className="card">
            <h3>
              Review <span className="mono">{data.review.stars} &#9733;</span>
            </h3>
            {data.review.text && <p className="quote">&ldquo;{data.review.text}&rdquo;</p>}
            <div className="subs">
              {data.review.subs.map((s) => (
                <span key={s.label} className={`sub ${s.value != null && s.value <= 3 ? "low" : ""}`}>
                  {s.label}
                  <b className="num">{s.value ?? "—"}</b>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
