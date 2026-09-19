"use client";

import { useEffect, useRef, useState } from "react";
import { useDrawer } from "./DrawerContext";
import { fetchReservationPanel, fetchTicketPanel } from "./actions";
import { ReservationPanel } from "./ReservationPanel";
import { TicketPanel } from "./TicketPanel";
import type { ReservationDrawerData } from "@/lib/data/reservations";
import type { TicketDrawerData } from "@/lib/data/tickets";

type Loaded =
  | { kind: "res"; data: ReservationDrawerData }
  | { kind: "ticket"; data: TicketDrawerData }
  | null;

export function DrawerRoot() {
  const { panel, close } = useDrawer();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panel) return;
    let cancelled = false;
    (async () => {
      if (panel.kind === "res") {
        const data = await fetchReservationPanel(panel.id);
        if (!cancelled && data) setLoaded({ kind: "res", data });
      } else {
        const data = await fetchTicketPanel(panel.id);
        if (!cancelled && data) setLoaded({ kind: "ticket", data });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [panel]);

  useEffect(() => {
    if (panel) bodyRef.current?.querySelector(".d-body")?.scrollTo({ top: 0 });
  }, [panel]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && panel) close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel, close]);

  const isOpen = !!panel;

  return (
    <>
      <div className={`scrim ${isOpen ? "open" : ""}`} onClick={close} />
      <aside className={`drawer ${isOpen ? "open" : ""}`} aria-hidden={!isOpen} role="dialog" aria-label="Detail" ref={bodyRef}>
        {loaded?.kind === "res" && <ReservationPanel data={loaded.data} />}
        {loaded?.kind === "ticket" && <TicketPanel data={loaded.data} />}
      </aside>
    </>
  );
}
