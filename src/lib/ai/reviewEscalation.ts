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
- Argue EVERY policy violation the review commits, not just the strongest. The team's rule: "we don't have to choose one or the other when we're communicating with him directly - cover both options." Retaliation for a declined refund and extortion/pressure often apply together; so does misleading content.

== STRUCTURE (follow the team's escalations that worked) ==
Write it so Robert can forward it to Airbnb as-is.
1. Open with "Hi Robert," then one short paragraph: we are escalating our request to remove [guest]'s [N]-star review for [listing], reservation [confirmation code], stay [dates]; both removal requests were declined; we believe the central violation was not fully assessed. Mention any Airbnb case ID from the team input.
2. "Policy provisions violated": quote each relevant line of the Reviews Policy exactly, as bullets, naming the section (e.g. "Reviews involving bias, deception, extortion, incentivization, or pressure") and its Help Article. Note that the policy's Enforcing section lets Airbnb remove a violating review with its ratings.
3. "Documented timeline": a dated, timestamped list built from the guest-host conversation (state the time zone, e.g. "all times MST, January 31"). Quote the guest's own words at each step - especially any ultimatum, refund demand, or warning - and our response with how quickly we replied. End with what happened right before the review (e.g. "We declined the refund at 10:30 PM. The review was published after this refusal.").
4. One section per violation ("Violation 1: Extortion and pressure for unwarranted compensation", "Violation 2: Retaliation for a declined refund", "Violation 3: Misleading and deceptive content", ...). Tie each to the timeline and to the review's own words.
5. Misleading claims: bullet each claim in the review against what the thread actually shows (amounts, times, durations, what we said). Use the exact figures from the messages - e.g. the guest wrote "over $150" but the review says $200.
6. Anything Airbnb staff already said in our favour (case manager quotes, prior findings) if it appears in the team input or conversation.
7. "Our conduct throughout": short, factual - response times, what we offered and did.
8. "Request": remove the review and its ratings; because two requests were declined, ask that a senior specialist review the full message thread (name the key messages by time); ask Airbnb to confirm the outcome and its reasoning in writing.
9. Close: "Thank you for your time and continued support." then "Michael & Katrina" and "Pique Properties" on their own lines.

- Keep the "we" voice as the host throughout.
- Never invent facts, times, amounts, case IDs or staff names. Use only the review, the conversation, the appeals, Airbnb's responses and team input. If something important is missing (e.g. a case ID), list it under VERIFY instead.

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
