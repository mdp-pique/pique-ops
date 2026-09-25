-- Connecteam step 1 (read-only): a local copy of the Job Scheduler's shifts from a
-- week back to ~6 months ahead, refreshed hourly by the n8n workflow
-- Pique-Connecteam-Shifts-Sync. Nothing here writes to Connecteam or touches the
-- Zapier Zap that creates shifts today.
--
-- Used for: future cleans on the calendar, and cleaning_schedule_reconcile - every
-- upcoming booking checked against Connecteam by the reservation code the Zap puts
-- in each shift title ("<property name> - <code>").
--
-- Shift notes are NOT stored: they carry access instructions and door codes.

create table public.connecteam_shifts (
  shift_id text primary key,
  scheduler_id text not null,
  job_id text,
  property_id uuid,
  title text,
  reservation_code text,
  shift_date date,
  start_at timestamptz,
  end_at timestamptz,
  is_published boolean,
  is_open_shift boolean,
  assigned_user_ids jsonb not null default '[]'::jsonb,
  assigned_count integer generated always as (jsonb_array_length(assigned_user_ids)) stored,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when a sync covering this shift's date no longer returns it (deleted in Connecteam).
  gone_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connecteam_shifts_property_id_fkey foreign key (property_id) references public.properties (id) on delete set null
);

create index connecteam_shifts_shift_date_idx on public.connecteam_shifts (shift_date) where gone_at is null;
create index connecteam_shifts_reservation_code_idx on public.connecteam_shifts (reservation_code) where gone_at is null;
create index connecteam_shifts_property_date_idx on public.connecteam_shifts (property_id, shift_date) where gone_at is null;

alter table public.connecteam_shifts enable row level security;

create policy connecteam_shifts_team_read on public.connecteam_shifts
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy connecteam_shifts_service_all on public.connecteam_shifts
  for all to service_role using (true) with check (true);

-- Called by n8n with one batch of shifts (Connecteam API objects, notes stripped)
-- and the time window that batch covers. Upserts what came back; anything in the
-- window we had before but Connecteam no longer returns gets gone_at.
create or replace function public.sync_connecteam_shifts(p_shifts jsonb, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_upserted int := 0;
  v_gone int := 0;
  v_ids text[];
begin
  if jsonb_typeof(p_shifts) is distinct from 'array' then
    raise exception 'p_shifts must be a json array';
  end if;

  with src as (
    select
      s->>'id' as shift_id,
      coalesce(s->>'schedulerId', '') as scheduler_id,
      nullif(s->>'jobId', '') as job_id,
      nullif(trim(s->>'title'), '') as title,
      case when (s->>'startTime') ~ '^\d+$' then to_timestamp((s->>'startTime')::bigint) end as start_at,
      case when (s->>'endTime') ~ '^\d+$' then to_timestamp((s->>'endTime')::bigint) end as end_at,
      (s->>'isPublished')::boolean as is_published,
      (s->>'isOpenShift')::boolean as is_open_shift,
      case when jsonb_typeof(s->'assignedUserIds') = 'array' then s->'assignedUserIds' else '[]'::jsonb end as assigned_user_ids,
      s - 'notes' as raw
    from jsonb_array_elements(p_shifts) s
    where s ? 'id'
  ),
  up as (
    insert into public.connecteam_shifts as c (
      shift_id, scheduler_id, job_id, property_id, title, reservation_code, shift_date, start_at, end_at,
      is_published, is_open_shift, assigned_user_ids, raw, last_seen_at, gone_at, updated_at
    )
    select
      src.shift_id, src.scheduler_id, src.job_id,
      (select m.property_id from public.cleaning_job_map m where m.connecteam_job_id = src.job_id limit 1),
      src.title,
      -- "<property> - <code>": the code is the last " - " segment when it looks like one.
      nullif(substring(src.title from '\s-\s([A-Za-z0-9][A-Za-z0-9-]{4,})\s*$'), ''),
      (src.start_at at time zone 'America/Edmonton')::date,
      src.start_at, src.end_at, src.is_published, src.is_open_shift, src.assigned_user_ids, src.raw,
      now(), null, now()
    from src
    on conflict (shift_id) do update set
      scheduler_id = excluded.scheduler_id,
      job_id = excluded.job_id,
      property_id = excluded.property_id,
      title = excluded.title,
      reservation_code = excluded.reservation_code,
      shift_date = excluded.shift_date,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      is_published = excluded.is_published,
      is_open_shift = excluded.is_open_shift,
      assigned_user_ids = excluded.assigned_user_ids,
      raw = excluded.raw,
      last_seen_at = now(),
      gone_at = null,
      updated_at = now()
    returning c.shift_id
  )
  select count(*), array_agg(shift_id) into v_upserted, v_ids from up;

  update public.connecteam_shifts c
    set gone_at = now(), updated_at = now()
  where c.gone_at is null
    and c.start_at >= p_from and c.start_at < p_to
    and not (c.shift_id = any (coalesce(v_ids, '{}')));
  get diagnostics v_gone = row_count;

  return jsonb_build_object('upserted', v_upserted, 'gone', v_gone, 'from', p_from, 'to', p_to);
end;
$function$;

revoke execute on function public.sync_connecteam_shifts(jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_connecteam_shifts(jsonb, timestamptz, timestamptz) to service_role;

-- Every upcoming checkout the Zap is meant to cover (accepted, Edmonton + Calgary),
-- checked against Connecteam. Read-only; nothing acts on it yet.
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
)
select
  b.*,
  c.code_shifts, c.code_shifts_on_date, c.empty_drafts_on_date, c.crews_on_date, c.shift_ids,
  p.property_shifts_on_date,
  case
    when c.code_shifts = 0 and p.property_shifts_on_date > 0 then 'no_code_but_property_has_shift'
    when c.code_shifts = 0 then 'missing'
    when c.code_shifts_on_date = 0 then 'wrong_date'
    when c.code_shifts_on_date > 1 and c.empty_drafts_on_date > 0 then 'duplicate'
    else 'ok'
  end as reconcile_status
from bookings b
join by_code c using (reservation_id)
join by_property p using (reservation_id);

-- Upcoming shifts that don't belong to any accepted booking: cancelled bookings,
-- moved dates, or hand-made shifts without a code.
create or replace view public.cleaning_schedule_orphans
with (security_invoker = true) as
select s.shift_id, s.title, s.reservation_code, s.shift_date, s.property_id, s.is_published, s.assigned_count,
  r.id as reservation_id, r.status as reservation_status, r.check_out as reservation_check_out,
  case
    when s.reservation_code is null then 'no_code'
    when r.id is null then 'code_not_found'
    when r.status <> 'accepted' then 'booking_' || r.status
    when r.check_out <> s.shift_date then 'date_moved'
  end as orphan_reason
from public.connecteam_shifts s
left join lateral (
  select r.* from public.reservations r where r.confirmation_code = s.reservation_code
  order by (r.status = 'accepted') desc, r.check_out desc limit 1
) r on true
where s.gone_at is null
  and s.shift_date >= (now() at time zone 'America/Edmonton')::date
  and (s.reservation_code is null or r.id is null or r.status <> 'accepted' or r.check_out <> s.shift_date);
