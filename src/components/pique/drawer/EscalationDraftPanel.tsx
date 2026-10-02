"use client";

import { useState, useTransition } from "react";
import { Btn } from "@/components/pique/primitives";
import type { EscalationResult } from "@/lib/ai/reviewEscalation";
import { draftEscalationMessage, saveEscalationMessage } from "./reviewRemovalActions";

const TEXTAREA_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line-2)",
  borderRadius: 10,
  background: "var(--surface-solid)",
  color: "var(--ink)",
  font: "inherit",
  fontSize: 13,
  resize: "vertical",
};

/** Drafts the message to Robert on a review_removal_escalation ticket. No length limit; every violation. */
export function EscalationDraftPanel({ ticketId, onMutated }: { ticketId: string; onMutated?: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [extraContext, setExtraContext] = useState("");
  const [draft, setDraft] = useState<EscalationResult | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = (revise: boolean) => {
    setError(null);
    startTransition(async () => {
      const r = await draftEscalationMessage(ticketId, {
        extraContext,
        priorDraft: revise ? draft?.draftMessage : undefined,
        feedback: revise ? feedback : undefined,
      });
      if ("error" in r) return setError(r.error);
      setDraft(r);
      setSaved(false);
      if (revise) setFeedback("");
    });
  };

  const save = () => {
    if (!draft) return;
    startTransition(async () => {
      const r = await saveEscalationMessage(ticketId, draft.draftMessage);
      if (r.error) return setError(r.error);
      setSaved(true);
      onMutated?.();
    });
  };

  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.draftMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy - select the text and copy it instead.");
    }
  };

  return (
    <div className="card">
      <h3>Message to Robert</h3>
      <div className="d" style={{ marginBottom: 10 }}>
        Drafts the escalation from the review, the conversation and both appeals. No length limit, and it covers every policy the review breaks.
      </div>

      {!draft && (
        <>
          <label className="d" htmlFor={`esc-context-${ticketId}`} style={{ display: "block", marginBottom: 4 }}>
            Anything Robert should know that isn&apos;t in the messages (optional)
          </label>
          <textarea
            id={`esc-context-${ticketId}`}
            value={extraContext}
            onChange={(e) => setExtraContext(e.target.value)}
            rows={3}
            placeholder="e.g. Airbnb case ID, what an Airbnb case manager said, photos we have, a house rule they broke…"
            style={TEXTAREA_STYLE}
          />
          <div style={{ marginTop: 8 }}>
            <Btn variant="primary" onClick={() => run(false)} disabled={isPending}>
              {isPending ? "Drafting… (can take a minute)" : "Draft message to Robert"}
            </Btn>
          </div>
        </>
      )}

      {draft && (
        <>
          {draft.violationTypes && (
            <div className="d" style={{ marginBottom: 8 }}>
              <b>Policies it argues:</b> {draft.violationTypes}
            </div>
          )}
          <label className="sr-only" htmlFor={`esc-draft-${ticketId}`}>
            Draft message to Robert
          </label>
          <textarea
            id={`esc-draft-${ticketId}`}
            value={draft.draftMessage}
            onChange={(e) => setDraft({ ...draft, draftMessage: e.target.value })}
            rows={18}
            style={TEXTAREA_STYLE}
          />
          {draft.attachments && draft.attachments !== "N/A" && (
            <div className="d" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
              <b>Attach:</b>
              {"\n"}
              {draft.attachments}
            </div>
          )}
          {draft.verify && draft.verify !== "N/A" && (
            <div className="d" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
              <b>Check before sending:</b>
              {"\n"}
              {draft.verify}
            </div>
          )}
          <label className="sr-only" htmlFor={`esc-feedback-${ticketId}`}>
            What should change?
          </label>
          <textarea
            id={`esc-feedback-${ticketId}`}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={2}
            placeholder="What should change? (leave blank to try a stronger structure)"
            style={{ ...TEXTAREA_STYLE, marginTop: 10 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <Btn onClick={() => run(true)} disabled={isPending}>
              {isPending ? "Redrafting…" : "Regenerate with feedback"}
            </Btn>
            <Btn onClick={copy}>{copied ? "Copied ✓" : "Copy"}</Btn>
            <Btn variant="primary" onClick={save} disabled={isPending || saved}>
              {saved ? "Saved to ticket ✓" : "Save to ticket"}
            </Btn>
          </div>
          {saved && (
            <div className="d" style={{ marginTop: 6, color: "var(--ok)" }}>
              Saved as a comment. Send it to Robert, then tick &ldquo;Sent to Robert&rdquo;.
            </div>
          )}
        </>
      )}

      {error && (
        <p className="form-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
