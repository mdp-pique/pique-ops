"use client";

import { useEffect, useRef, useState } from "react";

export interface TypeOption {
  type: string;
  label: string;
  // Another team currently gets this type; checking it here moves it.
  otherTeam: string | null;
}

export interface TypeGroup {
  label: string;
  note?: string;
  types: TypeOption[];
}

// Checkbox state lives here, but each box is still a plain `name="type"` input,
// so the surrounding server-action form submits exactly as before.
export function TypePicker({ groups, initial }: { groups: TypeGroup[]; initial: string[] }) {
  const [checked, setChecked] = useState(() => new Set(initial));
  const all = groups.flatMap((g) => g.types.map((t) => t.type));

  const setMany = (types: string[], on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      for (const t of types) {
        if (on) next.add(t);
        else next.delete(t);
      }
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span>
          {checked.size} of {all.length} selected
        </span>
        <button type="button" className="underline hover:text-gray-200" onClick={() => setMany(all, true)}>
          Select all
        </button>
        <button type="button" className="underline hover:text-gray-200" onClick={() => setMany(all, false)}>
          Clear
        </button>
      </div>
      {groups.map((g) => {
        const types = g.types.map((t) => t.type);
        const count = types.filter((t) => checked.has(t)).length;
        return (
          <div key={g.label} className="rounded border border-gray-800 p-3">
            <div className="mb-2 flex items-center gap-2">
              <GroupToggle
                label={`All ${g.label}`}
                state={count === 0 ? "none" : count === types.length ? "all" : "some"}
                onChange={(on) => setMany(types, on)}
              />
              <span className="text-sm font-medium">{g.label}</span>
              {g.note && <span className="text-xs text-gray-500">{g.note}</span>}
            </div>
            <div className="flex flex-wrap gap-2 pl-6">
              {g.types.map((t) => (
                <label key={t.type} className="flex items-center gap-2 rounded border border-gray-800 px-2 py-1 text-sm">
                  <input type="checkbox" name="type" value={t.type} checked={checked.has(t.type)} onChange={(e) => setMany([t.type], e.target.checked)} />
                  {t.label}
                  {t.otherTeam && <span className="text-xs text-gray-500">(now: {t.otherTeam})</span>}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GroupToggle({ label, state, onChange }: { label: string; state: "none" | "some" | "all"; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={state === "all"} onChange={() => onChange(state !== "all")} />;
}
