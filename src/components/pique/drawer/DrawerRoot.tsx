"use client";

import { useEffect, useRef, useState } from "react";
import { useDrawer } from "./DrawerContext";
import { fetchReservationPanel, fetchTicketPanel } from "./actions";
import { ReservationPanel } from "./ReservationPanel";
import { TicketPanel } from "./TicketPanel";
import { NewTicketPanel } from "./NewTicketPanel";
import type { ReservationDrawerData } from "@/lib/data/reservations";
import type { TicketDrawerData } from "@/lib/data/tickets";

type Tab = "ticket" | "res";

/**
 * A ticket and its reservation are shown as tabs of ONE drawer, not two
 * separate panels you navigate between - a ticket has at most one
 * reservation, so there's never more than this one pair to hold at a time
 * (confirmed: every place in the app that opens a ticket or reservation
 * does so as a single fresh open, never a multi-level drill-down). Picking
 * a ticket off "Open on this reservation" flips the active tab locally
 * instead of pushing a new panel, so the Reservation tab is always one
 * click away and there's no back-arrow to hunt for.
 */
export function DrawerRoot() {
  const { panel, close, openTicket } = useDrawer();
  const [ticket, setTicket] = useState<TicketDrawerData | null>(null);
  const [res, setRes] = useState<ReservationDrawerData | null>(null);
  const [tab, setTab] = useState<Tab>("ticket");
  const bodyRef = useRef<HTMLDivElement>(null);

  // A fresh open from outside the drawer (Queue, Inbox, a reservation
  // bubble, Live Activity...) is a different identity than whatever pair
  // was showing before - reset during render (React's own pattern for
  // "adjusting state when a prop changes"), not as a side effect.
  const panelKey = panel ? `${panel.kind}:${panel.kind === "new" ? panel.nonce : panel.id}` : null;
  const seenKeyRef = useRef<string | null>(null);
  if (panelKey !== seenKeyRef.current) {
    seenKeyRef.current = panelKey;
    setTab(panel?.kind === "res" ? "res" : "ticket");
    setTicket(null);
    setRes(null);
  }

  useEffect(() => {
    if (!panel || panel.kind === "new") return;
    let cancelled = false;
    if (panel.kind === "ticket") {
      fetchTicketPanel(panel.id).then((data) => {
        if (!cancelled) setTicket(data);
      });
    } else {
      fetchReservationPanel(panel.id).then((data) => {
        if (!cancelled) setRes(data);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [panel]);

  // Once a ticket is loaded, prefetch its reservation (if any) so switching
  // to that tab is instant instead of a fresh load.
  useEffect(() => {
    if (!ticket?.reservationId) return;
    let cancelled = false;
    fetchReservationPanel(ticket.reservationId).then((data) => {
      if (!cancelled) setRes(data);
    });
    return () => {
      cancelled = true;
    };
  }, [ticket?.reservationId]);

  const selectTicket = (ticketId: string) => {
    setTab("ticket");
    setTicket(null);
    fetchTicketPanel(ticketId).then((data) => setTicket(data));
  };

  // Re-fetch the currently-open ticket after any action mutates it (assign,
  // comment, decide on a review, etc.) - the drawer holds its own copy of the
  // data locally now, so nothing else would pick up the change.
  const refreshTicket = () => {
    if (!ticket) return;
    fetchTicketPanel(ticket.id).then((data) => setTicket(data));
  };

  useEffect(() => {
    if (panel) bodyRef.current?.querySelector(".d-body")?.scrollTo({ top: 0 });
  }, [panel, tab]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && panel) close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel, close]);

  const isOpen = !!panel;
  const isNew = panel?.kind === "new";
  const showTabs = !isNew && !!ticket?.reservationId;

  return (
    <>
      <div className={`scrim ${isOpen ? "open" : ""}`} onClick={close} />
      <aside className={`drawer ${isOpen ? "open" : ""}`} aria-hidden={!isOpen} role="dialog" aria-label="Detail" ref={bodyRef}>
        {showTabs && (
          <div className="d-tabs">
            <button className={tab === "ticket" ? "active" : ""} onClick={() => setTab("ticket")}>
              Ticket
            </button>
            <button className={tab === "res" ? "active" : ""} onClick={() => setTab("res")}>
              Reservation
            </button>
          </div>
        )}
        {panel?.kind === "new" && <NewTicketPanel key={panel.nonce} prefill={panel.prefill} onCreated={openTicket} />}
        {!isNew && tab === "res" && res && <ReservationPanel data={res} onSelectTicket={selectTicket} />}
        {!isNew && tab === "ticket" && ticket && (
          <TicketPanel data={ticket} onOpenReservation={() => setTab("res")} onMutated={refreshTicket} />
        )}
      </aside>
    </>
  );
}
