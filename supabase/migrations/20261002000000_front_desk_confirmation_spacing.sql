-- The desk's booking system pads dates ("October  3, 2026", two spaces), so the
-- Arrival/Departure regex in record_front_desk_confirmation() never matched and
-- the 2026-10-02 confirmation (#182670) was stored unmatched. Collapse whitespace
-- before parsing, and let a previously unmatched reply be matched on a re-run.
create or replace function public.record_front_desk_confirmation(p_gmail_message_id text, p_subject text, p_body text)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_mode text := coalesce((select value from automation_flags where key = 'front_desk_notices_mode'), 'dry_run');
  v_body text := regexp_replace(coalesce(p_body, ''), '[ \t ]+', ' ', 'g');
  v_code text;
  v_suite text;
  v_arrival date;
  v_departure date;
  c front_desk_contacts;
  st front_desk_state;
  v_status text;
begin
  if exists (select 1 from front_desk_confirmations where gmail_message_id = p_gmail_message_id and ticket_id is not null) then
    return (select ticket_id from front_desk_confirmations where gmail_message_id = p_gmail_message_id);
  end if;

  v_code := coalesce(substring(p_subject from 'Confirmation:\s*(\d+)'), substring(v_body from 'confirmation number is\s*(\d+)'));
  v_suite := substring(v_body from 'Suite Number:\s*(\S+)');
  begin
    v_arrival := to_date(substring(v_body from 'Arrival Date:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})'), 'FMMonth FMDD, YYYY');
    v_departure := to_date(substring(v_body from 'Departure Date:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})'), 'FMMonth FMDD, YYYY');
  exception when others then
    v_arrival := null;
    v_departure := null;
  end;

  select * into c from front_desk_contacts where suite_code = v_suite;
  if found and v_arrival is not null then
    select * into st from front_desk_state s
    where s.mode = v_mode and s.property_id = c.property_id and s.told_status = 'accepted' and s.told_check_in = v_arrival
    order by (s.told_check_out = v_departure) desc, s.last_told_at desc
    limit 1;
  end if;

  insert into front_desk_confirmations (gmail_message_id, confirmation_code, suite_code, arrival, departure,
                                        property_id, hospitable_reservation_id, ticket_id)
  values (p_gmail_message_id, v_code, v_suite, v_arrival, v_departure, c.property_id, st.hospitable_reservation_id, st.ticket_id)
  on conflict (gmail_message_id) do update set
    confirmation_code = excluded.confirmation_code, suite_code = excluded.suite_code,
    arrival = excluded.arrival, departure = excluded.departure, property_id = excluded.property_id,
    hospitable_reservation_id = excluded.hospitable_reservation_id, ticket_id = excluded.ticket_id;

  if st.hospitable_reservation_id is null then
    return null;
  end if;

  update front_desk_state set confirmation_code = v_code, confirmed_at = now(), updated_at = now()
  where mode = st.mode and hospitable_reservation_id = st.hospitable_reservation_id;

  if st.ticket_id is not null then
    update tickets set metadata = metadata || jsonb_build_object('front_desk_confirmation', v_code)
    where id = st.ticket_id
    returning status into v_status;
    update ticket_items set is_done = true, done_at = now()
    where ticket_id = st.ticket_id and label = 'Front desk confirmation received' and not is_done;
    insert into ticket_events (ticket_id, event_type, note, payload)
    values (st.ticket_id, 'comment', 'Front desk confirmed - confirmation #' || coalesce(v_code, '?'),
            jsonb_build_object('gmail_message_id', p_gmail_message_id, 'arrival', v_arrival, 'departure', v_departure));
    if v_status in ('open', 'in_progress', 'blocked') then
      update tickets set status = 'resolved', closed_at = now() where id = st.ticket_id;
      insert into ticket_events (ticket_id, event_type, from_value, to_value, note)
      values (st.ticket_id, 'status_change', v_status, 'resolved', 'Front desk confirmed #' || coalesce(v_code, '?'));
    end if;
  end if;
  return st.ticket_id;
end;
$$;

revoke execute on function public.record_front_desk_confirmation(text, text, text) from public, anon, authenticated;
