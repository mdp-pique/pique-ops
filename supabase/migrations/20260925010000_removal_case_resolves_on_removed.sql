-- A removal attempt marked 'removed' (Airbnb took the review down) now resolves
-- its review_removal_case ticket. Before this, only 'no_violation' closed the
-- ticket, so won cases sat open forever. 'rejected' / 'sent' / 'pending' keep
-- the ticket open on purpose: the next step is a retry, an escalation, or
-- waiting on Airbnb.
--
-- Same function as 20260918233000 otherwise: still exception-safe, still never
-- blocks the write to review_removal_drafts.

create or replace function public.mirror_review_removal_draft_to_ticket()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ticket_id uuid;
  v_prior_status text;
  v_property_id uuid;
  v_reservation_id uuid;
  v_ext_ref text;
  v_new_status text;
begin
  begin
    v_ext_ref := 'review_removal:' || new.review_id::text;

    select rv.property_id, rv.reservation_id into v_property_id, v_reservation_id
    from public.reviews rv where rv.id = new.review_id;

    select t.id, t.status into v_ticket_id, v_prior_status
    from public.tickets t where t.external_ref = v_ext_ref;

    v_new_status := case
      when new.status = 'no_violation' then 'closed'
      when new.status = 'removed' then 'resolved'
      else 'open'
    end;

    if v_ticket_id is null then
      insert into public.tickets (
        type, status, priority, stage, property_id, reservation_id, guest_name, source, external_ref, metadata, closed_at
      ) values (
        'review_removal_case', v_new_status, 'normal', 'accountability', v_property_id, v_reservation_id, new.guest_name,
        'automation', v_ext_ref,
        jsonb_build_object(
          'review_removal_draft_id', new.id, 'review_id', new.review_id,
          'attempt_number', new.attempt_number, 'violation_types', new.violation_types,
          'draft_status', new.status, 'airbnb_response', new.airbnb_response,
          'mirrored_from', 'review_removal_drafts'
        ),
        case when v_new_status in ('closed', 'resolved') then now() else null end
      ) returning id into v_ticket_id;

      insert into public.ticket_events (ticket_id, event_type, to_value, note)
      values (
        v_ticket_id, 'status_change', v_new_status,
        'Shadow-mirrored from review_removal_drafts, attempt #' || coalesce(new.attempt_number::text, '1') || ' (existing review removal flow unchanged)'
      );
    else
      if v_new_status is distinct from v_prior_status then
        update public.tickets
          set status = v_new_status,
              closed_at = case when v_new_status in ('closed', 'resolved') then now() else null end,
              metadata = metadata || jsonb_build_object(
                'attempt_number', new.attempt_number, 'draft_status', new.status, 'airbnb_response', new.airbnb_response
              )
          where id = v_ticket_id;

        insert into public.ticket_events (ticket_id, event_type, from_value, to_value, note)
        values (v_ticket_id, 'status_change', v_prior_status, v_new_status, 'Mirrored update, attempt #' || coalesce(new.attempt_number::text, '1'));
      else
        update public.tickets
          set metadata = metadata || jsonb_build_object(
                'attempt_number', new.attempt_number, 'draft_status', new.status, 'airbnb_response', new.airbnb_response
              )
          where id = v_ticket_id;
      end if;
    end if;
  exception when others then
    raise warning 'mirror_review_removal_draft_to_ticket failed for draft id %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$function$;

-- No revoke: a trigger function can't be called directly (returns trigger), and
-- the existing grants are left exactly as they were.

-- Backfill: cases whose latest attempt is already 'removed' but whose ticket is still open.
with latest as (
  select distinct on (review_id) review_id, status, attempt_number
  from public.review_removal_drafts
  order by review_id, attempt_number desc nulls last, created_at desc
),
fixed as (
  update public.tickets t
    set status = 'resolved', closed_at = now(),
        metadata = t.metadata || jsonb_build_object('draft_status', 'removed')
  from latest l
  where l.status = 'removed'
    and t.external_ref = 'review_removal:' || l.review_id::text
    and t.status in ('open', 'in_progress', 'blocked')
  returning t.id, l.attempt_number
)
insert into public.ticket_events (ticket_id, event_type, from_value, to_value, note)
select id, 'status_change', 'open', 'resolved', 'Backfill: review was removed (attempt #' || coalesce(attempt_number::text, '1') || ')'
from fixed;
