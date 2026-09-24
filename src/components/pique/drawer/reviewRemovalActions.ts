"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser, claimTicketIfUnassigned } from "./actions";
import { getReviewRemovalContext, getReviewIdForReservation, type ReviewRemovalContext } from "@/lib/data/reviews";
import { generateReviewRemovalDraft, type DraftRequest, type DraftResult } from "@/lib/ai/reviewRemoval";
import type { Database } from "@/lib/supabase/database.types";

const SIGNED_URL_TTL_SECONDS = 3600;

export async function fetchReviewContext(reviewId: string): Promise<ReviewRemovalContext | null> {
  await requireUser();
  return getReviewRemovalContext(reviewId);
}

/** review_flag tickets don't know their review_id up front (see getReviewIdForReservation) - resolve it from the reservation first. */
export async function fetchReviewContextForReservation(reservationId: string): Promise<ReviewRemovalContext | null> {
  await requireUser();
  const reviewId = await getReviewIdForReservation(reservationId);
  if (!reviewId) return null;
  return getReviewRemovalContext(reviewId);
}

/**
 * A review_flag ticket that just got a removal attempt started or logged
 * against it is handled - the new/updated review_removal_case ticket (a
 * separate ticket, mirrored from review_removal_drafts) is now where that
 * work is tracked, so close this one out rather than leaving a dead
 * duplicate sitting open in the queue.
 */
async function resolveIfReviewFlagTicket(supabase: SupabaseClient<Database>, ticketId: string) {
  const { data: ticket } = await supabase.from("tickets").select("type, status").eq("id", ticketId).maybeSingle();
  if (!ticket || ticket.type !== "review_flag" || ticket.status === "resolved") return;

  await supabase.from("tickets").update({ status: "resolved", closed_at: new Date().toISOString() }).eq("id", ticketId);
  await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    event_type: "status_change",
    from_value: ticket.status,
    to_value: "resolved",
    note: "Closed - removal attempt started/logged; tracked on its own review removal ticket from here.",
  });
}

/**
 * "Don't appeal" for a review_flag ticket. Writes review_flags.status the
 * same way the existing Slack-based suppression flow already does (same
 * columns, same 'suppressed' value) - the live mirror_review_flag_to_ticket
 * trigger then resolves this ticket itself, exactly as it would for a
 * decision made through that existing flow. Uses the admin client because
 * review_flags has no authenticated write policy, only service_role - same
 * pattern as markUnansweredMessageResolved.
 */
export async function suppressReviewFlag(ticketId: string) {
  const { supabase, user } = await requireUser();

  // Derived server-side from the ticket's trigger-set external_ref, never
  // taken from the client - the admin client below bypasses RLS.
  const { data: ticket } = await supabase
    .from("tickets")
    .select("external_ref")
    .eq("id", ticketId)
    .eq("type", "review_flag")
    .maybeSingle();
  const match = ticket?.external_ref?.match(/^review_flag:(\d+)$/);
  if (!match) throw new Error("Not a review flag ticket");
  const reviewFlagsId = Number(match[1]);

  await claimTicketIfUnassigned(ticketId);

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  await admin
    .from("review_flags")
    .update({ status: "suppressed", decided_by: user.email ?? user.id, decided_at: new Date().toISOString() })
    .eq("id", reviewFlagsId);

  await supabase.from("ticket_comments").insert({
    ticket_id: ticketId,
    author_id: user.id,
    body: "Decided not to pursue removal for this review.",
  });

  revalidatePath("/", "layout");
}

/**
 * Logs a removal attempt that was already sent outside the app (before this
 * tool existed, or off to the side) - same review_removal_drafts insert as
 * an AI-generated attempt, just with staff-pasted text and no AI call, so
 * it rolls into the same one-ticket-per-review history for future staff to
 * see either way.
 */
export async function logManualAttempt(
  ticketId: string,
  reviewId: string,
  input: { draftEmail: string; status: "sent" | "rejected" | "removed"; airbnbResponse?: string },
): Promise<{ draftId: string }> {
  const { supabase, user } = await requireUser();
  await claimTicketIfUnassigned(ticketId);

  const ctx = await getReviewRemovalContext(reviewId);
  if (!ctx) throw new Error("Review not found");

  const nextAttempt = (ctx.priorAttempts.at(-1)?.attemptNumber ?? 0) + 1;

  const { data: draft, error } = await supabase
    .from("review_removal_drafts")
    .insert({
      review_id: reviewId,
      guest_name: ctx.guestName,
      property_name: ctx.propertyName,
      review_rating: ctx.reviewRating,
      review_text: ctx.reviewText,
      violation_types: "logged manually",
      draft_email: input.draftEmail,
      airbnb_response: input.airbnbResponse || null,
      slack_thread_ts: "",
      attempt_number: nextAttempt,
      status: input.status,
    })
    .select("id")
    .single();
  if (error || !draft) throw new Error("Failed to log attempt");

  await supabase.from("ticket_comments").insert({
    ticket_id: ticketId,
    author_id: user.id,
    body: `Logged a previously-sent removal attempt (attempt #${nextAttempt}, ${input.status}).`,
  });

  await resolveIfReviewFlagTicket(supabase, ticketId);

  revalidatePath("/", "layout");
  return { draftId: draft.id };
}

/**
 * Evidence is passed as attachment ids, never URLs: the server fetches PDFs
 * itself, so a client-supplied URL would let a caller make the server fetch
 * anything. Ids are scoped to this ticket and signed here.
 */
export async function generateDraft(
  ticketId: string,
  reviewId: string,
  req: Omit<DraftRequest, "attachments"> & { attachmentIds?: string[] },
): Promise<DraftResult> {
  const { supabase } = await requireUser();

  const ctx = await getReviewRemovalContext(reviewId);
  if (!ctx) throw new Error("Review not found");

  const { attachmentIds, ...rest } = req;
  let attachments: DraftRequest["attachments"] = [];
  if (attachmentIds?.length) {
    const { data: rows } = await supabase
      .from("ticket_attachments")
      .select("storage_path, kind")
      .eq("ticket_id", ticketId)
      .in("id", attachmentIds);
    if (rows?.length) {
      const { data: signed } = await supabase.storage
        .from("ticket-attachments")
        .createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_TTL_SECONDS);
      const urlByPath = new Map((signed ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
      attachments = rows
        .map((r) => ({ url: urlByPath.get(r.storage_path) ?? "", kind: r.kind }))
        .filter((a) => a.url);
    }
  }

  return generateReviewRemovalDraft(ctx, { ...rest, attachments });
}

/**
 * Records a manual draft as a new attempt against this review - inserts into
 * the same review_removal_drafts table the automated n8n monitor writes to,
 * so the existing shadow-mirror trigger rolls it into the review's one
 * review_removal_case ticket exactly like an automated attempt would. Never
 * touches the n8n workflow itself.
 */
export async function saveDraftAttempt(
  ticketId: string,
  reviewId: string,
  result: { isViolation: boolean; violationTypes: string; draftEmail: string },
): Promise<{ draftId: string }> {
  const { supabase, user } = await requireUser();
  await claimTicketIfUnassigned(ticketId);

  const ctx = await getReviewRemovalContext(reviewId);
  if (!ctx) throw new Error("Review not found");

  const nextAttempt = (ctx.priorAttempts.at(-1)?.attemptNumber ?? 0) + 1;

  const { data: draft, error } = await supabase
    .from("review_removal_drafts")
    .insert({
      review_id: reviewId,
      guest_name: ctx.guestName,
      property_name: ctx.propertyName,
      review_rating: ctx.reviewRating,
      review_text: ctx.reviewText,
      violation_types: result.violationTypes,
      draft_email: result.draftEmail,
      slack_thread_ts: "",
      attempt_number: nextAttempt,
      status: result.isViolation ? "pending" : "no_violation",
    })
    .select("id")
    .single();
  if (error || !draft) throw new Error("Failed to save draft");

  await supabase.from("ticket_comments").insert({
    ticket_id: ticketId,
    author_id: user.id,
    body: `Drafted removal request manually (attempt #${nextAttempt}) - ${result.violationTypes}`,
  });

  await resolveIfReviewFlagTicket(supabase, ticketId);

  revalidatePath("/", "layout");
  return { draftId: draft.id };
}

/**
 * Evidence/photos for one specific removal attempt, so it "stays with the
 * first and second appeal" as new rounds happen, rather than living as one
 * undifferentiated pile on the ticket. Best-effort per file - one bad
 * upload doesn't fail the rest.
 */
export async function uploadAttemptAttachments(ticketId: string, reviewRemovalDraftId: string, formData: FormData) {
  const { supabase, user } = await requireUser();

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  for (const file of files) {
    const path = `${ticketId}/${reviewRemovalDraftId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("ticket-attachments").upload(path, file);
    if (uploadError) continue;

    await supabase.from("ticket_attachments").insert({
      ticket_id: ticketId,
      review_removal_draft_id: reviewRemovalDraftId,
      storage_path: path,
      kind: file.type.startsWith("image/") ? "photo" : "document",
      uploaded_by: user.id,
    });
  }

  revalidatePath("/", "layout");
}

export interface PendingAttachment {
  id: string;
  url: string;
  kind: string;
  name: string;
}

/**
 * Evidence selected before an attempt exists yet, so the AI can actually see
 * it while drafting (not just file it away after the fact). Uploaded right
 * away with no review_removal_draft_id set - a real ticket_attachments row
 * from the start, just not yet claimed by an attempt. attachPendingToAttempt
 * re-parents it once the draft/log is saved; deletePendingAttachment removes
 * it if the staff member changes their mind before saving.
 */
export async function uploadPendingAttachment(ticketId: string, formData: FormData): Promise<PendingAttachment[]> {
  const { supabase, user } = await requireUser();

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const results: PendingAttachment[] = [];

  for (const file of files) {
    const path = `${ticketId}/pending/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("ticket-attachments").upload(path, file);
    if (uploadError) continue;

    const kind = file.type.startsWith("image/") ? "photo" : "document";
    const { data: row, error } = await supabase
      .from("ticket_attachments")
      .insert({ ticket_id: ticketId, storage_path: path, kind, uploaded_by: user.id })
      .select("id")
      .single();
    if (error || !row) continue;

    const { data: signed } = await supabase.storage.from("ticket-attachments").createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (!signed?.signedUrl) continue;

    results.push({ id: row.id, url: signed.signedUrl, kind, name: file.name });
  }

  return results;
}

/** Claims already-uploaded pending evidence for the attempt that just got saved, instead of re-uploading it. Only this ticket's still-unclaimed uploads. */
export async function attachPendingToAttempt(ticketId: string, attachmentIds: string[], reviewRemovalDraftId: string) {
  if (attachmentIds.length === 0) return;
  const { supabase } = await requireUser();
  await supabase
    .from("ticket_attachments")
    .update({ review_removal_draft_id: reviewRemovalDraftId })
    .eq("ticket_id", ticketId)
    .is("review_removal_draft_id", null)
    .in("id", attachmentIds);
  revalidatePath("/", "layout");
}

/** Removes a pending evidence upload the staff member deselected before saving any attempt - never one already filed with an attempt. */
export async function deletePendingAttachment(ticketId: string, attachmentId: string) {
  const { supabase } = await requireUser();
  const { data: row } = await supabase
    .from("ticket_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .eq("ticket_id", ticketId)
    .is("review_removal_draft_id", null)
    .maybeSingle();
  if (!row) return;
  await supabase.storage.from("ticket-attachments").remove([row.storage_path]);
  await supabase.from("ticket_attachments").delete().eq("id", attachmentId);
}
