-- Respect shifts the team reschedules by hand.
--
-- On 2026-09-28 the scheduler (Janina) moved two claimed cleans from the Sep 29 checkout to
-- Sep 28 on purpose. The planner saw "shift not on checkout day" and moved them back,
-- overriding her. It could not tell "the booking's date changed" from "a person moved the
-- shift".
--
-- cleaning_shift_links.booked_check_out records the checkout a shift was scheduled for.
-- The planner now moves a shift only when the booking's checkout differs from that, i.e.
-- the booking itself changed. A shift a person moves while the booking stays the same is
-- left alone. When the booking does change and the shift is claimed (assigned or
-- published), it posts to Slack (flag_date_change) instead of moving it.

alter table public.cleaning_shift_links add column if not exists booked_check_out date;

-- Existing links: scheduled for the booking as it stands now. Any shift not on that day
-- today was put there by a person (or is the one the planner just moved back), so it is
-- respected rather than moved.
update public.cleaning_shift_links l set booked_check_out = r.check_out
from public.reservations r where r.id = l.reservation_id and l.booked_check_out is null;

update public.automation_flags set value = value || ',flag_date_change'
where key = 'cleaning_shifts_live_actions' and value not like '%flag_date_change%';

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
    (ls.shift_id is not null) as linked_seen, l.booked_check_out,
    (coalesce(ls.assigned_count, 0) > 0 or coalesce(ls.is_published, false)) as linked_claimed,
    ls.start_at as linked_start
  from shaped s
  left join public.cleaning_shift_links l on l.reservation_id = s.id
  left join public.connecteam_shifts ls on ls.shift_id = l.shift_id
  where s.status = 'accepted'
)
-- Linked shift on the wrong day: move it.
-- Only when the BOOKING's checkout changed since the shift was scheduled for it. A shift
-- the team moved by hand (booking unchanged) is left alone. Claimed shifts (assigned or
-- published) are never moved automatically: flag them so a person reschedules.
select case when a.linked_claimed then 'flag_date_change' else 'move' end,
  a.id, a.property_id, a.linked_id, a.check_out,
  a.p || jsonb_build_object('from_date', a.linked_date, 'booked_for', a.booked_check_out,
    'shift_start_local', to_char(a.linked_start at time zone 'America/Edmonton', 'Mon DD HH24:MI'))
from acc a
where a.linked_id is not null and a.linked_seen and a.linked_gone is null
  and a.linked_date is distinct from a.check_out
  and a.booked_check_out is not null and a.booked_check_out <> a.check_out
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


create or replace function public.run_cleaning_shift_planner()
returns table (id bigint, action text, reservation_id uuid, shift_id text, payload jsonb)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_mode text := coalesce((select value from public.automation_flags where key = 'cleaning_shifts_mode'), 'dry_run');
  v_actions text[] := string_to_array(replace(coalesce(
    (select value from public.automation_flags where key = 'cleaning_shifts_live_actions'),
    'create,move,remove,remove_duplicate,flag_claimed,flag_date_change'), ' ', ''), ',');
  v_batch int := coalesce(nullif((select value from public.automation_flags where key = 'cleaning_shifts_batch'), '')::int, 50);
begin
  -- A linked shift sitting on its booking's checkout day is scheduled for that checkout,
  -- whoever put it there (covers a person moving it to follow a date change).
  update public.cleaning_shift_links l
    set booked_check_out = r.check_out, updated_at = now()
  from public.reservations r, public.connecteam_shifts s
  where r.id = l.reservation_id and s.shift_id = l.shift_id and s.gone_at is null
    and s.shift_date = r.check_out and l.booked_check_out is distinct from r.check_out;

  create temporary table if not exists _cleaning_plan (
    action text, reservation_id uuid, property_id uuid, shift_id text, check_out date, payload jsonb, dedupe_key text
  ) on commit drop;
  truncate _cleaning_plan;

  insert into _cleaning_plan
  select p.action, p.reservation_id, p.property_id, p.shift_id, p.check_out, p.payload,
    v_mode || ':' || p.action || ':' || coalesce(p.reservation_id::text, '') || ':' || coalesce(p.shift_id, '') || ':' || coalesce(p.check_out::text, '')
  from public.plan_cleaning_shift_actions() p;

  insert into public.cleaning_shift_actions (mode, action, reservation_id, property_id, shift_id, check_out, payload, dedupe_key)
  select v_mode, c.action, c.reservation_id, c.property_id, c.shift_id, c.check_out, c.payload, c.dedupe_key
  from _cleaning_plan c
  on conflict (dedupe_key) do nothing;

  -- Anything still waiting that today's plan no longer asks for is out of date.
  update public.cleaning_shift_actions a
    set status = 'skipped', done_at = now(), result = jsonb_build_object('reason', 'no longer in the plan')
  where a.mode = v_mode and a.status = 'planned' and a.action <> 'adopt'
    and not exists (select 1 from _cleaning_plan c where c.dedupe_key = a.dedupe_key);

  -- Adopting only links our record to a shift that already exists; safe in both modes.
  with todo as (
    select a.id, a.reservation_id, a.shift_id, a.check_out from public.cleaning_shift_actions a
    where a.action = 'adopt' and a.status = 'planned' and a.mode = v_mode
  ),
  linked as (
    insert into public.cleaning_shift_links (reservation_id, shift_id, linked_via, booked_check_out)
    select t.reservation_id, t.shift_id, 'adopted', t.check_out from todo t
    where t.reservation_id is not null
    on conflict do nothing
    returning cleaning_shift_links.reservation_id
  )
  update public.cleaning_shift_actions a
    set status = case when a.reservation_id in (select l.reservation_id from linked l) then 'done' else 'skipped' end,
        done_at = now()
  from todo t where t.id = a.id;

  if v_mode <> 'live' then
    return;
  end if;

  return query
  select a.id, a.action, a.reservation_id, a.shift_id, a.payload
  from public.cleaning_shift_actions a
  where a.mode = 'live' and a.status = 'planned' and a.action = any (v_actions)
  -- Creates first: a missing clean matters more than a leftover one.
  order by case a.action when 'create' then 0 when 'move' then 1 when 'flag_claimed' then 2 when 'flag_date_change' then 2 else 3 end, a.check_out, a.id
  limit greatest(v_batch, 0);
end;
$function$;


create or replace function public.complete_cleaning_shift_action(p_id bigint, p_ok boolean, p_result jsonb, p_new_shift_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a public.cleaning_shift_actions;
begin
  update public.cleaning_shift_actions
    set status = case when p_ok then 'done' else 'failed' end, result = p_result, done_at = now()
  where id = p_id and status = 'planned'
  returning * into a;
  if a.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not found or already completed');
  end if;
  if not p_ok then
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;

  if a.action = 'create' and p_new_shift_id is not null then
    insert into public.cleaning_shift_links (reservation_id, shift_id, linked_via, booked_check_out)
    values (a.reservation_id, p_new_shift_id, 'created', a.check_out)
    on conflict (reservation_id) do update set shift_id = excluded.shift_id, linked_via = 'created',
      booked_check_out = excluded.booked_check_out, updated_at = now();
    -- Visible to the planner right away, before the hourly sync picks it up.
    insert into public.connecteam_shifts (shift_id, scheduler_id, job_id, property_id, title, reservation_code, shift_date, start_at, end_at, is_published, is_open_shift)
    values (p_new_shift_id, '7699658', a.payload->>'job_id', a.property_id, a.payload->>'title', a.payload->>'code', a.check_out,
            to_timestamp((a.payload->>'start_time')::bigint), to_timestamp((a.payload->>'end_time')::bigint), false, true)
    on conflict (shift_id) do nothing;
  elsif a.action = 'move' then
    update public.connecteam_shifts
      set shift_date = a.check_out, start_at = to_timestamp((a.payload->>'start_time')::bigint),
          end_at = to_timestamp((a.payload->>'end_time')::bigint), updated_at = now()
    where shift_id = a.shift_id;
    update public.cleaning_shift_links set booked_check_out = a.check_out, updated_at = now()
    where reservation_id = a.reservation_id;
  elsif a.action = 'flag_date_change' then
    -- A person owns it now; do not flag or move it again for this date.
    update public.cleaning_shift_links set booked_check_out = a.check_out, updated_at = now()
    where reservation_id = a.reservation_id;
  elsif a.action in ('remove', 'remove_duplicate') then
    update public.connecteam_shifts set gone_at = now(), updated_at = now() where shift_id = a.shift_id;
    delete from public.cleaning_shift_links where shift_id = a.shift_id;
  end if;
  return jsonb_build_object('ok', true, 'status', 'done');
end;
$function$;

revoke execute on function public.plan_cleaning_shift_actions() from public, anon, authenticated;
grant execute on function public.plan_cleaning_shift_actions() to service_role;
revoke execute on function public.run_cleaning_shift_planner() from public, anon, authenticated;
grant execute on function public.run_cleaning_shift_planner() to service_role;
revoke execute on function public.complete_cleaning_shift_action(bigint, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.complete_cleaning_shift_action(bigint, boolean, jsonb, text) to service_role;

-- The reconcile view shows a shift the team moved on purpose as rescheduled_by_team, not wrong_date.
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
  select b.reservation_id, (s.shift_date = b.check_out) as on_date,
    (s.shift_date <> b.check_out and l.booked_check_out = b.check_out) as moved_by_team
  from bookings b
  join public.cleaning_shift_links l on l.reservation_id = b.reservation_id
  join public.connecteam_shifts s on s.shift_id = l.shift_id and s.gone_at is null
)
select
  b.*,
  c.code_shifts, c.code_shifts_on_date, c.empty_drafts_on_date, c.crews_on_date, c.shift_ids,
  p.property_shifts_on_date,
  case
    when lk.moved_by_team then 'rescheduled_by_team'
    when c.code_shifts_on_date = 0 and lk.on_date then 'ok'
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
