import { STAGE_KEYS, type StageKey, type StageState, OPEN_STATUSES, ticketSeverity } from "./mappings";
import { bucketFor, currentStageIndex, type Bucket } from "./dates";

export interface StageTicketInfo {
  stage: string | null;
  status: string;
  priority: string;
  sla_breached: boolean;
}

/**
 * Six-slot stage state array for a reservation's spine.
 * Ticket-driven crit/warn wins outright; otherwise ok/now/'' comes from
 * bucket + today vs check_in/check_out (see UI spec §7).
 */
export function computeStages(
  checkIn: string,
  checkOut: string,
  ticketsForRes: StageTicketInfo[],
  bucket: Bucket = bucketFor(checkIn, checkOut),
): StageState[] {
  const openByStage = new Map<StageKey, ("warn" | "crit")[]>();
  for (const t of ticketsForRes) {
    if (!t.stage || !(OPEN_STATUSES as readonly string[]).includes(t.status)) continue;
    const key = t.stage as StageKey;
    const sevs = openByStage.get(key) ?? [];
    sevs.push(ticketSeverity(t));
    openByStage.set(key, sevs);
  }

  const nowIdx = bucket === "future" ? 0 : bucket === "past" ? -1 : currentStageIndex(checkIn, checkOut);

  return STAGE_KEYS.map((key, i) => {
    const sevs = openByStage.get(key);
    if (sevs?.includes("crit")) return "crit";
    if (sevs?.length) return "warn";
    if (bucket === "past") return "ok";
    if (i === nowIdx) return "now";
    if (nowIdx >= 0 && i < nowIdx) return "ok";
    return "";
  });
}
