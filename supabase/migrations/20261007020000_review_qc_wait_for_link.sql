-- Review QC fix: wait for the review to be linked to its stay.
--
-- Hospitable-Sync-Reviews-Daily inserts new reviews without a reservation and links
-- them at the end of the run (link_review_reservations(), ~20 s later). The insert
-- trigger from 20261007010000 therefore saw no stay, so no checkout clean and no
-- cleaner. Now:
--   * record_review_qc skips a review that isn't linked yet ('unlinked'); the body
--     moves to record_review_qc_core(review, allow_unlinked) (no drops, so the
--     signature the backfill used stays);
--   * the trigger also fires when reviews.reservation_id is set, which records it;
--   * record_unlinked_review_qc() picks up reviews that never get linked (no
--     matching guest name, Booking.com without a stay) after 10 minutes. The review
--     feed (src/lib/pique-bot/reviews.ts) calls it before posting.

create or replace function public.record_review_qc_core(p_review uuid, p_allow_unlinked boolean)
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
  if r.reservation_id is null and not p_allow_unlinked then
    return 'unlinked';
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

create or replace function public.record_review_qc(p_review uuid)
returns text
language sql
security definer
set search_path = public
as $$
  select public.record_review_qc_core(p_review, false);
$$;

-- Never blocks or rolls back the Hospitable review sync.
create or replace function public.mirror_review_to_qc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.reservation_id is not distinct from new.reservation_id then
    return null;
  end if;
  begin
    perform public.record_review_qc(new.id);
  exception when others then
    raise warning 'mirror_review_to_qc failed for review %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create or replace trigger mirror_review_to_qc
after insert or update of reservation_id on public.reviews
for each row execute function public.mirror_review_to_qc();

-- Reviews the sync never linked to a stay, recorded without one after 10 minutes.
create or replace function public.record_unlinked_review_qc()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  n integer := 0;
begin
  for v_id in
    select r.id from reviews r
    where r.created_at between now() - interval '3 days' and now() - interval '10 minutes'
      and not exists (select 1 from review_qc q where q.review_id = r.id)
    order by r.created_at
  loop
    if public.record_review_qc_core(v_id, true) in ('recorded', 'flagged') then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

revoke execute on function public.record_review_qc_core(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.record_review_qc(uuid) from public, anon, authenticated;
revoke execute on function public.mirror_review_to_qc() from public, anon, authenticated;
revoke execute on function public.record_unlinked_review_qc() from public, anon, authenticated;
grant execute on function public.record_unlinked_review_qc() to service_role;
