import { createClient } from "@/lib/supabase/server";
import { PROFILE_ROLES } from "@/lib/types";
import { approveUser, listPendingAndApproved, revokeUser, updateRole } from "./actions";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };

  if (profile?.role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8 text-sm text-gray-400">
        Admin only. Ask an admin if you need access changed.
      </div>
    );
  }

  const { approved, pending, adminApiError } = await listPendingAndApproved();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-lg font-semibold">Team</h1>

      {adminApiError && (
        <div className="mb-6 rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          Couldn&apos;t reach the Supabase admin API, so pending sign-ins can&apos;t be listed right now
          (existing team members below are unaffected). Likely cause: <code>PIQUE_SERVICE_ROLE_KEY</code>{" "}
          is missing or wrong in Vercel&apos;s environment variables.
          <br />
          <span className="text-xs text-red-400">{adminApiError}</span>
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-xs uppercase text-gray-500">
          Pending approval {pending.length > 0 && `(${pending.length})`}
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-500">No one waiting.</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded border border-gray-800 p-3 text-sm">
                <div>
                  <p>{p.email}</p>
                  <p className="text-xs text-gray-500">signed in {new Date(p.created_at).toLocaleString()}</p>
                </div>
                <form action={approveUser.bind(null, p.id)} className="flex items-center gap-2">
                  <input
                    name="display_name"
                    placeholder="Name"
                    className="w-28 rounded border border-gray-700 bg-black px-2 py-1 text-xs"
                  />
                  <select name="role" className="rounded border border-gray-700 bg-black px-2 py-1 text-xs" required>
                    <option value="">role…</option>
                    {PROFILE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button className="rounded bg-white px-3 py-1 text-xs font-medium text-black">Approve</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase text-gray-500">Team ({approved.length})</h2>
        <ul className="space-y-2">
          {approved.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded border border-gray-800 p-3 text-sm">
              <div>
                <p>
                  {p.display_name ?? p.email} <span className="text-gray-500">· {p.email}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <form action={updateRole.bind(null, p.id)} className="flex items-center gap-2">
                  <select
                    name="role"
                    defaultValue={p.role}
                    className="rounded border border-gray-700 bg-black px-2 py-1 text-xs"
                  >
                    {PROFILE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button className="rounded border border-gray-700 px-2 py-1 text-xs hover:bg-gray-900">
                    Update
                  </button>
                </form>
                {p.id !== user?.id && (
                  <form action={revokeUser.bind(null, p.id)}>
                    <button className="text-xs text-red-400 hover:underline">Revoke</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
