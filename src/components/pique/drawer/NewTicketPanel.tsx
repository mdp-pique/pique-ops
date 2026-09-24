"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { IconBtn, Btn } from "@/components/pique/primitives";
import { DOMAINS, CREATABLE_TYPES, specFor, defaultDueDate, type DomainKey, type FieldSpec } from "@/lib/pique-ui/domains";
import { ticketTypeLabel } from "@/lib/pique-ui/mappings";
import { todayLocal, formatShortDate } from "@/lib/pique-ui/dates";
import { useDrawer, type NewTicketPrefill } from "./DrawerContext";
import {
  getNewTicketOptions,
  searchReservations,
  createManualTicket,
  type NewTicketOptions,
  type ReservationOption,
} from "./ticketActions";

export function NewTicketPanel({ prefill, onCreated }: { prefill: NewTicketPrefill; onCreated: (ticketId: string) => void }) {
  const { close } = useDrawer();
  const [options, setOptions] = useState<NewTicketOptions | null>(null);

  const initialSpec = prefill.type ? specFor(prefill.type) : null;
  const [domain, setDomain] = useState<DomainKey | null>(initialSpec?.domain ?? prefill.domain ?? null);
  const [type, setType] = useState<string | null>(initialSpec?.type ?? null);
  const [reservation, setReservation] = useState<ReservationOption | null>(prefill.reservation ?? null);
  const [propertyId, setPropertyId] = useState("");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [priority, setPriority] = useState("normal");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueOverride, setDueOverride] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getNewTicketOptions().then(setOptions);
  }, []);

  const spec = type ? specFor(type) : null;
  const typesInDomain = domain ? CREATABLE_TYPES.filter((t) => t.domain === domain) : [];
  const defaultDue = spec ? defaultDueDate(spec, reservation, fields, todayLocal()) : null;
  const due = dueOverride ?? defaultDue ?? "";

  const pickDomain = (key: DomainKey) => {
    setDomain(key);
    if (spec?.domain !== key) {
      const only = CREATABLE_TYPES.filter((t) => t.domain === key);
      setType(only.length === 1 ? only[0].type : null);
      setFields({});
      setDueOverride(null);
    }
  };

  const pickType = (t: string) => {
    setType(t);
    setFields({});
    setDueOverride(null);
    setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!spec) return;
    setError(null);
    startTransition(async () => {
      const result = await createManualTicket({
        type: spec.type,
        reservationId: reservation?.id ?? null,
        propertyId: reservation ? null : propertyId || null,
        title,
        fields,
        priority,
        assigneeId: assigneeId || null,
        dueDate: due || null,
      });
      if ("error" in result) setError(result.error);
      else onCreated(result.id);
    });
  };

  return (
    <>
      <div className="d-top">
        <div className="crumbs">
          <span>Tickets</span>
          <span>&rsaquo;</span>
          <b>New ticket</b>
        </div>
        <IconBtn label="Close" onClick={close}>
          <svg viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </IconBtn>
      </div>
      <form className="d-body" onSubmit={submit}>
        <div className="d-hero">
          <h2>New ticket</h2>
        </div>

        <fieldset className="fset">
          <legend>Section</legend>
          <div className="choice-grid">
            {DOMAINS.map((d) => (
              <button type="button" key={d.key} className="choice" aria-pressed={domain === d.key} onClick={() => pickDomain(d.key)}>
                <b>{d.label}</b>
                <span>{d.blurb}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {domain && (
          <fieldset className="fset">
            <legend>Type</legend>
            <div className="choice-list">
              {typesInDomain.map((t) => (
                <button type="button" key={t.type} className="choice" aria-pressed={type === t.type} onClick={() => pickType(t.type)}>
                  <b>{ticketTypeLabel(t.type)}</b>
                  <span>{t.blurb}</span>
                </button>
              ))}
            </div>
            {domain === "reviews" && <p className="hint">Review flags and removal cases come in automatically - they don&rsquo;t need creating here.</p>}
            {domain === "maintenance" && <p className="hint">Nightly lock and camera checks will be created automatically once they&rsquo;re built.</p>}
          </fieldset>
        )}

        {spec && (
          <>
            <fieldset className="fset">
              <legend>{spec.needsReservation ? "Reservation" : "Reservation or property"}</legend>
              <ReservationPicker value={reservation} onChange={setReservation} />
              {!spec.needsReservation && !reservation && (
                <label className="fld">
                  <span>Or just the property</span>
                  <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                    <option value="">Choose a property…</option>
                    {options?.properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </fieldset>

            <fieldset className="fset">
              <legend>Details</legend>
              <label className="fld">
                <span>Summary</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={140} placeholder="One line - what is this?" />
              </label>
              {spec.fields.map((f) => (
                <Field key={f.key} spec={f} value={fields[f.key] ?? ""} onChange={(v) => setFields((prev) => ({ ...prev, [f.key]: v }))} />
              ))}
              {spec.items.length > 0 && (
                <div className="fld">
                  <span>Checklist</span>
                  <ul className="items">
                    {spec.items.map((label) => (
                      <li key={label}>
                        <i />
                        <span>{label}</span>
                      </li>
                    ))}
                  </ul>
                  <span className="hint">You can add more items after creating it.</span>
                </div>
              )}
            </fieldset>

            <fieldset className="fset">
              <legend>Who and when</legend>
              <div className="fld-row">
                <label className="fld">
                  <span>Priority</span>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
                <label className="fld">
                  <span>Due</span>
                  <input type="date" value={due} onChange={(e) => setDueOverride(e.target.value)} />
                </label>
              </div>
              {defaultDue && dueOverride == null && <span className="hint">{dueHint(spec.dueRule)}</span>}
              <label className="fld">
                <span>Assign to</span>
                <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {options?.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>

            {error && (
              <p className="form-err" role="alert">
                {error}
              </p>
            )}
            <div className="actions">
              <Btn type="submit" variant="primary" disabled={isPending}>
                {isPending ? "Creating…" : "Create ticket"}
              </Btn>
              <Btn onClick={close}>Cancel</Btn>
            </div>
          </>
        )}
      </form>
    </>
  );
}

function dueHint(rule: string): string {
  switch (rule) {
    case "checkin":
      return "Set to the check-in date.";
    case "claim_deadline":
      return "Filing deadline from checkout (AirCover 14 days, Truvi 30).";
    case "booking_plus_2d":
      return "Two days after booking.";
    default:
      return "";
  }
}

function Field({ spec, value, onChange }: { spec: FieldSpec; value: string; onChange: (v: string) => void }) {
  const label = (
    <span>
      {spec.label}
      {!spec.required && <em> (optional)</em>}
    </span>
  );
  if (spec.kind === "textarea") {
    return (
      <label className="fld">
        {label}
        <textarea value={value} onChange={(e) => onChange(e.target.value)} required={spec.required} placeholder={spec.placeholder} />
      </label>
    );
  }
  if (spec.kind === "select") {
    return (
      <label className="fld">
        {label}
        <select value={value} onChange={(e) => onChange(e.target.value)} required={spec.required}>
          <option value="">Choose…</option>
          {spec.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="fld">
      {label}
      <input
        type={spec.kind === "number" ? "number" : spec.kind === "date" ? "date" : "text"}
        inputMode={spec.kind === "number" ? "decimal" : undefined}
        step={spec.kind === "number" ? "any" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={spec.required}
        placeholder={spec.placeholder}
      />
    </label>
  );
}

function ReservationPicker({ value, onChange }: { value: ReservationOption | null; onChange: (r: ReservationOption | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReservationOption[]>([]);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const id = ++latest.current;
    const timer = setTimeout(() => {
      setSearching(true);
      searchReservations(query).then((r) => {
        if (id !== latest.current) return;
        setResults(r);
        setSearching(false);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  if (value) {
    return (
      <div className="picked">
        <div>
          <b>
            {value.guestName} &middot; {value.propertyName}
          </b>
          <span>
            {formatShortDate(value.checkIn)} &ndash; {formatShortDate(value.checkOut)}
          </span>
        </div>
        <button type="button" className="go" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  const showResults = query.trim().length >= 2;
  return (
    <div className="fld">
      <label className="fld">
        <span>Find reservation</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Guest name, confirmation code, or property" />
      </label>
      {showResults && (
        <div className="res-results" aria-live="polite">
          {searching && results.length === 0 && <span className="hint">Searching…</span>}
          {!searching && results.length === 0 && <span className="hint">No matches.</span>}
          {results.map((r) => (
            <button type="button" key={r.id} className="res-opt" onClick={() => onChange(r)}>
              <b>{r.guestName}</b>
              <span>
                {r.propertyName} &middot; {formatShortDate(r.checkIn)} &ndash; {formatShortDate(r.checkOut)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
