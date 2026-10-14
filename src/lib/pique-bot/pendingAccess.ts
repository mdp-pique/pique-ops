import { createAdminClient } from "@/lib/supabase/admin";
import { ESCALATE_PROFILE_ID } from "./config";
import { appUrl } from "./data";
import { slackApi } from "./slack";

/**
 * Someone signed in with no Pique Ops profile is stuck on "Access pending" until an admin adds
 * them. DMs ESCALATE_PROFILE_ID (MDP) once per person, as Pique-a-choo, with a link to Admin > Users
 * (MDP 10-14: keep admin approval, but hear about it). Claimed in pending_access_notices; a failed
 * DM releases the claim so the next visit tries again.
 */
export async function notifyPendingAccess(user: { id: string; email?: string | null; name?: string | null }) {
  const admin = createAdminClient();
  const { data: claimed } = await admin
    .from("pending_access_notices")
    .upsert({ user_id: user.id, email: user.email ?? null }, { onConflict: "user_id", ignoreDuplicates: true })
    .select("user_id");
  if (!claimed?.length) return;

  const { data: approver } = await admin.from("profiles").select("slack_user_id").eq("id", ESCALATE_PROFILE_ID).maybeSingle();
  const who = [user.name, user.email].filter(Boolean).join(" · ") || "Someone";
  const base = appUrl();
  const link = base ? ` <${base}/admin/users|Add them in Admin > Users>` : " Add them in Admin > Users.";
  const res = approver?.slack_user_id
    ? await slackApi("chat.postMessage", { channel: approver.slack_user_id, text: `${who} signed in to Pique Ops and is waiting on Access pending.${link}` })
    : { ok: false, error: "no Slack account for the approver" };
  if (!res.ok) {
    console.error(`Pique Bot: pending access DM failed: ${res.error}`);
    await admin.from("pending_access_notices").delete().eq("user_id", user.id);
    return;
  }
  await admin.from("pending_access_notices").update({ notified_at: new Date().toISOString() }).eq("user_id", user.id);
}
