import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("role, display_name").eq("id", user.id).maybeSingle()
    : { data: null };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold">Pique Ops</h1>
        <p className="text-sm text-gray-500">Signed in as {user?.email}</p>
        <p className="text-xs text-gray-400">
          {profile
            ? `Role: ${profile.role}${profile.display_name ? ` · ${profile.display_name}` : ""}`
            : "No profile provisioned yet — an admin needs to add you."}
        </p>
      </div>
      <SignOutButton />
    </div>
  );
}
