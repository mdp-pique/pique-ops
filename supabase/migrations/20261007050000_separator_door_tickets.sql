-- Separator door reminders for joint listings (MDP 10-07). Replaces the n8n workflow
-- "Joint Listing Separator Door Reminders" (PaaeapfYeBPHtITg, built outside this repo
-- 10-03). It @channel'd #pique-internal-cleaning-operations at 9 AM with one message per
-- joint-listing checkout (lock the separator door) and check-in (unlock it), but never
-- posted: Hospitable's API rejects its property ids, so every run since 10-04 failed.
--
-- Now: each morning n8n Pique-Separator-Doors calls create_separator_door_tickets(),
-- which opens one separator_door ticket per accepted checkout / check-in that day at the
-- joint listings in joint_listing_properties (from our own reservations table). Pique Bot
-- asks them in the 7 AM post in that channel with Done / Not yet (rule separator_door),
-- so the team ticks each door off instead of reading an @channel.

create table public.joint_listing_properties (
  property_id uuid primary key references public.properties(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.joint_listing_properties enable row level security;
create policy joint_listing_properties_read on public.joint_listing_properties for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

-- The 14 joint listings the old workflow watched (by Hospitable property id).
insert into public.joint_listing_properties (property_id)
select id from public.properties
where hospitable_property_id in (
  '75e1cbfa-422b-4d95-a7be-155ad03a6ad4', '8d095d92-a95a-48d4-9360-5e1001aea5e5', '088e942a-fbf1-45ea-9c9a-c7c8d209c120',
  '6fa6cded-c9ac-4c37-b2b6-602a5940948f', '0f27ebd1-8cb2-4934-9c57-9b1cd3fe7043', 'fdce2745-f9b0-425d-b7f6-ee7e2a9cfa33',
  '99223213-6edd-470e-a847-53ff7dd630f6', '7f75765e-3e91-4071-a2d8-b6100a3ec012', '322491df-0b12-47ec-96df-f33506830622',
  'd6919c6f-f2da-48de-8d49-f94138720279', '517e30c3-82a2-4317-822b-7fe43d769660', 'fda09d68-f52a-4948-8c73-6379a9e41198',
  'd4eabcfc-180d-40c9-aed6-37521acc2baa', '418c1166-567a-4dce-90ab-16d6b15f755d')
on conflict do nothing;

insert into ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values ('separator_door', 'created', 'start', interval '8 hours', null, false, null, interval '2 hours', null, false)
on conflict (type) do nothing;

-- One ticket per joint-listing checkout (lock) and check-in (unlock) on p_day, due 3 PM
-- that day (before check-in). Idempotent on external_ref, so a re-run changes nothing.
-- Returns how many tickets it opened.
create or replace function public.create_separator_door_tickets(p_day date default (now() at time zone 'America/Edmonton')::date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_ticket uuid;
  n integer := 0;
begin
  for r in
    select res.id as reservation_id, res.property_id, g.full_name as guest_name,
           regexp_replace(trim(coalesce(p.property_name, p.public_name, 'Joint listing')), '\*+$', '') as unit,
           a.action
    from reservations res
    join joint_listing_properties j on j.property_id = res.property_id
    join properties p on p.id = res.property_id
    left join guests g on g.id = res.guest_id
    cross join lateral (
      select 'lock'::text as action where res.check_out = p_day
      union all
      select 'unlock' where res.check_in = p_day
    ) a
    where res.status = 'accepted'
  loop
    insert into tickets (type, status, priority, stage, source, property_id, reservation_id, guest_name, due_at, external_ref, metadata)
    values ('separator_door', 'open', 'normal', case r.action when 'lock' then 'checkout' else 'checkin' end, 'automation',
            r.property_id, r.reservation_id, r.guest_name,
            (p_day + time '15:00') at time zone 'America/Edmonton',
            'door:' || r.action || ':' || r.reservation_id,
            jsonb_build_object(
              'title', case r.action when 'lock' then 'Lock separator door: ' else 'Unlock separator door: ' end || r.unit,
              'action', r.action,
              'day', p_day,
              'unit', r.unit))
    on conflict (external_ref) do nothing
    returning id into v_ticket;
    if v_ticket is not null then
      insert into ticket_items (ticket_id, label, sort_order)
      values (v_ticket, case r.action when 'lock' then 'Separator door locked' else 'Separator door unlocked' end, 0);
      insert into ticket_events (ticket_id, event_type, to_value, note, payload)
      values (v_ticket, 'status_change', 'open',
              'Created automatically: joint listing ' || case r.action when 'lock' then 'checkout' else 'check-in' end || ' today', '{}'::jsonb);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

revoke execute on function public.create_separator_door_tickets(date) from public, anon, authenticated;
