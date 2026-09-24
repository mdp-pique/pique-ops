-- Fix for upsert_parking_ticket: nested payload keys keep their path
-- (e.g. "location.name"), so GHL's business name can't be read as the guest's
-- name; "full name" style keys win over a bare "name".

create or replace function public.upsert_parking_ticket(p_property_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_fields jsonb;
  v_plate text;
  v_vehicle text;
  v_name text;
  v_email text;
  v_conf text;
  v_checkin_raw text;
  v_checkin date;
  v_submission text;
  v_res_id uuid;
  v_res_checkin date;
  v_res_guest text;
  v_matched_by text := 'unmatched';
  v_ref text;
  v_ticket_id uuid;
  v_inserted boolean;
  v_guest text;
  v_meta jsonb;
begin
  if not exists (select 1 from properties where id = p_property_id) then
    raise exception 'Unknown property %', p_property_id;
  end if;

  -- Flatten nested objects into lowercased path -> text value ("location.name"),
  -- so GHL's nested location/workflow fields stay distinguishable from the form's.
  with recursive walk(k, v, depth) as (
    select lower(e.key), e.value, 0 from jsonb_each(coalesce(p_payload, '{}'::jsonb)) e
    union all
    select w.k || '.' || lower(e.key), e.value, w.depth + 1
    from walk w, jsonb_each(w.v) e
    where jsonb_typeof(w.v) = 'object' and w.depth < 4
  )
  select coalesce(jsonb_object_agg(k, v #>> '{}'), '{}'::jsonb) into v_fields
  from (
    select distinct on (k) k, v from walk
    where jsonb_typeof(v) in ('string', 'number') and nullif(trim(v #>> '{}'), '') is not null
    order by k, depth
  ) s;

  select value into v_plate from jsonb_each_text(v_fields)
    where key ~ '(plate|licen[cs]e)' order by length(key) limit 1;
  select string_agg(value, ' ' order by key) into v_vehicle from jsonb_each_text(v_fields)
    where key ~ '(make|model|colou?r|vehicle)' and key !~ '(plate|licen[cs]e)';
  select value into v_name from jsonb_each_text(v_fields)
    where key ~ '(^|\.)(full_?name|guest_?name|contact_?name|name)$'
      and key !~ '^(location|workflow|user|company|attribution|contact\.attribution)'
    order by (key ~ '(full_?name|guest_?name)$') desc, length(key)
    limit 1;
  if v_name is null then
    select nullif(trim(coalesce(v_fields->>'first_name', v_fields->>'contact.first_name', '') || ' ' || coalesce(v_fields->>'last_name', v_fields->>'contact.last_name', '')), '') into v_name;
  end if;
  select value into v_email from jsonb_each_text(v_fields)
    where key ~ 'email' and value ~ '@' and key !~ '^(location|workflow|user|company)'
    order by length(key) limit 1;
  select value into v_conf from jsonb_each_text(v_fields)
    where key ~ '(confirm|reservation|booking).*(code|number|id)|^(confirmation|code)$' limit 1;
  select value into v_checkin_raw from jsonb_each_text(v_fields)
    where key ~ '(check.?in|arrival)' limit 1;
  begin
    v_checkin := v_checkin_raw::date;
  exception when others then
    v_checkin := null;
  end;
  select value into v_submission from jsonb_each_text(v_fields)
    where key ~ '(submission|form_?entry|entry)_?id' limit 1;
  v_submission := coalesce(v_submission, md5(coalesce(p_payload::text, '')));

  -- Match the stay at this property, most specific signal first. Never a cancelled one.
  if v_conf is not null then
    select r.id, r.check_in, g.full_name into v_res_id, v_res_checkin, v_res_guest
    from reservations r left join guests g on g.id = r.guest_id
    where r.property_id = p_property_id and r.confirmation_code ilike trim(v_conf)
      and coalesce(r.status, '') !~* '(cancel|declin|denied|expired|inquiry)'
    limit 1;
    if found then v_matched_by := 'confirmation_code'; end if;
  end if;
  if v_matched_by = 'unmatched' and v_checkin is not null then
    select r.id, r.check_in, g.full_name into v_res_id, v_res_checkin, v_res_guest
    from reservations r left join guests g on g.id = r.guest_id
    where r.property_id = p_property_id and r.check_in = v_checkin
      and coalesce(r.status, '') !~* '(cancel|declin|denied|expired|inquiry)'
    limit 1;
    if found then v_matched_by := 'check_in_date'; end if;
  end if;
  if v_matched_by = 'unmatched' and v_email is not null then
    select r.id, r.check_in, g.full_name into v_res_id, v_res_checkin, v_res_guest
    from reservations r join guests g on g.id = r.guest_id
    where r.property_id = p_property_id and lower(g.email) = lower(trim(v_email))
      and r.check_out >= current_date
      and coalesce(r.status, '') !~* '(cancel|declin|denied|expired|inquiry)'
    order by r.check_in limit 1;
    if found then v_matched_by := 'email'; end if;
  end if;
  if v_matched_by = 'unmatched' and length(trim(coalesce(v_name, ''))) >= 4 then
    select r.id, r.check_in, g.full_name into v_res_id, v_res_checkin, v_res_guest
    from reservations r join guests g on g.id = r.guest_id
    where r.property_id = p_property_id and g.full_name ilike '%' || trim(v_name) || '%'
      and r.check_out >= current_date
      and coalesce(r.status, '') !~* '(cancel|declin|denied|expired|inquiry)'
    order by r.check_in limit 1;
    if found then v_matched_by := 'guest_name'; end if;
  end if;

  v_ref := case when v_matched_by = 'unmatched' then 'parking:unmatched:' || v_submission else 'parking:' || v_res_id end;
  v_guest := coalesce(v_res_guest, v_name);
  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'title', 'Register vehicle' || coalesce(' – ' || v_guest, ''),
    'plate', v_plate,
    'vehicle', v_vehicle,
    'guest_email', v_email,
    'confirmation_code_given', v_conf,
    'check_in_given', v_checkin_raw,
    'matched_by', v_matched_by,
    'source_form', 'GHL parking form'
  ));

  insert into tickets (type, status, priority, stage, property_id, reservation_id, guest_name, source, external_ref, due_at, metadata)
  values (
    'vehicle_registration', 'open', 'normal', 'checkin', p_property_id,
    case when v_matched_by = 'unmatched' then null else v_res_id end,
    v_guest, 'automation', v_ref,
    case when v_res_checkin is not null then (v_res_checkin + time '12:00') at time zone 'America/Edmonton' end,
    v_meta
  )
  on conflict (external_ref) do update
    set metadata = tickets.metadata || excluded.metadata,
        guest_name = coalesce(excluded.guest_name, tickets.guest_name),
        updated_at = now()
  returning id, (xmax = 0) into v_ticket_id, v_inserted;

  if v_inserted then
    insert into ticket_items (ticket_id, label, is_done, done_at, sort_order) values
      (v_ticket_id, 'Plate received from guest', v_plate is not null, case when v_plate is not null then now() end, 0),
      (v_ticket_id, 'Registered with building', false, null, 1);
    insert into ticket_events (ticket_id, event_type, to_value, note, payload)
    values (v_ticket_id, 'status_change', 'open',
            'Created from the GHL parking form' || case when v_matched_by = 'unmatched' then ' - no matching reservation found, check the details' else ' (matched by ' || replace(v_matched_by, '_', ' ') || ')' end,
            jsonb_build_object('form_fields', v_fields));
  else
    if v_plate is not null then
      update ticket_items set is_done = true, done_at = coalesce(done_at, now())
      where ticket_id = v_ticket_id and label = 'Plate received from guest' and not is_done;
    end if;
    insert into ticket_events (ticket_id, event_type, note, payload)
    values (v_ticket_id, 'field_change', 'Parking form resubmitted - details updated', jsonb_build_object('form_fields', v_fields));
  end if;

  return jsonb_build_object('ticket_id', v_ticket_id, 'inserted', v_inserted, 'matched_by', v_matched_by);
end;
$$;

revoke execute on function public.upsert_parking_ticket(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_parking_ticket(uuid, jsonb) to service_role;
