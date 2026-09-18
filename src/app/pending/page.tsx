import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "../sign-out-button";

export default async function PendingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profile) redirect("/");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Access pending</h1>
      <p className="max-w-sm text-sm text-gray-400">
        You&apos;re signed in as {user.email}, but an admin hasn&apos;t approved your account
        for Pique Ops yet. Ask MDP, Michael, or Katrina to add you.
      </p>
      <SignOutButton />
    </div>
  );
}
