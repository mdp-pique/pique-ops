import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkInvoice, type InvoiceEmail } from "@/lib/pique-bot/invoiceCheck";

export const maxDuration = 120;

/**
 * One invoices@ email, sent by n8n (Pique-Invoice-Check) with the same shared secret as the other
 * Pique Bot routes: { message_id, subject, from, received_at, text, files: [{ name, text }], other_files }.
 * Checks it against bookings and maintenance tickets (invoiceCheck.ts). Fails with 500 so n8n's
 * error alert fires and the check is retried on a later run. ?dry=1 reads and compares without
 * writing anything (works for an older email with no ticket).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PIQUE_BOT_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as InvoiceEmail | null;
  if (!body || typeof body.message_id !== "string" || !body.message_id) {
    return NextResponse.json({ error: "body needs message_id, plus subject, from, text and files: [{ name, text }]" }, { status: 400 });
  }
  try {
    const dry = request.nextUrl.searchParams.get("dry") === "1";
    return NextResponse.json(await checkInvoice(createAdminClient(), body, { dry }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
