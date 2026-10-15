import { createAdminClient } from "@/lib/supabase/admin";
import { CRISTINE } from "./config";
import { slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Interac e-transfers (Michael Stead 10-15): @customerservice says what each transfer is for, Pique-a-choo
 * files the email in invoices@ under that folder and tells Cristine in the post's thread. The folders are the
 * existing Gmail labels under "Interac E-Transfer Receipts/" (checked 10-15); n8n Pique-Etransfer-Label only
 * accepts those.
 */
const PARENT = "Interac E-Transfer Receipts/";
export const ETRANSFER_FOLDERS = [
  "Pet Fees",
  "Early Check In Fee",
  "Additional Nights",
  "Additional Guest Fees",
  "Additional Cleaning",
  "Damage Deposit E-Transfers",
  "Damage Payment",
  "Booking Revenue",
  "Firewood Purchase",
  "Return Shipping Charges",
  "Funding From Client",
] as const;
const OTHER = "other";

const LABEL_URL = "https://api.piquepropertiesinc.com/webhook/pique-etransfer-label";

export function etransferModal(postId: string, ticketId: string, itemId: string) {
  return {
    type: "modal",
    callback_id: "pique_bot_etransfer",
    private_metadata: `${postId}|${ticketId}|${itemId}`,
    title: { type: "plain_text", text: "What's it for?" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "folder",
        label: { type: "plain_text", text: "What the e-transfer is for" },
        element: {
          type: "static_select",
          action_id: "value",
          placeholder: { type: "plain_text", text: "Pick one" },
          options: [
            ...ETRANSFER_FOLDERS.map((f) => ({ text: { type: "plain_text", text: f }, value: f })),
            { text: { type: "plain_text", text: "Something else (say in the note)" }, value: OTHER },
          ],
        },
      },
      {
        type: "input",
        block_id: "note",
        label: { type: "plain_text", text: "Guest / booking, anything Cristine should know" },
        element: { type: "plain_text_input", action_id: "value", multiline: true, placeholder: { type: "plain_text", text: "e.g. 143 GR, Irene Beentjes" } },
      },
    ],
  };
}

/** The answer from the form, already checked: a folder from the list (or "other") and a note. */
export function readEtransferForm(values: Record<string, Record<string, { selected_option?: { value?: string }; value?: string }>>) {
  const folder = values.folder?.value?.selected_option?.value ?? "";
  const note = values.note?.value?.value?.trim() ?? "";
  const known = (ETRANSFER_FOLDERS as readonly string[]).includes(folder) || folder === OTHER;
  return known && note ? { folder, note } : null;
}

/**
 * Saves the answer on the ticket (comment + a note the posts show), files the email in invoices@, and
 * tells Cristine in the post's thread. The caller ticks the checklist item and redraws.
 */
export async function recordEtransfer(
  admin: Admin,
  opts: { ticketId: string; postId: string; channel: string | null; threadTs: string | null; folder: string; note: string; actor: { profileId: string | null; name: string } },
) {
  const { data: ticket } = await admin.from("tickets").select("external_ref, metadata").eq("id", opts.ticketId).maybeSingle();
  const m = (ticket?.metadata ?? {}) as Record<string, unknown>;
  const messageId = String(ticket?.external_ref ?? "").match(/^email:etransfer:([0-9a-f]+)$/i)?.[1] ?? null;
  const what = opts.folder === OTHER ? "Something else" : opts.folder;
  const text = `${what}: ${opts.note}`;

  await admin.from("ticket_comments").insert({ ticket_id: opts.ticketId, author_id: opts.actor.profileId, body: `E-transfer is for (${opts.actor.name}, from Slack): ${text}` });

  // File it under the folder; "Something else" stays where it is for Cristine to file by hand.
  let filed: string | null = null;
  let fileError: string | null = null;
  if (opts.folder !== OTHER && messageId) {
    const secret = process.env.PIQUE_BOT_CRON_SECRET;
    try {
      const res = await fetch(LABEL_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, label: PARENT + opts.folder }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (res.ok && body?.ok) filed = PARENT + opts.folder;
      else fileError = `HTTP ${res.status}`;
    } catch (e) {
      fileError = e instanceof Error ? e.message : "error";
    }
    if (fileError) console.error(`Pique-a-choo: filing e-transfer ${messageId} failed: ${fileError}`);
  }

  await admin.from("ticket_events").insert({
    ticket_id: opts.ticketId,
    event_type: "comment",
    actor_id: opts.actor.profileId,
    note: filed ? `E-transfer noted in Slack by ${opts.actor.name}, filed in invoices@ under ${filed}` : `E-transfer noted in Slack by ${opts.actor.name}`,
    payload: { source: "pique_bot", kind: "note", post_id: opts.postId, by: opts.actor.name, note: text, folder: opts.folder, filed, file_error: fileError },
  });

  if (opts.channel && opts.threadTs) {
    const amount = String(m.subject ?? "").match(/\$[\d,]+(?:\.\d\d)?/)?.[0];
    const from = typeof m.from_name === "string" ? m.from_name : null;
    const which = [amount, from && `from ${from}`].filter(Boolean).join(" ");
    const where = filed
      ? `Filed in invoices@ under ${opts.folder}.`
      : opts.folder === OTHER
        ? "Not filed: it's not one of the usual folders."
        : "Couldn't file it in invoices@, so it still needs filing by hand.";
    await slackApi("chat.postMessage", {
      channel: opts.channel,
      thread_ts: opts.threadTs,
      text: `<@${CRISTINE}> the e-transfer${which ? ` (${which})` : ""} is for: ${text} (${opts.actor.name}). ${where}`,
      unfurl_links: false,
    });
  }
}
