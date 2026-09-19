"use client";

import { useEffect, useRef, useState } from "react";
import { askPiqueAction } from "./askPiqueActions";
import { ASK_PIQUE_FOCUS_EVENT, consumePendingAskFocus } from "./AskPiqueHotkey";
import type { AskPiqueStep } from "@/lib/ai/askPique";

const STARTER_CHIPS = [
  "How many tickets are open right now?",
  "Which properties have an open maintenance ticket?",
  "Any cleaner no-shows this week?",
  "What's our average rating this month?",
];

interface ChatTurn {
  id: string;
  question: string;
  answer?: string;
  steps?: AskPiqueStep[];
  error?: string;
  pending?: boolean;
}

function shortSql(sql: string): string {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  return oneLine.length > 46 ? `${oneLine.slice(0, 46)}…` : oneLine;
}

function ResultTable({ step }: { step: AskPiqueStep }) {
  if (!step.rows || step.rows.length === 0) return null;
  const columns = Object.keys(step.rows[0]);

  // A single row with a single value is already stated in the prose answer -
  // showing a whole table for it is just visual clutter, not new information.
  if (step.rows.length === 1 && columns.length === 1) return null;

  return (
    <div className="tw">
      <table className="atab">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {step.rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c}>{formatCell(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {step.truncated && <div className="ask-note">Showing first {step.rows.length} of {step.rowCount} rows.</div>}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function AskPique() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (consumePendingAskFocus()) inputRef.current?.focus();
    function onFocus() {
      inputRef.current?.focus();
    }
    window.addEventListener(ASK_PIQUE_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(ASK_PIQUE_FOCUS_EVENT, onFocus);
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    const id = crypto.randomUUID();
    const history = turns
      .filter((t) => t.answer)
      .flatMap((t) => [
        { role: "user" as const, content: t.question },
        { role: "assistant" as const, content: t.answer! },
      ]);

    setTurns((prev) => [...prev, { id, question: q, pending: true }]);
    setInput("");
    setBusy(true);

    try {
      const result = await askPiqueAction(q, history);
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, pending: false, answer: result.answer, steps: result.steps, error: result.error } : t)),
      );
    } catch {
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, pending: false, answer: "Something went wrong - try again.", error: "client_error" } : t)),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
      <div className="ask-top">
        <div className="ask-mark">
          <svg viewBox="0 0 24 24">
            <path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
          </svg>
        </div>
        <div className="ask-id">
          <b>Ask Pique</b>
          <span>Reads the database to answer. Never writes, always shows the query.</span>
        </div>
        <span className="kbd">⌘K</span>
      </div>

      {turns.length > 0 && (
        <div className="chat" ref={chatRef}>
          {turns.map((t) => (
            <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="cmsg u">{t.question}</div>
              <div className="cmsg b">
                {t.pending && (
                  <div className="thinking" aria-label="Thinking">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                  </div>
                )}
                {!t.pending && t.steps && t.steps.length > 0 && (
                  <div className="steps">
                    {t.steps.map((s, i) => (
                      <span className="step" key={i} title={s.sql}>
                        <span className="dot" style={s.error ? { background: "var(--crit, #e5484d)" } : undefined} />
                        {shortSql(s.sql)}
                      </span>
                    ))}
                  </div>
                )}
                {!t.pending && t.answer && <div className="answer">{t.answer}</div>}
                {!t.pending && t.steps?.at(-1) && <ResultTable step={t.steps.at(-1)!} />}
                {!t.pending && t.steps && t.steps.length > 0 && (
                  <details>
                    <summary>View {t.steps.length === 1 ? "query" : `${t.steps.length} queries`}</summary>
                    <pre>{t.steps.map((s) => s.sql).join(";\n\n")}</pre>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {turns.length === 0 && (
        <div className="ask-chips">
          {STARTER_CHIPS.map((chip) => (
            <button key={chip} type="button" onClick={() => ask(chip)}>
              {chip}
            </button>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about reservations, tickets, cleaning, reviews…"
          disabled={busy}
        />
        <button className="send" type="submit" disabled={busy || !input.trim()} aria-label="Send">
          <svg viewBox="0 0 24 24">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}
