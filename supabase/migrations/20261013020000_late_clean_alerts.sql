-- Cleans that may not be ready for a 4 PM check-in (MDP / Katrina 10-13). Connecteam's time clock
-- (clock-in / clock-out per cleaner) is copied here by n8n Pique-Cleaning-Clock every 10 min; the app
-- (src/lib/pique-bot/lateCleans.ts) compares open clock-ins on turnover days with how long that
-- property usually takes, opens a clean_running_late ticket that Pique-a-choo posts in
-- #cleaning-health-check tagging @customerservice, escalates it at 4 PM if the cleaner is still
-- clocked in, and resolves it when they clock out. Additive: the live no-show check is untouched.

create table public.cleaning_clock_sessions (
  user_id bigint not null,               -- Connecteam user
  started_at timestamptz not null,
  ended_at timestamptz,                  -- null while clocked in
  job_id text,                           -- Connecteam job
  scheduler_shift_id text,               -- the scheduled shift it was clocked against, when linked
  property_id uuid references public.properties(id) on delete set null,
  work_date date not null,               -- local (Edmonton) date of the clock-in
  last_synced_at timestamptz not null default now(),
  primary key (user_id, started_at)
);
create index cleaning_clock_sessions_property_date on public.cleaning_clock_sessions (property_id, work_date);
-- Cleaners' working hours: server (service_role) only, like cleaning_shift_check. No authenticated policy.
alter table public.cleaning_clock_sessions enable row level security;

insert into public.ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values ('clean_running_late', 'created', 'start', interval '2 hours', null, true, null, interval '30 minutes', null, false)
on conflict (type) do nothing;

-- Silence check: the clock copy should refresh every day the cleaners work.
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
