import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runLateCleans, type ClockActivity } from "@/lib/pique-bot/lateCleans";

/**
 * Connecteam's time clock for today, sent every 10 minutes by n8n (Pique-Cleaning-Clock) with the
 * same shared secret as the other Pique Bot routes: saves the clock-ins and checks today's
 * turnovers for cleans that may not be ready at 4 PM (lateCleans.ts). Body: { activities, dates }.
 * ?dry=1 saves the clock-ins but opens no tickets and posts nothing, and shows what it would flag.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PIQUE_BOT_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const body = (await request.json().catch(() => null)) as { activities?: unknown; dates?: unknown } | null;
  if (!body || !Array.isArray(body.activities)) {
    return NextResponse.json({ error: "body needs activities: [{ userId, jobId, schedulerShiftId, start, end }]" }, { status: 400 });
  }
  const activities = body.activities as ClockActivity[];
  const dates = Array.isArray(body.dates) ? body.dates.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  try {
    const result = await runLateCleans(createAdminClient(), { activities, dates, dry });
    // A failed Slack reply or ticket fails the request, so n8n's error alert fires.
    const failed = result.results.some((r) => "error" in r);
    return NextResponse.json({ dry, ...result }, { status: failed ? 502 : 200 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
