import type { StageKey } from "./mappings";

// Domain sections (PRD §7.1). Views over `tickets` grouped by type - the data
// model doesn't know about them.

export type DomainKey = "reviews" | "maintenance" | "claims" | "requests";

export interface Domain {
  key: DomainKey;
  label: string;
  blurb: string;
  types: string[];
}

export const DOMAINS: Domain[] = [
  {
    key: "reviews",
    label: "Reviews",
    blurb: "Removal appeals, escalations, and fixes guests asked for.",
    types: ["review_flag", "review_removal_case", "review_removal_escalation", "review_action_item", "guest_review_reminder"],
  },
  {
    key: "maintenance",
    label: "Maintenance",
    blurb: "Issues in a unit, entry permission, and lock and camera checks.",
    types: ["maintenance_ticket", "maintenance_access", "property_security_check"],
  },
  {
    key: "claims",
    label: "Claims",
    blurb: "AirCover and Truvi claims against their filing deadline, and guest blocks.",
    types: ["claim_tracker", "guest_block_report"],
  },
  {
    key: "requests",
    label: "Requests",
    blurb: "Small SOP tasks tied to a date on the reservation.",
    types: ["vehicle_registration", "pet_fee", "pack_n_play", "direct_booking_id_check", "guest_vetting", "extension_request"],
  },
];

export function isDomainKey(k: string): k is DomainKey {
  return DOMAINS.some((d) => d.key === k);
}

export function domainFor(key: DomainKey): Domain {
  return DOMAINS.find((d) => d.key === key)!;
}

const DOMAIN_BY_TYPE = new Map(DOMAINS.flatMap((d) => d.types.map((t) => [t, d.key] as const)));

export function domainForType(type: string): DomainKey | null {
  return DOMAIN_BY_TYPE.get(type) ?? null;
}

// ---------- manually creatable types ----------

export interface FieldSpec {
  key: string;
  label: string;
  kind: "text" | "textarea" | "date" | "number" | "select";
  options?: string[];
  placeholder?: string;
  required?: boolean;
}

export type DueRule = "checkin" | "checkout" | "claim_deadline" | "booking_plus_2d" | "none";

export interface TypeSpec {
  type: string;
  domain: DomainKey;
  stage: StageKey | null;
  blurb: string;
  needsReservation: boolean;
  fields: FieldSpec[];
  items: string[];
  /** A textarea field whose lines each become a checklist item (one item per issue). */
  itemsFromField?: string;
  dueRule: DueRule;
}

export const CREATABLE_TYPES: TypeSpec[] = [
  // Reviews
  {
    type: "review_action_item",
    domain: "reviews",
    stage: "accountability",
    blurb: "A guest complained about something fixable - track the fix and the proof.",
    needsReservation: true,
    fields: [
      { key: "complaint", label: "What the guest said", kind: "textarea", required: true },
      { key: "action", label: "What we're doing about it", kind: "textarea" },
    ],
    items: ["Issue checked in the unit", "Fix ordered or done", "Proof photo attached"],
    dueRule: "none",
  },
  {
    type: "guest_review_reminder",
    domain: "reviews",
    stage: "accountability",
    blurb: "Write a review for this guest (bad guests especially - mess, damage, noise, hostility).",
    needsReservation: true,
    fields: [
      { key: "platform", label: "Platform", kind: "select", options: ["Airbnb", "VRBO", "Booking.com"], required: true },
      { key: "reason", label: "Anything to call out", kind: "textarea", placeholder: "Late checkout, left a mess…" },
    ],
    items: ["Review written and submitted"],
    dueRule: "none",
  },
  {
    type: "review_removal_escalation",
    domain: "reviews",
    stage: "accountability",
    blurb: "Removal denied twice - package it for Robert.",
    needsReservation: true,
    fields: [{ key: "grounds", label: "Grounds argued so far", kind: "textarea" }],
    items: ["Sent to Robert", "Robert responded", "Outcome recorded"],
    dueRule: "none",
  },
  // Maintenance
  {
    type: "maintenance_ticket",
    domain: "maintenance",
    stage: "stay",
    blurb: "One visit to a unit. Each issue becomes its own checklist item.",
    needsReservation: false,
    fields: [
      { key: "issues", label: "Issues (one per line)", kind: "textarea", required: true, placeholder: "Dishwasher leaking\nDeck door sticks" },
      { key: "technician", label: "Technician / who's going", kind: "text" },
    ],
    items: [],
    itemsFromField: "issues",
    dueRule: "none",
  },
  {
    type: "maintenance_access",
    domain: "maintenance",
    stage: "stay",
    blurb: "A technician needs to enter while a guest is staying. 24h notice, or the guest's permission.",
    needsReservation: true,
    fields: [
      { key: "visit_at", label: "Visit date", kind: "date", required: true },
      { key: "reason", label: "Reason for entry", kind: "text" },
    ],
    items: ["Guest notified", "24h notice given or guest permission confirmed"],
    dueRule: "none",
  },
  // Claims
  {
    type: "claim_tracker",
    domain: "claims",
    stage: "accountability",
    blurb: "Damage claim. Deadline is set from checkout: AirCover 14 days, Truvi 30.",
    needsReservation: true,
    fields: [
      { key: "platform", label: "Claim through", kind: "select", options: ["AirCover", "Truvi"], required: true },
      { key: "charges_summary", label: "Summary of charges", kind: "textarea", required: true },
      { key: "amount", label: "Amount claimed ($)", kind: "number" },
    ],
    items: [
      "Before/after photos (wide + close-up)",
      "Receipts or estimates",
      "Third-party invoice",
      "Proof guest accepted house rules",
      "Claim filed",
    ],
    dueRule: "claim_deadline",
  },
  {
    type: "guest_block_report",
    domain: "claims",
    stage: "accountability",
    blurb: "Block or report a guest (hostile, abusive, damage). Done in the platform UI; tracked here.",
    needsReservation: true,
    fields: [
      { key: "reason", label: "Reason", kind: "textarea", required: true },
      { key: "case_id", label: "Platform case ID", kind: "text" },
    ],
    items: ["Guest blocked", "Reported to platform"],
    dueRule: "none",
  },
  // Requests
  {
    type: "vehicle_registration",
    domain: "requests",
    stage: "checkin",
    blurb: "Register the guest's vehicle with the building before they arrive (unregistered cars get fined).",
    needsReservation: true,
    fields: [
      { key: "plate", label: "Licence plate", kind: "text" },
      { key: "vehicle", label: "Make / model / colour", kind: "text" },
    ],
    items: ["Plate received from guest", "Registered with building"],
    dueRule: "checkin",
  },
  {
    type: "pet_fee",
    domain: "requests",
    stage: "book",
    blurb: "Guest has pets - request the fee and make sure it's collected.",
    needsReservation: true,
    fields: [
      { key: "pet_count", label: "Number of pets", kind: "number" },
      { key: "amount", label: "Fee ($)", kind: "number" },
    ],
    items: ["Fee requested", "Fee collected"],
    dueRule: "booking_plus_2d",
  },
  {
    type: "pack_n_play",
    domain: "requests",
    stage: "checkin",
    blurb: "Pack 'n play requested - make sure it's in the unit before check-in.",
    needsReservation: true,
    fields: [],
    items: ["Delivered to unit"],
    dueRule: "checkin",
  },
  {
    type: "direct_booking_id_check",
    domain: "requests",
    stage: "book",
    blurb: "Direct booking - collect ID and confirm the purpose of the trip before check-in.",
    needsReservation: true,
    fields: [{ key: "purpose", label: "Purpose of trip", kind: "text" }],
    items: ["ID collected", "Purpose of trip confirmed", "Pet count confirmed"],
    dueRule: "checkin",
  },
  {
    type: "guest_vetting",
    domain: "requests",
    stage: "book",
    blurb: "Guest has no, few, or bad reviews - vet them before the stay.",
    needsReservation: true,
    fields: [{ key: "concern", label: "What's the concern", kind: "textarea" }],
    items: ["Guest history reviewed", "Decision made (keep / cancel)"],
    dueRule: "checkin",
  },
  {
    type: "extension_request",
    domain: "requests",
    stage: "stay",
    blurb: "Guest asked to extend their stay.",
    needsReservation: true,
    fields: [{ key: "requested_until", label: "Wants to stay until", kind: "date" }],
    items: ["Availability checked", "Replied to guest"],
    dueRule: "none",
  },
];

const SPEC_BY_TYPE = new Map(CREATABLE_TYPES.map((s) => [s.type, s]));

export function specFor(type: string): TypeSpec | null {
  return SPEC_BY_TYPE.get(type) ?? null;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Default due date (YYYY-MM-DD, property-local) for a new ticket, or null if the type has no natural deadline. */
export function defaultDueDate(
  spec: TypeSpec,
  res: { checkIn: string; checkOut: string; bookedAt?: string | null } | null,
  fields: Record<string, string>,
  today: string,
): string | null {
  switch (spec.dueRule) {
    case "checkin":
      return res?.checkIn ?? null;
    case "checkout":
      return res?.checkOut ?? null;
    case "claim_deadline":
      return res ? addDays(res.checkOut, fields.platform === "Truvi" ? 30 : 14) : null;
    case "booking_plus_2d":
      return addDays(res?.bookedAt?.slice(0, 10) ?? today, 2);
    default:
      return null;
  }
}
