"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Btn } from "@/components/pique/primitives";
import { VIOLATION_HINTS, type DraftResult } from "@/lib/ai/reviewRemoval";
import type { ReviewRemovalContext } from "@/lib/data/reviews";
import {
  fetchReviewContext,
  fetchReviewContextForReservation,
  generateDraft,
  saveDraftAttempt,
  suppressReviewFlag,
  logManualAttempt,
  uploadAttemptAttachments,
} from "./reviewRemovalActions";
import { claimTicketIfUnassigned } from "./actions";

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

const MANUAL_STATUS_OPTIONS: { value: "sent" | "rejected" | "removed"; label: string }[] = [
  { value: "sent", label: "Sent - awaiting response" },
  { value: "rejected", label: "Airbnb rejected it" },
  { value: "removed", label: "Airbnb removed the review" },
];

type Attempt = ReviewRemovalContext["priorAttempts"][number];

/** One past (or just-saved) attempt: its own status, draft text, and evidence - evidence stays scoped to whichever round it was gathered for, not lumped in one pile across every appeal. */
function AttemptRow({ attempt, ticketId, onUploaded }: { attempt: Attempt; ticketId: string; onUploaded: () => void }) {
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upload = (files: FileList) => {
    const formData = new FormData();
    for (const f of Array.from(files)) formData.append("files", f);
    startTransition(async () => {
      await uploadAttemptAttachments(ticketId, attempt.id, formData);
      onUploaded();
    });
  };

  return (
    <div style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <b style={{ fontSize: 12.5 }}>
          Attempt #{attempt.attemptNumber} &middot; {attempt.status}
        </b>
        <span className="d" style={{ color: "var(--ink-3)" }}>
          {new Date(attempt.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      </div>
      {attempt.draftEmail && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", color: "var(--accent)", fontSize: 12 }}>View text</summary>
          <div className="d" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
            {attempt.draftEmail}
          </div>
        </details>
      )}

      {attempt.attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {attempt.attachments.map((a) => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              style={{ display: "block", width: 56, height: 56, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line-2)" }}
            >
              {a.kind === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 10, color: "var(--ink-3)" }}>
                  File
                </div>
              )}
            </a>
          ))}
        </div>
      )}

      <button
        type="button"
        className="chip"
        style={{ marginTop: 8 }}
        disabled={isPending}
        onClick={() => fileInputRef.current?.click()}
      >
        {isPending ? "Uploading…" : "+ Add evidence"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * Handles the review-removal flow for both ticket types that can end up
 * here: a review_flag ticket (undecided - hasn't been sent anywhere yet) and
 * a review_removal_case ticket (already has at least one attempt on file).
 * For a still-undecided flag, `flagReviewFlagsId` gates the rest of the
 * panel behind a Don't appeal / Start appeal choice; for a case ticket
 * (flagReviewFlagsId undefined) the drafting tools are shown right away.
 */
export function ReviewRemovalPanel({
  ticketId,
  reviewId: reviewIdProp,
  reservationId,
  flagReviewFlagsId,
  onMutated,
}: {
  ticketId: string;
  reviewId?: string;
  reservationId?: string | null;
  flagReviewFlagsId?: number;
  onMutated?: () => void;
}) {
  const isFlag = flagReviewFlagsId != null;
  const [ctx, setCtx] = useState<ReviewRemovalContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(true);
  const [hints, setHints] = useState<string[]>([]);
  const [extraContext, setExtraContext] = useState("");
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [started, setStarted] = useState(!isFlag);
  const [suppressed, setSuppressed] = useState(false);
  const [showManualLog, setShowManualLog] = useState(false);
  const [manualDraft, setManualDraft] = useState("");
  const [manualStatus, setManualStatus] = useState<"sent" | "rejected" | "removed">("sent");
  const [manualResponse, setManualResponse] = useState("");
  const [manualSaved, setManualSaved] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const pendingFileInputRef = useRef<HTMLInputElement>(null);

  const loadCtx = () => {
    const load = reviewIdProp ? fetchReviewContext(reviewIdProp) : reservationId ? fetchReviewContextForReservation(reservationId) : Promise.resolve(null);
    return load.then((c) => setCtx(c));
  };

  useEffect(() => {
    let cancelled = false;
    const load = reviewIdProp ? fetchReviewContext(reviewIdProp) : reservationId ? fetchReviewContextForReservation(reservationId) : Promise.resolve(null);
    load
      .then((c) => {
        if (!cancelled) setCtx(c);
      })
      .finally(() => {
        if (!cancelled) setLoadingCtx(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reviewIdProp, reservationId]);

  const reviewId = ctx?.reviewId;
  const toggleHint = (key: string) => setHints((h) => (h.includes(key) ? h.filter((x) => x !== key) : [...h, key]));

  const runGenerate = (isRevision: boolean) => {
    if (!reviewId) return;
    if (!isRevision && pendingFiles.length === 0 && !window.confirm("Generate this draft with no evidence attached?")) return;
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

  const uploadPendingFiles = async (draftId: string) => {
    if (pendingFiles.length === 0) return;
    const formData = new FormData();
    for (const f of pendingFiles) formData.append("files", f);
    await uploadAttemptAttachments(ticketId, draftId, formData);
    setPendingFiles([]);
  };

  const markCreated = () => {
    if (!draft || !reviewId) return;
    startTransition(async () => {
      const { draftId } = await saveDraftAttempt(ticketId, reviewId, {
        isViolation: draft.isViolation,
        violationTypes: draft.violationTypes,
        draftEmail: draft.draftEmail,
      });
      await uploadPendingFiles(draftId);
      setSaved(true);
      await loadCtx();
      onMutated?.();
    });
  };

  const dontAppeal = () => {
    if (flagReviewFlagsId == null) return;
    startTransition(async () => {
      await suppressReviewFlag(ticketId, flagReviewFlagsId);
      setSuppressed(true);
      onMutated?.();
    });
  };

  const startAppeal = () => {
    setStarted(true);
    startTransition(async () => {
      await claimTicketIfUnassigned(ticketId);
      onMutated?.();
    });
  };

  const submitManualLog = () => {
    if (!reviewId || !manualDraft.trim()) return;
    startTransition(async () => {
      const { draftId } = await logManualAttempt(ticketId, reviewId, {
        draftEmail: manualDraft.trim(),
        status: manualStatus,
        airbnbResponse: manualResponse.trim() || undefined,
      });
      await uploadPendingFiles(draftId);
      setManualSaved(true);
      setShowManualLog(false);
      setManualDraft("");
      setManualResponse("");
      await loadCtx();
      onMutated?.();
    });
  };

  if (suppressed) {
    return (
      <div className="card">
        <h3>Review removal</h3>
        <div className="d" style={{ color: "var(--ok)" }}>Marked as not pursuing removal. This ticket is closed.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>{isFlag && !started ? "Review flagged - decide" : "Draft removal request"}</h3>

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
            <details style={{ marginBottom: 10 }}>
              <summary style={{ cursor: "pointer", color: "var(--ink-3)", fontSize: 12.5 }}>
                {ctx.priorAttempts.length} prior attempt{ctx.priorAttempts.length === 1 ? "" : "s"} on file
              </summary>
              {ctx.priorAttempts.map((a) => (
                <AttemptRow key={a.id} attempt={a} ticketId={ticketId} onUploaded={loadCtx} />
              ))}
            </details>
          )}

          {isFlag && !started ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn variant="primary" onClick={startAppeal}>
                Start the appeal
              </Btn>
              <Btn onClick={dontAppeal} disabled={isPending}>
                {isPending ? "Saving…" : "Don't appeal"}
              </Btn>
            </div>
          ) : (
            <>
              {manualSaved && (
                <div className="d" style={{ marginBottom: 10, color: "var(--ok)" }}>
                  Logged{isFlag ? " - this flag ticket is now closed, tracked on its own review removal ticket." : "."} You can attach more evidence to it anytime under prior attempts.
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

              <div style={{ marginTop: 10 }}>
                <button type="button" className="chip" onClick={() => pendingFileInputRef.current?.click()}>
                  + Attach evidence
                </button>
                <input
                  ref={pendingFileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.length) setPendingFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                    e.target.value = "";
                  }}
                />
                {pendingFiles.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {pendingFiles.map((f, i) => (
                      <span
                        key={i}
                        className="chip"
                        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                      >
                        {f.name}
                        <button
                          type="button"
                          onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                          style={{ color: "var(--ink-3)", fontWeight: 700 }}
                          aria-label={`Remove ${f.name}`}
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {error && <div style={{ color: "var(--crit)", fontSize: 12.5, marginTop: 6 }}>{error}</div>}

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <Btn variant="primary" onClick={() => runGenerate(false)}>
                  {isPending && !draft ? "Drafting…" : draft ? "Start over" : "Generate draft"}
                </Btn>
                <Btn onClick={() => setShowManualLog((v) => !v)}>
                  {showManualLog ? "Cancel" : "Already sent something for this?"}
                </Btn>
              </div>

              {showManualLog && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  <div className="d" style={{ marginBottom: 8, color: "var(--ink-3)" }}>
                    Paste what was already sent to Airbnb, so it&apos;s on file for this review. Use &ldquo;Attach evidence&rdquo; above to include anything gathered for it.
                  </div>
                  <textarea
                    value={manualDraft}
                    onChange={(e) => setManualDraft(e.target.value)}
                    placeholder="Paste the removal request that was already sent…"
                    rows={6}
                    style={TEXTAREA_STYLE}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      value={manualStatus}
                      onChange={(e) => setManualStatus(e.target.value as typeof manualStatus)}
                      style={{ borderRadius: 10, border: "1px solid var(--line-2)", background: "var(--surface-solid)", color: "var(--ink)", padding: "7px 10px", font: "inherit", fontSize: 13 }}
                    >
                      {MANUAL_STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={manualResponse}
                    onChange={(e) => setManualResponse(e.target.value)}
                    placeholder="Airbnb's response, if any (optional)…"
                    rows={2}
                    style={{ ...TEXTAREA_STYLE, marginTop: 8 }}
                  />
                  <div style={{ marginTop: 8 }}>
                    <Btn variant="primary" onClick={submitManualLog} disabled={isPending || !manualDraft.trim()}>
                      {isPending ? "Saving…" : "Log this attempt"}
                    </Btn>
                  </div>
                </div>
              )}

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
                        ? `Logged as an attempt on this ticket. Send it via Gmail, then track any Airbnb response here manually for now.${isFlag ? " This flag ticket is now closed." : ""} You can attach more evidence to it anytime under prior attempts.`
                        : "Logged on this ticket as a no-violation attempt."}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
