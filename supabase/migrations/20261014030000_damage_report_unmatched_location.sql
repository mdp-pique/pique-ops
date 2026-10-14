-- record_damage_report() crashed ("record v_res is not assigned yet") when a damage form's Location
-- matched no listing: the stay lookup was skipped, then v_res.id was read. The report was never saved
-- and Pique-Damage-Forms would fail on it every run. Now it saves the report with the listing and stay
-- left empty, like record_connecteam_form() does (MDP sign-off 10-14). Nothing else changes.
create or replace function public.record_damage_report(p_sub jsonb)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_id text := p_sub->>'id';
  v_form text := p_sub->>'form';
  v_inserted text;
  v_property uuid;
  v_when timestamptz := coalesce(nullif(p_sub->>'submitted_at', '')::timestamptz, now());
  v_day date := (v_when at time zone 'America/Edmonton')::date;
  v_res_id uuid;
  v_guest text;
  v_by text;
  v_desc text := coalesce(nullif(trim(p_sub->>'description'), ''), '(no description)');
  v_ticket uuid;
begin
  if v_id is null or v_form not in ('damage', 'linens') then
    return 'skipped';
  end if;

  insert into damage_report_submissions (submission_id, form) values (v_id, v_form)
  on conflict (submission_id) do nothing
  returning submission_id into v_inserted;
  if v_inserted is null then
    return 'seen';
  end if;
  if coalesce((select value from automation_flags where key = 'damage_reports_armed'), 'false') <> 'true' then
    return 'baseline';
  end if;

  v_property := damage_report_property(p_sub->>'location');
  if v_property is not null then
    select r.id, g.full_name into v_res_id, v_guest
    from reservations r left join guests g on g.id = r.guest_id
    where r.property_id = v_property and r.status = 'accepted'
      and r.check_out between v_day - 3 and v_day
    order by r.check_out desc
    limit 1;
  end if;
  select full_name into v_by from connecteam_users where user_id::text = p_sub->>'submitted_by_id';

  insert into tickets (type, status, priority, stage, source, property_id, reservation_id, guest_name, external_ref, metadata)
  values ('damage_report', 'open', 'normal', 'accountability', 'automation', v_property, v_res_id, v_guest,
          'damage:' || v_id,
          jsonb_build_object(
            'title', case v_form when 'linens' then 'Linens damaged' else 'Damage reported' end || ': ' || left(v_desc, 80),
            'form', v_form,
            'location', p_sub->>'location',
            'description', v_desc,
            'photos', coalesce(p_sub->'photos', '[]'::jsonb),
            'videos', coalesce(p_sub->'videos', '[]'::jsonb),
            'submitted_by', v_by,
            'submitted_at', v_when,
            'connecteam_submission_id', v_id))
  on conflict (external_ref) do nothing
  returning id into v_ticket;

  if v_ticket is not null then
    insert into ticket_items (ticket_id, label, sort_order) values (v_ticket, 'Claim or wear and tear decided', 0);
    insert into ticket_events (ticket_id, event_type, to_value, note)
    values (v_ticket, 'status_change', 'open', 'Created automatically from a Connecteam ' ||
            case v_form when 'linens' then 'linens damage' else 'damage' end || ' form' || coalesce(' by ' || v_by, ''));
    update damage_report_submissions set ticket_id = v_ticket where submission_id = v_id;
  end if;
  return 'ticket';
end;
$$;

revoke execute on function public.record_damage_report(jsonb) from public, anon, authenticated;
