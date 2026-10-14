import type Anthropic from "@anthropic-ai/sdk";

/**
 * Live, read-only search of invoices@piquepropertiesinc.com for Pique-a-choo (tech request 10-13,
 * Janina / Michael Stead: "comb invoices@ first"). Goes through n8n Pique-Invoice-Search, which holds
 * the mailbox's Gmail login and returns only sender, subject, date, snippet and a Gmail link per match
 * (never bodies or attachments). Same bearer secret n8n sends to the Pique Bot routes.
 */
const SEARCH_URL = "https://api.piquepropertiesinc.com/webhook/pique-invoice-search";

export const SEARCH_INVOICES_TOOL: Anthropic.Tool = {
  name: "search_invoices",
  description:
    "Search the invoices@piquepropertiesinc.com mailbox (where ~99% of invoices and receipts arrive) live, like the Gmail search box. Use it FIRST whenever someone asks to find an invoice, receipt, bill or order confirmation. Returns sender, subject, date, a short snippet and a Gmail link for each match. Promotions are left out unless you include 'category:promotions'. Try a couple of queries if the first finds nothing (vendor name, order number, amount, 'invoice OR receipt', a date range with after:/before:). Many invoices are forwarded in by staff (e.g. Katrina forwards orders from her own account), so don't rely on from: alone: also search the vendor's name anywhere in the email. If 'this month' finds nothing, check the month before too and say what you found there (people often mean a recent order, not strictly this calendar month).",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Gmail search syntax, e.g. 'from:canadiantire.ca (invoice OR receipt OR order) after:2026/10/01'." },
      limit: { type: "number", description: "Most results to return, 1-15 (default 8)." },
    },
    required: ["query"],
  },
};

type Hit = { from: string | null; subject: string | null; date: string | null; snippet: string | null; link: string };

export async function searchInvoices(input: unknown): Promise<string> {
  const i = (input ?? {}) as { query?: unknown; limit?: unknown };
  let query = typeof i.query === "string" ? i.query.trim().slice(0, 500) : "";
  if (!query) return "Need a search query.";
  if (!/category:/i.test(query)) query += " -category:promotions -category:social";
  const secret = process.env.PIQUE_BOT_CRON_SECRET;
  if (!secret) return "Invoice search isn't set up (missing secret).";

  try {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: typeof i.limit === "number" ? i.limit : 8 }),
      signal: AbortSignal.timeout(25_000),
    });
    const body = (await res.json().catch(() => null)) as { results?: Hit[] } | null;
    if (!res.ok || !body || !Array.isArray(body.results)) return `The invoices@ search failed (HTTP ${res.status}). Tell them to search the mailbox directly.`;
    if (!body.results.length) return `No matches in invoices@ for: ${query}`;
    return JSON.stringify({ mailbox: "invoices@piquepropertiesinc.com", query, results: body.results });
  } catch (e) {
    return `The invoices@ search didn't answer (${e instanceof Error ? e.message : "error"}). Tell them to search the mailbox directly.`;
  }
}
