"use client";

import { useState, useTransition } from "react";
import { Btn } from "@/components/pique/primitives";
import { useDrawer } from "./DrawerContext";
import { closeRemovalCase, escalateRemovalCase } from "./reviewRemovalActions";
import { MAX_AIRBNB_APPEALS } from "@/lib/reviewAppeals";

// Two appeals go to Airbnb; the third step is Robert, our account manager.
function outcomeHint(sent: number | null, rejected: number | null) {
  if (rejected != null && rejected >= MAX_AIRBNB_APPEALS)
    return "Both appeals to Airbnb were rejected. The next step is Robert, or close the case if it isn't worth pursuing.";
  if (!sent) return "No appeal has gone to Airbnb yet. Escalating is for after two rejected appeals.";
  return `${sent} of ${MAX_AIRBNB_APPEALS} appeals sent to Airbnb. Usually send the second appeal before escalating to Robert.`;
}

/**
 * The end of a review removal case: hand it to Robert (PRD §9, review_removal_escalation)
 * or stop appealing. Shown on open review_removal_case tickets only.
 */
export function RemovalCaseOutcome({
  ticketId,
  appealsSent,
  appealsRejected,
  onMutated,
}: {
  ticketId: string;
  appealsSent: number | null;
  appealsRejected: number | null;
  onMutated?: () => void;
}) {
  const { openTicket } = useDrawer();
  const [isPending, startTransition] = useTransition();
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const escalate = () => {
    setError(null);
    startTransition(async () => {
      const r = await escalateRemovalCase(ticketId);
      if ("error" in r) return setError(r.error);
      setDone("Escalated. The escalation ticket has everything to send Robert, and this case is closed.");
      onMutated?.();
      openTicket(r.id);
    });
  };

  const close = () => {
    setError(null);
    startTransition(async () => {
      const r = await closeRemovalCase(ticketId, reason);
      if (r.error) return setError(r.error);
      setDone("Closed. If you log another attempt for this review later, the case reopens.");
      onMutated?.();
    });
  };

  if (done) {
    return (
      <div className="card">
        <h3>Case outcome</h3>
        <div className="d" style={{ color: "var(--ok)" }}>{done}</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Done appealing?</h3>
      <div className="d" style={{ marginBottom: 10 }}>{outcomeHint(appealsSent, appealsRejected)}</div>
      {closing ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label className="sr-only" htmlFor={`close-reason-${ticketId}`}>
            Why are you closing it?
          </label>
          <input
            id={`close-reason-${ticketId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why (optional), e.g. denied twice, not worth escalating"
            style={{ flex: "1 1 220px", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface)", color: "var(--ink)" }}
          />
          <Btn variant="primary" onClick={close} disabled={isPending}>
            {isPending ? "Closing…" : "Close the case"}
          </Btn>
          <Btn onClick={() => setClosing(false)}>Cancel</Btn>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="primary" onClick={escalate} disabled={isPending}>
            {isPending ? "Escalating…" : "Escalate to Robert"}
          </Btn>
          <Btn onClick={() => setClosing(true)} disabled={isPending}>
            Close - stop appealing
          </Btn>
        </div>
      )}
      {error && (
        <p className="form-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
