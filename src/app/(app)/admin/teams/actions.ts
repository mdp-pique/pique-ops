"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const MANAGERS = ["admin", "ops_manager"];

async function requireTeamManager() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || !MANAGERS.includes(profile.role)) throw new Error("Admins and ops managers only");
  return supabase;
}

export async function createTeam(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const supabase = await requireTeamManager();
  const { error } = await supabase.from("teams").insert({ name });
  if (error) throw new Error(error.code === "23505" ? "A team with that name already exists" : error.message);
  revalidatePath("/admin/teams");
}

export async function deleteTeam(teamId: string) {
  const supabase = await requireTeamManager();
  await supabase.from("teams").delete().eq("id", teamId);
  revalidatePath("/admin/teams");
}

/** Replaces the team's members and the ticket types that default to it. A type has one default team, so checking it here moves it off any other team. */
export async function saveTeam(teamId: string, formData: FormData) {
  const supabase = await requireTeamManager();
  const members = formData.getAll("member").map(String);
  const types = formData.getAll("type").map(String);

  const { data: current } = await supabase.from("team_members").select("profile_id").eq("team_id", teamId);
  const currentIds = new Set((current ?? []).map((r) => r.profile_id));
  const toRemove = [...currentIds].filter((id) => !members.includes(id));
  const toAdd = members.filter((id) => !currentIds.has(id));
  if (toRemove.length) await supabase.from("team_members").delete().eq("team_id", teamId).in("profile_id", toRemove);
  if (toAdd.length) await supabase.from("team_members").insert(toAdd.map((profile_id) => ({ team_id: teamId, profile_id })));

  await supabase.from("ticket_type_clocks").update({ default_team_id: null }).eq("default_team_id", teamId);
  if (types.length) await supabase.from("ticket_type_clocks").update({ default_team_id: teamId }).in("type", types);

  revalidatePath("/admin/teams");
}
