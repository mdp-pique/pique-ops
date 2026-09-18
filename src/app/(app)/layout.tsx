import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "../sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("role, display_name").eq("id", user.id).maybeSingle()
    : { data: null };

  if (user && !profile) redirect("/pending");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-800 px-6 py-3">
        <Link href="/" className="text-sm font-semibold">
          Pique Ops
        </Link>
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span>
            {user?.email}
            {profile ? ` · ${profile.role}` : " · no profile"}
          </span>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
