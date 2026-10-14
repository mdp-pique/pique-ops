import Anthropic from "@anthropic-ai/sdk";
import type { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "./data";
import { redrawForTicket } from "./posts";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Invoice checks (tech requests 10-14, Michael Stead via Laurice). n8n Pique-Invoice-Check sends one
 * invoices@ email at a time: its text and the text of its PDFs. Claude lists what was billed per unit
 * (clean dates, maintenance jobs) and picks each unit's listing from ours. Then, in code:
 * - cleans: each billed date against that listing's accepted checkouts in the billed month(s);
 * - maintenance: each job against maintenance / damage tickets at that listing around its date.
 * The result goes on the invoice's ticket(s) as a comment, a few summary lines in metadata
 * (invoice_check, shown on the Pique-a-choo post), and invoice_checks. Read-only on everything else.
 */

export interface InvoiceEmail {
  message_id: string;
  subject?: string;
  from?: string;
  received_at?: string;
  text?: string;
  files?: { name: string; text: string }[];
  other_files?: string[];
}

type Extracted = {
  kind: "cleaning" | "maintenance" | "mixed" | "other";
  vendor: string;
  invoice_number: string | null;
  invoice_date: string | null;
  units: {
    billed_as: string;
    listing: number | null;
    cleans: string[];
    maintenance: { date: string | null; description: string; amount: number | null }[];
  }[];
};

const MAINT_TYPES = ["maintenance_ticket", "maintenance_access", "damage_report"];
const TEXT_LIMIT = 60_000;

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** dry: read and compare only, write nothing (also works for an email with no ticket, e.g. an older one). */
export async function checkInvoice(admin: Admin, email: InvoiceEmail, opts: { dry?: boolean } = {}): Promise<Record<string, unknown>> {
  if (opts.dry) return dryRun(admin, email);
  // The email's tickets on the invoices@ rules (record_email_alert's external_ref is email:{rule}:{message}).
  const refs = ["invoice", "invoice_reviewed"].map((rule) => `email:${rule}:${email.message_id}`);
  const { data: tix } = await admin.from("tickets").select("id").in("external_ref", refs);
  const ticketIds = (tix ?? []).map((t) => t.id);
  if (!ticketIds.length) return { message_id: email.message_id, skipped: "no invoice ticket for this email" };

  // Claimed once per email; a failed run is released by invoice_checks_pending() for a retry.
  const { data: prior } = await admin.from("invoice_checks").select("status").eq("message_id", email.message_id).maybeSingle();
  if (prior && prior.status !== "failed") return { message_id: email.message_id, skipped: `already ${prior.status}` };
  await admin.from("invoice_checks").upsert({ message_id: email.message_id, ticket_ids: ticketIds, status: "checking", error: null, created_at: new Date().toISOString() });

  try {
    const { data: props } = await admin.from("properties").select("id, property_name, public_name, city").eq("is_active", true).order("property_name");
    const listings = (props ?? []).map((p) => ({ id: p.id, name: (p.property_name || p.public_name || "").replace(/\*+$/, "").trim(), city: p.city }));
    const extracted = await extract(email, listings);
    if (!extracted || extracted.kind === "other" || !extracted.units.length) {
      await admin.from("invoice_checks").update({ status: "skipped", kind: extracted?.kind ?? null, vendor: extracted?.vendor ?? null, result: extracted as never, checked_at: new Date().toISOString() }).eq("message_id", email.message_id);
      return { message_id: email.message_id, skipped: "not a cleaning or maintenance invoice", vendor: extracted?.vendor };
    }

    const units = await compareAll(admin, extracted, listings);
    const { summary, detail } = describe(extracted, units);
    const now = new Date().toISOString();
    await admin.from("invoice_checks").update({ status: "done", kind: extracted.kind, vendor: extracted.vendor, summary, result: { extracted, units } as never, checked_at: now }).eq("message_id", email.message_id);

    for (const ticketId of ticketIds) {
      const { data: t } = await admin.from("tickets").select("metadata").eq("id", ticketId).maybeSingle();
      const metadata = { ...((t?.metadata as Record<string, unknown>) ?? {}), invoice_check: summary };
      await admin.from("tickets").update({ metadata: metadata as never }).eq("id", ticketId);
      await admin.from("ticket_comments").insert({ ticket_id: ticketId, author_id: null, body: detail });
      await admin.from("ticket_events").insert({ ticket_id: ticketId, event_type: "comment", note: "Invoice checked by Pique-a-choo", payload: { source: "invoice_check", message_id: email.message_id } });
      await redrawForTicket(admin, ticketId);
    }
    return { message_id: email.message_id, kind: extracted.kind, vendor: extracted.vendor, summary };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await admin.from("invoice_checks").update({ status: "failed", error: error.slice(0, 1000), checked_at: new Date().toISOString() }).eq("message_id", email.message_id);
    throw e;
  }
}

async function dryRun(admin: Admin, email: InvoiceEmail): Promise<Record<string, unknown>> {
  const { data: props } = await admin.from("properties").select("id, property_name, public_name, city").eq("is_active", true).order("property_name");
  const listings = (props ?? []).map((p) => ({ id: p.id, name: (p.property_name || p.public_name || "").replace(/\*+$/, "").trim(), city: p.city }));
  const extracted = await extract(email, listings);
  if (!extracted || extracted.kind === "other" || !extracted.units.length) return { dry: true, skipped: "not a cleaning or maintenance invoice", extracted };
  const units = await compareAll(admin, extracted, listings);
  return { dry: true, ...describe(extracted, units), units };
}

type Job = { date: string | null; description: string; amount: number | null };
type UnitResult = {
  billed_as: string;
  listing: { id: string; name: string } | null;
  cleans: { billed: string[]; matched: string[]; no_checkout: string[]; not_billed: string[] } | null;
  maintenance: Job[];
  /** Maintenance / damage tickets at this listing around the jobs' dates, for the reviewer to judge. */
  tickets: { id: string; title: string; created: string }[];
};

/** Lines billed to the same listing (e.g. "118 Elbow Drive" and "11820 Elbow Dr.") are checked together. */
async function compareAll(admin: Admin, x: Extracted, listings: { id: string; name: string }[]): Promise<UnitResult[]> {
  const groups = new Map<string, { names: string[]; listing?: { id: string; name: string }; cleans: string[]; maintenance: Job[] }>();
  x.units.forEach((u, i) => {
    const listing = u.listing != null ? listings[u.listing - 1] : undefined;
    const key = listing ? listing.id : `unplaced:${i}`;
    const g = groups.get(key) ?? { names: [], listing, cleans: [], maintenance: [] };
    g.names.push(u.billed_as);
    g.cleans.push(...u.cleans);
    g.maintenance.push(...u.maintenance);
    groups.set(key, g);
  });
  return Promise.all([...groups.values()].map((g) => compareUnit(admin, g, x.invoice_date)));
}

async function compareUnit(
  admin: Admin,
  g: { names: string[]; listing?: { id: string; name: string }; cleans: string[]; maintenance: Job[] },
  invoiceDate: string | null,
): Promise<UnitResult> {
  const listing = g.listing;
  const result: UnitResult = {
    billed_as: [...new Set(g.names)].join(" / "),
    listing: listing ? { id: listing.id, name: listing.name } : null,
    cleans: null,
    maintenance: g.maintenance.map((j) => ({ date: isDate(j.date) ? j.date : null, description: j.description, amount: j.amount })),
    tickets: [],
  };
  const billed = [...new Set(g.cleans.filter(isDate))].sort();

  if (listing && billed.length) {
    // The whole month(s) billed, so a checkout that wasn't billed shows up too.
    const from = `${billed[0].slice(0, 7)}-01`;
    const last = billed[billed.length - 1];
    const to = addDays(`${addDays(`${last.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1);
    const { data: stays } = await admin.from("reservations").select("check_out").eq("property_id", listing.id).eq("status", "accepted").gte("check_out", from).lte("check_out", to);
    const outs = new Set((stays ?? []).map((s) => String(s.check_out).slice(0, 10)));
    result.cleans = {
      billed,
      matched: billed.filter((d) => outs.has(d)),
      no_checkout: billed.filter((d) => !outs.has(d)),
      not_billed: [...outs].filter((d) => !billed.includes(d)).sort(),
    };
  } else if (billed.length) {
    result.cleans = { billed, matched: [], no_checkout: [], not_billed: [] };
  }

  const dates = [...result.maintenance.map((j) => j.date), invoiceDate].filter(isDate).sort();
  if (listing && result.maintenance.length && dates.length) {
    const { data } = await admin
      .from("tickets")
      .select("id, type, metadata, created_at")
      .eq("property_id", listing.id)
      .in("type", MAINT_TYPES)
      .gte("created_at", `${addDays(dates[0], -45)}T00:00:00Z`)
      .lte("created_at", `${addDays(dates[dates.length - 1], 7)}T23:59:59Z`)
      .order("created_at", { ascending: false })
      .limit(8);
    result.tickets = (data ?? []).map((t) => ({ id: t.id, title: String((t.metadata as { title?: unknown })?.title ?? t.type), created: String(t.created_at).slice(0, 10) }));
  }
  return result;
}

/** A few Slack lines (summary) and the full write-up for the ticket comment (detail). */
function describe(x: Extracted, units: UnitResult[]): { summary: string[]; detail: string } {
  const summary: string[] = [];
  const cleanUnits = units.filter((u) => u.cleans?.billed.length);
  const unplaced = units.filter((u) => !u.listing);
  if (cleanUnits.length) {
    const placed = cleanUnits.filter((u) => u.listing);
    const ok = placed.filter((u) => !u.cleans!.no_checkout.length && !u.cleans!.not_billed.length);
    const off = placed.filter((u) => u.cleans!.no_checkout.length || u.cleans!.not_billed.length);
    const billedCount = placed.reduce((n, u) => n + u.cleans!.billed.length, 0);
    if (placed.length) summary.push(off.length ? `:broom: Cleans: ${ok.length} of ${placed.length} units match the checkouts` : `:white_check_mark: Cleans: all ${billedCount} billed cleans match a checkout (${placed.length} unit${placed.length === 1 ? "" : "s"})`);
    for (const u of off.slice(0, 4)) {
      const bits = [u.cleans!.no_checkout.length && `billed with no checkout: ${u.cleans!.no_checkout.map(day).join(", ")}`, u.cleans!.not_billed.length && `checkout not billed: ${u.cleans!.not_billed.map(day).join(", ")}`].filter(Boolean);
      summary.push(`:warning: ${u.listing!.name}: ${bits.join("; ")}`);
    }
    if (off.length > 4) summary.push(`...and ${off.length - 4} more units - see the ticket`);
  }
  const maintUnits = units.filter((u) => u.maintenance.length);
  if (maintUnits.length) {
    const jobs = maintUnits.reduce((n, u) => n + u.maintenance.length, 0);
    const withTickets = maintUnits.filter((u) => u.tickets.length);
    const where = maintUnits.length === 1 ? (maintUnits[0].listing?.name ?? maintUnits[0].billed_as) : `${maintUnits.length} units`;
    summary.push(
      `:wrench: Maintenance: ${jobs} job${jobs === 1 ? "" : "s"} at ${where} - ${
        withTickets.length ? `${withTickets.length === maintUnits.length ? "each has" : `${withTickets.length} ha${withTickets.length === 1 ? "s" : "ve"}`} a maintenance ticket around then (see the ticket to compare)` : "no maintenance tickets for these in Pique Ops"
      }`,
    );
  }
  if (unplaced.length) summary.push(`:grey_question: Couldn't tell which listing: ${unplaced.map((u) => u.billed_as).slice(0, 3).join(", ")}`);

  const url = appUrl();
  const lines = [`Invoice check by Pique-a-choo - ${x.vendor}${x.invoice_number ? ` #${x.invoice_number}` : ""}${x.invoice_date ? ` (${x.invoice_date})` : ""}`];
  for (const u of units) {
    lines.push("", `${u.listing?.name ?? `"${u.billed_as}" (no matching listing found)`}${u.listing && u.billed_as !== u.listing.name ? ` - billed as "${u.billed_as}"` : ""}`);
    if (u.cleans?.billed.length) {
      lines.push(`  Cleans billed (${u.cleans.billed.length}): ${u.cleans.billed.map(day).join(", ")}`);
      if (u.listing) {
        lines.push(u.cleans.no_checkout.length ? `  No checkout on: ${u.cleans.no_checkout.map(day).join(", ")}` : "  Every billed clean matches a checkout.");
        if (u.cleans.not_billed.length) lines.push(`  Checkouts not billed: ${u.cleans.not_billed.map(day).join(", ")}`);
      }
    }
    for (const m of u.maintenance) lines.push(`  Maintenance: ${m.date ? `${day(m.date)} - ` : ""}${m.description}${m.amount != null ? ` ($${m.amount.toFixed(2)})` : ""}`);
    if (u.maintenance.length && u.listing) {
      lines.push(
        u.tickets.length
          ? `  Maintenance tickets at this listing around then: ${u.tickets.map((t) => `${t.title} (${day(t.created)}${url ? `, ${url}/?ticket=${t.id}` : ""})`).join("; ")}`
          : "  No maintenance tickets at this listing around then.",
      );
    }
  }
  lines.push("", "Checked against accepted bookings in Pique Ops. Cancelled or owner stays aren't counted.");
  return { summary, detail: lines.join("\n") };
}

async function extract(email: InvoiceEmail, listings: { id: string; name: string; city: string | null }[]): Promise<Extracted | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  let budget = TEXT_LIMIT;
  const take = (s: string) => {
    const part = s.slice(0, Math.max(0, budget));
    budget -= part.length;
    return part;
  };
  const files = (email.files ?? []).map((f) => `--- Attachment: ${f.name} ---\n${take(f.text ?? "")}`).join("\n\n");
  const listingLines = listings.map((l, i) => `${i + 1}. ${l.name}${l.city ? ` (${l.city})` : ""}`).join("\n");

  const prompt = `You read vendor invoices for Pique Properties, a short-term rental operator. Turn this invoice email into structured data.

Email from: ${email.from ?? "unknown"}
Subject: ${email.subject ?? ""}
Received: ${email.received_at ?? "unknown"}
Body:
${take(email.text ?? "") || "(empty)"}
${files ? `\n${files}` : ""}
${email.other_files?.length ? `\nAttachments not readable here (only their names): ${email.other_files.join(", ")}` : ""}

Our listings (number. name):
${listingLines}

Rules:
- kind: "cleaning" for turnover / housekeeping cleans, "maintenance" for repairs, call-outs and handyman work, "mixed" if both, "other" for anything else (subscriptions, bookkeeping, supplies orders, payment receipts). For "other", return no units.
- One entry in units per property or unit the invoice bills. billed_as: the unit as the invoice writes it. listing: the number of the matching listing above, or null if you can't tell. Match on unit numbers, street addresses and building names (e.g. "MS121" or "121 Mystic Springs" = "#121 Mystic Springs"; "213-214 Grand Rockies" = the joint 213 & 214 listing, not either single unit; an address with a small typo still matches). Never guess between two similar listings: use null.
- cleans: every date a clean was billed for that unit, as YYYY-MM-DD, one per clean (a line like "Quick Turnover Cleans September - 03, 04, 09" is three dates in that month and the invoice's year). Leave out linen fees and supplies. If a clean is billed without a date, leave it out.
- maintenance: each repair or call-out job billed for that unit: its date (YYYY-MM-DD) if the invoice gives one, else null; a short plain description; the amount before tax if shown, else null. Supplies restocking is not maintenance.
- If the attachment is only named (not readable), use what the subject and body say.`;

  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const message = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 6000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["cleaning", "maintenance", "mixed", "other"] },
            vendor: { type: "string" },
            invoice_number: { type: ["string", "null"] },
            invoice_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
            units: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  billed_as: { type: "string" },
                  listing: { type: ["integer", "null"] },
                  cleans: { type: "array", items: { type: "string" } },
                  maintenance: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { date: { type: ["string", "null"] }, description: { type: "string" }, amount: { type: ["number", "null"] } },
                      required: ["date", "description", "amount"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["billed_as", "listing", "cleans", "maintenance"],
                additionalProperties: false,
              },
            },
          },
          required: ["kind", "vendor", "invoice_number", "invoice_date", "units"],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: "user", content: prompt }],
  });
  if (message.stop_reason !== "end_turn") throw new Error(`invoice read stopped early (${message.stop_reason})`);
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text) as Extracted;
  // A listing number outside the list counts as "couldn't tell".
  for (const u of parsed.units ?? []) if (u.listing != null && (u.listing < 1 || u.listing > listings.length)) u.listing = null;
  return parsed;
}
