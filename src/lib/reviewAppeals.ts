/**
 * What counts as an appeal on a review removal case. review_removal_drafts also holds
 * the n8n monitor's automatic check (violation_types 'DID NOT VIOLATE', nothing sent)
 * and no_violation verdicts; neither went to Airbnb. Keep in sync with the SQL in
 * tally_review_removal_appeals (migration 20261001000000).
 */
export const MAX_AIRBNB_APPEALS = 2;

export function isAppeal(a: { violationTypes: string | null; status: string }): boolean {
  return a.violationTypes !== "DID NOT VIOLATE" && a.status !== "no_violation";
}
