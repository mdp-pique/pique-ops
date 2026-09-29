-- cleaning_schedule_reconcile matched shifts to bookings only by the reservation code in
-- the shift title, so a checkout whose linked shift was renamed by hand in Connecteam
-- (e.g. "Pleasantview Upstairs" for a joint-listing booking) showed as 'missing' even
-- though the planner has it linked and a cleaner claimed it. Count the linked shift too.
create or replace view public.cleaning_schedule_reconcile
with (security_invoker = true) as
with bookings as (
  select r.id as reservation_id, r.confirmation_code, r.check_out, r.property_id, p.property_name, p.market
  from public.reservations r
  join public.properties p on p.id = r.property_id
  where r.status = 'accepted'
    and p.market in ('Edmonton', 'Calgary')
    and r.check_out >= (now() at time zone 'America/Edmonton')::date
    and r.check_out < (now() at time zone 'America/Edmonton')::date + 183
),
by_code as (
  select b.reservation_id,
    count(s.shift_id) as code_shifts,
    count(s.shift_id) filter (where s.shift_date = b.check_out) as code_shifts_on_date,
    count(s.shift_id) filter (where s.shift_date = b.check_out and s.assigned_count = 0 and not coalesce(s.is_published, false)) as empty_drafts_on_date,
    count(distinct s.assigned_user_ids::text) filter (where s.shift_date = b.check_out and s.assigned_count > 0) as crews_on_date,
    array_agg(s.shift_id order by s.start_at) filter (where s.shift_id is not null) as shift_ids
  from bookings b
  left join public.connecteam_shifts s on s.reservation_code = b.confirmation_code and s.gone_at is null
  group by b.reservation_id
),
by_property as (
  select b.reservation_id, count(s.shift_id) as property_shifts_on_date
  from bookings b
  left join public.connecteam_shifts s
    on s.property_id = b.property_id and s.shift_date = b.check_out and s.gone_at is null
  group by b.reservation_id
),
linked as (
  select b.reservation_id
  from bookings b
  join public.cleaning_shift_links l on l.reservation_id = b.reservation_id
  join public.connecteam_shifts s on s.shift_id = l.shift_id and s.gone_at is null and s.shift_date = b.check_out
)
select
  b.*,
  c.code_shifts, c.code_shifts_on_date, c.empty_drafts_on_date, c.crews_on_date, c.shift_ids,
  p.property_shifts_on_date,
  case
    when c.code_shifts_on_date = 0 and lk.reservation_id is not null then 'ok'
    when c.code_shifts = 0 and p.property_shifts_on_date > 0 then 'no_code_but_property_has_shift'
    when c.code_shifts = 0 then 'missing'
    when c.code_shifts_on_date = 0 then 'wrong_date'
    when c.code_shifts_on_date > 1 and c.empty_drafts_on_date > 0 then 'duplicate'
    else 'ok'
  end as reconcile_status
from bookings b
join by_code c using (reservation_id)
join by_property p using (reservation_id)
left join linked lk using (reservation_id);
