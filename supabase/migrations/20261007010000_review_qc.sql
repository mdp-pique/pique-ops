-- Review quality control (docs/zapier-migration.md lane Q). Replaces "Finding Clean
-- when Review is Submitted" (P1-76) and "Quality Control Reviews (Canmore and
-- Calgary)" (P1-102). Both read a Google Sheet that "Reviews for Connecteam
-- Clockouts" (P1-71) filled; that Zap was turned off 10-02, so nothing has posted
-- to #quality-control-reviews since.
--
-- Now every new guest review (public.reviews, synced from Hospitable) gets one
-- review_qc row, made by an exception-safe trigger: the cleaner of the checkout
-- clean (Edmonton only - MDP 10-07: leave the cleaner out for Canmore and Calgary),
-- and whether cleanliness was rated below 5. Pique Bot posts each review once to
-- #quality-control-reviews (src/lib/pique-bot/reviews.ts). A cleanliness score
-- below 5 also opens a cleaning_issue ticket (external_ref 'review_qc:{review}'),
-- which Pique Bot posts there instead, tagging Tammy, with Done / Not yet.
-- review_qc is also the log the Zap kept on the sheet's "Cleaner Reviews" tab.

create table public.review_qc (
  review_id uuid primary key references public.reviews(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  reservation_id uuid references public.reservations(id) on delete set null,
  -- The clean after the stay and who was on it (null for Canmore / Calgary, or no shift found).
  cleaning_date date,
  cleaner_names text,
  cleanliness numeric,
  flagged boolean not null default false,
  ticket_id uuid references public.tickets(id) on delete set null,
  -- Unflagged reviews: the FYI post (claimed by setting posted_at before posting).
  channel_id text,
  slack_ts text,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);
create index review_qc_unposted_idx on public.review_qc (created_at) where posted_at is null;

alter table public.review_qc enable row level security;
create policy review_qc_read on public.review_qc for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

-- Who cleaned after a checkout: the shift titled with the reservation code first
-- (connecteam_shifts), else the property's Connecteam job on checkout day
-- (cleaning_shift_check). Names of everyone assigned, comma separated.
create or replace function public.review_cleaner(p_property uuid, p_check_out date, p_code text)
returns table (cleaning_date date, cleaner_names text)
language sql
stable
security definer
set search_path = public
as $$
  with shift as (
    select d, ids from (
      select cs.shift_date as d, cs.assigned_user_ids as ids, 0 as prio, cs.start_at as at
      from connecteam_shifts cs
      where p_code is not null and cs.reservation_code = p_code and cs.assigned_count > 0
        and cs.shift_date between p_check_out - 1 and p_check_out + 2
      union all
      select c.check_date, c.assigned_user_ids, 1, c.shift_start
      from cleaning_shift_check c
      join cleaning_job_map m on m.connecteam_job_id = c.connecteam_job_id
      where m.property_id = p_property and c.check_date = p_check_out and c.assigned_count > 0
    ) s
    order by prio, at
    limit 1
  )
  select shift.d,
         (select string_agg(u.full_name, ', ' order by u.full_name)
          from jsonb_array_elements_text(shift.ids) x(id)
          join connecteam_users u on u.user_id::text = x.id)
  from shift;
$$;

-- One review -> its review_qc row, plus a cleaning_issue ticket when cleanliness < 5.
-- Returns 'flagged', 'recorded', 'seen' (already done), 'old' or 'missing'.
create or replace function public.record_review_qc(p_review uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r reviews%rowtype;
  v_market text;
  v_unit text;
  v_code text;
  v_check_in date;
  v_check_out date;
  v_reviewed timestamptz;
  v_clean numeric;
  v_flagged boolean;
  v_cleaning date;
  v_cleaners text;
  v_inserted uuid;
  v_ticket uuid;
  v_comment text;
  v_scale numeric;
begin
  select * into r from reviews where id = p_review;
  if not found then
    return 'missing';
  end if;
  v_reviewed := coalesce(nullif(r.raw_hospitable_data->>'reviewed_at', '')::timestamptz, r.review_date::timestamptz, r.created_at);
  -- A re-sync that brings in old reviews must not flood the channel. Airbnb only
  -- releases a review up to two weeks after it is written, so allow 45 days.
  if v_reviewed < now() - interval '45 days' then
    return 'old';
  end if;

  select p.market, regexp_replace(trim(coalesce(p.property_name, p.public_name, 'Unit')), '\*+$', '')
    into v_market, v_unit
  from properties p where p.id = r.property_id;
  select res.confirmation_code, res.check_in, res.check_out into v_code, v_check_in, v_check_out
  from reservations res where res.id = r.reservation_id;

  if v_check_out is not null and coalesce(v_market, '') not in ('Canmore', 'Calgary') then
    select c.cleaning_date, c.cleaner_names into v_cleaning, v_cleaners
    from review_cleaner(r.property_id, v_check_out, v_code) c;
  end if;

  -- 0 means the platform didn't ask (direct, most Booking.com); only a real score below 5 flags.
  -- Booking.com scores out of 10 (overall_rating is already out of 5, the categories are not).
  v_scale := case when r.booking_source = 'booking' then 2 else 1 end;
  v_clean := nullif(r.cleanliness_rating, 0) / v_scale;
  v_flagged := v_clean is not null and v_clean < 5;

  insert into review_qc (review_id, property_id, reservation_id, cleaning_date, cleaner_names, cleanliness, flagged)
  values (r.id, r.property_id, r.reservation_id, v_cleaning, v_cleaners, v_clean, v_flagged)
  on conflict (review_id) do nothing
  returning review_id into v_inserted;
  if v_inserted is null then
    return 'seen';
  end if;
  if not v_flagged then
    return 'recorded';
  end if;

  select nullif(trim(d->>'comment'), '') into v_comment
  from jsonb_array_elements(coalesce(r.raw_hospitable_data->'private'->'detailed_ratings', '[]'::jsonb)) d
  where d->>'type' = 'cleanliness'
  limit 1;

  insert into tickets (type, status, priority, stage, source, property_id, reservation_id, guest_name, external_ref, metadata)
  values ('cleaning_issue', 'open', 'normal', 'turnover', 'automation', r.property_id, r.reservation_id, r.reviewer_name,
          'review_qc:' || r.id,
          jsonb_build_object(
            'title', 'Cleanliness rated ' || rtrim(to_char(v_clean, 'FM990.9'), '.') || ' - ' || coalesce(v_unit, 'unit'),
            'source', 'review',
            'review_id', r.id,
            'platform', coalesce(r.booking_source, r.raw_hospitable_data->>'platform'),
            'market', v_market,
            'check_in', v_check_in,
            'check_out', v_check_out,
            'cleaning_date', v_cleaning,
            'cleaner_names', v_cleaners,
            'overall', nullif(r.overall_rating, 0),
            'cleanliness', v_clean,
            'cleanliness_comment', v_comment,
            'communication', nullif(r.communication_rating, 0) / v_scale,
            'checkin', nullif(r.checkin_rating, 0) / v_scale,
            'accuracy', nullif(r.accuracy_rating, 0) / v_scale,
            'location', nullif(r.location_rating, 0) / v_scale,
            'value', nullif(r.value_rating, 0) / v_scale,
            'public_review', nullif(trim(coalesce(r.review_text, '')), ''),
            'private_feedback', nullif(trim(coalesce(r.raw_hospitable_data->'private'->>'feedback', '')), ''),
            'reviewed_at', v_reviewed))
  on conflict (external_ref) do nothing
  returning id into v_ticket;

  if v_ticket is not null then
    insert into ticket_items (ticket_id, label, sort_order) values (v_ticket, 'Followed up on the clean', 0);
    insert into ticket_events (ticket_id, event_type, to_value, note, payload)
    values (v_ticket, 'status_change', 'open',
            'Created automatically: guest rated cleanliness ' || rtrim(to_char(v_clean, 'FM990.9'), '.') || ' out of 5' ||
            coalesce(' (cleaned by ' || v_cleaners || ')', ''), '{}'::jsonb);
    update review_qc set ticket_id = v_ticket where review_id = r.id;
  end if;
  return 'flagged';
end;
$$;

-- Never blocks or rolls back the Hospitable review sync.
create or replace function public.mirror_review_to_qc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.record_review_qc(new.id);
  exception when others then
    raise warning 'mirror_review_to_qc failed for review %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger mirror_review_to_qc
after insert on public.reviews
for each row execute function public.mirror_review_to_qc();

revoke execute on function public.review_cleaner(uuid, date, text) from public, anon, authenticated;
revoke execute on function public.record_review_qc(uuid) from public, anon, authenticated;
revoke execute on function public.mirror_review_to_qc() from public, anon, authenticated;

-- Everything that came in after the Zap's last post (Oct 2, 7:39 AM: Herman Penner,
-- which reached this table at 12:15 that day).
select public.record_review_qc(id) from public.reviews
where created_at > '2026-10-02 18:20:00+00' order by created_at;

-- Silence check: reviews the trigger missed, and FYI posts that never went out.
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
