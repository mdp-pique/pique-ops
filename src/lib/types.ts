export type TicketStatus = "open" | "in_progress" | "blocked" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStage = "book" | "checkin" | "stay" | "checkout" | "turnover" | "accountability";

export const TICKET_STATUSES: TicketStatus[] = ["open", "in_progress", "blocked", "resolved", "closed"];

export type ProfileRole = "admin" | "ops_manager" | "customer_service" | "cleaning_coordinator" | "finance";
export const PROFILE_ROLES: ProfileRole[] = [
  "admin",
  "ops_manager",
  "customer_service",
  "cleaning_coordinator",
  "finance",
];

export interface Profile {
  id: string;
  role: string;
  display_name: string | null;
}
