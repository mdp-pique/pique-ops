-- Count real appeals on review removal cases.
--
-- The case ticket showed "attempt #N" from review_removal_drafts.attempt_number, which
-- counts every row: the n8n monitor's automatic check (violation_types 'DID NOT VIOLATE',
-- nothing drafted or sent) is always row #1, and mistaken logs count too. The team sends
-- at most two appeals to Airbnb, then escalates to Robert (PRD §9).
--
-- An appeal is any draft row that is not the monitor's automatic check and not a
-- no_violation verdict. A new AFTER trigger (named to run after the existing mirror, and
-- exception-safe like it) writes appeals_sent / appeals_rejected into the case ticket's
-- metadata on every insert, update or delete. The existing mirror and the n8n monitor
-- are unchanged.

create or replace function public.tally_review_removal_appeals()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_review_id uuid := coalesce(new.review_id, old.review_id);
begin
  begin
    update public.tickets t
      set metadata = t.metadata || (
        select jsonb_build_object(
          'appeals_sent', count(*) filter (where d.violation_types is distinct from 'DID NOT VIOLATE' and d.status <> 'no_violation'),
          'appeals_rejected', count(*) filter (where d.violation_types is distinct from 'DID NOT VIOLATE' and d.status = 'rejected')
        )
        from public.review_removal_drafts d where d.review_id = v_review_id
      )
    where t.external_ref = 'review_removal:' || v_review_id::text;
  exception when others then
    raise warning 'tally_review_removal_appeals failed for review %: % (%)', v_review_id, sqlerrm, sqlstate;
  end;
  return null;
end;
$function$;

revoke execute on function public.tally_review_removal_appeals() from public, anon, authenticated;

create trigger review_removal_drafts_tally_appeals
  after insert or update or delete on public.review_removal_drafts
  for each row execute function public.tally_review_removal_appeals();

-- Backfill every case.
update public.tickets t
  set metadata = t.metadata || c.counts
from (
  select 'review_removal:' || d.review_id::text as ref,
    jsonb_build_object(
      'appeals_sent', count(*) filter (where d.violation_types is distinct from 'DID NOT VIOLATE' and d.status <> 'no_violation'),
      'appeals_rejected', count(*) filter (where d.violation_types is distinct from 'DID NOT VIOLATE' and d.status = 'rejected')
    ) as counts
  from public.review_removal_drafts d group by d.review_id
) c
where t.external_ref = c.ref and t.type = 'review_removal_case';
