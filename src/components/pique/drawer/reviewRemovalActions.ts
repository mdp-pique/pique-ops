"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "./actions";
import { getReviewRemovalContext, type ReviewRemovalContext } from "@/lib/data/reviews";
import { generateReviewRemovalDraft, type DraftRequest, type DraftResult } from "@/lib/ai/reviewRemoval";

export async function fetchReviewContext(reviewId: string): Promise<ReviewRemovalContext | null> {
  await requireUser();
  return getReviewRemovalContext(reviewId);
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

  revalidatePath("/", "layout");
}
