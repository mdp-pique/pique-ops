"use client";

import { createClient } from "@/lib/supabase/client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  domain_not_allowed: "That Google account isn't part of the Pique Properties workspace.",
  auth_failed: "Sign-in failed. Please try again.",
};

function LoginError() {
  const params = useSearchParams();
  const error = params.get("error");
  if (!error) return null;
  return (
    <p className="mt-4 text-sm text-red-600">
      {ERROR_MESSAGES[error] ?? "Something went wrong signing in."}
    </p>
  );
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  async function signInWithGoogle() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          hd: process.env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN ?? "",
        },
      },
    });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">Pique Ops</h1>
        <p className="text-sm text-gray-500">Sign in with your Pique Properties Google account.</p>
      </div>
      <button
        onClick={signInWithGoogle}
        disabled={loading}
        className="rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {loading ? "Redirecting…" : "Sign in with Google"}
      </button>
      <Suspense fallback={null}>
        <LoginError />
      </Suspense>
    </div>
  );
}
