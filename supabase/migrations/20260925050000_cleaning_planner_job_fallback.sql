-- The booking-driven shift planner only covered properties in cleaning_property_jobs,
-- a snapshot of the "Connecteam Lookup" sheet taken at launch. A property set up in
-- Connecteam afterwards (Hicham - Elbow Dr, 2026-09-25) was silently skipped. Fall
-- back to cleaning_job_map when it names exactly one job for the property.

create or replace function public.plan_cleaning_shift_actions()
returns table (action text, reservation_id uuid, property_id uuid, shift_id text, check_out date, payload jsonb)
language sql
stable
security definer
set search_path to 'public'
as $function$
with today as (select (now() at time zone 'America/Edmonton')::date as d),
bk as (
  select r.id, r.confirmation_code as code, r.check_out, r.status, r.property_id, r.guest_count,
    g.full_name as guest_name, p.property_name, p.address, coalesce(pj.connecteam_job_id, mj.job_id) as job_id,
    (r.check_out + coalesce(nullif(p.checkout_time, ''), '10:00')::time) at time zone 'America/Edmonton' as start_at,
    least(
      ((r.check_out + coalesce(nullif(p.checkout_time, ''), '10:00')::time) at time zone 'America/Edmonton') + interval '4 hours',
      (r.check_out + coalesce(nullif(p.checkin_time, ''), '16:00')::time) at time zone 'America/Edmonton'
    ) as end_at
  from public.reservations r
  join public.properties p on p.id = r.property_id
  left join public.cleaning_property_jobs pj on pj.property_id = r.property_id
  -- Fallback for properties set up in Connecteam after launch: the job mapping,
  -- when it names exactly one job for the property.
  left join lateral (
    select min(m.connecteam_job_id) as job_id
    from public.cleaning_job_map m
    where m.property_id = r.property_id
    having count(distinct m.connecteam_job_id) = 1
  ) mj on true
  left join public.guests g on g.id = r.guest_id
  cross join today
  where p.market in ('Edmonton', 'Calgary')
    and coalesce(pj.connecteam_job_id, mj.job_id) is not null
    and r.confirmation_code is not null
    and r.check_out >= today.d
    and r.check_out < today.d + 183
),
shaped as (
  select bk.*,
    jsonb_build_object(
      'title', bk.property_name || ' - ' || bk.code,
      'job_id', bk.job_id,
      'start_time', extract(epoch from bk.start_at)::bigint,
      'end_time', extract(epoch from bk.end_at)::bigint,
      'timezone', 'America/Edmonton',
      'address', bk.address,
      'guest_name', bk.guest_name,
      'guest_count', bk.guest_count,
      'property_name', bk.property_name,
      'code', bk.code,
      'check_out', bk.check_out
    ) as p
  from bk
),
acc as (
  select s.*, l.shift_id as linked_id, ls.shift_date as linked_date, ls.gone_at as linked_gone,
    (ls.shift_id is not null) as linked_seen
  from shaped s
  left join public.cleaning_shift_links l on l.reservation_id = s.id
  left join public.connecteam_shifts ls on ls.shift_id = l.shift_id
  where s.status = 'accepted'
)
-- Linked shift on the wrong day: move it.
select 'move', a.id, a.property_id, a.linked_id, a.check_out, a.p || jsonb_build_object('from_date', a.linked_date)
from acc a
where a.linked_id is not null and a.linked_seen and a.linked_gone is null and a.linked_date is distinct from a.check_out
union all
-- Linked shift was deleted in Connecteam: make a new one.
select 'create', a.id, a.property_id, null, a.check_out, a.p || jsonb_build_object('replaces', a.linked_id)
from acc a
where a.linked_id is not null and a.linked_gone is not null
union all
-- Not linked yet: adopt the shift the Zap made (best match by reservation code), or create one.
select case when c.shift_id is null then 'create' else 'adopt' end, a.id, a.property_id, c.shift_id, a.check_out, a.p
from acc a
left join lateral (
  select cs.shift_id from public.connecteam_shifts cs
  where cs.reservation_code = a.code and cs.gone_at is null
  order by (cs.shift_date = a.check_out) desc, (cs.assigned_count > 0) desc, coalesce(cs.is_published, false) desc, cs.first_seen_at
  limit 1
) c on true
where a.linked_id is null
union all
-- Extra copies of a linked booking's shift that nobody touched: remove.
select 'remove_duplicate', a.id, a.property_id, d.shift_id, a.check_out, a.p || jsonb_build_object('keep', a.linked_id)
from acc a
join public.connecteam_shifts d
  on d.reservation_code = a.code and d.gone_at is null and d.shift_id <> a.linked_id
 and d.assigned_count = 0 and not coalesce(d.is_published, false)
where a.linked_id is not null and a.linked_seen and a.linked_gone is null
union all
-- Cancelled / declined bookings: remove unclaimed shifts, flag claimed ones.
select case when x.assigned_count = 0 and not coalesce(x.is_published, false) then 'remove' else 'flag_claimed' end,
  s.id, s.property_id, x.shift_id, s.check_out,
  s.p || jsonb_build_object('booking_status', s.status, 'assigned_count', x.assigned_count, 'published', x.is_published, 'shift_date', x.shift_date)
from shaped s
join public.connecteam_shifts x
  on x.gone_at is null and x.shift_date >= (select d from today)
 and (x.reservation_code = s.code or x.shift_id = (select l.shift_id from public.cleaning_shift_links l where l.reservation_id = s.id))
where s.status <> 'accepted'
  -- never touch a shift whose code also belongs to a live booking
  and not exists (select 1 from public.reservations r2 where r2.confirmation_code = s.code and r2.status = 'accepted');
$function$;

revoke execute on function public.plan_cleaning_shift_actions() from public, anon, authenticated;
grant execute on function public.plan_cleaning_shift_actions() to service_role;
