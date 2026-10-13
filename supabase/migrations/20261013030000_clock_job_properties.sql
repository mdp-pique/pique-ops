-- Which listing a Connecteam job's clock-ins belong to, for the late-clean alerts (lateCleans.ts).
-- Kept apart from cleaning_job_map / cleaning_property_jobs, which the live shift planner reads, so
-- nothing here can change which shifts the planner creates or moves.
--   mapped:   clock-ins on this job are for property_id
--   not_ours: not a listing in our Hospitable account (a cleaning client's home, travel time, ...)
-- Filled automatically when a shift's title carries one of our booking codes (source 'booking_code');
-- a job it can't place opens a tech_request ticket (external_ref clock_job:{job}), and adding its
-- row here closes that ticket on the next run.
create table public.clock_job_properties (
  job_id text primary key,
  status text not null check (status in ('mapped', 'not_ours')),
  property_id uuid references public.properties(id) on delete cascade,
  job_title text,
  source text not null default 'manual' check (source in ('manual', 'booking_code')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'mapped') = (property_id is not null))
);
alter table public.clock_job_properties enable row level security;
-- Server (service_role) only, like cleaning_clock_sessions.

insert into public.clock_job_properties (job_id, status, property_id, job_title, note) values
  ('39d274d3-608a-74df-b77b-d68917818595', 'mapped', 'abab3654-1784-4c22-9d0f-99dc180684fc', 'The Evergreen Château - 10405 31a Ave NW', 'Listing added to the main Hospitable account 10-13; MDP: unpark it'),
  ('6622414c-62fc-ac01-cd56-3e397cc22ed1', 'not_ours', null, 'Travel Time', 'Not a unit'),
  ('fd0a7c6e-7325-341f-4241-053c9af1541a', 'not_ours', null, 'Stephan MAIN', 'Cleaning client (Stephan), not in our Hospitable account'),
  ('f9734271-196a-1175-8492-51ff84860ae0', 'not_ours', null, 'Stephan''s Main', 'Cleaning client (Stephan), not in our Hospitable account'),
  ('16e75e09-786b-a3fd-db99-f4ee5795a2ad', 'not_ours', null, 'Stephan BSMT', 'Cleaning client (Stephan), not in our Hospitable account'),
  ('c636048e-fa96-258d-0c1e-85daabdb5fba', 'not_ours', null, '11247-ROYAL ALEX', 'Cleaning client (Padmore), not in our Hospitable account'),
  ('b08a9e52-839c-9d50-c075-761d8c221582', 'not_ours', null, '150 Westridge Road Nw - Sharon''s House', 'Private home, not in our Hospitable account'),
  ('00debf0f-5964-1da2-1487-761a464c047a', 'not_ours', null, 'Orlandice - 1710 Keene Cres SW', 'Private home, not in our Hospitable account'),
  ('ac7df25d-44ec-25ff-1e14-d267687a64ca', 'not_ours', null, '1710 Keene Crescent', 'Private home, not in our Hospitable account');

-- Evergreen's clock-ins so far.
update public.cleaning_clock_sessions set property_id = 'abab3654-1784-4c22-9d0f-99dc180684fc'
where job_id = '39d274d3-608a-74df-b77b-d68917818595' and property_id is null;

-- Booking feed check: skip bookings made over a day ago (see bookings.ts).
create or replace function public.automation_silence_check()
returns table (check_key text, problem text)
language sql
stable
set search_path = public
as $$
  select 'reservations_sync',
         'No reservation has synced from Hospitable since ' ||
         to_char(max(last_synced_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ' (normally several times a day).'
  from reservations
  having max(last_synced_at) < now() - interval '26 hours'

  union all
  select 'messages_sync',
         'No guest message has come in from Hospitable since ' ||
         to_char(max(created_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || '.'
  from messages
  having max(created_at) < now() - interval '12 hours'

  union all
  select 'connecteam_shifts_sync',
         'The Connecteam schedule copy has not refreshed since ' ||
         to_char(max(last_seen_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ' (normally hourly).'
  from connecteam_shifts
  having max(last_seen_at) < now() - interval '3 hours'

  union all
  select 'booking_feed',
         count(*) || ' new booking(s) from the last day were never posted to #new-reservations (oldest booked ' ||
         to_char(min(r.created_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ').'
  from reservations r
  where r.status = 'accepted'
    and r.created_at between now() - interval '24 hours' and now() - interval '15 minutes'
    -- A listing newly added to Hospitable brings its old bookings with it; the feed skips those.
    and (r.booked_at is null or r.booked_at >= now() - interval '24 hours')
    and not exists (select 1 from pique_bot_booking_posts p where p.reservation_id = r.id)
  having count(*) > 0

  union all
  select 'pique_bot_alerts',
         count(*) || ' live ticket(s) from the last day were never posted by Pique Bot (' ||
         string_agg(distinct coalesce('email:' || (t.metadata->>'rule'), t.type), ', ') || ').'
  from tickets t
  cross join lateral (
    select coalesce(string_to_array(replace(value, ' ', ''), ','), '{}') as live
    from automation_flags where key = 'pique_bot_alerts_live_types'
  ) f
  where t.created_at between now() - interval '24 hours' and now() - interval '15 minutes'
    and (t.created_at at time zone 'America/Edmonton')::time between time '07:00' and time '20:45'
    and (
      (t.type in ('save_booking', 'guest_count_check') and t.type = any (f.live))
      or (t.type = 'email_alert' and 'email:' || (t.metadata->>'rule') = any (f.live))
      or (t.type = 'cleaning_issue' and t.metadata->>'source' = 'review' and 'review_qc' = any (f.live))
      or t.type = 'pet_fee'
      or t.type = 'clean_running_late'
    )
    and not exists (
      select 1 from pique_bot_posts p where p.kind = 'alert' and t.id = any (p.ticket_ids)
    )
  having count(*) > 0

  union all
  select 'pique_bot_morning',
         'Pique Bot''s 7 AM check-in has not posted today (it posted yesterday).'
  where (now() at time zone 'America/Edmonton')::time > time '07:30'
    and exists (select 1 from pique_bot_posts where kind = 'morning'
                and post_date = (now() at time zone 'America/Edmonton')::date - 1)
    and not exists (select 1 from pique_bot_posts where kind = 'morning'
                    and post_date = (now() at time zone 'America/Edmonton')::date)

  union all
  select 'email_alerts',
         'No new matching email has been recorded since ' ||
         to_char(max(first_seen_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') ||
         ' - check the Gmail login in n8n.'
  from email_alert_messages
  having max(first_seen_at) < now() - interval '48 hours'

  union all
  select 'changelog',
         count(*) || ' changelog entr' || case when count(*) = 1 then 'y has' else 'ies have' end ||
         ' not been posted to #change-logs (is Pique Bot in the channel?).'
  from changelog_entries
  where slack_ts is null and created_at < now() - interval '1 hour'
  having count(*) > 0

  union all
  select 'review_qc_trigger',
         count(*) || ' new review(s) from the last day have no quality-control record (the reviews trigger may be failing).'
  from reviews r
  where r.created_at between now() - interval '24 hours' and now() - interval '15 minutes'
    and coalesce(nullif(r.raw_hospitable_data->>'reviewed_at', '')::timestamptz, r.review_date::timestamptz) > now() - interval '45 days'
    and not exists (select 1 from review_qc q where q.review_id = r.id)
  having count(*) > 0

  union all
  select 'review_qc_feed',
         count(*) || ' review(s) were never posted to #quality-control-reviews.'
  from review_qc
  where not flagged and slack_ts is null and created_at < now() - interval '1 hour'
    and created_at > now() - interval '3 days'
  having count(*) > 0

  union all
  select 'cleaning_clock_sync',
         'The Connecteam time-clock copy (late-clean alerts) has not refreshed since ' ||
         to_char(max(last_synced_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ' - check n8n Pique-Cleaning-Clock.'
  from cleaning_clock_sessions
  having max(last_synced_at) < now() - interval '26 hours'
$$;
