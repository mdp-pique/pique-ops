-- Review QC: find the stay for reviews the sync never links.
--
-- link_review_reservations() (part of the live reviews sync, left untouched) only
-- links a review to a stay that ended at most 45 days before it. Booking.com
-- reviews can come much later (Glenwood MAIN, 10-02: stay Jul 19-20, 74 days),
-- so those posted with no stay, cleaner or Open link. review_qc_stay() looks
-- further back, 120 days, by guest name at the same property, and only for
-- review_qc - reviews.reservation_id stays the sync's.

create or replace function public.review_qc_stay(p_review uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select res.id
  from reviews r
  join reservations res on res.property_id = r.property_id
  join guests g on g.id = res.guest_id
  where r.id = p_review
    and lower(trim(g.full_name)) = lower(trim(r.reviewer_name))
    and (r.review_date - res.check_out) between 0 and 120
    and res.status = 'accepted'
  order by res.check_out desc
  limit 1;
$$;

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
  v_res uuid;
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
  v_res := coalesce(r.reservation_id, public.review_qc_stay(r.id));

  select p.market, regexp_replace(trim(coalesce(p.property_name, p.public_name, 'Unit')), '\*+$', '')
    into v_market, v_unit
  from properties p where p.id = r.property_id;
  select res.confirmation_code, res.check_in, res.check_out into v_code, v_check_in, v_check_out
  from reservations res where res.id = v_res;

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
  values (r.id, r.property_id, v_res, v_cleaning, v_cleaners, v_clean, v_flagged)
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
  values ('cleaning_issue', 'open', 'normal', 'turnover', 'automation', r.property_id, v_res, r.reviewer_name,
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


revoke execute on function public.review_qc_stay(uuid) from public, anon, authenticated;

-- Reviews already recorded without a stay: fill it in, with the cleaner (Edmonton).
update public.review_qc q
set reservation_id = s.res_id,
    cleaning_date = c.cleaning_date,
    cleaner_names = c.cleaner_names
from (
  select q2.review_id, public.review_qc_stay(q2.review_id) as res_id
  from public.review_qc q2 where q2.reservation_id is null
) s
join public.reservations res on res.id = s.res_id
join public.properties p on p.id = res.property_id
left join lateral (
  select * from public.review_cleaner(res.property_id, res.check_out, res.confirmation_code)
  where coalesce(p.market, '') not in ('Canmore', 'Calgary')
) c on true
where q.review_id = s.review_id and s.res_id is not null;
