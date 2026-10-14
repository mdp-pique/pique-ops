-- 213 FML parking: the building's promo code lasts 5 days, so a stay longer than that needs the vehicle
-- re-registered (tech request 10-14). Only on the day itself, like the first registration (the waitlist
-- only allows same-day registering).
-- create_parking_renewal_tickets(day): for each accepted stay at a parking_registration_properties
-- listing that is still going on that day, takes the last time "Registered with building" was ticked on
-- that stay's parking tickets; once 5 days have passed, opens one vehicle_registration ticket
-- (external_ref 'parking_renew:{reservation}:{day}', due that day at noon) with the plate copied over and
-- the single item "Registered with building". Ticking it starts the next 5 days. Skipped when the pass
-- would run out on checkout day or later, or when nothing was ever registered (no parking).
-- Called by the Pique-a-choo alerts run (every 5 min, idempotent), which posts it at 11:00 (rule
-- parking:renew, src/lib/pique-bot/config.ts).

create or replace function public.create_parking_renewal_tickets(p_day date default (now() at time zone 'America/Edmonton')::date)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_ticket uuid;
  v_count int := 0;
begin
  for r in
    with stays as (
      select res.id, res.property_id, res.check_in, res.check_out, g.full_name
      from reservations res
      join parking_registration_properties pr on pr.property_id = res.property_id
      left join guests g on g.id = res.guest_id
      where res.status = 'accepted' and res.check_in < p_day and res.check_out > p_day
    ), regs as (
      select s.id as res_id, t.metadata, i.done_at,
        row_number() over (partition by s.id order by i.done_at desc) as rn
      from stays s
      join tickets t on t.type = 'vehicle_registration'
        and (t.external_ref = 'parking:' || s.id or t.external_ref like 'parking_renew:' || s.id || ':%')
      join ticket_items i on i.ticket_id = t.id and i.label = 'Registered with building' and i.is_done and i.done_at is not null
    )
    select s.*, (g.done_at at time zone 'America/Edmonton')::date as registered_on, g.metadata
    from stays s
    join regs g on g.res_id = s.id and g.rn = 1
    where (g.done_at at time zone 'America/Edmonton')::date + 5 <= p_day
      and (g.done_at at time zone 'America/Edmonton')::date + 5 < s.check_out
  loop
    insert into tickets (type, status, priority, stage, property_id, reservation_id, guest_name, source, external_ref, due_at, metadata)
    values ('vehicle_registration', 'open', 'normal', 'stay', r.property_id, r.id, r.full_name, 'automation',
            'parking_renew:' || r.id || ':' || p_day, (p_day + time '12:00') at time zone 'America/Edmonton',
            jsonb_strip_nulls(jsonb_build_object(
              'title', 'Re-register vehicle' || coalesce(' – ' || r.full_name, ''),
              'renewal', true,
              'renew_on', p_day,
              'registered_on', r.registered_on,
              'stays_until', r.check_out,
              'plate', r.metadata->>'plate',
              'vehicle', r.metadata->>'vehicle',
              'source_form', 'renewal')))
    on conflict (external_ref) do nothing
    returning id into v_ticket;
    if v_ticket is not null then
      insert into ticket_items (ticket_id, label, sort_order) values (v_ticket, 'Registered with building', 0);
      insert into ticket_events (ticket_id, event_type, to_value, note, payload)
      values (v_ticket, 'status_change', 'open', 'Created automatically: the 5-day parking pass from ' || to_char(r.registered_on, 'Mon DD') || ' runs out', '{}'::jsonb);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;

revoke execute on function public.create_parking_renewal_tickets(date) from public, anon, authenticated;
grant execute on function public.create_parking_renewal_tickets(date) to service_role;
