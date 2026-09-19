import { worstOf, type StageState } from "./mappings";
import type { Bucket } from "./dates";

export function statusPillFor(bucket: Bucket, stages: StageState[]): { variant: "ok" | "warn" | "crit" | "neutral"; label: string } {
  const w = worstOf(stages);

  if (bucket === "future") {
    return w === "ok" ? { variant: "neutral", label: "Pre-arrival clear" } : { variant: w, label: "Needs attention" };
  }
  if (bucket === "current") {
    return w === "ok" ? { variant: "ok", label: "In stay – clear" } : { variant: w, label: "Open during stay" };
  }
  if (w === "ok") return { variant: "ok", label: "Closed clean" };
  if (w === "crit") return { variant: "crit", label: "Accountability open" };
  return { variant: "warn", label: "Follow-up open" };
}
