-- Cleaning shifts for client accounts (cleaning-only clients with their own Hospitable login), starting
-- with Stephan (MDP 10-13: shifts in Connecteam for every booking, moved when dates change, removed when
-- cancelled). Replaces the Zap "New - Cleaning from Stephan to Connecteam" (P2-51); Padmore (P2-31) joins
-- once its token is in n8n.
--
-- Kept apart from reservations / properties on purpose: client stays must never trigger our own pet fee,
-- booking feed, guest count, parking or review flows. Kept apart from the live planner too
-- (plan_cleaning_shift_actions, cleaning_shift_links / _actions are tied to reservations by foreign key);
-- this is a parallel copy of its logic over client bookings, with its own switch
-- (automation_flags.client_cleaning_shifts_mode: dry_run logs and adopts only, live writes to Connecteam).
--   n8n Pique-Client-Bookings-Sync   hourly: each client account's bookings -> sync_client_reservations()
--   n8n Pique-Client-Cleaning-Shifts every 10 min: run_client_cleaning_shift_planner() -> Connecteam,
--                                    complete_client_cleaning_shift_action() records each result
-- A booking at a listing with several jobs (Stephan's Joint Listing = Main + Basement) gets one shift per job.

create table public.client_listings (
  hospitable_property_id text primary key,
  account text not null,
  name text not null,
  address text,
  checkout_time text not null default '11:00',
  checkin_time text not null default '16:00',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Which Connecteam job(s) a client listing's cleans go on, the shift title (before " - {code}") and
-- how long the clean is booked for (never past check-in).
create table public.client_listing_jobs (
  hospitable_property_id text not null references public.client_listings(hospitable_property_id) on delete cascade,
  connecteam_job_id text not null,
  shift_label text not null,
  minutes int not null default 240 check (minutes between 30 and 720),
  primary key (hospitable_property_id, connecteam_job_id)
);

create table public.client_reservations (
  hospitable_reservation_id text primary key,
  account text not null,
  hospitable_property_id text not null references public.client_listings(hospitable_property_id) on delete cascade,
  code text,
  check_in date,
  check_out date,
  status text not null,          -- Hospitable's category (accepted, cancelled, ...), or 'not_returned'
  guest_name text,
  guest_count int,
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now()
);
create index client_reservations_code on public.client_reservations (code);
create index client_reservations_check_out on public.client_reservations (check_out);

create table public.client_cleaning_shift_links (
  client_reservation_id text not null references public.client_reservations(hospitable_reservation_id) on delete cascade,
  connecteam_job_id text not null,
  shift_id text not null unique,
  linked_via text not null check (linked_via in ('created', 'adopted')),
  booked_check_out date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_reservation_id, connecteam_job_id)
);

create table public.client_cleaning_shift_actions (
  id bigint generated always as identity primary key,
  mode text not null check (mode in ('dry_run', 'live')),
  action text not null check (action in ('create', 'adopt', 'move', 'remove', 'remove_duplicate', 'flag_claimed', 'flag_date_change')),
  client_reservation_id text references public.client_reservations(hospitable_reservation_id) on delete set null,
  connecteam_job_id text,
  shift_id text,
  check_out date,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  status text not null default 'planned' check (status in ('planned', 'done', 'failed', 'skipped')),
  result jsonb,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

-- Client guests' names and stays: server (service_role / n8n) only.
alter table public.client_listings enable row level security;
alter table public.client_listing_jobs enable row level security;
alter table public.client_reservations enable row level security;
alter table public.client_cleaning_shift_links enable row level security;
alter table public.client_cleaning_shift_actions enable row level security;

insert into public.automation_flags (key, value, note) values
  ('client_cleaning_shifts_mode', 'dry_run',
   'Pique-Client-Cleaning-Shifts: dry_run = plan and log only (adopts existing shifts); live = create / move / remove client cleaning shifts in Connecteam.'),
  ('client_cleaning_shifts_batch', '20', 'Most client shift actions sent to Connecteam per run.')
on conflict (key) do nothing;

-- Stephan (Hospitable account checked 10-13: three listings at 850 35A Ave NW). Jobs and lengths from the
-- shifts the team has been making by hand: "Stephan Main" 11:00-15:00, "Stephan BSMT" 11:00-13:30.
insert into public.client_listings (hospitable_property_id, account, name, address) values
  ('6352a3d8-f389-4334-ab32-4b99ca1eb36f', 'stephan', 'Stephan''s Main', '850 35A Avenue Northwest, Edmonton, AB T6T 1A2'),
  ('3e311797-68c6-4188-8653-7325287b2980', 'stephan', 'Stephan''s Basement', 'Basement, 850 35A Avenue Northwest, Edmonton, AB T6T 1A2'),
  ('55694e3a-52a2-4e74-92de-b04bafc52ba5', 'stephan', 'Stephan''s Joint Listing', '850 35A Avenue Northwest, Edmonton, AB T6T 1A2');
insert into public.client_listing_jobs (hospitable_property_id, connecteam_job_id, shift_label, minutes) values
  ('6352a3d8-f389-4334-ab32-4b99ca1eb36f', 'fd0a7c6e-7325-341f-4241-053c9af1541a', 'Stephan Main', 240),
  ('3e311797-68c6-4188-8653-7325287b2980', '16e75e09-786b-a3fd-db99-f4ee5795a2ad', 'Stephan BSMT', 150),
  ('55694e3a-52a2-4e74-92de-b04bafc52ba5', 'fd0a7c6e-7325-341f-4241-053c9af1541a', 'Stephan Main', 240),
  ('55694e3a-52a2-4e74-92de-b04bafc52ba5', '16e75e09-786b-a3fd-db99-f4ee5795a2ad', 'Stephan BSMT', 150);

-- n8n sends one account's bookings, already shaped: [{id, property_id, code, check_in, check_out, status,
-- guest_name, guest_count}]. Bookings at listings we don't clean are ignored. When p_complete (the API
-- returned every booking in the window), a booking in the window that is no longer returned is marked
-- 'not_returned', so its shift comes off like a cancellation.
create or replace function public.sync_client_reservations(p_account text, p_rows jsonb, p_complete boolean, p_from date, p_to date)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_upserted int;
  v_gone int := 0;
begin
  with src as (
    select r->>'id' as id, r->>'property_id' as property_id, nullif(r->>'code', '') as code,
           nullif(r->>'check_in', '')::date as check_in, nullif(r->>'check_out', '')::date as check_out,
           coalesce(nullif(r->>'status', ''), 'unknown') as status, nullif(r->>'guest_name', '') as guest_name,
           nullif(r->>'guest_count', '')::int as guest_count
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where exists (select 1 from client_listings l where l.hospitable_property_id = r->>'property_id' and l.account = p_account)
  ), up as (
    insert into client_reservations (hospitable_reservation_id, account, hospitable_property_id, code, check_in, check_out, status, guest_name, guest_count, last_synced_at)
    select id, p_account, property_id, code, check_in, check_out, status, guest_name, guest_count, now() from src
    on conflict (hospitable_reservation_id) do update set
      hospitable_property_id = excluded.hospitable_property_id, code = excluded.code, check_in = excluded.check_in,
      check_out = excluded.check_out, status = excluded.status, guest_name = excluded.guest_name,
      guest_count = excluded.guest_count, last_synced_at = now()
    returning 1
  )
  select count(*) into v_upserted from up;

  if p_complete then
    update client_reservations r set status = 'not_returned', last_synced_at = now()
    where r.account = p_account and r.status <> 'not_returned'
      and r.check_out between p_from and p_to
      and not exists (select 1 from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x where x->>'id' = r.hospitable_reservation_id);
    get diagnostics v_gone = row_count;
  end if;
  return jsonb_build_object('upserted', v_upserted, 'not_returned', v_gone);
end;
$$;

-- The same plan as plan_cleaning_shift_actions(), over client bookings x their listing's jobs.
create or replace function public.plan_client_cleaning_shift_actions()
returns table (action text, client_reservation_id text, connecteam_job_id text, shift_id text, check_out date, payload jsonb)
language sql
stable
set search_path = public
as $$
with today as (select (now() at time zone 'America/Edmonton')::date as d),
bk as (
  select r.hospitable_reservation_id as rid, r.code, r.check_out, r.status, r.guest_name, r.guest_count,
    l.name as listing, l.address, j.connecteam_job_id as job_id, j.shift_label,
    (r.check_out + l.checkout_time::time) at time zone 'America/Edmonton' as start_at,
    least(((r.check_out + l.checkout_time::time) at time zone 'America/Edmonton') + make_interval(mins => j.minutes),
          (r.check_out + l.checkin_time::time) at time zone 'America/Edmonton') as end_at
  from client_reservations r
  join client_listings l on l.hospitable_property_id = r.hospitable_property_id and l.active
  join client_listing_jobs j on j.hospitable_property_id = l.hospitable_property_id
  cross join today
  where r.code is not null and r.check_out >= today.d and r.check_out < today.d + 183
),
shaped as (
  select bk.*,
    jsonb_build_object(
      'title', bk.shift_label || ' - ' || bk.code,
      'job_id', bk.job_id,
      'start_time', extract(epoch from bk.start_at)::bigint,
      'end_time', extract(epoch from bk.end_at)::bigint,
      'timezone', 'America/Edmonton',
      'address', bk.address,
      'guest_name', bk.guest_name,
      'guest_count', bk.guest_count,
      'property_name', bk.listing,
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
  left join client_cleaning_shift_links l on l.client_reservation_id = s.rid and l.connecteam_job_id = s.job_id
  left join connecteam_shifts ls on ls.shift_id = l.shift_id
  where s.status = 'accepted'
)
-- Checkout moved: move the shift, or flag it when a cleaner has already claimed it.
select case when a.linked_claimed then 'flag_date_change' else 'move' end,
  a.rid, a.job_id, a.linked_id, a.check_out,
  a.p || jsonb_build_object('from_date', a.linked_date, 'booked_for', a.booked_check_out,
    'shift_start_local', to_char(a.linked_start at time zone 'America/Edmonton', 'Mon DD HH24:MI'))
from acc a
where a.linked_id is not null and a.linked_seen and a.linked_gone is null
  and a.linked_date is distinct from a.check_out
  and a.booked_check_out is not null and a.booked_check_out <> a.check_out
union all
-- Its shift was deleted in Connecteam: make a new one.
select 'create', a.rid, a.job_id, null, a.check_out, a.p || jsonb_build_object('replaces', a.linked_id)
from acc a
where a.linked_id is not null and a.linked_gone is not null
union all
-- No shift yet: adopt one already there (titled with the code, or a hand-made shift on that job that
-- day with no code), else create it.
select case when c.shift_id is null then 'create' else 'adopt' end, a.rid, a.job_id, c.shift_id, a.check_out, a.p
from acc a
left join lateral (
  select cs.shift_id from connecteam_shifts cs
  where cs.job_id = a.job_id and cs.gone_at is null
    and (cs.reservation_code = a.code or (cs.reservation_code is null and cs.shift_date = a.check_out))
    and not exists (select 1 from client_cleaning_shift_links l2 where l2.shift_id = cs.shift_id)
    and not exists (select 1 from cleaning_shift_links l3 where l3.shift_id = cs.shift_id)
  order by (cs.reservation_code = a.code) desc nulls last, (cs.shift_date = a.check_out) desc,
    (cs.assigned_count > 0) desc, coalesce(cs.is_published, false) desc, cs.first_seen_at
  limit 1
) c on true
where a.linked_id is null
union all
-- Extra unclaimed shifts for the same booking and job.
select 'remove_duplicate', a.rid, a.job_id, d.shift_id, a.check_out, a.p || jsonb_build_object('keep', a.linked_id)
from acc a
join connecteam_shifts d
  on d.reservation_code = a.code and d.job_id = a.job_id and d.gone_at is null and d.shift_id <> a.linked_id
 and d.assigned_count = 0 and not coalesce(d.is_published, false)
where a.linked_id is not null and a.linked_seen and a.linked_gone is null
union all
-- Cancelled (or gone from Hospitable): remove its shift, or flag it when already claimed.
select case when x.assigned_count = 0 and not coalesce(x.is_published, false) then 'remove' else 'flag_claimed' end,
  s.rid, s.job_id, x.shift_id, s.check_out,
  s.p || jsonb_build_object('booking_status', s.status, 'assigned_count', x.assigned_count, 'published', x.is_published, 'shift_date', x.shift_date)
from shaped s
join connecteam_shifts x
  on x.gone_at is null and x.shift_date >= (select d from today) and x.job_id = s.job_id
 and (x.reservation_code = s.code
      or x.shift_id = (select l.shift_id from client_cleaning_shift_links l where l.client_reservation_id = s.rid and l.connecteam_job_id = s.job_id))
where s.status <> 'accepted'
  and not exists (select 1 from client_reservations r2 where r2.code = s.code and r2.status = 'accepted');
$$;

create or replace function public.run_client_cleaning_shift_planner()
returns table (id bigint, action text, client_reservation_id text, shift_id text, payload jsonb)
language plpgsql
set search_path = public
as $$
declare
  v_mode text := coalesce((select value from automation_flags where key = 'client_cleaning_shifts_mode'), 'dry_run');
  v_batch int := coalesce(nullif((select value from automation_flags where key = 'client_cleaning_shifts_batch'), '')::int, 20);
begin
  -- A linked shift that sits on the booking's checkout records that date as what it was booked for.
  update client_cleaning_shift_links l
    set booked_check_out = r.check_out, updated_at = now()
  from client_reservations r, connecteam_shifts s
  where r.hospitable_reservation_id = l.client_reservation_id and s.shift_id = l.shift_id and s.gone_at is null
    and s.shift_date = r.check_out and l.booked_check_out is distinct from r.check_out;

  create temporary table if not exists _client_cleaning_plan (
    action text, client_reservation_id text, connecteam_job_id text, shift_id text, check_out date, payload jsonb, dedupe_key text
  ) on commit drop;
  truncate _client_cleaning_plan;

  insert into _client_cleaning_plan
  select p.action, p.client_reservation_id, p.connecteam_job_id, p.shift_id, p.check_out, p.payload,
    v_mode || ':' || p.action || ':' || coalesce(p.client_reservation_id, '') || ':' || coalesce(p.connecteam_job_id, '') || ':' ||
      coalesce(p.shift_id, '') || ':' || coalesce(p.check_out::text, '')
  from plan_client_cleaning_shift_actions() p;

  insert into client_cleaning_shift_actions (mode, action, client_reservation_id, connecteam_job_id, shift_id, check_out, payload, dedupe_key)
  select v_mode, c.action, c.client_reservation_id, c.connecteam_job_id, c.shift_id, c.check_out, c.payload, c.dedupe_key
  from _client_cleaning_plan c
  on conflict (dedupe_key) do nothing;

  update client_cleaning_shift_actions a
    set status = 'skipped', done_at = now(), result = jsonb_build_object('reason', 'no longer in the plan')
  where a.mode = v_mode and a.status = 'planned' and a.action <> 'adopt'
    and not exists (select 1 from _client_cleaning_plan c where c.dedupe_key = a.dedupe_key);

  -- Adopting only links a shift that is already there, so it happens in either mode.
  with todo as (
    select a.id, a.client_reservation_id, a.connecteam_job_id, a.shift_id, a.check_out from client_cleaning_shift_actions a
    where a.action = 'adopt' and a.status = 'planned' and a.mode = v_mode
  ),
  linked as (
    insert into client_cleaning_shift_links (client_reservation_id, connecteam_job_id, shift_id, linked_via, booked_check_out)
    select t.client_reservation_id, t.connecteam_job_id, t.shift_id, 'adopted', t.check_out from todo t
    where t.client_reservation_id is not null
    on conflict do nothing
    returning client_cleaning_shift_links.shift_id
  )
  update client_cleaning_shift_actions a
    set status = case when a.shift_id in (select l.shift_id from linked l) then 'done' else 'skipped' end,
        done_at = now()
  from todo t where t.id = a.id;

  if v_mode <> 'live' then
    return;
  end if;

  return query
  select a.id, a.action, a.client_reservation_id, a.shift_id, a.payload
  from client_cleaning_shift_actions a
  where a.mode = 'live' and a.status = 'planned' and a.action <> 'adopt'
  order by case a.action when 'create' then 0 when 'move' then 1 when 'flag_claimed' then 2 when 'flag_date_change' then 2 else 3 end, a.check_out, a.id
  limit greatest(v_batch, 0);
end;
$$;

create or replace function public.complete_client_cleaning_shift_action(p_id bigint, p_ok boolean, p_result jsonb, p_new_shift_id text default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  a client_cleaning_shift_actions;
begin
  update client_cleaning_shift_actions
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
    insert into client_cleaning_shift_links (client_reservation_id, connecteam_job_id, shift_id, linked_via, booked_check_out)
    values (a.client_reservation_id, a.connecteam_job_id, p_new_shift_id, 'created', a.check_out)
    on conflict (client_reservation_id, connecteam_job_id) do update set shift_id = excluded.shift_id, linked_via = 'created',
      booked_check_out = excluded.booked_check_out, updated_at = now();
    -- Seen right away, before the hourly schedule copy picks it up (so the next run doesn't create it again).
    insert into connecteam_shifts (shift_id, scheduler_id, job_id, property_id, title, reservation_code, shift_date, start_at, end_at, is_published, is_open_shift)
    values (p_new_shift_id, '7699658', a.payload->>'job_id', null, a.payload->>'title', a.payload->>'code', a.check_out,
            to_timestamp((a.payload->>'start_time')::bigint), to_timestamp((a.payload->>'end_time')::bigint), false, true)
    on conflict (shift_id) do nothing;
  elsif a.action = 'move' then
    update connecteam_shifts
      set shift_date = a.check_out, start_at = to_timestamp((a.payload->>'start_time')::bigint),
          end_at = to_timestamp((a.payload->>'end_time')::bigint), updated_at = now()
    where shift_id = a.shift_id;
    update client_cleaning_shift_links set booked_check_out = a.check_out, updated_at = now()
    where client_reservation_id = a.client_reservation_id and connecteam_job_id = a.connecteam_job_id;
  elsif a.action = 'flag_date_change' then
    update client_cleaning_shift_links set booked_check_out = a.check_out, updated_at = now()
    where client_reservation_id = a.client_reservation_id and connecteam_job_id = a.connecteam_job_id;
  elsif a.action in ('remove', 'remove_duplicate') then
    update connecteam_shifts set gone_at = now(), updated_at = now() where shift_id = a.shift_id;
    delete from client_cleaning_shift_links where shift_id = a.shift_id;
  end if;
  return jsonb_build_object('ok', true, 'status', 'done');
end;
$$;

revoke execute on function public.sync_client_reservations(text, jsonb, boolean, date, date) from public, anon, authenticated;
revoke execute on function public.plan_client_cleaning_shift_actions() from public, anon, authenticated;
revoke execute on function public.run_client_cleaning_shift_planner() from public, anon, authenticated;
revoke execute on function public.complete_client_cleaning_shift_action(bigint, boolean, jsonb, text) from public, anon, authenticated;
