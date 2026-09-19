"use client";

import { useEffect, useState, useTransition } from "react";
import { Btn } from "@/components/pique/primitives";
import { VIOLATION_HINTS, type DraftResult } from "@/lib/ai/reviewRemoval";
import type { ReviewRemovalContext } from "@/lib/data/reviews";
import { fetchReviewContext, generateDraft, saveDraftAttempt } from "./reviewRemovalActions";

const TEXTAREA_STYLE: React.CSSProperties = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid var(--line-2)",
  background: "var(--surface-solid)",
  padding: "10px 12px",
  color: "var(--ink)",
  font: "inherit",
  fontSize: 13,
  resize: "vertical",
};

export function ReviewRemovalPanel({ ticketId, reviewId }: { ticketId: string; reviewId: string }) {
  const [ctx, setCtx] = useState<ReviewRemovalContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(true);
  const [hints, setHints] = useState<string[]>([]);
  const [extraContext, setExtraContext] = useState("");
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReviewContext(reviewId)
      .then((c) => {
        if (!cancelled) setCtx(c);
      })
      .finally(() => {
        if (!cancelled) setLoadingCtx(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  const toggleHint = (key: string) => setHints((h) => (h.includes(key) ? h.filter((x) => x !== key) : [...h, key]));

  const runGenerate = (isRevision: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await generateDraft(reviewId, {
          violationHints: hints,
          extraContext,
          priorDraft: isRevision ? draft?.draftEmail : undefined,
          feedback: isRevision ? feedback : undefined,
        });
        setDraft(result);
        setSaved(false);
        if (isRevision) setFeedback("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate draft");
      }
    });
  };

  const copyDraft = () => {
    if (draft?.draftEmail) navigator.clipboard.writeText(draft.draftEmail);
  };

  const markCreated = () => {
    if (!draft) return;
    startTransition(async () => {
      await saveDraftAttempt(ticketId, reviewId, {
        isViolation: draft.isViolation,
        violationTypes: draft.violationTypes,
        draftEmail: draft.draftEmail,
      });
      setSaved(true);
    });
  };

  return (
    <div className="card">
      <h3>Draft removal request</h3>

      {loadingCtx ? (
        <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>Loading review…</div>
      ) : !ctx ? (
        <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>Couldn&apos;t load this review.</div>
      ) : (
        <>
          <div className="d" style={{ marginBottom: 10 }}>
            <b>{ctx.guestName}</b> &middot; {ctx.reviewRating ?? "?"}&#9733; &middot; &ldquo;
            {ctx.reviewText.slice(0, 160)}
            {ctx.reviewText.length > 160 ? "…" : ""}&rdquo;
          </div>

          {ctx.priorAttempts.length > 0 && (
            <div className="d" style={{ marginBottom: 10, color: "var(--ink-3)" }}>
              {ctx.priorAttempts.length} prior attempt{ctx.priorAttempts.length === 1 ? "" : "s"} on file
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {VIOLATION_HINTS.map((h) => (
              <button
                key={h.key}
                type="button"
                className="chip"
                aria-pressed={hints.includes(h.key)}
                onClick={() => toggleHint(h.key)}
              >
                {h.label}
              </button>
            ))}
          </div>

          <textarea
            value={extraContext}
            onChange={(e) => setExtraContext(e.target.value)}
            placeholder="Anything staff know that isn't in the messages (e.g. a phone call, a side conversation)…"
            rows={3}
            style={TEXTAREA_STYLE}
          />

          {error && <div style={{ color: "var(--crit)", fontSize: 12.5, marginTop: 6 }}>{error}</div>}

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Btn variant="primary" onClick={() => runGenerate(false)}>
              {isPending && !draft ? "Drafting…" : draft ? "Start over" : "Generate draft"}
            </Btn>
          </div>

          {draft && (
            <div style={{ marginTop: 14 }}>
              <div className="mono" style={{ marginBottom: 6, color: draft.isViolation ? "var(--accent)" : "var(--ink-3)" }}>
                {draft.isViolation ? draft.violationTypes : "No violation found"}
              </div>

              {!draft.isViolation && draft.reasoning && (
                <div className="d" style={{ marginBottom: 10 }}>
                  {draft.reasoning}
                </div>
              )}

              {draft.isViolation && (
                <textarea
                  value={draft.draftEmail}
                  onChange={(e) => setDraft(draft ? { ...draft, draftEmail: e.target.value } : draft)}
                  rows={12}
                  style={TEXTAREA_STYLE}
                />
              )}
              {draft.isViolation && draft.attachments && draft.attachments !== "N/A" && (
                <div className="d" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                  <b>Suggested attachments:</b>
                  {"\n"}
                  {draft.attachments}
                </div>
              )}

              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={
                  draft.isViolation
                    ? "What should change? (leave blank to just try a different angle)"
                    : "Disagree? Add context and try again (e.g. what actually happened)…"
                }
                rows={2}
                style={{ ...TEXTAREA_STYLE, marginTop: 10 }}
              />

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <Btn onClick={() => runGenerate(true)}>{isPending ? "Redrafting…" : "Regenerate with feedback"}</Btn>
                {draft.isViolation && <Btn onClick={copyDraft}>Copy draft</Btn>}
                <Btn variant="primary" onClick={markCreated}>
                  {saved ? "Saved ✓" : "Mark as created"}
                </Btn>
              </div>
              {saved && (
                <div className="d" style={{ marginTop: 6, color: "var(--ok)" }}>
                  {draft.isViolation
                    ? "Logged as an attempt on this ticket. Send it via Gmail, then track any Airbnb response here manually for now."
                    : "Logged on this ticket as a no-violation attempt."}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
