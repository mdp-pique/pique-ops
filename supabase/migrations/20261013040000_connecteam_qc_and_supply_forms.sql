-- Connecteam Cleaning Quality Check form (15052074) and Supply Order form (8341879) -> tickets
-- (replaces the Zaps "Connecteam to Slack - Cleaning QC Form" and "Connecteam Order Form To Slack",
-- docs/zapier-migration.md P2-90 / P2-12). n8n Pique-Connecteam-Forms reads both forms every 5 min
-- (read-only) and calls record_connecteam_form() once per submission: one qc_inspection or
-- supply_order ticket each, which Pique-a-choo posts where the Zap posted (rules in config.ts).

insert into ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values ('supply_order', 'created', 'start', interval '1 day', null, false, null, interval '4 hours', null, true)
on conflict (type) do nothing;

-- Every submission seen, so each makes at most one ticket. The first run only records what is
-- already there (automation_flags.connecteam_forms_armed), like the damage forms.
create table public.connecteam_form_submissions (
  submission_id text primary key,
  form text not null check (form in ('qc', 'order')),
  ticket_id uuid references public.tickets(id) on delete set null,
  first_seen_at timestamptz not null default now()
);
alter table public.connecteam_form_submissions enable row level security;
create policy connecteam_form_submissions_read on public.connecteam_form_submissions for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

insert into public.automation_flags (key, value, note)
values ('connecteam_forms_armed', 'false',
        'Pique-Connecteam-Forms: false = only record existing QC / supply order submissions as seen (first run); true = open tickets.')
on conflict (key) do nothing;

-- p_sub: id, form ('qc' | 'order'), submitted_at (ISO), submitted_by_id, location, and
--   qc:    clean_date (ISO), checks [{label, yes}], notes
--   order: needed
-- Returns 'ticket', 'seen' (already recorded), 'baseline' (not armed yet) or 'skipped'.
create or replace function public.record_connecteam_form(p_sub jsonb)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_id text := p_sub->>'id';
  v_form text := p_sub->>'form';
  v_inserted text;
  v_when timestamptz := coalesce(nullif(p_sub->>'submitted_at', '')::timestamptz, now());
  v_day date;
  v_property uuid;
  v_res_id uuid;
  v_guest text;
  v_by text;
  v_location text := coalesce(nullif(trim(p_sub->>'location'), ''), '(no location)');
  v_failed text[];
  v_notes text := nullif(trim(p_sub->>'notes'), '');
  v_needed text := coalesce(nullif(trim(p_sub->>'needed'), ''), '(nothing listed)');
  v_ticket uuid;
begin
  if v_id is null or v_form not in ('qc', 'order') then
    return 'skipped';
  end if;

  insert into connecteam_form_submissions (submission_id, form) values (v_id, v_form)
  on conflict (submission_id) do nothing
  returning submission_id into v_inserted;
  if v_inserted is null then
    return 'seen';
  end if;
  if coalesce((select value from automation_flags where key = 'connecteam_forms_armed'), 'false') <> 'true' then
    return 'baseline';
  end if;

  v_property := damage_report_property(p_sub->>'location');
  select full_name into v_by from connecteam_users where user_id::text = p_sub->>'submitted_by_id';

  if v_form = 'qc' then
    v_day := coalesce((nullif(p_sub->>'clean_date', '')::timestamptz at time zone 'America/Edmonton')::date,
                      (v_when at time zone 'America/Edmonton')::date);
    -- The stay that checked out on the day of the clean.
    if v_property is not null then
      select r.id, g.full_name into v_res_id, v_guest
      from reservations r left join guests g on g.id = r.guest_id
      where r.property_id = v_property and r.status = 'accepted' and r.check_out between v_day - 1 and v_day
      order by r.check_out desc
      limit 1;
    end if;
    select array_agg(c->>'label') into v_failed
    from jsonb_array_elements(coalesce(p_sub->'checks', '[]'::jsonb)) c
    where not coalesce((c->>'yes')::boolean, false);

    insert into tickets (type, status, priority, stage, source, property_id, reservation_id, guest_name, external_ref, metadata)
    values ('qc_inspection', 'open', case when v_failed is not null then 'high' else 'normal' end, 'turnover', 'automation',
            v_property, v_res_id, v_guest, 'qc_form:' || v_id,
            jsonb_build_object(
              'title', 'Cleaning quality check: ' || v_location || case when v_failed is not null then ' (missing ' || array_to_string(v_failed, ', ') || ')' else '' end,
              'form', 'qc',
              'location', p_sub->>'location',
              'clean_date', v_day,
              'checks', coalesce(p_sub->'checks', '[]'::jsonb),
              'missing', coalesce(to_jsonb(v_failed), '[]'::jsonb),
              'notes', v_notes,
              'submitted_by', v_by,
              'submitted_at', v_when,
              'connecteam_submission_id', v_id))
    on conflict (external_ref) do nothing
    returning id into v_ticket;
  else
    insert into tickets (type, status, priority, stage, source, property_id, external_ref, metadata)
    values ('supply_order', 'open', 'normal', 'turnover', 'automation', v_property, 'supply_order:' || v_id,
            jsonb_build_object(
              'title', 'Supply order: ' || v_location,
              'form', 'order',
              'location', p_sub->>'location',
              'needed', v_needed,
              'submitted_by', v_by,
              'submitted_at', v_when,
              'connecteam_submission_id', v_id))
    on conflict (external_ref) do nothing
    returning id into v_ticket;
  end if;

  if v_ticket is not null then
    insert into ticket_items (ticket_id, label, sort_order) values (v_ticket, 'Reviewed', 0);
    insert into ticket_events (ticket_id, event_type, to_value, note)
    values (v_ticket, 'status_change', 'open', 'Created automatically from the Connecteam ' ||
            case v_form when 'qc' then 'Cleaning Quality Check' else 'Supply Order' end || ' form' || coalesce(' by ' || v_by, ''));
    update connecteam_form_submissions set ticket_id = v_ticket where submission_id = v_id;
  end if;
  return 'ticket';
end;
$$;

revoke execute on function public.record_connecteam_form(jsonb) from public, anon, authenticated;

-- Silence check: the two new ticket types once live, and the forms feed going quiet.
create or replace function public.automation_silence_check()
returns table (check_key text, problem text)
language sql
stable
set search_path = public
as $$
  select 'reservations_sync',
         'No reservation has synced from Hospitable since ' ||
         to_char(max(last_synced_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ' (normally several times a day).'
  from reservations
  having max(last_synced_at) < now() - interval '26 hours'

  union all
  select 'messages_sync',
         'No guest message has come in from Hospitable since ' ||
         to_char(max(created_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || '.'
  from messages
  having max(created_at) < now() - interval '12 hours'

  union all
  select 'connecteam_shifts_sync',
         'The Connecteam schedule copy has not refreshed since ' ||
         to_char(max(last_seen_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ' (normally hourly).'
  from connecteam_shifts
  having max(last_seen_at) < now() - interval '3 hours'

  union all
  select 'booking_feed',
         count(*) || ' new booking(s) from the last day were never posted to #new-reservations (oldest booked ' ||
         to_char(min(r.created_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ').'
  from reservations r
  where r.status = 'accepted'
    and r.created_at between now() - interval '24 hours' and now() - interval '15 minutes'
    -- A listing newly added to Hospitable brings its old bookings with it; the feed skips those.
    and (r.booked_at is null or r.booked_at >= now() - interval '24 hours')
    and not exists (select 1 from pique_bot_booking_posts p where p.reservation_id = r.id)
  having count(*) > 0

  union all
  select 'pique_bot_alerts',
         count(*) || ' live ticket(s) from the last day were never posted by Pique Bot (' ||
         string_agg(distinct coalesce('email:' || (t.metadata->>'rule'), t.type), ', ') || ').'
  from tickets t
  cross join lateral (
    select coalesce(string_to_array(replace(value, ' ', ''), ','), '{}') as live
    from automation_flags where key = 'pique_bot_alerts_live_types'
  ) f
  where t.created_at between now() - interval '24 hours' and now() - interval '15 minutes'
    and (t.created_at at time zone 'America/Edmonton')::time between time '07:00' and time '20:45'
    and (
      (t.type in ('save_booking', 'guest_count_check') and t.type = any (f.live))
      or (t.type = 'email_alert' and 'email:' || (t.metadata->>'rule') = any (f.live))
      or (t.type = 'cleaning_issue' and t.metadata->>'source' = 'review' and 'review_qc' = any (f.live))
      or t.type = 'pet_fee'
      or t.type = 'clean_running_late'
      or (t.type in ('qc_inspection', 'supply_order') and t.type = any (f.live))
    )
    and not exists (
      select 1 from pique_bot_posts p where p.kind = 'alert' and t.id = any (p.ticket_ids)
    )
  having count(*) > 0

  union all
  select 'pique_bot_morning',
         'Pique Bot''s 7 AM check-in has not posted today (it posted yesterday).'
  where (now() at time zone 'America/Edmonton')::time > time '07:30'
    and exists (select 1 from pique_bot_posts where kind = 'morning'
                and post_date = (now() at time zone 'America/Edmonton')::date - 1)
    and not exists (select 1 from pique_bot_posts where kind = 'morning'
                    and post_date = (now() at time zone 'America/Edmonton')::date)

  union all
  select 'email_alerts',
         'No new matching email has been recorded since ' ||
         to_char(max(first_seen_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') ||
         ' - check the Gmail login in n8n.'
  from email_alert_messages
  having max(first_seen_at) < now() - interval '48 hours'

  union all
  select 'changelog',
         count(*) || ' changelog entr' || case when count(*) = 1 then 'y has' else 'ies have' end ||
         ' not been posted to #change-logs (is Pique Bot in the channel?).'
  from changelog_entries
  where slack_ts is null and created_at < now() - interval '1 hour'
  having count(*) > 0

  union all
  select 'review_qc_trigger',
         count(*) || ' new review(s) from the last day have no quality-control record (the reviews trigger may be failing).'
  from reviews r
  where r.created_at between now() - interval '24 hours' and now() - interval '15 minutes'
    and coalesce(nullif(r.raw_hospitable_data->>'reviewed_at', '')::timestamptz, r.review_date::timestamptz) > now() - interval '45 days'
    and not exists (select 1 from review_qc q where q.review_id = r.id)
  having count(*) > 0

  union all
  select 'review_qc_feed',
         count(*) || ' review(s) were never posted to #quality-control-reviews.'
  from review_qc
  where not flagged and slack_ts is null and created_at < now() - interval '1 hour'
    and created_at > now() - interval '3 days'
  having count(*) > 0

  union all
  select 'cleaning_clock_sync',
         'The Connecteam time-clock copy (late-clean alerts) has not refreshed since ' ||
         to_char(max(last_synced_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ' - check n8n Pique-Cleaning-Clock.'
  from cleaning_clock_sessions
  having max(last_synced_at) < now() - interval '26 hours'

  union all
  select 'connecteam_forms',
         'No Connecteam QC or supply order form has been recorded since ' ||
         to_char(max(first_seen_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ' - check n8n Pique-Connecteam-Forms.'
  from connecteam_form_submissions
  having max(first_seen_at) < now() - interval '36 hours'
$$;
