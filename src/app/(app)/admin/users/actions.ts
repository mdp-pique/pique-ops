"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROFILE_ROLES, type ProfileRole } from "@/lib/types";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("Admin only");

  return { supabase, user };
}

export async function approveUser(userId: string, formData: FormData) {
  const role = formData.get("role") as ProfileRole;
  const displayName = (formData.get("display_name") as string)?.trim() || null;
  if (!PROFILE_ROLES.includes(role)) throw new Error("Invalid role");

  const { supabase } = await requireAdmin();

  const { error } = await supabase.from("profiles").insert({ id: userId, role, display_name: displayName });
  if (error) throw error;

  revalidatePath("/admin/users");
}

export async function updateRole(userId: string, formData: FormData) {
  const role = formData.get("role") as ProfileRole;
  if (!PROFILE_ROLES.includes(role)) throw new Error("Invalid role");

  const { supabase } = await requireAdmin();

  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) throw error;

  revalidatePath("/admin/users");
}

export async function revokeUser(userId: string) {
  const { supabase, user } = await requireAdmin();

  if (userId === user.id) throw new Error("Can't revoke your own access");

  const { error } = await supabase.from("profiles").delete().eq("id", userId);
  if (error) throw error;

  revalidatePath("/admin/users");
}

export async function listPendingAndApproved() {
  await requireAdmin();

  const admin = createAdminClient();
  const supabase = await createClient();

  const [{ data: authUsers }, { data: profiles }] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 200 }),
    supabase.from("profiles").select("id, role, display_name, created_at").order("created_at"),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const approved = (profiles ?? []).map((p) => ({
    ...p,
    email: authUsers?.users.find((u) => u.id === p.id)?.email ?? "(unknown)",
  }));

  const pending = (authUsers?.users ?? [])
    .filter((u) => !profileById.has(u.id))
    .map((u) => ({ id: u.id, email: u.email ?? "(no email)", created_at: u.created_at }));

  return { approved, pending };
}
