-- Two Pique Bot changes (MDP 10-07):
--
-- 1. Email from Chrangela (chrangela.mail@gmail.com) or PEKA (@peka.ca) to info@ becomes an
--    email rule, replacing the standalone n8n workflow "Chrangela & PEKA Email → Slack Alert"
--    (lWQjXeTxGmDQDzQI, built outside this repo 10-03), which posted a Claude summary to
--    #pique-team-chat with @channel. Now: an email_alert ticket posted there by Pique Bot with
--    Done / Not yet and the start of the email, no @channel (rule key email:chrangela_peka).
--    Starts unarmed, so its first run only records existing mail as seen.
-- 2. Pet fees post to #new-reservation-with-pet as soon as the booking comes in (src config),
--    so the silence check now expects a post for every new pet fee ticket too.

insert into public.email_alert_rules (key, label, gmail_query, title, items, priority, replaces_zap, mailbox, active, armed)
values ('chrangela_peka', 'Chrangela / PEKA',
        'from:(chrangela.mail@gmail.com OR @peka.ca) newer_than:2d -from:me',
        'Email from Chrangela / PEKA', array['Read and handled'], 'normal',
        'n8n Chrangela & PEKA Email → Slack Alert', 'info', true, false)
on conflict (key) do nothing;

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
      -- Pet fees post as soon as the booking comes in (not gated).
      or t.type = 'pet_fee'
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
  -- Review QC (Pique-Bot-Reviews): every recent review gets a review_qc row from the trigger...
  select 'review_qc_trigger',
         count(*) || ' new review(s) from the last day have no quality-control record (the reviews trigger may be failing).'
  from reviews r
  where r.created_at between now() - interval '24 hours' and now() - interval '15 minutes'
    and coalesce(nullif(r.raw_hospitable_data->>'reviewed_at', '')::timestamptz, r.review_date::timestamptz) > now() - interval '45 days'
    and not exists (select 1 from review_qc q where q.review_id = r.id)
  having count(*) > 0

  union all
  -- ...and each unflagged one is posted to #quality-control-reviews within minutes.
  select 'review_qc_feed',
         count(*) || ' review(s) were never posted to #quality-control-reviews.'
  from review_qc
  where not flagged and slack_ts is null and created_at < now() - interval '1 hour'
    and created_at > now() - interval '3 days'
  having count(*) > 0
$$;

revoke execute on function public.automation_silence_check() from public, anon, authenticated;
