import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pique Bot is its own Slack app, separate from the one n8n uses, so its
 * button taps can come here without touching the live n8n Slack flows.
 */
export function botToken(): string {
  const token = process.env.PIQUE_BOT_SLACK_TOKEN;
  if (!token) throw new Error("PIQUE_BOT_SLACK_TOKEN is not configured");
  return token;
}

// Slack's read methods only take form-encoded arguments, not JSON.
const FORM_METHODS = new Set(["users.info", "users.lookupByEmail", "chat.getPermalink", "conversations.replies"]);

export async function slackApi<T = Record<string, unknown>>(method: string, body: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const form = FORM_METHODS.has(method);
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken()}`,
      "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8",
    },
    body: form ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString() : JSON.stringify(body),
  });
  const json = (await res.json()) as T & { ok: boolean; error?: string };
  if (!json.ok) console.error(`Slack ${method} failed: ${json.error}`);
  return json;
}

/** Slack request signing (v0): reject anything unsigned, forged, or older than 5 minutes. */
export function verifySlackSignature(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env.PIQUE_BOT_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
