import { STAGE_LABELS_LG, STAGE_LABELS_SM, type StageState } from "@/lib/pique-ui/mappings";

export function Spine({ stages, lg = false }: { stages: StageState[]; lg?: boolean }) {
  const labels = lg ? STAGE_LABELS_LG : STAGE_LABELS_SM;
  return (
    <div className={`spine ${lg ? "lg" : ""}`} aria-label="Reservation stages">
      {labels.map((label, i) => (
        <div key={label} className={`st ${stages[i] ?? ""}`}>
          <i />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
