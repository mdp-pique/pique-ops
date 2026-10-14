-- Two more Connecteam form Zaps, found 10-14 (MDP): "Connecteam to Slack - Linen and Bedding Refresh"
-- (form 10267865) and "Connecteam to Slack - Winterization" (form 14126323). Pique-Connecteam-Forms now
-- reads both too and calls record_connecteam_form():
--  * linens        -> one linen_refresh ticket (linen_refresh:{submission}): location, what's needed and
--                     why, photos (shown in the app's gallery), submitter. Posted in
--                     #linen-and-bedding-refresh-notification.
--  * winterization -> one winterization_check ticket (winterization:{submission}): the address the
--                     cleaner checked in at, the yes/no battery checks (high priority when one is No),
--                     which photo tasks were done, notes and all photos. Posted in
--                     #damages-complaints-refunds-notification, where the Zap posted. The Zap's own
--                     fields ("Describe Damage", "Upload video of damage") are from an older version of
--                     the form and no longer exist, so this follows the form as it is now.
-- Checklist "Reviewed", like the other forms. connecteam_forms_armed is already true; neither form has
-- had a submission in the last 3 days, so nothing old is ticketed.

alter table public.connecteam_form_submissions drop constraint connecteam_form_submissions_form_check;
alter table public.connecteam_form_submissions add constraint connecteam_form_submissions_form_check
  check (form in ('qc', 'order', 'linens', 'winterization'));

insert into ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values ('linen_refresh', 'created', 'start', interval '2 days', null, false, null, interval '8 hours', null, true),
       ('winterization_check', 'created', 'start', interval '2 days', null, false, null, interval '8 hours', null, true)
on conflict (type) do nothing;

-- p_sub: id, form ('qc' | 'order' | 'linens' | 'winterization'), submitted_at (ISO), submitted_by_id, location, and
--   qc:            clean_date (ISO), checks [{label, yes}], notes
--   order:         needed
--   linens:        request, photos [url]
--   winterization: checks [{label, yes}], tasks [{label, photos}], photos [url], notes
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
  if v_id is null or v_form is null or v_form not in ('qc', 'order', 'linens', 'winterization') then
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
  elsif v_form = 'order' then
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
  elsif v_form = 'linens' then
    insert into tickets (type, status, priority, stage, source, property_id, external_ref, metadata)
    values ('linen_refresh', 'open', 'normal', 'turnover', 'automation', v_property, 'linen_refresh:' || v_id,
            jsonb_build_object(
              'title', 'Linen refresh: ' || v_location,
              'form', 'linens',
              'location', p_sub->>'location',
              'request', coalesce(nullif(trim(p_sub->>'request'), ''), '(nothing listed)'),
              'photos', coalesce(p_sub->'photos', '[]'::jsonb),
              'submitted_by', v_by,
              'submitted_at', v_when,
              'connecteam_submission_id', v_id))
    on conflict (external_ref) do nothing
    returning id into v_ticket;
  else
    select array_agg(c->>'label') into v_failed
    from jsonb_array_elements(coalesce(p_sub->'checks', '[]'::jsonb)) c
    where not coalesce((c->>'yes')::boolean, false);

    insert into tickets (type, status, priority, stage, source, property_id, external_ref, metadata)
    values ('winterization_check', 'open', case when v_failed is not null then 'high' else 'normal' end, 'stay', 'automation',
            v_property, 'winterization:' || v_id,
            jsonb_build_object(
              'title', 'Winterization checklist: ' || v_location || case when v_failed is not null then ' (not done: ' || array_to_string(v_failed, ', ') || ')' else '' end,
              'form', 'winterization',
              'location', p_sub->>'location',
              'checks', coalesce(p_sub->'checks', '[]'::jsonb),
              'missing', coalesce(to_jsonb(v_failed), '[]'::jsonb),
              'tasks', coalesce(p_sub->'tasks', '[]'::jsonb),
              'photos', coalesce(p_sub->'photos', '[]'::jsonb),
              'notes', v_notes,
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
            case v_form when 'qc' then 'Cleaning Quality Check' when 'order' then 'Supply Order'
                        when 'linens' then 'Linen and Bedding Refresh' else 'Winterization' end
            || ' form' || coalesce(' by ' || v_by, ''));
    update connecteam_form_submissions set ticket_id = v_ticket where submission_id = v_id;
  end if;
  return 'ticket';
end;
$$;

revoke execute on function public.record_connecteam_form(jsonb) from public, anon, authenticated;
