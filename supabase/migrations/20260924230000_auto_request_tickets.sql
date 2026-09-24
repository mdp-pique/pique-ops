-- Automatic Requests tickets (PRD §7.1 Requests, Katrina's list) from data that
-- already exists. Additive and exception-safe: a bug here can never block the
-- Hospitable reservation sync or the pack-n-play reminder flow's writes.
--   direct_booking_id_check  - accepted direct booking, upcoming   ('direct_id:{reservation}')
--   pet_fee                  - accepted booking with pets, upcoming ('pet_fee:{reservation}')
--   pack_n_play              - packnplay_requests.requested = true  ('packnplay:{reservation}')
-- Cancelled bookings (or a withdrawn pack-n-play request) resolve the open ticket.
-- Due dates and health come from ticket_type_clocks via the tickets clock trigger.

create or replace function public.upsert_request_ticket(
  p_type text, p_ref text, p_reservation_id uuid, p_title text, p_items text[], p_meta jsonb default '{}'
)
returns void
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_ticket_id uuid;
begin
  select res.id, res.property_id, g.full_name into r
  from reservations res left join guests g on g.id = res.guest_id
  where res.id = p_reservation_id;
  if not found then
    return;
  end if;

  insert into tickets (type, status, priority, property_id, reservation_id, guest_name, source, external_ref, metadata)
  values (p_type, 'open', 'normal', r.property_id, r.id, r.full_name, 'automation', p_ref,
          jsonb_build_object('title', p_title || coalesce(' – ' || r.full_name, '')) || p_meta)
  on conflict (external_ref) do nothing
  returning id into v_ticket_id;

  if v_ticket_id is not null then
    insert into ticket_items (ticket_id, label, sort_order)
    select v_ticket_id, label, ord - 1 from unnest(p_items) with ordinality as t(label, ord);
    insert into ticket_events (ticket_id, event_type, to_value, note)
    values (v_ticket_id, 'status_change', 'open', 'Created automatically from the reservation');
  end if;
end;
$$;

create or replace function public.resolve_request_ticket(p_ref text, p_note text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_ticket_id uuid;
  v_status text;
begin
  select id, status into v_ticket_id, v_status from tickets
  where external_ref = p_ref and status in ('open', 'in_progress', 'blocked');
  if v_ticket_id is null then
    return;
  end if;
  update tickets set status = 'resolved', closed_at = now() where id = v_ticket_id;
  insert into ticket_events (ticket_id, event_type, from_value, to_value, note)
  values (v_ticket_id, 'status_change', v_status, 'resolved', p_note);
end;
$$;

revoke execute on function public.upsert_request_ticket(text, text, uuid, text, text[], jsonb) from public, anon, authenticated;
revoke execute on function public.resolve_request_ticket(text, text) from public, anon, authenticated;

create or replace function public.mirror_reservation_to_request_tickets()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_active boolean;
  v_cancelled boolean;
  v_pets int;
begin
  begin
    v_active := new.status = 'accepted' and new.check_in >= (now() at time zone 'America/Edmonton')::date;
    v_cancelled := coalesce(new.status, '') ~* '(cancel|declin|denied|expired|not accepted)';
    v_pets := case when new.raw_hospitable_data->'guests'->>'pet_count' ~ '^\d+$'
                   then (new.raw_hospitable_data->'guests'->>'pet_count')::int else 0 end;

    if new.booking_source = 'direct' then
      if v_active then
        perform upsert_request_ticket('direct_booking_id_check', 'direct_id:' || new.id, new.id,
          'Direct booking ID check', array['ID collected', 'Purpose of trip confirmed', 'Pet count confirmed']);
      elsif v_cancelled then
        perform resolve_request_ticket('direct_id:' || new.id, 'Closed automatically - booking cancelled');
      end if;
    end if;

    if v_pets > 0 and v_active then
      perform upsert_request_ticket('pet_fee', 'pet_fee:' || new.id, new.id,
        'Pet fee', array['Fee requested', 'Fee collected'], jsonb_build_object('pet_count', v_pets::text));
    elsif v_cancelled then
      perform resolve_request_ticket('pet_fee:' || new.id, 'Closed automatically - booking cancelled');
    end if;

    if v_cancelled then
      perform resolve_request_ticket('packnplay:' || new.id, 'Closed automatically - booking cancelled');
    end if;
  exception when others then
    raise warning 'mirror_reservation_to_request_tickets failed for reservation %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger mirror_reservation_to_request_tickets
  after insert or update on public.reservations
  for each row execute function public.mirror_reservation_to_request_tickets();

create or replace function public.mirror_packnplay_to_ticket()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ok boolean;
begin
  begin
    if new.reservation_id is null then
      return null;
    end if;
    if new.requested then
      select status = 'accepted' and check_in >= (now() at time zone 'America/Edmonton')::date into v_ok
      from reservations where id = new.reservation_id;
      if coalesce(v_ok, false) then
        perform upsert_request_ticket('pack_n_play', 'packnplay:' || new.reservation_id, new.reservation_id,
          'Pack ''n play', array['Delivered to unit']);
      end if;
    else
      perform resolve_request_ticket('packnplay:' || new.reservation_id, 'Closed automatically - pack ''n play no longer requested');
    end if;
  exception when others then
    raise warning 'mirror_packnplay_to_ticket failed for %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger mirror_packnplay_to_ticket
  after insert or update on public.packnplay_requests
  for each row execute function public.mirror_packnplay_to_ticket();

-- Backfill upcoming stays only.
select upsert_request_ticket('direct_booking_id_check', 'direct_id:' || r.id, r.id,
  'Direct booking ID check', array['ID collected', 'Purpose of trip confirmed', 'Pet count confirmed'])
from reservations r
where r.booking_source = 'direct' and r.status = 'accepted'
  and r.check_in >= (now() at time zone 'America/Edmonton')::date;

select upsert_request_ticket('pet_fee', 'pet_fee:' || r.id, r.id,
  'Pet fee', array['Fee requested', 'Fee collected'], jsonb_build_object('pet_count', r.raw_hospitable_data->'guests'->>'pet_count'))
from reservations r
where r.raw_hospitable_data->'guests'->>'pet_count' ~ '^[1-9]\d*$' and r.status = 'accepted'
  and r.check_in >= (now() at time zone 'America/Edmonton')::date;

select upsert_request_ticket('pack_n_play', 'packnplay:' || p.reservation_id, p.reservation_id, 'Pack ''n play', array['Delivered to unit'])
from packnplay_requests p join reservations r on r.id = p.reservation_id
where p.requested and r.status = 'accepted'
  and r.check_in >= (now() at time zone 'America/Edmonton')::date;
