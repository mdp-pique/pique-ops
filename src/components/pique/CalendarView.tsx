"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { CalendarData, CalDay, CalTicket, CalClean, LayerKey } from "@/lib/data/calendar";
import { useDrawer } from "./drawer/DrawerContext";

const LAYERS: { key: LayerKey; label: string; hint: string; defaultOn: boolean }[] = [
  { key: "res", label: "Reservations", hint: "Check-ins & check-outs", defaultOn: true },
  { key: "clean", label: "Cleans", hint: "Connecteam shifts", defaultOn: true },
  { key: "maint", label: "Maintenance", hint: "Repairs due", defaultOn: true },
  { key: "cs", label: "Customer service", hint: "Requests & claims due", defaultOn: true },
  // Off by default: the review backlog would crowd out everything else.
  { key: "rev", label: "Reviews", hint: "Flags & removals due", defaultOn: false },
];

// Layer toggles are a per-person convenience, so they live in this browser.
const STORAGE_KEY = "pq-calendar-layers";
const STORAGE_EVENT = "pq-calendar-layers";
function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function subscribeStored(cb: () => void) {
  window.addEventListener(STORAGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(STORAGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function writeStored(value: Record<LayerKey, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private window or blocked storage: toggles just won't be remembered.
  }
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const asDate = (d: string) => new Date(`${d}T12:00:00`);
const dow = (d: string) => asDate(d).toLocaleDateString("en-CA", { weekday: "short" });
const dayNum = (d: string) => asDate(d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
const longDay = (d: string) => asDate(d).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
const daysBetween = (a: string, b: string) => Math.round((asDate(b).getTime() - asDate(a).getTime()) / 86_400_000);

const CLEAN_STATE: Record<string, { text: string; tone: "behind" | "attention" | "" }> = {
  ok: { text: "", tone: "" },
  not_clocked_in: { text: "Not clocked in", tone: "behind" },
  no_show: { text: "No-show", tone: "behind" },
  draft: { text: "Draft, not published", tone: "attention" },
  unassigned: { text: "Nobody assigned", tone: "attention" },
  open: { text: "Open shift, not claimed yet", tone: "" },
};

function toneFor(health: string | null): "behind" | "attention" | "" {
  if (health === "behind" || health === "missed") return "behind";
  if (health === "attention") return "attention";
  return "";
}

function Badge({ tone }: { tone: "behind" | "attention" | "" }) {
  if (!tone) return null;
  return <span className={`cal-badge ${tone}`}>{tone === "behind" ? "Behind" : "Attention"}</span>;
}

export function CalendarView({ data }: { data: CalendarData }) {
  const { openTicket, openRes } = useDrawer();
  const stored = useSyncExternalStore(subscribeStored, readStored, () => null);
  const on = useMemo(() => {
    const base = Object.fromEntries(LAYERS.map((l) => [l.key, l.defaultOn])) as Record<LayerKey, boolean>;
    try {
      const parsed = stored ? (JSON.parse(stored) as Partial<Record<LayerKey, boolean>>) : {};
      for (const l of LAYERS) if (typeof parsed[l.key] === "boolean") base[l.key] = parsed[l.key]!;
    } catch {
      // Bad stored value: fall back to defaults.
    }
    return base;
  }, [stored]);
  const toggle = (key: LayerKey) => writeStored({ ...on, [key]: !on[key] });

  const inRange = data.days.some((d) => d.date === data.today);
  const [sel, setSel] = useState(inRange ? data.today : data.start);
  const selDay = data.days.find((d) => d.date === sel) ?? data.days[0];
  const visible = LAYERS.filter((l) => on[l.key]);
  const end = data.days[data.days.length - 1].date;

  const weekCount = (key: LayerKey) =>
    data.days.reduce((n, d) => {
      if (key === "res") return n + d.checkIns.length + d.checkOuts.length;
      if (key === "clean") return n + d.cleans.length;
      return n + d.tickets.filter((t) => t.layer === key).length;
    }, 0);

  const pick = (date: string) => {
    setSel(date);
    document.getElementById("cal-detail")?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  // Many of the same ticket on one day (12 pet fees) read as one line on the board.
  const ticketGroups = (list: CalTicket[]) => {
    const groups: { key: string; items: CalTicket[] }[] = [];
    for (const t of list) {
      const key = `${t.typeLabel}|${t.health ?? ""}|${t.done}`;
      const g = groups.find((x) => x.key === key);
      if (g) g.items.push(t);
      else groups.push({ key, items: [t] });
    }
    return groups;
  };

  const cell = (d: CalDay, key: LayerKey) => {
    if (key === "res") {
      const turn = d.checkOuts.filter((o) => d.checkIns.some((i) => i.propertyName === o.propertyName)).length;
      if (!d.checkIns.length && !d.checkOuts.length) return null;
      return (
        <>
          <span className="cal-resline">
            <span className="cal-pill num">{d.checkIns.length} in</span>
            <span className="cal-pill out num">{d.checkOuts.length} out</span>
          </span>
          {turn > 0 && <span className="cal-sub num">{turn} same-day turnover{turn > 1 ? "s" : ""}</span>}
        </>
      );
    }
    if (key === "clean") {
      if (!d.cleans.length) return null;
      const flagged = d.cleans.filter((c) => CLEAN_STATE[c.state]?.tone);
      const shown = [...flagged, ...d.cleans.filter((c) => !CLEAN_STATE[c.state]?.tone)].slice(0, 3);
      return (
        <>
          {shown.map((c) => (
            <CleanChip key={c.id} c={c} />
          ))}
          {d.cleans.length > 3 && <span className="cal-more num">+{d.cleans.length - 3} more · {d.cleans.length} cleans</span>}
        </>
      );
    }
    const groups = ticketGroups(d.tickets.filter((t) => t.layer === key));
    return (
      <>
        {groups.slice(0, 3).map((g) =>
          g.items.length === 1 ? (
            <TicketChip key={g.key} t={g.items[0]} onOpen={openTicket} />
          ) : (
            <span key={g.key} className={`cal-ev l-${key} ${toneFor(g.items[0].health)} ${g.items[0].done ? "done" : ""}`}>
              {g.items[0].typeLabel} × {g.items.length}
              <Badge tone={toneFor(g.items[0].health)} />
            </span>
          ),
        )}
        {groups.length > 3 && <span className="cal-more">+{groups.length - 3} more</span>}
      </>
    );
  };

  const overdueLayers = visible.filter((l) => l.key !== "res");
  const overdueTotal = data.overdue.filter((g) => on[g.layer]).reduce((n, g) => n + g.count, 0);

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="cal-layers" role="group" aria-label="Layers to show">
          <span className="mono">Show</span>
          {LAYERS.map((l) => (
            <button key={l.key} type="button" className={`cal-chip l-${l.key}`} aria-pressed={on[l.key]} onClick={() => toggle(l.key)}>
              <span className="cal-dot" />
              {l.label}
              <span className="n num">{weekCount(l.key)}</span>
            </button>
          ))}
        </div>
        <nav className="cal-week" aria-label="Week">
          <Link href={`/calendar?start=${addDays(data.start, -7)}`} aria-label="Previous week">
            &#8249;
          </Link>
          <span className="num">
            {dayNum(data.start)} – {dayNum(end)}
          </span>
          <Link href={`/calendar?start=${addDays(data.start, 7)}`} aria-label="Next week">
            &#8250;
          </Link>
          {!inRange && (
            <Link href="/calendar" className="cal-today">
              Today
            </Link>
          )}
        </nav>
      </div>

      {overdueLayers.length > 0 && (
        <section className="cal-overdue" aria-label="Overdue">
          <div className="cal-ohead">
            <h2>
              Overdue {overdueTotal > 0 && <span className="cal-count num">{overdueTotal}</span>}
            </h2>
            <p>Unfinished tasks from earlier days move up here and stay until someone closes them. Finished tasks stay on the day they were done.</p>
          </div>
          <div className="cal-ogrid">
            {overdueLayers.map((l) => {
              const groups = data.overdue.filter((g) => g.layer === l.key);
              const n = groups.reduce((a, g) => a + g.count, 0);
              return (
                <div key={l.key} className={`cal-ocard l-${l.key} ${n ? "" : "clear"}`}>
                  <h3>
                    {l.label}
                    <span className="num">{n ? `${n} overdue` : "0"}</span>
                  </h3>
                  {n === 0 && <span className="cal-caught">Nothing overdue</span>}
                  {groups.map((g) => {
                    const oldest = g.oldest[0]?.dueDate;
                    return (
                      <details key={g.typeLabel} className="cal-otype">
                        <summary>
                          <b>{g.typeLabel}</b>
                          <span className="n num">{g.count}</span>
                          {oldest && (
                            <span className="cal-sub">
                              Oldest {dayNum(oldest)} · {daysBetween(oldest, data.today)} days late
                            </span>
                          )}
                        </summary>
                        <div className="cal-olist">
                          {g.oldest.map((o) => (
                            <button key={o.id} type="button" onClick={() => openTicket(o.id)}>
                              <span>{o.propertyName}</span>
                              <span className="late">{daysBetween(o.dueDate, data.today)}d late</span>
                            </button>
                          ))}
                          {g.count > g.oldest.length && (
                            <Link href={g.href} className="rest">
                              See all {g.count}, oldest first →
                            </Link>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="cal-board-wrap">
        <div className="cal-board">
          <div className="cal-corner">
            <span className="mono">Week of {dayNum(data.start)}</span>
          </div>
          {data.days.map((d) => (
            <button
              key={d.date}
              type="button"
              className={`cal-dayhead ${d.date === data.today ? "today" : ""} ${d.date === sel ? "sel" : ""}`}
              aria-pressed={d.date === sel}
              onClick={() => pick(d.date)}
            >
              <span className="mono">{dow(d.date)}</span>
              <b>
                {dayNum(d.date)}
                {d.date === data.today && <span className="cal-todaytag">Today</span>}
              </b>
            </button>
          ))}
          {visible.map((l) => (
            <div key={l.key} className="cal-row">
              <div className={`cal-lane l-${l.key}`}>
                {l.label}
                <small>{l.hint}</small>
              </div>
              {data.days.map((d) => (
                <div key={d.date} className={`cal-cell ${d.date === sel ? "sel" : ""}`} onClick={() => pick(d.date)}>
                  {cell(d, l.key)}
                </div>
              ))}
            </div>
          ))}
          {visible.length === 0 && <div className="cal-empty">All layers are off. Turn one on above.</div>}
        </div>
      </div>

      <div className="cal-agenda">
        {data.days.map((d) => (
          <div key={d.date} className="cal-aday">
            <button type="button" onClick={() => pick(d.date)}>
              <b>
                {dow(d.date)} {dayNum(d.date)}
              </b>
              <span className="mono">{d.date === data.today ? "Today" : "Details ›"}</span>
            </button>
            {visible.map((l) => (
              <div key={l.key} className="cal-aline">
                {l.key === "res" ? (
                  d.checkIns.length + d.checkOuts.length > 0 && (
                    <span className="cal-ev l-res">
                      {d.checkIns.length} check-ins · {d.checkOuts.length} check-outs
                    </span>
                  )
                ) : (
                  cell(d, l.key)
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <section id="cal-detail" className="cal-detail" aria-live="polite">
        <div>
          <span className="mono">{selDay.date === data.today ? "Today" : "Selected day"}</span>
          <h2>{longDay(selDay.date)}</h2>
        </div>
        <div className="cal-dgroups">
          {visible.length === 0 && <span className="cal-empty">All layers are off.</span>}
          {visible.map((l) => (
            <div key={l.key} className={`cal-dgroup l-${l.key}`}>
              <h3>{l.label}</h3>
              {l.key === "res" && (
                <>
                  <ResList title="Checking out" list={selDay.checkOuts} onOpen={openRes} />
                  <ResList title="Checking in" list={selDay.checkIns} onOpen={openRes} />
                </>
              )}
              {l.key === "clean" &&
                (selDay.cleans.length ? (
                  [...selDay.cleans]
                    .sort((a, b) => Number(!CLEAN_STATE[a.state]?.tone) - Number(!CLEAN_STATE[b.state]?.tone))
                    .map((c) => <CleanChip key={c.id} c={c} full />)
                ) : (
                  <span className="cal-empty">No cleans scheduled.</span>
                ))}
              {l.key !== "res" &&
                l.key !== "clean" &&
                (() => {
                  const list = selDay.tickets.filter((t) => t.layer === l.key);
                  return list.length ? list.map((t) => <TicketChip key={t.id} t={t} onOpen={openTicket} />) : <span className="cal-empty">Nothing due.</span>;
                })()}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TicketChip({ t, onOpen }: { t: CalTicket; onOpen: (id: string) => void }) {
  const tone = toneFor(t.health);
  return (
    <button
      type="button"
      className={`cal-ev l-${t.layer} ${tone} ${t.done ? "done" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(t.id);
      }}
    >
      {t.done && <span className="sr-only">Done: </span>}
      {t.layer === "maint" ? t.title : t.typeLabel}
      <Badge tone={tone} />
      <span className="cal-sub">
        {t.propertyName} · {t.owner}
      </span>
    </button>
  );
}

function CleanChip({ c, full }: { c: CalClean; full?: boolean }) {
  const st = CLEAN_STATE[c.state] ?? { text: c.state, tone: "" as const };
  return (
    <span className={`cal-ev l-clean ${st.tone}`}>
      {c.time && <span className="cal-time">{c.time}</span>} {c.propertyName}
      <Badge tone={st.tone} />
      {full && <span className="cal-sub">{[st.text, c.cleaner ?? (c.state === "open" ? null : "Cleaner not matched")].filter(Boolean).join(" · ")}</span>}
    </span>
  );
}

function ResList({ title, list, onOpen }: { title: string; list: { id: string; propertyName: string; guestName: string | null }[]; onOpen: (id: string) => void }) {
  if (!list.length) return <span className="cal-empty">{title}: nobody.</span>;
  return (
    <details className="cal-reslist" open={list.length <= 6}>
      <summary>
        {title} <span className="num">({list.length})</span>
      </summary>
      {list.map((r) => (
        <button key={r.id} type="button" className="cal-ev l-res" onClick={() => onOpen(r.id)}>
          {r.propertyName}
          {r.guestName && <span className="cal-sub">{r.guestName}</span>}
        </button>
      ))}
    </details>
  );
}
