export const STAGE_KEYS = ["book", "checkin", "stay", "checkout", "turnover", "accountability"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const STAGE_LABELS_LG = ["Book", "Check-in", "Stay", "Check-out", "Turnover", "Account"];
export const STAGE_LABELS_SM = ["Book", "In", "Stay", "Out", "Turn", "Acct"];

export type StageState = "ok" | "warn" | "crit" | "now" | "";

const TAG_CLASS_BY_TYPE: Record<string, string> = {
  maintenance_ticket: "maint",
  maintenance_access: "maint",
  cleaning_issue: "clean",
  cleaner_late_noshow: "clean",
  incomplete_cleaning_form: "clean",
  qc_inspection: "clean",
  cleaning_overtime_approval: "clean",
  review_removal_case: "review",
  review_removal_escalation: "review",
  review_action_item: "review",
  guest_review_reminder: "review",
  review_flag: "review",
  guest_vetting: "vet",
  direct_booking_id_check: "vet",
  pack_n_play: "vet",
  pet_fee: "vet",
  claim_tracker: "claim",
  unanswered_message: "msg",
  missed_call: "msg",
  extension_request: "msg",
};

export function ticketTagClass(type: string): string {
  return TAG_CLASS_BY_TYPE[type] ?? "msg";
}

export function typesForTagClass(cls: string): string[] {
  return Object.entries(TAG_CLASS_BY_TYPE)
    .filter(([, c]) => c === cls)
    .map(([type]) => type);
}

const TYPE_LABELS: Record<string, string> = {
  maintenance_ticket: "Maintenance",
  maintenance_access: "Maintenance access",
  cleaning_issue: "Cleaning issue",
  cleaner_late_noshow: "Cleaner no-show",
  incomplete_cleaning_form: "Incomplete cleaning form",
  qc_inspection: "QC inspection",
  cleaning_overtime_approval: "Cleaning overtime",
  review_removal_case: "Review removal",
  review_removal_escalation: "Review removal escalation",
  review_action_item: "Review action",
  guest_review_reminder: "Review reminder",
  review_flag: "Review flag",
  guest_vetting: "Guest vetting",
  direct_booking_id_check: "Direct booking ID check",
  pack_n_play: "Pack 'n play",
  pet_fee: "Pet fee",
  claim_tracker: "Claim",
  unanswered_message: "Unanswered message",
  missed_call: "Missed call",
  extension_request: "Extension request",
  system_health: "System health",
};

export function ticketTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export const QUEUE_TYPE_FILTERS = [
  { key: "all", label: "All" },
  { key: "maint", label: "Maintenance" },
  { key: "clean", label: "Cleaning" },
  { key: "review", label: "Reviews" },
  { key: "vet", label: "Vetting" },
  { key: "msg", label: "Messages" },
  { key: "claim", label: "Claims" },
] as const;

export function ticketSeverity(t: { status: string; priority: string; sla_breached: boolean }): "warn" | "crit" {
  if (t.status === "blocked" || t.priority === "urgent" || t.sla_breached) return "crit";
  return "warn";
}

export const OPEN_STATUSES = ["open", "in_progress", "blocked"] as const;

export function worstOf(stages: StageState[]): "ok" | "warn" | "crit" {
  if (stages.includes("crit")) return "crit";
  if (stages.includes("warn")) return "warn";
  return "ok";
}
