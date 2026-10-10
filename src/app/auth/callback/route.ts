import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { NEXT_COOKIE, safeNext } from "@/lib/auth/next";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const allowedDomain = process.env.GOOGLE_WORKSPACE_DOMAIN;
      const emailDomain = data.user.email?.split("@")[1];

      if (allowedDomain && emailDomain !== allowedDomain) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=domain_not_allowed`);
      }

      // Back to the page they were sent to sign in from (set by src/proxy.ts), else the dashboard.
      const cookieStore = await cookies();
      const next = safeNext(cookieStore.get(NEXT_COOKIE)?.value);
      cookieStore.delete(NEXT_COOKIE);
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
