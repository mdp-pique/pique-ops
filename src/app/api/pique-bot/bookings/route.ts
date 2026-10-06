import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runBookingFeed } from "@/lib/pique-bot/bookings";

/**
 * The booking feed: posts each new accepted reservation to #new-reservations
 * once. Called every couple of minutes by n8n (Pique-Bot-Bookings) with the
 * same shared secret as the morning run; ?dry=1 shows what would be posted
 * without posting or saving anything.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PIQUE_BOT_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const posted = await runBookingFeed(createAdminClient(), { dry });
  // A failed Slack post fails the request, so n8n's error alert fires instead of the run looking green.
  const failed = posted.some((r) => "error" in r);
  return NextResponse.json({ dry, posted }, { status: failed ? 502 : 200 });
}
