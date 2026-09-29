import Anthropic from "@anthropic-ai/sdk";

// When Pique Bot should ask again after a "Not yet". A date typed in the form
// always wins; otherwise Claude reads the note and picks a day, and the result
// is held to these limits so a bad answer can't hide an item past check-in.

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Earliest is tomorrow. Before check-in: no later than the day before it.
 * Already checked in (overdue): at most two days out. No check-in date: a week.
 */
export function askAgainLimits(today: string, checkIn: string | null): { min: string; max: string } {
  const min = addDays(today, 1);
  if (!checkIn) return { min, max: addDays(today, 7) };
  if (checkIn > today) {
    const dayBefore = addDays(checkIn, -1);
    return { min, max: dayBefore > min ? dayBefore : min };
  }
  return { min, max: addDays(today, 2) };
}

export function clampDate(date: string, limits: { min: string; max: string }): string {
  if (date < limits.min) return limits.min;
  if (date > limits.max) return limits.max;
  return date;
}

export interface AskAgainPick {
  date: string;
  reason: string | null;
  /** Set when a person should look: the note was unclear ("unsure") or the AI call didn't work ("failed"). */
  needsHuman: "unsure" | "failed" | null;
  detail: string | null;
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "long", timeZone: "UTC" });

export async function pickAskAgain(input: {
  today: string;
  checkIn: string | null;
  itemLabel: string;
  typeLabel: string;
  note: string;
}): Promise<AskAgainPick> {
  const limits = askAgainLimits(input.today, input.checkIn);
  // Whenever the date isn't a confident pick, ask tomorrow and flag it for a person.
  const fallback = (needsHuman: AskAgainPick["needsHuman"], detail: string): AskAgainPick => ({ date: limits.min, reason: null, needsHuman, detail });
  // No note and only one possible day: nothing to read or choose. A note is always read,
  // even then, so an unclear one still reaches a person.
  if (limits.min === limits.max && !input.note) return { date: limits.min, reason: null, needsHuman: null, detail: null };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback("failed", "ANTHROPIC_API_KEY is not configured");

  const prompt = `A short-term rental ops team gets a Slack check-in each morning asking about tasks for upcoming guests. Someone answered "Not yet" for this task. Pick the morning the bot should ask again.

Task: ${input.typeLabel} - ${input.itemLabel}
Today: ${weekday(input.today)} ${input.today}
Guest check-in: ${input.checkIn ? `${weekday(input.checkIn)} ${input.checkIn}` : "unknown"}
Their note: ${input.note ? `"${input.note}"` : "(none)"}

Rules:
- Choose a date from ${limits.min} to ${limits.max}, inclusive.
- If the note says when it will happen (e.g. "guest will pay Thursday", "sending it tomorrow night"), ask the morning after that.
- If the note suggests waiting on the guest with no date, leave a day or two, but keep time to chase it before check-in.
- With no note, ask tomorrow unless check-in is far enough out that a later day is clearly fine.
- When unsure, pick the earlier date.

"reason" is a few words shown in Slack after the date, e.g. "after the guest's Thursday payment" or "day before check-in". No names or pronouns.

"sure": false if a person should look at this instead - the note is unclear or contradicts itself, it can't be told when this will be handled, or it sounds like something a manager should step in on (a guest refusing, a dispute, a complaint, a safety issue). A person gets tagged, so never guess to avoid that.`;

  try {
    const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
    const message = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              date: { type: "string", description: "YYYY-MM-DD" },
              reason: { type: "string" },
              sure: { type: "boolean" },
            },
            required: ["date", "reason", "sure"],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: "user", content: prompt }],
    });
    if (message.stop_reason !== "end_turn") return fallback("failed", `stopped early (${message.stop_reason})`);
    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(text) as { date?: string; reason?: string; sure?: boolean };
    if (!parsed.date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) return fallback("failed", "no usable date in the answer");
    if (parsed.sure !== true) return fallback("unsure", parsed.reason?.trim().slice(0, 200) || "unclear note");
    const reason = parsed.reason?.trim().slice(0, 80) || null;
    return { date: clampDate(parsed.date, limits), reason, needsHuman: null, detail: null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Pique Bot: picking the ask-again date failed: ${detail}`);
    return fallback("failed", detail.slice(0, 300));
  }
}
