import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";
import { NEXT_COOKIE } from "@/lib/auth/next";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Pique Bot routes have no browser session: Slack taps are checked against
  // Slack's signing secret and the morning run against PIQUE_BOT_CRON_SECRET.
  // The Stripe webhook is checked against STRIPE_WEBHOOK_SECRET.
  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth/callback") ||
    request.nextUrl.pathname.startsWith("/api/slack/") ||
    request.nextUrl.pathname.startsWith("/api/pique-bot/") ||
    request.nextUrl.pathname === "/api/stripe/webhook";

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Remember where they were going (e.g. a ticket opened from Slack), so sign-in lands there, not on the dashboard.
    const next = request.nextUrl.pathname + request.nextUrl.search;
    // Page loads only: not API calls or the router's background (RSC) fetches.
    if (request.method === "GET" && next !== "/" && !request.nextUrl.pathname.startsWith("/api/") && !request.headers.has("rsc")) {
      redirect.cookies.set(NEXT_COOKIE, next, { path: "/", maxAge: 900, httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:" });
    }
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
