-- Replace the Zapier Zap that creates Connecteam cleaning shifts. Bookings are the
-- source of truth; Connecteam is where shifts get written. For every upcoming
-- checkout at a mapped Edmonton/Calgary property there should be exactly one shift:
--   new booking      -> create it (or adopt the shift the Zap already made)
--   dates changed    -> move that same shift
--   cancelled        -> remove it if nobody claimed it, otherwise flag it in Slack
--   extra copies     -> remove empty, unpublished duplicates of an adopted shift
-- The n8n workflow Pique-Cleaning-Shifts-From-Bookings runs the planner every 10
-- minutes. automation_flags.cleaning_shifts_mode = 'dry_run' records what it would
-- do without touching Connecteam; 'live' lets n8n carry the actions out.

-- ---------- which Connecteam job each property's cleans go to ----------
-- Seeded from the Zap's "Connecteam Lookup" sheet (Jobs tab), matched by job id so
-- property renames can't break it.
create table public.cleaning_property_jobs (
  property_id uuid primary key,
  connecteam_job_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cleaning_property_jobs_property_id_fkey foreign key (property_id) references public.properties (id) on delete cascade
);

insert into public.cleaning_property_jobs (property_id, connecteam_job_id)
select distinct on (m.property_id) m.property_id, m.connecteam_job_id
from public.cleaning_job_map m
join (values
  ('ca4bab2e-0c9b-c0b2-2b51-5c4bb8705c93'),
  ('7812b89b-160f-8b74-8580-62c28e0a5e78'),
  ('48e831b7-51d1-7e3c-9351-30fca4ba5e54'),
  ('939fd1e9-f7a5-ad55-2fe8-4d59308b1b63'),
  ('a40a9512-f4da-7eea-87e1-c54212ecb41b'),
  ('bf05f473-e8dc-c0ca-d961-50e902637e2f'),
  ('632ffa0a-cb5a-fd73-8cd2-d590d1a3a5e0'),
  ('11900b03-7d67-113f-6f26-cd58ca152bca'),
  ('a67c3141-8684-8a6c-08ce-5baf7f28cf74'),
  ('23da32fc-f836-42d3-9e76-d9d012ddc437'),
  ('104dd7e5-dec7-48fb-86df-72571e8cf9b8'),
  ('c4ce32b6-f20b-3132-606e-2b3eb13b08b2'),
  ('2a465f79-5bad-f22b-36e5-ec94617a77e3'),
  ('c700a8a6-c2ea-ca87-a401-305f52aa9168'),
  ('6188b0aa-a692-8313-2a92-18b33ea96594'),
  ('64195f1f-20ce-4155-82c0-173b5983f7ad'),
  ('c7c94980-675a-4c4c-bc27-897bc07b609a'),
  ('ce1dfca8-ebc4-4958-891d-559083102389'),
  ('afd3dc84-ebdf-4843-a808-e856159fda8d'),
  ('9fd0d6a6-1fcd-c565-32fa-29973cbc30ab'),
  ('d67665cb-dc7d-4cf7-a557-7d62ae565543'),
  ('5877ab5b-241c-4cd6-af0c-7cb71cc288e2'),
  ('7e1e3d92-6129-ad10-3208-37729a75442b'),
  ('34fbef55-0bd1-4e8e-8e42-44f5e8cfb6e1'),
  ('32b8699c-29cc-48ef-b2db-9e20ebc63abd'),
  ('64c788a1-92bc-addf-4281-cb45385113d1'),
  ('f950e30a-0f3b-4483-6a80-d8c2c62d45ca'),
  ('96f383ce-8bb1-51b5-a001-8d34eba470ff'),
  ('f79db6fd-caba-51eb-007c-e61babce2492'),
  ('4e88e8bc-784e-4c85-a5ea-a72d89145b2c'),
  ('34ea8326-3478-121d-b6ff-489a114f0927'),
  ('4c75402e-f1e8-4b38-b933-26f35525e82b'),
  ('ca6a4b8f-9cf9-38ef-6dbf-65bae0139378'),
  ('389a9001-091f-65ba-a1c7-17aecf00f4d7'),
  ('98a94ff1-164a-49af-9c3e-db2b49add4e9'),
  ('2786605b-bb42-4827-b7cb-a3e4240e6943'),
  ('3db7541b-5c4c-7e9d-3513-8874522d03ed'),
  ('e828a37d-0a15-4bed-aadd-830c88b4b451'),
  ('b6b575cf-0872-b45f-5cdc-b63c22f4d5f2'),
  ('dc6b5ef4-3435-46e4-86a2-9f3b39e767f6'),
  ('7f501f96-5497-40f0-a912-2a7505e836ac'),
  ('3c616139-1eca-41d9-ac84-712a91350eba'),
  ('da64eacc-e5a1-42de-a6a9-30de977695f6'),
  ('aaf0847d-8ccc-468f-86db-db2adbb95e3e'),
  ('5036db1d-7129-391e-0195-b45c10e8caa3'),
  ('5d57e373-b1bf-423f-a0bf-aac06a9d66af'),
  ('b1d83c14-00e8-2bfc-4b31-3a8b32b3b882'),
  ('8395f0bb-f518-9785-53b7-3d22af98ede0'),
  ('6c58f551-5104-4a1b-c095-b3c58fe6412a'),
  ('b0e190f3-b2f1-756d-c16b-4448137ef5c1'),
  ('46f3bfe4-9722-76ea-6e48-c7a8ab8e62aa'),
  ('2e2baaa6-2bc5-9c59-1d0b-a6b7841c4723'),
  ('2aa89d2e-f553-4234-7f0b-e7f35100862c'),
  ('17c17ad5-dfea-44c1-badb-64b7237cf7ff'),
  ('dd3275d8-007c-4278-ae7c-5c2a7151e711'),
  ('c77dbdb9-966c-25c5-8554-afc1047b6f65'),
  ('9118d279-7ea4-4097-ad81-de2c7ecb7326'),
  ('65d8f5a5-0f03-4f5e-aecf-905bc0ed7aff'),
  ('13884d3d-0582-4d2d-be58-5993bef93cce'),
  ('efcfc9a8-4b35-d48d-ce6f-348ba6f87f6b'),
  ('8269221d-bf1b-4521-a9bc-70df484acd17'),
  ('ff4e138d-799b-1ae6-6c09-6bca080cddae'),
  ('7473ac58-1677-9053-7b8b-082fdfbdef27'),
  ('68ad40f3-3de8-a44f-8340-290cfe3cd710'),
  ('307f53d5-cc12-a0b4-b2f8-dc776a3c4354'),
  ('79557dd6-0e22-cd0c-4eef-e267d3fb887b'),
  ('0f67e754-e23c-4f98-9ed8-0e761071b958'),
  ('3328653d-f73e-454d-9dfd-f851cebc7e33'),
  ('75cc049f-ff75-f409-68d8-c04983d61edf'),
  ('4e083337-57d0-48d4-a40d-a26860ef6ce5'),
  ('93cd194e-7839-9b47-811d-5649ea036ef1'),
  ('90ea12da-eea3-ea5c-cdb6-18dafab28038'),
  ('866f25ce-8e4a-d142-f080-a9d052e90b7e'),
  ('f38f5641-6325-2848-d255-d33b2d150e9e'),
  ('b7ca4b1b-d357-4293-9dc4-fe31459a3147'),
  ('857feffa-9b54-477e-8e7f-efc651b918b8'),
  ('a2d0051f-b10d-433e-ac35-f48ec9e1bbce'),
  ('9f6aa8da-5f34-34f2-9363-5ee1885dfdaa')
) as sheet(job_id) on sheet.job_id = m.connecteam_job_id
where m.property_id is not null
order by m.property_id, m.connecteam_job_id;

-- ---------- one shift per booking ----------
create table public.cleaning_shift_links (
  reservation_id uuid primary key,
  shift_id text not null unique,
  linked_via text not null check (linked_via in ('created', 'adopted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cleaning_shift_links_reservation_id_fkey foreign key (reservation_id) references public.reservations (id) on delete cascade
);

-- ---------- every planned / performed action ----------
create table public.cleaning_shift_actions (
  id bigint generated always as identity primary key,
  mode text not null check (mode in ('dry_run', 'live')),
  action text not null check (action in ('create', 'adopt', 'move', 'remove', 'remove_duplicate', 'flag_claimed')),
  reservation_id uuid,
  property_id uuid,
  shift_id text,
  check_out date,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'planned' check (status in ('planned', 'done', 'failed', 'skipped')),
  result jsonb,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  constraint cleaning_shift_actions_reservation_id_fkey foreign key (reservation_id) references public.reservations (id) on delete set null,
  constraint cleaning_shift_actions_property_id_fkey foreign key (property_id) references public.properties (id) on delete set null
);
create index cleaning_shift_actions_open_idx on public.cleaning_shift_actions (mode, status) where status = 'planned';

-- ---------- on/off switches for automations ----------
create table public.automation_flags (
  key text primary key,
  value text not null,
  note text,
  updated_at timestamptz not null default now()
);
insert into public.automation_flags (key, value, note) values
  ('cleaning_shifts_mode', 'dry_run', 'dry_run = record what would happen; live = n8n writes to Connecteam. Flip to live only when the Zapier Zap is turned off.');

alter table public.cleaning_property_jobs enable row level security;
alter table public.cleaning_shift_links enable row level security;
alter table public.cleaning_shift_actions enable row level security;
alter table public.automation_flags enable row level security;

create policy cleaning_property_jobs_team_read on public.cleaning_property_jobs for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
create policy cleaning_shift_links_team_read on public.cleaning_shift_links for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
create policy cleaning_shift_actions_team_read on public.cleaning_shift_actions for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
create policy automation_flags_team_read on public.automation_flags for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy cleaning_property_jobs_service_all on public.cleaning_property_jobs for all to service_role using (true) with check (true);
create policy cleaning_shift_links_service_all on public.cleaning_shift_links for all to service_role using (true) with check (true);
create policy cleaning_shift_actions_service_all on public.cleaning_shift_actions for all to service_role using (true) with check (true);
create policy automation_flags_service_all on public.automation_flags for all to service_role using (true) with check (true);

-- ---------- the planner ----------
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
    g.full_name as guest_name, p.property_name, p.address, pj.connecteam_job_id as job_id,
    (r.check_out + coalesce(nullif(p.checkout_time, ''), '10:00')::time) at time zone 'America/Edmonton' as start_at,
    least(
      ((r.check_out + coalesce(nullif(p.checkout_time, ''), '10:00')::time) at time zone 'America/Edmonton') + interval '4 hours',
      (r.check_out + coalesce(nullif(p.checkin_time, ''), '16:00')::time) at time zone 'America/Edmonton'
    ) as end_at
  from public.reservations r
  join public.properties p on p.id = r.property_id
  join public.cleaning_property_jobs pj on pj.property_id = r.property_id
  left join public.guests g on g.id = r.guest_id
  cross join today
  where p.market in ('Edmonton', 'Calgary')
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

-- Plans, records (deduplicated), performs the database-only 'adopt' step, and returns
-- the Connecteam actions n8n should carry out - none while in dry_run.
create or replace function public.run_cleaning_shift_planner()
returns table (id bigint, action text, reservation_id uuid, shift_id text, payload jsonb)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_mode text := coalesce((select value from public.automation_flags where key = 'cleaning_shifts_mode'), 'dry_run');
begin
  insert into public.cleaning_shift_actions (mode, action, reservation_id, property_id, shift_id, check_out, payload, dedupe_key)
  select v_mode, p.action, p.reservation_id, p.property_id, p.shift_id, p.check_out, p.payload,
    v_mode || ':' || p.action || ':' || coalesce(p.reservation_id::text, '') || ':' || coalesce(p.shift_id, '') || ':' || coalesce(p.check_out::text, '')
  from public.plan_cleaning_shift_actions() p
  on conflict (dedupe_key) do nothing;

  -- Adopting only links our record to a shift that already exists; safe in both modes.
  with todo as (
    select a.id, a.reservation_id, a.shift_id from public.cleaning_shift_actions a
    where a.action = 'adopt' and a.status = 'planned' and a.mode = v_mode
  ),
  linked as (
    insert into public.cleaning_shift_links (reservation_id, shift_id, linked_via)
    select t.reservation_id, t.shift_id, 'adopted' from todo t
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
  where a.mode = 'live' and a.status = 'planned' and a.action in ('create', 'move', 'remove', 'remove_duplicate', 'flag_claimed')
  order by a.id
  limit 50;
end;
$function$;

-- n8n reports back after each Connecteam call.
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
    insert into public.cleaning_shift_links (reservation_id, shift_id, linked_via)
    values (a.reservation_id, p_new_shift_id, 'created')
    on conflict (reservation_id) do update set shift_id = excluded.shift_id, linked_via = 'created', updated_at = now();
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
  elsif a.action in ('remove', 'remove_duplicate') then
    update public.connecteam_shifts set gone_at = now(), updated_at = now() where shift_id = a.shift_id;
    delete from public.cleaning_shift_links where shift_id = a.shift_id;
  end if;
  return jsonb_build_object('ok', true, 'status', 'done');
end;
$function$;

revoke execute on function public.plan_cleaning_shift_actions() from public, anon, authenticated;
revoke execute on function public.run_cleaning_shift_planner() from public, anon, authenticated;
revoke execute on function public.complete_cleaning_shift_action(bigint, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.plan_cleaning_shift_actions() to service_role;
grant execute on function public.run_cleaning_shift_planner() to service_role;
grant execute on function public.complete_cleaning_shift_action(bigint, boolean, jsonb, text) to service_role;
