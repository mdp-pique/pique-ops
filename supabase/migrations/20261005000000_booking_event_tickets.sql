-- Zapier migration, booking events (docs/zapier-migration.md, lane B).
-- Replaces the Zaps "Cancelled Reservation -> Slack Notification" and
-- "New Reservations - 1 Guest Only" with tickets made from the reservations we
-- already sync. Pique Bot posts them (docs/pique-bot-notification-legend.md).
--
--   save_booking        an accepted, upcoming booking is cancelled   ('save_booking:{reservation}')
--   guest_count_check   a new accepted, upcoming booking shows 1 guest ('guest_count:{reservation}')
--
-- Only transitions count (a new row, or a status change), so the daily full
-- re-sync of every reservation never creates or re-asks anything. Additive and
-- exception-safe like mirror_reservation_to_request_tickets: a bug here can
-- never block the reservation sync. Reuses upsert_request_ticket /
-- resolve_request_ticket (idempotent on external_ref).

insert into public.ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values
  ('save_booking', 'created', 'start', interval '4 hours', null, false, null, interval '1 hour', null, false),
  ('guest_count_check', 'created', 'checkin', interval '0', 12, true, null, interval '2 days', interval '1 day', false)
on conflict (type) do nothing;

create or replace function public.mirror_reservation_to_booking_event_tickets()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_upcoming boolean;
  v_cancelled boolean;
  v_was_accepted boolean;
  v_became_accepted boolean;
  v_guests int;
begin
  begin
    v_upcoming := new.check_in >= (now() at time zone 'America/Edmonton')::date;
    v_cancelled := coalesce(new.status, '') ~* 'cancel';
    v_was_accepted := tg_op = 'UPDATE' and old.status = 'accepted';
    v_became_accepted := new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted');
    v_guests := case when new.raw_hospitable_data->'guests'->>'total' ~ '^\d+$'
                     then (new.raw_hospitable_data->'guests'->>'total')::int
                     else new.guest_count end;

    -- Cancelled after being accepted: someone reaches out and tries to save it.
    if v_cancelled and v_was_accepted and v_upcoming then
      perform upsert_request_ticket('save_booking', 'save_booking:' || new.id, new.id,
        'Cancelled booking - try to save it', array['Reached out to the guest']);
      update tickets set priority = 'high'
      where external_ref = 'save_booking:' || new.id and priority = 'normal';
    elsif new.status = 'accepted' and tg_op = 'UPDATE' and old.status is distinct from 'accepted' then
      perform resolve_request_ticket('save_booking:' || new.id, 'Closed automatically - booking is accepted again');
    end if;

    -- A new booking with one guest: confirm the real count.
    if v_became_accepted and v_upcoming and v_guests = 1 then
      perform upsert_request_ticket('guest_count_check', 'guest_count:' || new.id, new.id,
        'Only 1 guest - confirm the count', array['Guest count confirmed'], jsonb_build_object('guest_total', v_guests::text));
    elsif new.status = 'accepted' and coalesce(v_guests, 0) > 1 then
      perform resolve_request_ticket('guest_count:' || new.id, 'Closed automatically - booking now shows ' || v_guests || ' guests');
    elsif v_cancelled then
      perform resolve_request_ticket('guest_count:' || new.id, 'Closed automatically - booking cancelled');
    end if;
  exception when others then
    raise warning 'mirror_reservation_to_booking_event_tickets failed for reservation %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger mirror_reservation_to_booking_event_tickets
  after insert or update on public.reservations
  for each row execute function public.mirror_reservation_to_booking_event_tickets();

-- Pique Bot immediate posts. A post is either the 7 AM check-in (one per channel
-- per day, as before) or an alert about a single ticket (at most one per ticket).
alter table public.pique_bot_posts
  add column kind text not null default 'morning' check (kind in ('morning', 'alert')),
  add column reminded_at timestamptz;
alter table public.pique_bot_posts drop constraint pique_bot_posts_date_channel_key;
create unique index pique_bot_posts_morning_key on public.pique_bot_posts (post_date, channel_id) where kind = 'morning';
create unique index pique_bot_posts_alert_ticket_key on public.pique_bot_posts ((ticket_ids[1])) where kind = 'alert';

-- Which gated ticket types (taken over from Zaps) Pique Bot may post about,
-- right away and in the 7 AM post (comma-separated). Empty = shadow: tickets
-- are created and show in the app, nothing posts yet.
insert into public.automation_flags (key, value, note) values
  ('pique_bot_alerts_live_types', '', 'Gated ticket types (from the Zapier migration) Pique Bot may post about, immediately and in the 7 AM post. Comma-separated. Empty = shadow, no posts.')
on conflict (key) do nothing;
