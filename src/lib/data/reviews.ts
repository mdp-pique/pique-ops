import { createClient } from "@/lib/supabase/server";

export interface ReviewAttachment {
  id: string;
  url: string;
  kind: string;
}

export interface ReviewRemovalContext {
  reviewId: string;
  guestName: string;
  propertyName: string;
  reviewRating: number | null;
  reviewText: string;
  privateFeedback: string;
  reservationId: string | null;
  confirmationCode: string | null;
  checkIn: string | null;
  checkOut: string | null;
  reviewedAt: string | null;
  conversation: string;
  priorAttempts: {
    id: string;
    attemptNumber: number;
    violationTypes: string;
    draftEmail: string;
    status: string;
    createdAt: string;
    attachments: ReviewAttachment[];
  }[];
}

/** review_flag tickets only carry a reservation_id (from review_flags.reservation_uuid), not a review_id directly - resolve it so the removal panel can load the same way it does from a review_removal_case ticket's metadata.review_id. */
export async function getReviewIdForReservation(reservationId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("reviews").select("id").eq("reservation_id", reservationId).maybeSingle();
  return data?.id ?? null;
}

const ATTACHMENT_BUCKET = "ticket-attachments";
const SIGNED_URL_TTL_SECONDS = 3600;

/** Same shape as the n8n review-removal monitor's "Fetch Reviews" query, but for one review on demand instead of a time-windowed scan. */
export async function getReviewRemovalContext(reviewId: string): Promise<ReviewRemovalContext | null> {
  const supabase = await createClient();

  const { data: review, error } = await supabase
    .from("reviews")
    .select(
      `id, reviewer_name, overall_rating, review_text, review_date, reservation_id, raw_hospitable_data,
       property:properties(property_name, public_name),
       reservation:reservations(check_in, check_out, confirmation_code)`,
    )
    .eq("id", reviewId)
    .maybeSingle();

  if (error) console.error("getReviewRemovalContext:", error);
  if (!review) return null;

  const [{ data: messages }, { data: priorDrafts }] = await Promise.all([
    review.reservation_id
      ? supabase
          .from("messages")
          .select("direction, body, sent_at")
          .eq("reservation_id", review.reservation_id)
          .order("sent_at", { ascending: true })
      : Promise.resolve({ data: null }),
    supabase
      .from("review_removal_drafts")
      .select("id, attempt_number, violation_types, draft_email, status, created_at")
      .eq("review_id", reviewId)
      .order("attempt_number", { ascending: true }),
  ]);

  const draftIds = (priorDrafts ?? []).map((d) => d.id);
  const { data: attachmentRows } = draftIds.length
    ? await supabase
        .from("ticket_attachments")
        .select("id, storage_path, kind, review_removal_draft_id")
        .in("review_removal_draft_id", draftIds)
    : { data: null };

  const signedUrlByPath = new Map<string, string>();
  if (attachmentRows?.length) {
    const { data: signed } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrls(
        attachmentRows.map((a) => a.storage_path),
        SIGNED_URL_TTL_SECONDS,
      );
    for (const s of signed ?? []) {
      if (s.signedUrl) signedUrlByPath.set(s.path ?? "", s.signedUrl);
    }
  }

  const attachmentsByDraftId = new Map<string, ReviewAttachment[]>();
  for (const a of attachmentRows ?? []) {
    if (!a.review_removal_draft_id) continue;
    const url = signedUrlByPath.get(a.storage_path);
    if (!url) continue;
    const list = attachmentsByDraftId.get(a.review_removal_draft_id) ?? [];
    list.push({ id: a.id, url, kind: a.kind });
    attachmentsByDraftId.set(a.review_removal_draft_id, list);
  }

  const conversation = messages?.length
    ? messages.map((m) => `${m.direction === "inbound" ? "Guest" : "Host"}: ${m.body ?? ""}`).join("\n")
    : "No conversation available";

  const raw = review.raw_hospitable_data as { private_feedback?: string } | null;

  return {
    reviewId: review.id,
    guestName: review.reviewer_name ?? "Unknown Guest",
    propertyName: review.property?.public_name ?? review.property?.property_name ?? "Unknown property",
    reviewRating: review.overall_rating,
    reviewText: review.review_text ?? "",
    privateFeedback: raw?.private_feedback ?? "",
    reservationId: review.reservation_id,
    confirmationCode: review.reservation?.confirmation_code ?? null,
    checkIn: review.reservation?.check_in ?? null,
    checkOut: review.reservation?.check_out ?? null,
    reviewedAt: review.review_date,
    conversation,
    priorAttempts: (priorDrafts ?? []).map((d) => ({
      id: d.id,
      attemptNumber: d.attempt_number ?? 1,
      violationTypes: d.violation_types ?? "",
      draftEmail: d.draft_email ?? "",
      status: d.status ?? "pending",
      createdAt: d.created_at ?? new Date(0).toISOString(),
      attachments: attachmentsByDraftId.get(d.id) ?? [],
    })),
  };
}
