import { createAdminClient } from "@/lib/supabase/admin";
import { domainForType } from "@/lib/pique-ui/domains";
import { appUrl, resolveActor } from "./data";
import { botToken, slackApi } from "./slack";

type Admin = ReturnType<typeof createAdminClient>;

export type SlackFile = {
  id: string;
  name?: string;
  mimetype?: string;
  size?: number;
  mode?: string;
  url_private_download?: string;
  url_private?: string;
  thumb_1024?: string;
};

const BUCKET = "ticket-attachments";

/** Bigger files stay in Slack (the reply says so); a long video would outlast the request. */
const MAX_BYTES = 100 * 1024 * 1024;

/**
 * Photos and videos posted in the thread under a Pique-a-choo post about one ticket (e.g. a damage
 * report) are saved to that ticket (MDP 10-10): ticket-attachments storage plus a ticket_attachments
 * row, so they show under Attachments on the ticket page. Needs the Slack app's files:read scope.
 * Each file is saved once (its path carries the Slack file id). A post about several tickets (the
 * 7 AM post) can't say which ticket they belong to, so it answers that instead.
 */
export async function saveThreadFiles(admin: Admin, m: { channel: string; threadTs: string; ts: string; user: string; files: SlackFile[] }) {
  const { data: post } = await admin
    .from("pique_bot_posts")
    .select("ticket_ids")
    .eq("channel_id", m.channel)
    .eq("slack_ts", m.threadTs)
    .limit(1)
    .maybeSingle();
  const ids = (post?.ticket_ids ?? []) as string[];
  if (!post || !ids.length) return; // Not under a Pique-a-choo ticket post: someone else's thread.
  if (ids.length > 1) {
    await slackApi("chat.postMessage", {
      channel: m.channel,
      thread_ts: m.threadTs,
      text: "This post covers several tickets, so I can't tell which one these go with. Post them in the thread of that ticket's own post, or add them on the ticket in the app (Add photo).",
    });
    return;
  }
  const ticketId = ids[0];
  const { data: ticket } = await admin.from("tickets").select("id, type").eq("id", ticketId).maybeSingle();
  if (!ticket) return;
  const actor = await resolveActor(admin, m.user, "");

  const saved: { kind: string; fileId: string }[] = [];
  const skipped: string[] = [];
  for (const file of m.files) {
    const result = await saveOne(admin, ticketId, file, actor.profileId);
    if (result === "saved-photo" || result === "saved-video" || result === "saved-file") saved.push({ kind: result.slice(6), fileId: file.id });
    else if (result !== "duplicate") skipped.push(`${file.name ?? "a file"} (${result})`);
  }
  if (!saved.length && !skipped.length) return;

  if (saved.length) {
    await admin.from("ticket_events").insert({
      ticket_id: ticketId,
      event_type: "comment",
      actor_id: actor.profileId,
      note: `${actor.name || "Someone"} added ${describe(saved)} from Slack`,
      payload: { source: "pique_bot", kind: "slack_files", slack_files: saved.map((s) => s.fileId), slack_ts: m.ts, channel: m.channel },
    });
  }
  const url = appUrl();
  const link = url ? ` · <${url}/tickets/${domainForType(ticket.type) ?? "requests"}?ticket=${ticketId}|Open>` : "";
  const lines = [];
  if (saved.length) lines.push(`:paperclip: Added ${describe(saved)} to the ticket${link}`);
  if (skipped.length) lines.push(`Couldn't add: ${skipped.join(", ")}`);
  await slackApi("chat.postMessage", { channel: m.channel, thread_ts: m.threadTs, text: lines.join("\n"), unfurl_links: false });
}

type SaveResult = "saved-photo" | "saved-video" | "saved-file" | "duplicate" | string;

async function saveOne(admin: Admin, ticketId: string, given: SlackFile, uploadedBy: string | null): Promise<SaveResult> {
  // Slack sometimes sends only the file id ("file_access": "check_file_info"); look the rest up.
  let file = given;
  if (!file.url_private_download && !file.url_private) {
    const info = await slackApi<{ file?: SlackFile }>("files.info", { file: file.id });
    if (info.ok && info.file) file = info.file;
  }
  if (file.mode === "tombstone" || file.mode === "hidden_by_limit" || file.mode === "external") return "not available";
  if ((file.size ?? 0) > MAX_BYTES) return "too big, over 100 MB";

  let mime = file.mimetype ?? "application/octet-stream";
  let source = file.url_private_download ?? file.url_private;
  // iPhone photos come as HEIC, which most browsers can't show; Slack's JPEG preview can be.
  if (/^image\/hei[cf]$/.test(mime) && file.thumb_1024) {
    source = file.thumb_1024;
    mime = "image/jpeg";
  }
  if (!source) return "no download link";

  const safeName = (file.name ?? "file").replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${ticketId}/slack-${file.id}-${mime === "image/jpeg" && !/\.jpe?g$/i.test(safeName) ? `${safeName}.jpg` : safeName}`;
  const { data: existing } = await admin.from("ticket_attachments").select("id").eq("storage_path", path).limit(1);
  if (existing?.length) return "duplicate";

  let body: ArrayBuffer;
  try {
    const res = await fetch(source, { headers: { Authorization: `Bearer ${botToken()}` } });
    // Without files:read Slack answers with its sign-in page instead of the file.
    if (!res.ok || (res.headers.get("content-type") ?? "").startsWith("text/html")) {
      console.error(`Pique-a-choo: Slack file ${file.id} download failed (${res.status})`);
      return "couldn't download it from Slack";
    }
    body = await res.arrayBuffer();
  } catch (e) {
    console.error(`Pique-a-choo: Slack file ${file.id} download failed: ${(e as Error).message}`);
    return "couldn't download it from Slack";
  }

  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, body, { contentType: mime, upsert: false });
  if (uploadError && !/exists/i.test(uploadError.message)) {
    console.error(`Pique-a-choo: saving Slack file ${file.id} failed: ${uploadError.message}`);
    return "couldn't save it";
  }
  const kind = mime.startsWith("image/") ? "photo" : mime.startsWith("video/") ? "video" : "file";
  // The table's kinds are photo / document / audio; a video is stored as a document and the
  // ticket page labels it by its extension.
  const { error } = await admin.from("ticket_attachments").insert({ ticket_id: ticketId, storage_path: path, kind: kind === "photo" ? "photo" : "document", uploaded_by: uploadedBy });
  if (error) {
    console.error(`Pique-a-choo: attachment row for Slack file ${file.id} failed: ${error.message}`);
    return "couldn't save it";
  }
  return `saved-${kind}`;
}

function describe(saved: { kind: string }[]): string {
  const count = (k: string, word: string) => {
    const n = saved.filter((s) => s.kind === k).length;
    return n ? `${n} ${word}${n === 1 ? "" : "s"}` : null;
  };
  return [count("photo", "photo"), count("video", "video"), count("file", "file")].filter(Boolean).join(" and ");
}
