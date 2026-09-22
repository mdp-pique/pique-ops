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

export interface DraftResult {
  isViolation: boolean;
  violationTypes: string;
  reasoning: string;
  draftEmail: string;
  attachments: string;
  raw: string;
}

// Same 8-check policy rubric as the n8n "Airbnb Review Removal Monitor" workflow
// (Claude Sonnet node) - reused verbatim so an in-app draft cites policy the same
// way staff already trust from the automated Slack drafts. Only the input/output
// framing differs: this adds team-provided hints/context, supports a revise loop,
// and skips the Slack-formatted header block since the app already shows that.
const RUBRIC = `PIQUE PROPERTIES CONTEXT (applies to ALL reviews):
- Pique Properties collects a damage/security deposit from all guests. This is explicitly listed in the property description as a mandatory requirement before check-in. It is a legitimate, disclosed host requirement and is NOT against Airbnb policy.
- If any guest's review claims that being asked for a damage or security deposit was "against Airbnb policy," improper, or unauthorized — that is a FALSE STATEMENT. Evaluate under False/Misleading (Article 546) and Retaliatory (Article 2673).
- All other house rules and booking requirements are similarly disclosed in the listing.

== INTERNAL ANALYSIS — work through all checks silently. NEVER include this in your output. ==

CHECK 1: RETALIATORY (Article 2673)
Policy: "A review will only be considered retaliatory if the reviewer [the GUEST] committed a policy violation, was notified of that violation, and then left a biased review because their own violation was reported."
Flag if ALL THREE are true:
(a) The GUEST violated a rule or booking requirement — examples: unauthorized guests, smoking, noise complaints, late checkout, property damage, refusing to pay the disclosed security deposit, breaching any listed house rule.
(b) The HOST enforced it — notified the guest, charged a fee, filed an AirCover/Resolution Center claim, or otherwise held the guest accountable.
(c) A negative review appeared immediately after that enforcement.
NOTE: Refusing to pay the disclosed damage/security deposit IS a guest violation of booking terms. A negative review that follows the host's attempt to enforce this requirement is retaliatory.
NOT retaliatory: host behavior complaints unrelated to any guest violation. NOT retaliatory: disputes the host initiated without any underlying guest violation.

CHECK 2: FALSE / MISLEADING (Article 546)
Flag if the guest makes specific false factual claims.
Always check: Does the guest claim any disclosed host requirement (deposit, house rules, fees) was "against Airbnb policy" or improper? If so — that is FALSE. All Pique Properties requirements are disclosed in the listing.
Also check: Any other factual claims contradicted by the listing or conversation.

CHECK 3: EXTORTION / PRESSURE (Article 2673)
Policy: "Hosts and guests may not threaten a negative review as a means to obtain unwarranted compensation, refund, or other incentive. Reviews may not be provided or withheld in exchange for something of value."
Flag if: guest tied their review to a refund/compensation demand, OR review appeared only after a refund was denied, OR guest withheld review pending resolution.

CHECK 4: IRRELEVANT (Article 2673)
Flag if: review is a single word, single emoji, or meaningless phrase with no substantive content; OR guest never checked in.

CHECK 5: FAKE (Article 2673)
Flag if: any indication the review is not based on a real stay.

CHECK 6: COMPETITOR (Article 2673)
Flag if: guest mentioned being an Airbnb host or owning short-term rental properties.

CHECK 7: NONDISCRIMINATION (Article 2867 + Article 546)
Flag if: review contains slurs, derogatory labels, or language that demeans, stereotypes, or conveys inferiority of any group based on a protected characteristic or vulnerable status.
Examples: 'druggies', 'junkies', 'crackheads', racial slurs, homophobic slurs — these are stigmatizing and demeaning even when framed as neighborhood observations.

CHECK 8: CONTENT POLICY (Article 546)
Flag if: review contains violent, threatening, or harassing language; sexually explicit content; endorsement of illegal activity; or disclosure of the exact property address or unit number.

DOES NOT QUALIFY for removal: star rating disagreement alone, subjective opinions about the stay, factors outside the host's control (neighborhood, street noise, weather), legitimate negative feedback based on real experience.

Flag EVERY check that applies. A review can violate multiple grounds simultaneously.

Weigh the TEAM INPUT section below as trustworthy factual input from the people who actually hosted this guest - it may include facts that never made it into the message thread. But still verify it against the evidence available and don't invent specifics that aren't in the review, private feedback, conversation, or team input.

If evidence photos or documents are attached to this message, actually look at them - a photo showing property damage, a screenshot of the listing's disclosed deposit clause, or a screenshot of the guest's review/profile is direct evidence, not just a filename. Reference specifically what an attached photo or document shows when it supports a violation (e.g. "the attached photo shows visible damage to X" or "the attached listing screenshot confirms the deposit was disclosed"). Never claim an attachment shows something it doesn't.`;

const OUTPUT_FORMAT = `== OUTPUT FORMAT — respond with exactly these sections, in this order, nothing else. ==

VERDICT: DID NOT VIOLATE or POLICY VIOLATION
VIOLATION_TYPES: [comma-separated violation names, or "DID NOT VIOLATE" if none]
REASONING: [if DID NOT VIOLATE: 2-3 sentences on which policies were checked and why none apply. If POLICY VIOLATION: skip this line entirely.]
DRAFT_EMAIL:
[If DID NOT VIOLATE: write "N/A". If POLICY VIOLATION: the full removal request email. HARD REQUIREMENT: between 2,000 and 2,500 characters total (Airbnb's removal-request submission has a practical length limit - staying in this range is not optional, count as you write and trim or expand to land inside it). One numbered section per violation type found, each citing the exact Airbnb article and quoting specific evidence from the review/conversation/attached evidence. Open with "I am writing to formally request the removal of a review left by [guest name] for reservation [reservation ID/confirmation code]..." and close with a request for prompt removal.]
ATTACHMENTS:
[Bullet list of specific evidence the host should attach, tailored to the violations found. "N/A" if DID NOT VIOLATE.]`;

function buildPrompt(ctx: ReviewRemovalContext, req: DraftRequest): string {
  const hints = req.violationHints.length
    ? VIOLATION_HINTS.filter((h) => req.violationHints.includes(h.key))
        .map((h) => h.label)
        .join(", ")
    : "(none specified - use your own judgment across all 8 checks)";

  const revisePart = req.priorDraft
    ? `\n\nPRIOR DRAFT (attempt before this one):\n${req.priorDraft}\n\nTEAM FEEDBACK ON THAT DRAFT — revise accordingly, keeping citation quality and the 2,000-2,500 character range:\n${req.feedback || "(no specific feedback given - just try a different angle/framing)"}`
    : "";

  return `You are a review removal specialist for Pique Properties. Analyze this Airbnb review against ALL Airbnb policies.

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
Suspected violation type(s): ${hints}
Additional context from staff (may include facts not in the messages above): ${req.extraContext.trim() || "(none given)"}
${req.attachments?.length ? `\nEvidence attached below: ${req.attachments.length} file(s). Look at each one - see the rubric's note on using attached evidence.` : ""}
${revisePart}

---
${RUBRIC}

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

  const verdict = section("VERDICT", ["VIOLATION_TYPES"]);
  const isViolation = verdict.toUpperCase().includes("POLICY VIOLATION");

  return {
    isViolation,
    violationTypes: section("VIOLATION_TYPES", ["REASONING", "DRAFT_EMAIL"]) || (isViolation ? "POLICY VIOLATION" : "DID NOT VIOLATE"),
    reasoning: section("REASONING", ["DRAFT_EMAIL"]),
    draftEmail: section("DRAFT_EMAIL", ["ATTACHMENTS"]) || "N/A",
    attachments: section("ATTACHMENTS", []) || "N/A",
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
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [...evidenceBlocks, { type: "text", text: buildPrompt(ctx, req) }],
      },
    ],
  });

  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return parseResponse(text);
}
