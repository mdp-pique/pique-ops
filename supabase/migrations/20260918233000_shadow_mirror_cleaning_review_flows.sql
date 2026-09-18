-- Shadow-mirror three more existing automation outputs into tickets, same
-- pattern and same guarantee as 20260918210000 (unanswered alerts): zero
-- edits to any live n8n workflow, exception-safe (a bug here can never
-- block the original write these workflows already make).
--
-- Explicitly NOT covered here: guest_vetting/fraud-check. That workflow
-- (Pique-Guest-Fraud-Check) never persists its verdict to any table - it
-- only posts to Slack - so there is nothing to mirror from. Adding a write
-- to that live workflow is a production edit requiring explicit sign-off,
-- not an additive shadow-mirror. Skipped until that decision is made.

-- ---------------------------------------------------------------------------
-- cleaning_shift_check (flag = 'no_show') -> cleaner_late_noshow tickets
-- ---------------------------------------------------------------------------
create or replace function public.mirror_noshow_to_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_id uuid;
  v_prior_status text;
  v_property_id uuid;
  v_ext_ref text;
begin
  begin
    v_ext_ref := 'noshow:' || new.shift_id || ':' || new.check_date::text;

    if new.flag = 'no_show' then
      select cjm.property_id into v_property_id
      from public.cleaning_job_map cjm
      where cjm.connecteam_job_id = new.connecteam_job_id
      limit 1;

      select t.id, t.status into v_ticket_id, v_prior_status
      from public.tickets t where t.external_ref = v_ext_ref;

      if v_ticket_id is null then
        insert into public.tickets (
          type, status, priority, stage, property_id, source, external_ref, staff_ref, metadata
        ) values (
          'cleaner_late_noshow', 'open', 'high', 'turnover', v_property_id, 'automation', v_ext_ref,
          (new.assigned_user_ids ->> 0),
          jsonb_build_object(
            'shift_id', new.shift_id, 'check_date', new.check_date, 'connecteam_job_id', new.connecteam_job_id,
            'shift_start', new.shift_start, 'shift_end', new.shift_end, 'assigned_user_ids', new.assigned_user_ids,
            'mirrored_from', 'cleaning_shift_check'
          )
        ) returning id into v_ticket_id;

        insert into public.ticket_events (ticket_id, event_type, to_value, note)
        values (v_ticket_id, 'status_change', 'open', 'Shadow-mirrored from cleaning_shift_check (existing no-show check unchanged)');
      end if;

    elsif new.flag = 'ok' then
      select t.id, t.status into v_ticket_id, v_prior_status
      from public.tickets t where t.external_ref = v_ext_ref;

      if v_ticket_id is not null and v_prior_status not in ('resolved', 'closed') then
        update public.tickets set status = 'resolved', closed_at = now() where id = v_ticket_id;
        insert into public.ticket_events (ticket_id, event_type, from_value, to_value, note)
        values (v_ticket_id, 'status_change', v_prior_status, 'resolved', 'Mirrored resolution: flag reverted to ok');
      end if;
    end if;
  exception when others then
    raise warning 'mirror_noshow_to_ticket failed for shift % / %: % (%)', new.shift_id, new.check_date, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

comment on function public.mirror_noshow_to_ticket is
  'Shadow-copies cleaning_shift_check no-show flags into tickets. Bridge only, exception-safe. See 20260918233000 migration comment.';

create trigger cleaning_shift_check_mirror_to_tickets
  after insert or update on public.cleaning_shift_check
  for each row execute function public.mirror_noshow_to_ticket();

-- ---------------------------------------------------------------------------
-- review_flags -> review_flag tickets (new type; PRD had no exact match for
-- this suppression-decision stage - review_removal_case below is the
-- distinct downstream "drafted an actual removal request" stage)
-- ---------------------------------------------------------------------------
create or replace function public.mirror_review_flag_to_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_id uuid;
  v_prior_status text;
  v_property_id uuid;
  v_reservation_id uuid;
  v_ext_ref text;
  v_new_status text;
  v_priority text;
begin
  begin
    v_ext_ref := 'review_flag:' || new.id::text;

    begin
      v_reservation_id := new.reservation_uuid::uuid;
    exception when others then
      v_reservation_id := null;
    end;

    if v_reservation_id is not null then
      select r.property_id into v_property_id from public.reservations r where r.id = v_reservation_id;
    end if;

    select t.id, t.status into v_ticket_id, v_prior_status
    from public.tickets t where t.external_ref = v_ext_ref;

    v_new_status := case when new.status = 'suppressed' then 'resolved' else 'open' end;
    v_priority := case when new.severity = 'high' then 'high' when new.severity = 'low' then 'low' else 'normal' end;

    if v_ticket_id is null then
      insert into public.tickets (
        type, status, priority, stage, property_id, reservation_id, guest_name, source, external_ref, metadata, closed_at
      ) values (
        'review_flag', v_new_status, v_priority, 'accountability', v_property_id, v_reservation_id, new.guest_name,
        'automation', v_ext_ref,
        jsonb_build_object(
          'review_flags_id', new.id, 'severity', new.severity, 'reason', new.reason,
          'evidence_snippet', new.evidence_snippet, 'agent_verdict', new.agent_verdict,
          'slack_channel', new.slack_channel, 'slack_ts', new.slack_ts,
          'mirrored_from', 'review_flags'
        ),
        case when v_new_status = 'resolved' then now() else null end
      ) returning id into v_ticket_id;

      insert into public.ticket_events (ticket_id, event_type, to_value, note)
      values (v_ticket_id, 'status_change', v_new_status, 'Shadow-mirrored from review_flags (existing review suppression flow unchanged)');
    else
      if v_new_status is distinct from v_prior_status then
        update public.tickets
          set status = v_new_status,
              priority = v_priority,
              closed_at = case when v_new_status = 'resolved' then now() else null end,
              metadata = metadata || jsonb_build_object('review_flags_status', new.status, 'decided_by', new.decided_by, 'decided_at', new.decided_at)
          where id = v_ticket_id;

        insert into public.ticket_events (ticket_id, event_type, from_value, to_value, note)
        values (v_ticket_id, 'status_change', v_prior_status, v_new_status, 'Mirrored: review_flags status -> ' || new.status);
      else
        update public.tickets
          set priority = v_priority,
              metadata = metadata || jsonb_build_object('review_flags_status', new.status, 'decided_by', new.decided_by, 'decided_at', new.decided_at)
          where id = v_ticket_id;
      end if;
    end if;
  exception when others then
    raise warning 'mirror_review_flag_to_ticket failed for review_flags id %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

comment on function public.mirror_review_flag_to_ticket is
  'Shadow-copies review_flags rows into tickets. Bridge only, exception-safe. See 20260918233000 migration comment.';

create trigger review_flags_mirror_to_tickets
  after insert or update on public.review_flags
  for each row execute function public.mirror_review_flag_to_ticket();

-- ---------------------------------------------------------------------------
-- review_removal_drafts -> review_removal_case tickets (PRD's actual
-- removal-request/attempt-tracking type; one ticket per review_id,
-- attempts tracked in metadata as they roll in)
-- ---------------------------------------------------------------------------
create or replace function public.mirror_review_removal_draft_to_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

    v_new_status := case when new.status = 'no_violation' then 'closed' else 'open' end;

    if v_ticket_id is null then
      insert into public.tickets (
        type, status, priority, stage, property_id, reservation_id, guest_name, source, external_ref, metadata, closed_at
      ) values (
        'review_removal_case', v_new_status, 'normal', 'accountability', v_property_id, v_reservation_id,
        new.guest_name, 'automation', v_ext_ref,
        jsonb_build_object(
          'review_removal_draft_id', new.id, 'review_id', new.review_id, 'attempt_number', new.attempt_number,
          'violation_types', new.violation_types, 'draft_status', new.status, 'airbnb_response', new.airbnb_response,
          'mirrored_from', 'review_removal_drafts'
        ),
        case when v_new_status = 'closed' then now() else null end
      ) returning id into v_ticket_id;

      insert into public.ticket_events (ticket_id, event_type, to_value, note)
      values (
        v_ticket_id, 'status_change', v_new_status,
        'Shadow-mirrored from review_removal_drafts, attempt #' || coalesce(new.attempt_number::text, '1') ||
        ' (existing review removal flow unchanged)'
      );
    else
      if v_new_status is distinct from v_prior_status then
        update public.tickets
          set status = v_new_status,
              closed_at = case when v_new_status = 'closed' then now() else null end,
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
$$;

comment on function public.mirror_review_removal_draft_to_ticket is
  'Shadow-copies review_removal_drafts rows into tickets. Bridge only, exception-safe. See 20260918233000 migration comment.';

create trigger review_removal_drafts_mirror_to_tickets
  after insert or update on public.review_removal_drafts
  for each row execute function public.mirror_review_removal_draft_to_ticket();

-- ---------------------------------------------------------------------------
-- Backfill: no-op self-updates fire each AFTER UPDATE trigger above for
-- every existing row without changing any source data.
-- ---------------------------------------------------------------------------
update public.cleaning_shift_check set flag = flag;
update public.review_flags set status = status;
update public.review_removal_drafts set status = status;
