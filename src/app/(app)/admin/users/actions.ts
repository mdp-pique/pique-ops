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
  const { supabase } = await requireAdmin();

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, role, display_name, created_at")
    .order("created_at");

  if (profilesError) console.error("Failed to load profiles:", profilesError);

  let authUsers: { id: string; email?: string; created_at: string }[] = [];
  let adminApiError: string | null = null;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw error;
    authUsers = data.users;
  } catch (err) {
    console.error("Failed to list auth users (check SUPABASE_SERVICE_ROLE_KEY):", err);
    const message = err instanceof Error ? err.message : "Unknown error calling the Supabase admin API";
    const keyLen = process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0;
    const urlLen = process.env.NEXT_PUBLIC_SUPABASE_URL?.length ?? 0;
    adminApiError = `${message} [debug: SUPABASE_SERVICE_ROLE_KEY seen by server = ${keyLen} chars, NEXT_PUBLIC_SUPABASE_URL = ${urlLen} chars]`;
  }

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const approved = (profiles ?? []).map((p) => ({
    ...p,
    email: authUsers.find((u) => u.id === p.id)?.email ?? "(unknown)",
  }));

  const pending = authUsers
    .filter((u) => !profileById.has(u.id))
    .map((u) => ({ id: u.id, email: u.email ?? "(no email)", created_at: u.created_at }));

  return { approved, pending, adminApiError };
}
