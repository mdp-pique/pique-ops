-- Daily silence check (MDP 2026-10-06). The n8n error alert only fires when a
-- run fails. It can't see an automation that quietly stopped: a Zap switched
-- off, a feed that runs but posts nothing, a sync that stopped bringing rows.
-- This lists those gaps from the data each automation leaves behind. n8n
-- Pique-Silence-Check runs it every morning and posts any rows to the n8n
-- errors channel (the same place as the error alerts); no rows, no post.
-- Add a check by adding a union branch: (check_key, what is wrong in words).

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
$$;

revoke execute on function public.automation_silence_check() from public, anon, authenticated;
