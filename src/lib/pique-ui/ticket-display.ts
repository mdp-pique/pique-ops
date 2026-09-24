import { ticketTypeLabel } from "./mappings";

type Metadata = Record<string, unknown>;

/**
 * Unanswered-message tickets don't carry guest_name or the message body in
 * their own columns (the shadow-mirror trigger only copied ids/Slack refs) -
 * both are joined in separately by the caller. Prefer the real message text
 * when we have it; fall back to guest name; fall back to a generic label
 * only when we truly know nothing.
 */
export function unansweredMessageTitle(guestName: string | null, messageBody: string | null): string {
  if (messageBody?.trim()) {
    const snippet = messageBody.length > 70 ? `${messageBody.slice(0, 70)}…` : messageBody;
    return guestName ? `${guestName}: “${snippet}”` : `“${snippet}”`;
  }
  if (guestName) return `${guestName} needs a reply`;
  return "Guest message needs a reply";
}

/** Tickets have no free-text title column by design (PRD §5: type-specific fields live in metadata). Derive a readable one per type from what each shadow-mirror trigger actually stores. */
export function ticketTitle(t: { type: string; metadata: Metadata }): string {
  const m = t.metadata ?? {};
  switch (t.type) {
    case "unanswered_message":
      return "Guest message needs a reply";
    case "cleaner_late_noshow":
      return typeof m.check_date === "string" ? `Cleaner no-show – ${m.check_date} shift` : "Cleaner no-show";
    case "review_flag":
      return typeof m.reason === "string" && m.reason.trim() ? m.reason : "Review flagged for suppression review";
    case "review_removal_case":
      return `Review removal – attempt #${typeof m.attempt_number === "number" ? m.attempt_number : 1}`;
    default:
      // Manually created tickets carry the staff-entered summary.
      return typeof m.title === "string" && m.title.trim() ? m.title : ticketTypeLabel(t.type);
  }
}

export function dueText(t: { due_at: string | null; sla_breached: boolean; created_at: string }): { text: string; late: boolean } {
  if (t.due_at) {
    const due = new Date(t.due_at);
    const late = due.getTime() < Date.now();
    return {
      text: (late ? "Overdue – " : "Due ") + due.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      late: late || t.sla_breached,
    };
  }
  const days = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
  return { text: days <= 0 ? "Opened today" : `Opened ${days}d ago`, late: t.sla_breached };
}
