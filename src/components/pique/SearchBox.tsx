"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useDrawer } from "./drawer/DrawerContext";
import { globalSearch, type ReservationOption, type TicketSearchResult } from "./drawer/ticketActions";
import { formatShortDate } from "@/lib/pique-ui/dates";

type Result =
  | { kind: "res"; key: string; r: ReservationOption }
  | { kind: "ticket"; key: string; t: TicketSearchResult };

/** ARIA combobox: type to search, arrows to move, Enter to open, Escape to close. */
export function SearchBox() {
  const { openRes, openTicket } = useDrawer();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const latest = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = ++latest.current;
    const timer = setTimeout(() => {
      setLoading(true);
      globalSearch(q).then(({ reservations, tickets }) => {
        if (id !== latest.current) return;
        setResults([
          ...tickets.map((t) => ({ kind: "ticket" as const, key: `t:${t.id}`, t })),
          ...reservations.map((r) => ({ kind: "res" as const, key: `r:${r.id}`, r })),
        ]);
        setActive(-1);
        setLoading(false);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const choose = (item: Result) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    if (item.kind === "res") openRes(item.r.id);
    else openTicket(item.t.id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter" && active >= 0 && results[active]) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };

  const showList = open && query.trim().length >= 2;
  const tickets = results.filter((x) => x.kind === "ticket");
  const reservations = results.filter((x) => x.kind === "res");

  const option = (item: Result) => {
    const index = results.indexOf(item);
    return (
      <li
        key={item.key}
        id={`${listId}-${index}`}
        role="option"
        aria-selected={index === active}
        className="sr-opt"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => choose(item)}
        onMouseEnter={() => setActive(index)}
      >
        {item.kind === "ticket" ? (
          <>
            <b>{item.t.title}</b>
            <span>
              {item.t.typeLabel} &middot; {item.t.propertyName}
            </span>
          </>
        ) : (
          <>
            <b>{item.r.guestName}</b>
            <span>
              {item.r.propertyName} &middot; {formatShortDate(item.r.checkIn)} &ndash; {formatShortDate(item.r.checkOut)}
            </span>
          </>
        )}
      </li>
    );
  };

  return (
    <div className="search-wrap" ref={boxRef}>
      <label className="search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="search"
          role="combobox"
          aria-label="Search guests, reservations and tickets"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Search guest, property, ticket…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </label>
      {showList && (
        <div className="search-pop">
          {loading && results.length === 0 && <p className="hint">Searching…</p>}
          {!loading && results.length === 0 && <p className="hint">No matches.</p>}
          <ul id={listId} role="listbox" aria-label="Search results">
            {tickets.length > 0 && (
              <li role="presentation" className="sr-h">
                Open tickets
              </li>
            )}
            {tickets.map(option)}
            {reservations.length > 0 && (
              <li role="presentation" className="sr-h">
                Reservations
              </li>
            )}
            {reservations.map(option)}
          </ul>
        </div>
      )}
    </div>
  );
}
