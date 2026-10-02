import Anthropic from "@anthropic-ai/sdk";
import type { ReviewRemovalContext } from "@/lib/data/reviews";

export const VIOLATION_HINTS = [
  { key: "retaliatory", label: "Retaliatory" },
  { key: "false_misleading", label: "False / misleading" },
  { key: "extortion", label: "Extortion / pressure" },
  { key: "irrelevant", label: "Irrelevant" },
  { key: "fake", label: "Fake" },
  { key: "competitor", label: "Posted by a competitor" },
  { key: "discriminatory", label: "Discriminatory" },
  { key: "content_policy", label: "Content policy" },
] as const;

export interface EvidenceAttachment {
  url: string;
  kind: string;
}

export interface DraftRequest {
  violationHints: string[];
  extraContext: string;
  priorDraft?: string;
  feedback?: string;
  attachments?: EvidenceAttachment[];
}

export const ODDS_LEVELS = ["Likely", "Possible", "Long shot"] as const;
export type Odds = (typeof ODDS_LEVELS)[number];

export interface DraftResult {
  /** The AI's honest read on Airbnb accepting this request. Advice only - it never blocks a draft. */
  odds: Odds | null;
  violationTypes: string;
  /** One or two sentences: why those odds, and the weakest point an Airbnb agent is likely to push back on. */
  reasoning: string;
  draftEmail: string;
  attachments: string;
  /** Facts and policy wording staff should confirm before sending. */
  verify: string;
  raw: string;
}

// The 8 policy checks come from the n8n "Airbnb Review Removal Monitor"
// workflow (which is untouched and keeps its own copy). In the app they are
// used to pick grounds and judge the odds, not to decide whether to draft:
// the team appeals every review it wants removed, so every run returns the
// strongest honest request it can make.
export const RUBRIC = `PIQUE PROPERTIES CONTEXT (applies to ALL reviews):
- Pique Properties collects a damage/security deposit from all guests. This is explicitly listed in the property description as a mandatory requirement before check-in. It is a legitimate, disclosed host requirement and is NOT against Airbnb policy.
- Pet fees work the same way: they are disclosed in the listing, must be paid before check-in, and the door code is only activated once required payments are complete. Enforcing that is enforcing a disclosed booking requirement.
- If any guest's review claims that being asked for a damage/security deposit or pet fee was "against Airbnb policy," improper, or unauthorized - that is a FALSE STATEMENT. Consider False/Misleading (Help Article 546) and Retaliatory (Help Article 2673).
- All other house rules and booking requirements are similarly disclosed in the listing.

== POLICY CHECKS - use these to choose the grounds and judge the odds. Work through them silently; never include this analysis in your output. ==

CHECK 1: RETALIATORY (Help Article 2673)
Policy: "A review will only be considered retaliatory if the reviewer [the GUEST] committed a policy violation, was notified of that violation, and then left a biased review because their own violation was reported."
Applies when:
(a) The GUEST violated a rule or booking requirement - e.g. unauthorized guests, smoking, noise, late checkout, damage, not paying a disclosed deposit or fee, breaching any listed house rule.
(b) The HOST enforced it - notified the guest, charged a fee, withheld access until payment, filed an AirCover/Resolution Center claim, or otherwise held the guest accountable.
(c) The negative review followed that enforcement and is about it.
A house rule is an Airbnb policy matter: Airbnb's Ground Rules for guests require guests to follow the host's house rules, so breaking a disclosed house rule is a policy violation. Say so explicitly whenever the violation is a house rule.

CHECK 2: FALSE / MISLEADING (Help Article 546)
The guest makes specific factual claims that are false or misleading - including calling a disclosed requirement (deposit, pet fee, house rules) improper or "against policy", or claims contradicted by the listing, conversation or evidence.

CHECK 3: EXTORTION / PRESSURE (Help Article 2673)
Policy: "Hosts and guests may not threaten a negative review as a means to obtain unwarranted compensation, refund, or other incentive. Reviews may not be provided or withheld in exchange for something of value."
Applies when: the guest tied the review to a refund/compensation demand, the review came right after a refund was denied, or the guest withheld the review pending resolution.

CHECK 4: IRRELEVANT (Help Article 2673)
The review is a single word, emoji or meaningless phrase, or the guest never checked in.

CHECK 5: FAKE (Help Article 2673)
Any sign the review is not based on a real stay.

CHECK 6: COMPETITOR (Help Article 2673)
The guest mentioned being an Airbnb host or owning short-term rentals.

CHECK 7: NONDISCRIMINATION (Help Article 2867 + Help Article 546)
Slurs, derogatory labels, or language that demeans or stereotypes any group based on a protected characteristic or vulnerable status (e.g. 'druggies', 'junkies', 'crackheads', racial or homophobic slurs), even framed as neighborhood observations.

CHECK 8: CONTENT POLICY (Help Article 546)
Violent, threatening or harassing language; sexually explicit content; endorsement of illegal activity; or disclosure of the exact address or unit number.

Weaker grounds (they lower the odds but never stop a draft): star-rating disagreement alone, subjective opinions, factors outside the host's control (neighborhood, street noise, weather), and legitimate negative feedback about a real experience. When only weak grounds exist, still write the request: build it on the closest check that honestly fits (usually False/Misleading for inaccurate claims, or Retaliatory if anything was enforced) and rate the odds "Long shot".

Use every check that applies; a review can violate several at once.

Weigh the TEAM INPUT section below as trustworthy factual input from the people who actually hosted this guest - it may include facts that never made it into the message thread. Still check it against the evidence, and never invent specifics that aren't in the review, private feedback, conversation, attached evidence or team input.

If evidence photos or documents are attached to this message, actually look at them - a photo of damage, a screenshot of the listing's disclosed deposit or pet fee clause, or a screenshot of the guest's review is direct evidence. Say specifically what an attachment shows when it supports a point (e.g. "the attached listing screenshot shows the pet fee must be paid before the door code is activated"). Never claim an attachment shows something it doesn't.`;

// How to write the request. These rules came from comparing app drafts with a
// stronger hand-built appeal: agents respond to a checklist of the policy's
// elements, a house rule tied back to Airbnb policy, the obvious objection
// answered up front, and the guest's own words.
export const WRITING_RULES = `== HOW TO WRITE THE REQUEST ==
1. One numbered section per ground, headed with the ground and its citation in the form "Help Article 2673". Inside each section, walk the policy's elements as short labelled points the agent can tick off. For Retaliatory that is: the violation, the notice, the enforcement, and the review that followed.
2. When the guest broke a house rule, connect it to Airbnb policy: Airbnb's Ground Rules for guests require guests to follow house rules, so breaking a disclosed house rule is a policy violation. Name the Ground Rules; do not give them an article number.
3. Answer the most obvious counterargument before the agent raises it (e.g. "this is not a fee dispute", "this is not a complaint about the stay itself").
4. Use the guest's own words. Quote any line in the review or messages showing the rating is a penalty (e.g. removing stars for the enforcement), and anything they said or did during the stay that contradicts the review (e.g. "we got in fine", extending the stay).
5. Deal with every incident the review complains about, and meet the most sympathetic one head-on rather than leaving it for the agent to find. If the evidence does not show what caused an incident, do not paper over it - list it under VERIFY so staff can supply the facts.
6. Quote Airbnb policy exactly as given above. Never edit, shorten or extend a policy quote to make it fit.
7. Be exact about facts and timing (e.g. a fee due BEFORE check-in, not "promptly upon check-in"). Only state times, amounts and events that appear in the review, conversation, evidence or team input.
8. Write in one voice throughout: first person plural as the host ("we", "our listing"). Never switch to "the host".
9. Open with "I am writing to formally request the removal of a review left by [guest name] for reservation [confirmation code]..." using the real confirmation code if it is given, and close with a request for prompt removal.
10. Make every sentence add a new point. Do not repeat the same words ("disclosed", "legitimate") in place of new evidence.
11. HARD REQUIREMENT: the request is between 2,000 and 2,500 characters total (Airbnb's submission form has a practical limit). Count as you write and trim or expand to land inside it.`;

const OUTPUT_FORMAT = `== OUTPUT FORMAT - respond with exactly these sections, in this order, nothing else. ==

ODDS: Likely | Possible | Long shot
VIOLATION_TYPES: [comma-separated grounds used, each with its citation, e.g. "Retaliatory (Help Article 2673), False/Misleading (Help Article 546)"]
REASONING: [1-2 sentences: your honest read on the odds, and the weakest point an Airbnb agent is most likely to push back on.]
DRAFT_EMAIL:
[the full removal request, following the writing rules above]
ATTACHMENTS:
[bullet list of the specific evidence to attach, tailored to the grounds]
VERIFY:
[bullet list of what staff must confirm before sending: every fact taken only from team input, any incident the evidence doesn't explain, and a reminder to check each policy quote against Airbnb's current Help Center wording. "N/A" only if there is truly nothing to check.]`;

function buildPrompt(ctx: ReviewRemovalContext, req: DraftRequest): string {
  const hints = req.violationHints.length
    ? VIOLATION_HINTS.filter((h) => req.violationHints.includes(h.key))
        .map((h) => h.label)
        .join(", ")
    : "(none specified - pick the strongest grounds yourself)";

  const hasPriorDraft = !!req.priorDraft && req.priorDraft.trim() !== "N/A";
  const revisePart = hasPriorDraft
    ? `\n\nPRIOR DRAFT (the current text, which may include the team's own edits - keep what they changed unless the feedback says otherwise):\n${req.priorDraft}\n\nTEAM FEEDBACK ON THAT DRAFT - revise accordingly, keeping the writing rules and the 2,000-2,500 character range:\n${req.feedback || "(no specific feedback given - just try a different angle/framing)"}`
    : "";

  return `You are a review removal specialist for Pique Properties. The team has decided to ask Airbnb to remove this review. Your job is to write the strongest honest removal request the facts allow, and to tell the team plainly how likely it is to succeed. You always write the request - a low chance is a reason to make it as strong as possible, not a reason to skip it.

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

TEAM INPUT:
Grounds the team wants to use: ${hints}${req.violationHints.length ? " (build the request on these; add another ground only if it clearly applies)" : ""}
Additional context from staff (may include facts not in the messages above): ${req.extraContext.trim() || "(none given)"}
${req.attachments?.length ? `\nEvidence attached below: ${req.attachments.length} file(s). Look at each one - see the note on attached evidence.` : ""}
${revisePart}

---
${RUBRIC}

---
${WRITING_RULES}

---
${OUTPUT_FORMAT}`;
}

function parseResponse(text: string): DraftResult {
  const section = (name: string, stopAt: string[]) => {
    const start = text.indexOf(`${name}:`);
    if (start === -1) return "";
    const from = start + name.length + 1;
    const rest = text.slice(from);
    let end = rest.length;
    for (const stop of stopAt) {
      const idx = rest.indexOf(`\n${stop}:`);
      if (idx !== -1 && idx < end) end = idx;
    }
    return rest.slice(0, end).trim();
  };

  const oddsText = section("ODDS", ["VIOLATION_TYPES"]).toLowerCase();
  const odds = ODDS_LEVELS.find((o) => oddsText.startsWith(o.toLowerCase())) ?? null;
  const verify = section("VERIFY", []);

  return {
    odds,
    violationTypes: section("VIOLATION_TYPES", ["REASONING", "DRAFT_EMAIL"]) || "Removal request",
    reasoning: section("REASONING", ["DRAFT_EMAIL"]),
    draftEmail: section("DRAFT_EMAIL", ["ATTACHMENTS", "VERIFY"]),
    attachments: section("ATTACHMENTS", ["VERIFY"]),
    verify: verify === "N/A" ? "" : verify,
    raw: text,
  };
}

/** Photos go in as an image block by URL - Claude fetches the signed URL itself, no need to download it here. PDFs need base64 (no URL source type for documents), so those are fetched and encoded here. */
async function buildEvidenceBlocks(attachments: EvidenceAttachment[]): Promise<Anthropic.ContentBlockParam[]> {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const a of attachments) {
    if (a.kind === "photo") {
      blocks.push({ type: "image", source: { type: "url", url: a.url } });
    } else {
      const res = await fetch(a.url);
      if (!res.ok) continue;
      const data = Buffer.from(await res.arrayBuffer()).toString("base64");
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    }
  }
  return blocks;
}

export async function generateReviewRemovalDraft(ctx: ReviewRemovalContext, req: DraftRequest): Promise<DraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const client = new Anthropic({ apiKey });
  const evidenceBlocks = req.attachments?.length ? await buildEvidenceBlocks(req.attachments) : [];

  const message = await client.messages.create({
    model: "claude-sonnet-5",
    // Odds, reasoning, a 2,000-2,500 character draft, attachments and the verify
    // list all share this budget; at 2000 tokens long drafts were cut off mid-sentence.
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [...evidenceBlocks, { type: "text", text: buildPrompt(ctx, req) }],
      },
    ],
  });

  // Never hand back a half-written draft as if it were finished.
  if (message.stop_reason === "max_tokens") {
    throw new Error("The draft came back cut off. Try generating it again.");
  }

  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const result = parseResponse(text);
  if (!result.draftEmail) throw new Error("The AI didn't return a draft. Try generating it again.");
  return result;
}
