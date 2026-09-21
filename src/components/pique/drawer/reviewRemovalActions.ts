"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser, claimTicketIfUnassigned } from "./actions";
import { getReviewRemovalContext, getReviewIdForReservation, type ReviewRemovalContext } from "@/lib/data/reviews";
import { generateReviewRemovalDraft, type DraftRequest, type DraftResult } from "@/lib/ai/reviewRemoval";
import type { Database } from "@/lib/supabase/database.types";

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
export async function suppressReviewFlag(ticketId: string, reviewFlagsId: number) {
  const { supabase, user } = await requireUser();
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
) {
  const { supabase, user } = await requireUser();
  await claimTicketIfUnassigned(ticketId);

  const ctx = await getReviewRemovalContext(reviewId);
  if (!ctx) throw new Error("Review not found");

  const nextAttempt = (ctx.priorAttempts.at(-1)?.attemptNumber ?? 0) + 1;

  await supabase.from("review_removal_drafts").insert({
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
  });

  await supabase.from("ticket_comments").insert({
    ticket_id: ticketId,
    author_id: user.id,
    body: `Logged a previously-sent removal attempt (attempt #${nextAttempt}, ${input.status}).`,
  });

  await resolveIfReviewFlagTicket(supabase, ticketId);

  revalidatePath("/", "layout");
}

export async function generateDraft(reviewId: string, req: DraftRequest): Promise<DraftResult> {
  await requireUser();

  const ctx = await getReviewRemovalContext(reviewId);
  if (!ctx) throw new Error("Review not found");

  return generateReviewRemovalDraft(ctx, req);
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
) {
  const { supabase, user } = await requireUser();
  await claimTicketIfUnassigned(ticketId);

  const ctx = await getReviewRemovalContext(reviewId);
  if (!ctx) throw new Error("Review not found");

  const nextAttempt = (ctx.priorAttempts.at(-1)?.attemptNumber ?? 0) + 1;

  await supabase.from("review_removal_drafts").insert({
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
  });

  await supabase.from("ticket_comments").insert({
    ticket_id: ticketId,
    author_id: user.id,
    body: `Drafted removal request manually (attempt #${nextAttempt}) - ${result.violationTypes}`,
  });

  await resolveIfReviewFlagTicket(supabase, ticketId);

  revalidatePath("/", "layout");
}
