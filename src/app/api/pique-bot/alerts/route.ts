import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAlerts } from "@/lib/pique-bot/alerts";

/**
 * Immediate posts for urgent / today tickets, plus one reminder on an
 * unanswered urgent post. Called every few minutes by n8n (Pique-Bot-Alerts)
 * with the same shared secret as the morning run. Only ticket types listed in
 * automation_flags.pique_bot_alerts_live_types post; ?dry=1 shows what would
 * be posted without posting or saving anything.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PIQUE_BOT_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const result = await runAlerts(createAdminClient(), { dry });
  return NextResponse.json({ dry, ...result });
}
