import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ticketTypeLabel } from "@/lib/pique-ui/mappings";
import { createTeam, deleteTeam, saveTeam } from "./actions";
import { SubmitButton } from "@/components/pique/SubmitButton";

export default async function AdminTeamsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : { data: null };

  if (!profile || !["admin", "ops_manager"].includes(profile.role)) {
    return <div className="mx-auto max-w-2xl px-6 py-8 text-sm text-gray-400">Admins and ops managers only.</div>;
  }

  const [{ data: teams }, { data: members }, { data: people }, { data: clocks }] = await Promise.all([
    supabase.from("teams").select("id, name").order("name"),
    supabase.from("team_members").select("team_id, profile_id"),
    supabase.from("profiles").select("id, display_name").order("display_name"),
    supabase.from("ticket_type_clocks").select("type, default_team_id").order("type"),
  ]);

  const membersOf = (teamId: string) => new Set((members ?? []).filter((m) => m.team_id === teamId).map((m) => m.profile_id));
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.name]));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Teams</h1>
        {profile.role === "admin" && (
          <Link href="/admin/users" className="text-sm text-gray-400 hover:underline">
            People &amp; access →
          </Link>
        )}
      </div>

      <p className="mb-6 text-sm text-gray-400">
        Assign tickets to a team instead of one person. A teammate can then pick it up. Ticket types checked below go to that team
        automatically when they&apos;re created with nobody assigned.
      </p>

      <form action={createTeam} className="mb-8 flex items-center gap-2">
        <label className="sr-only" htmlFor="new-team">
          New team name
        </label>
        <input
          id="new-team"
          name="name"
          required
          placeholder="New team, e.g. Maintenance"
          className="flex-1 rounded border border-gray-700 bg-black px-3 py-2 text-sm"
        />
        <SubmitButton pendingText="Adding…" className="rounded bg-white px-3 py-2 text-sm font-medium text-black disabled:opacity-60">
          Add team
        </SubmitButton>
      </form>

      {(teams ?? []).length === 0 && <p className="text-sm text-gray-500">No teams yet.</p>}

      <div className="space-y-6">
        {(teams ?? []).map((t) => {
          const mine = membersOf(t.id);
          return (
            <section key={t.id} className="rounded border border-gray-800 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">{t.name} team</h2>
                <form action={deleteTeam.bind(null, t.id)}>
                  <SubmitButton pendingText="Deleting…" className="text-xs text-red-400 hover:underline disabled:opacity-60">
                    Delete team
                  </SubmitButton>
                </form>
              </div>
              <form action={saveTeam.bind(null, t.id)} className="space-y-4">
                <fieldset>
                  <legend className="mb-2 text-xs uppercase text-gray-500">Members</legend>
                  <div className="flex flex-wrap gap-2">
                    {(people ?? []).map((p) => (
                      <label key={p.id} className="flex items-center gap-2 rounded border border-gray-800 px-2 py-1 text-sm">
                        <input type="checkbox" name="member" value={p.id} defaultChecked={mine.has(p.id)} />
                        {p.display_name ?? "Unnamed"}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 text-xs uppercase text-gray-500">Ticket types that go to this team by default</legend>
                  <div className="flex flex-wrap gap-2">
                    {(clocks ?? []).map((c) => (
                      <label key={c.type} className="flex items-center gap-2 rounded border border-gray-800 px-2 py-1 text-sm">
                        <input type="checkbox" name="type" value={c.type} defaultChecked={c.default_team_id === t.id} />
                        {ticketTypeLabel(c.type)}
                        {c.default_team_id && c.default_team_id !== t.id && (
                          <span className="text-xs text-gray-500">(now: {teamName.get(c.default_team_id)})</span>
                        )}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <SubmitButton className="rounded border border-gray-700 px-3 py-1 text-sm hover:bg-gray-900 disabled:opacity-60">Save</SubmitButton>
              </form>
            </section>
          );
        })}
      </div>
    </div>
  );
}
