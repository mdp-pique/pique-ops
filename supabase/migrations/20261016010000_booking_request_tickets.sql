-- Requests to book (MDP 10-16, tech request 73fad24d): a ticket the moment a reservation turns into an
-- Airbnb / direct "request to book" (reservations.status = 'request'), posted right away in
-- #pique-team-chat-missed tagging @customerservice, with one thread reminder 10 minutes later if it's
-- still unanswered (config.ts rule booking_request, posted around the clock). Resolves itself when the
-- request is accepted, declined, expires or is cancelled, and keeps the outcome and response time in
-- metadata so requests can be audited later (MDP wants to look at auto-accepting eventually).
--
-- Additive and exception-safe like mirror_reservation_to_booking_event_tickets: a bug here can never
-- block the reservation sync. Only transitions into / out of 'request' count, so the daily re-sync
-- never creates or re-asks anything. ref 'booking_request:{reservation}'.

insert into public.ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values
  ('booking_request', 'created', 'start', interval '1 hour', null, false, interval '10 minutes', interval '30 minutes', null, false)
on conflict (type) do nothing;

create or replace function public.open_booking_request_ticket(p_res public.reservations)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_ref text := 'booking_request:' || p_res.id;
  v_guest text := nullif(trim(concat_ws(' ', p_res.raw_hospitable_data->'guest'->>'first_name', p_res.raw_hospitable_data->'guest'->>'last_name')), '');
begin
  perform upsert_request_ticket('booking_request', v_ref, p_res.id, 'Request to book - accept or decline',
    array['Accepted or declined'],
    jsonb_build_object('booking_source', p_res.booking_source, 'requested_at', now(), 'code', p_res.confirmation_code));
  update tickets
     set priority = 'high',
         guest_name = coalesce(guest_name, v_guest),
         metadata = case when metadata->>'title' = 'Request to book - accept or decline' and v_guest is not null
                         then jsonb_set(metadata, '{title}', to_jsonb('Request to book - accept or decline – ' || v_guest))
                         else metadata end
   where external_ref = v_ref and status in ('open', 'in_progress', 'blocked');
end;
$$;
revoke execute on function public.open_booking_request_ticket(public.reservations) from public, anon, authenticated;

create or replace function public.mirror_reservation_to_booking_request_ticket()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ref text := 'booking_request:' || new.id;
begin
  begin
    if new.status = 'request' and (tg_op = 'INSERT' or old.status is distinct from 'request') then
      perform open_booking_request_ticket(new);
    elsif tg_op = 'UPDATE' and old.status = 'request' and new.status is distinct from 'request' then
      perform resolve_request_ticket(v_ref, 'Closed automatically - request ' || coalesce(new.status, 'changed'));
      -- For the audit: how each request ended and how long it took.
      update tickets
         set metadata = metadata || jsonb_build_object('outcome', new.status, 'answered_at', now(),
               'answer_minutes', round(extract(epoch from (now() - created_at)) / 60))
       where external_ref = v_ref and metadata->>'outcome' is null;
    end if;
  exception when others then
    raise warning 'mirror_reservation_to_booking_request_ticket failed for reservation %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger mirror_reservation_to_booking_request_ticket
  after insert or update of status on public.reservations
  for each row execute function public.mirror_reservation_to_booking_request_ticket();

-- Requests already waiting when this went in (HM3ZMEJADE, 10-16) get their ticket now.
select public.open_booking_request_ticket(r) from public.reservations r
 where r.status = 'request' and r.check_in >= (now() at time zone 'America/Edmonton')::date;
