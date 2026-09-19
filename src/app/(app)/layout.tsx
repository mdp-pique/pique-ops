import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Rail } from "@/components/pique/Rail";
import { DrawerProvider } from "@/components/pique/drawer/DrawerContext";
import { DrawerRoot } from "@/components/pique/drawer/DrawerRoot";
import { AskPiqueHotkey } from "@/components/pique/dashboard/AskPiqueHotkey";

function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  if (name) {
    return name
      .split(" ")
      .map((x) => x[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
  return (email ?? "??").slice(0, 2).toUpperCase();
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("role, display_name").eq("id", user.id).maybeSingle()
    : { data: null };

  if (user && !profile) redirect("/pending");

  return (
    <DrawerProvider>
      <div className="pq">
        <div className="app">
          <Rail initials={initialsFor(profile?.display_name, user?.email)} />
          <main className="main">{children}</main>
        </div>
        <DrawerRoot />
        <AskPiqueHotkey />
      </div>
    </DrawerProvider>
  );
}
