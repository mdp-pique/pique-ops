import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAlerts } from "@/lib/pique-bot/alerts";
import { redrawForTicket } from "@/lib/pique-bot/posts";

/**
 * Immediate posts for urgent / today tickets, plus one reminder on an
 * unanswered urgent post. Called every few minutes by n8n (Pique-Bot-Alerts)
 * with the same shared secret as the morning run. Only ticket types listed in
 * automation_flags.pique_bot_alerts_live_types post; ?dry=1 shows what would
 * be posted without posting or saving anything. ?since={ISO time} also posts
 * tickets created since then (a one-off catch-up when a rule goes live).
 * ?redraw={ticket id},... only redraws every post showing those tickets.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PIQUE_BOT_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const redraw = request.nextUrl.searchParams.get("redraw");
  if (redraw) {
    const admin = createAdminClient();
    for (const id of redraw.split(",").filter(Boolean)) await redrawForTicket(admin, id);
    return NextResponse.json({ redrawn: redraw.split(",").filter(Boolean) });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const since = request.nextUrl.searchParams.get("since");
  const sinceIso = since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : undefined;
  const result = await runAlerts(createAdminClient(), { dry, since: sinceIso });
  // A failed Slack post fails the request, so n8n's error alert fires instead of the run looking green.
  const failed = [...result.posted, ...result.reminded].some((r) => "error" in r && r.error);
  return NextResponse.json({ dry, ...result }, { status: failed ? 502 : 200 });
}
