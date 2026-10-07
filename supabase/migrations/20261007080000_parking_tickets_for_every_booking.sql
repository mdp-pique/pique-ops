-- 213 FML parking: a vehicle_registration ticket for every booking, not only when the
-- guest fills in the GHL parking form (docs/zapier-migration.md P2-103 / P1-127). The
-- form → n8n Pique-Parking-Form-To-Ticket → upsert_parking_ticket() path has never run
-- (no executions since 9-24), so no parking ticket was ever opened. Now the ticket comes
-- from our own reservations: one per accepted, upcoming stay at a property in
-- parking_registration_properties, ref 'parking:{reservation}' - the same ref the form
-- uses, so a form submission later fills in the plate on this ticket instead of opening
-- a second one. Same checklist and due time (check-in day, noon) as the form path.
-- A cancelled booking resolves it. Pique Bot asks it in #pique-team-chat from 2 days
-- before check-in (rule vehicle_registration).

create table public.parking_registration_properties (
  property_id uuid primary key references public.properties(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.parking_registration_properties enable row level security;
create policy parking_registration_properties_read on public.parking_registration_properties for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

-- #213 Fire Mountain Lodge (Lumos), the unit the GHL form and the Zap are for.
insert into public.parking_registration_properties (property_id)
select id from public.properties where id = 'b0546d4b-7601-42eb-81ab-f1d22ad9d9e9'
on conflict do nothing;

create or replace function public.open_parking_ticket(p_reservation uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket uuid;
  r record;
begin
  select res.id, res.property_id, res.check_in, g.full_name into r
  from reservations res
  join parking_registration_properties pr on pr.property_id = res.property_id
  left join guests g on g.id = res.guest_id
  where res.id = p_reservation and res.status = 'accepted'
    and res.check_in >= (now() at time zone 'America/Edmonton')::date;
  if not found then
    return null;
  end if;

  insert into tickets (type, status, priority, stage, property_id, reservation_id, guest_name, source, external_ref, due_at, metadata)
  values ('vehicle_registration', 'open', 'normal', 'checkin', r.property_id, r.id, r.full_name, 'automation',
          'parking:' || r.id, (r.check_in + time '12:00') at time zone 'America/Edmonton',
          jsonb_build_object('title', 'Register vehicle' || coalesce(' – ' || r.full_name, ''), 'source_form', 'booking'))
  on conflict (external_ref) do nothing
  returning id into v_ticket;
  if v_ticket is not null then
    insert into ticket_items (ticket_id, label, sort_order)
    values (v_ticket, 'Plate received from guest', 0), (v_ticket, 'Registered with building', 1);
    insert into ticket_events (ticket_id, event_type, to_value, note, payload)
    values (v_ticket, 'status_change', 'open', 'Created automatically from the booking', '{}'::jsonb);
  end if;
  return v_ticket;
end;
$$;

-- Never blocks or rolls back the reservation sync. Only a booking that is accepted now and
-- wasn't before (or is new) opens a ticket, so the daily full re-sync changes nothing.
create or replace function public.mirror_reservation_to_parking_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
      perform public.open_parking_ticket(new.id);
    elsif tg_op = 'UPDATE' and old.status = 'accepted' and new.status <> 'accepted' then
      perform public.resolve_request_ticket('parking:' || new.id, 'Booking ' || new.status);
    end if;
  exception when others then
    raise warning 'mirror_reservation_to_parking_ticket failed for reservation %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create or replace trigger mirror_reservation_to_parking_ticket
after insert or update of status on public.reservations
for each row execute function public.mirror_reservation_to_parking_ticket();

revoke execute on function public.open_parking_ticket(uuid) from public, anon, authenticated;
revoke execute on function public.mirror_reservation_to_parking_ticket() from public, anon, authenticated;

-- Every upcoming 213 FML booking that already exists (from tomorrow: today's check-in
-- was already reminded by the Zap).
select public.open_parking_ticket(res.id)
from reservations res
join parking_registration_properties pr on pr.property_id = res.property_id
where res.status = 'accepted' and res.check_in > (now() at time zone 'America/Edmonton')::date;
