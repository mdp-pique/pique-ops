import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role client. Bypasses RLS - server-only, never import from a
 * client component. Used for admin operations like listing auth.users
 * (not exposed via the normal PostgREST API) to find pending sign-ins.
 *
 * Reads PIQUE_SERVICE_ROLE_KEY rather than the more obvious
 * SUPABASE_SERVICE_ROLE_KEY: on this project, Vercel's native Supabase
 * integration appears to own that exact name and resets it to empty on
 * every deploy regardless of what's set manually in the dashboard - a
 * manually-added var under this name survives that.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.PIQUE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
