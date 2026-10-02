import Anthropic from "@anthropic-ai/sdk";
import type { ReviewRemovalContext } from "@/lib/data/reviews";
import { RUBRIC, WRITING_RULES } from "@/lib/ai/reviewRemoval";

/**
 * Drafts the message to Robert, our Airbnb account manager, after both appeals to
 * Airbnb were rejected (PRD §9). Unlike the removal request there is no length limit,
 * so it argues every policy violation the review commits, and it can answer what
 * Airbnb said in each rejection. Reuses the removal drafter's policy checks and
 * writing rules so the two never disagree on policy.
 */

export interface EscalationAppeal {
  number: number;
  status: string;
  sentText: string;
  airbnbResponse: string | null;
  date: string;
}

export interface EscalationRequest {
  extraContext: string;
  priorDraft?: string;
  feedback?: string;
}

export interface EscalationResult {
  violationTypes: string;
  draftMessage: string;
  attachments: string;
  verify: string;
}

const OUTPUT_FORMAT = `== OUTPUT FORMAT - respond with exactly these sections, in this order, nothing else. ==

VIOLATION_TYPES: [every ground the review violates, each with its citation, e.g. "Retaliatory (Help Article 2673), False/Misleading (Help Article 546)"]
DRAFT_MESSAGE:
[the full message to Robert]
ATTACHMENTS:
[bullet list of the specific evidence to attach]
VERIFY:
[bullet list of what staff must confirm before sending: facts taken only from team input, anything the evidence doesn't explain, and a reminder to check each policy quote against Airbnb's current Help Center wording. "N/A" only if there is truly nothing to check.]`;

function buildPrompt(ctx: ReviewRemovalContext, appeals: EscalationAppeal[], req: EscalationRequest): string {
  const appealsText = appeals.length
    ? appeals
        .map(
          (a) =>
            `APPEAL ${a.number} (${a.date}) - outcome: ${a.status}\nWhat we sent:\n${a.sentText || "(text not on file)"}\nAirbnb's response: ${a.airbnbResponse || "(not on file)"}`,
        )
        .join("\n\n")
    : "(no appeal text on file)";

  const revisePart =
    req.priorDraft && req.priorDraft.trim()
      ? `\n\nPRIOR DRAFT (may include the team's own edits - keep what they changed unless the feedback says otherwise):\n${req.priorDraft}\n\nTEAM FEEDBACK ON THAT DRAFT - revise accordingly:\n${req.feedback || "(no specific feedback - try a stronger structure)"}`
      : "";

  return `You are a review removal specialist for Pique Properties. We asked Airbnb twice to remove this review and both appeals were rejected. We are now escalating to Robert, our Airbnb account manager, who can take it further inside Airbnb. Write the message to Robert.

REVIEW DATA:
Guest: ${ctx.guestName}
Property: ${ctx.propertyName}
Rating: ${ctx.reviewRating ?? "?"}/5
Date: ${ctx.reviewedAt ?? "unknown"}
Booking Dates: ${ctx.checkIn ?? "N/A"} to ${ctx.checkOut ?? "N/A"}
Confirmation Code: ${ctx.confirmationCode ?? "N/A"}
Public Review: ${ctx.reviewText}
Private Feedback: ${ctx.privateFeedback || "(none)"}
Guest-Host Conversation:
${ctx.conversation}

APPEALS ALREADY SENT TO AIRBNB:
${appealsText}

TEAM INPUT (facts from the people who hosted this guest; may not be in the messages above): ${req.extraContext.trim() || "(none given)"}
${revisePart}

---
${RUBRIC}

---
${WRITING_RULES}

== HOW THIS DIFFERS FROM A REMOVAL REQUEST ==
- Ignore writing rules 9 and 11. There is NO length limit. Be complete rather than short, but every sentence must still add a point.
- Argue EVERY policy violation the review commits, not just the strongest one or two. Give each its own numbered section with the citation and the policy's elements as points.
- The reader is Robert, who works with us. Open with a short summary he can act on: the guest, property, stay dates, confirmation code, that both appeals were rejected, and what we're asking (that he escalate and have the review removed). Then the grounds, then the history.
- Include a short "History" section listing each appeal: date, the grounds we argued, and what Airbnb said. Where Airbnb's rejection missed or misread something, say so plainly and point to the evidence.
- Keep the "we" voice as the host. Close by thanking him and asking him to confirm next steps.
- Never invent facts. Use only the review, the conversation, the appeals, Airbnb's responses and team input.

---
${OUTPUT_FORMAT}`;
}

function section(text: string, name: string, next: string[]): string {
  const start = text.indexOf(`${name}:`);
  if (start === -1) return "";
  const rest = text.slice(start + name.length + 1);
  let end = rest.length;
  for (const n of next) {
    const i = rest.indexOf(`\n${n}:`);
    if (i !== -1 && i < end) end = i;
  }
  return rest.slice(0, end).trim();
}

export async function generateEscalationDraft(
  ctx: ReviewRemovalContext,
  appeals: EscalationAppeal[],
  req: EscalationRequest,
): Promise<EscalationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  const client = new Anthropic({ apiKey });

  // No length cap on this message, so stream to avoid request timeouts on long drafts.
  const message = await client.messages
    .stream({
      model: "claude-sonnet-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: buildPrompt(ctx, appeals, req) }],
    })
    .finalMessage();

  if (message.stop_reason === "max_tokens") throw new Error("The draft came back cut off. Try generating it again.");

  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const result = {
    violationTypes: section(text, "VIOLATION_TYPES", ["DRAFT_MESSAGE"]),
    draftMessage: section(text, "DRAFT_MESSAGE", ["ATTACHMENTS", "VERIFY"]),
    attachments: section(text, "ATTACHMENTS", ["VERIFY"]),
    verify: section(text, "VERIFY", []),
  };
  if (!result.draftMessage) throw new Error("The AI didn't return a draft. Try generating it again.");
  return result;
}
