-- Changelog feed (MDP 2026-10-06): every push to main, and every change to a
-- live automation (n8n, Zapier, Slack, database), gets a numbered entry here,
-- written by the chat that made it (housekeeping skill, step 3). Pique Bot
-- posts each entry once to Slack #change-logs (src/lib/pique-bot/changelog.ts,
-- n8n Pique-Changelog every 5 min). The id is the entry number shown in Slack.

create table public.changelog_entries (
  id bigint generated always as identity primary key,
  title text not null,
  -- Slack mrkdwn: what changed and why, in plain words, one bullet per change.
  body text not null,
  -- Which systems it touched: app, database, n8n, zapier, slack, other.
  areas text[] not null default '{}',
  commit_sha text,
  branch text,
  posted_at timestamptz,
  slack_ts text,
  created_at timestamptz not null default now()
);

alter table public.changelog_entries enable row level security;
create policy changelog_entries_read on public.changelog_entries for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

-- Silence check gains one more gap: an entry that never reached Slack (for
-- example Pique Bot not invited to #change-logs). Same function as
-- 20261006020000 plus the changelog branch at the end.
create or replace function public.automation_silence_check()
returns table (check_key text, problem text)
language sql
stable
set search_path = public
as $$
  -- Hospitable reservations: the webhook and the daily re-sync both touch last_synced_at.
  select 'reservations_sync',
         'No reservation has synced from Hospitable since ' ||
         to_char(max(last_synced_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ' (normally several times a day).'
  from reservations
  having max(last_synced_at) < now() - interval '26 hours'

  union all
  -- Guest messages from Hospitable (Hospitable-Webhook-Receiver / message sync).
  select 'messages_sync',
         'No guest message has come in from Hospitable since ' ||
         to_char(max(created_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || '.'
  from messages
  having max(created_at) < now() - interval '12 hours'

  union all
  -- Connecteam schedule copy (Pique-Connecteam-Shifts-Sync, hourly).
  select 'connecteam_shifts_sync',
         'The Connecteam schedule copy has not refreshed since ' ||
         to_char(max(last_seen_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ' (normally hourly).'
  from connecteam_shifts
  having max(last_seen_at) < now() - interval '3 hours'

  union all
  -- Booking feed (Pique-Bot-Bookings): every accepted booking should be posted within minutes.
  select 'booking_feed',
         count(*) || ' new booking(s) from the last day were never posted to #new-reservations (oldest booked ' ||
         to_char(min(r.created_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') || ').'
  from reservations r
  where r.status = 'accepted'
    and r.created_at between now() - interval '24 hours' and now() - interval '15 minutes'
    and not exists (select 1 from pique_bot_booking_posts p where p.reservation_id = r.id)
  having count(*) > 0

  union all
  -- Pique Bot immediate posts (Pique-Bot-Alerts): live urgent/today tickets created
  -- during posting hours (07:00-20:45 Edmonton) should have an alert post within minutes.
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
    )
    and not exists (
      select 1 from pique_bot_posts p where p.kind = 'alert' and t.id = any (p.ticket_ids)
    )
  having count(*) > 0

  union all
  -- Pique Bot 7 AM post (Pique-Bot-Morning): it claims a row per channel when it has something to ask.
  -- Checked after 07:30; a morning with nothing open anywhere is fine, so only flag when
  -- yesterday had posts and today has none.
  select 'pique_bot_morning',
         'Pique Bot''s 7 AM check-in has not posted today (it posted yesterday).'
  where (now() at time zone 'America/Edmonton')::time > time '07:30'
    and exists (select 1 from pique_bot_posts where kind = 'morning'
                and post_date = (now() at time zone 'America/Edmonton')::date - 1)
    and not exists (select 1 from pique_bot_posts where kind = 'morning'
                    and post_date = (now() at time zone 'America/Edmonton')::date)

  union all
  -- Email alerts (Pique-Email-Alerts): Truvi / Aircover / Robert mail arrives most days,
  -- so two days with nothing new recorded usually means the Gmail login or the workflow broke.
  select 'email_alerts',
         'No new matching email has been recorded since ' ||
         to_char(max(first_seen_at) at time zone 'America/Edmonton', 'Mon DD HH24:MI') ||
         ' - check the Gmail login in n8n.'
  from email_alert_messages
  having max(first_seen_at) < now() - interval '48 hours'

  union all
  -- Changelog (Pique-Changelog): entries should reach #change-logs within minutes.
  select 'changelog',
         count(*) || ' changelog entr' || case when count(*) = 1 then 'y has' else 'ies have' end ||
         ' not been posted to #change-logs (is Pique Bot in the channel?).'
  from changelog_entries
  where slack_ts is null and created_at < now() - interval '1 hour'
  having count(*) > 0
$$;

revoke execute on function public.automation_silence_check() from public, anon, authenticated;
