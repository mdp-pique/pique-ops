-- Front desk notices: email a building's front desk when a booking is confirmed,
-- its dates change, or it is cancelled, plus a reminder the day before arrival.
-- Replaces the Zapier Zap "320 Wolf - Draft Email", which only drafted an email
-- for someone to send by hand (the step that kept getting missed).
--
-- Flow (n8n Pique-Front-Desk-Notices, every 10 min):
--   1. n8n pulls the property's reservations straight from Hospitable (the
--      reservations table only syncs 3x/day - too slow for same-day bookings)
--      and passes the raw list to run_front_desk_notices().
--   2. The planner compares each booking to what the desk was last told
--      (front_desk_state) and queues new / change / cancel / reminder emails.
--   3. n8n sends each one from info@ and calls mark_front_desk_notice_sent(),
--      which logs it on a front_desk_notice ticket (Customer Service).
-- n8n Pique-Front-Desk-Confirmations passes the desk's "Confirmation: 182027"
-- replies to record_front_desk_confirmation(), which stores the code on the ticket.
--
-- automation_flags.front_desk_notices_mode: 'dry_run' simulates everything (no
-- email, no tickets) so the plan can be checked against the Zap; 'live' sends.
-- Switch with set_front_desk_notices_mode() - it also moves the "new bookings
-- from" cutoff so going live doesn't re-announce bookings the Zap already covered.
-- Additive only: no existing table, trigger or workflow is changed.

-- ---------- which properties, where to send, and the wording ----------
create table public.front_desk_contacts (
  property_id uuid primary key,
  email text not null,
  subject_label text not null,   -- 'Unit #320 Wolf Building'
  unit_phrase text not null,     -- 'our unit in the wolf building for unit #320'
  owner_line text,               -- 'For Owners Edward and Kim Rossol.'
  owner_stay_phrase text not null, -- 'Wolf Building, Unit #320'
  suite_code text not null unique, -- how the desk's confirmations name the suite: 'W320'
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint front_desk_contacts_property_id_fkey foreign key (property_id) references public.properties (id) on delete cascade
);

insert into public.front_desk_contacts (property_id, email, subject_label, unit_phrase, owner_line, owner_stay_phrase, suite_code)
values ('0b9b8e55-94c7-4fb1-8a7c-9ed5494c8776', 'guestservices@lodgesofcanmore.ca', 'Unit #320 Wolf Building',
        'our unit in the wolf building for unit #320', 'For Owners Edward and Kim Rossol.', 'Wolf Building, Unit #320', 'W320');

-- ---------- what the desk was last told, per booking ----------
-- Keyed by the Hospitable id because a brand-new booking may not be in
-- reservations yet. One row per mode so a dry run never affects live.
create table public.front_desk_state (
  mode text not null check (mode in ('dry_run', 'live')),
  hospitable_reservation_id text not null,
  property_id uuid not null,
  told_status text not null,
  told_check_in date not null,
  told_check_out date not null,
  sent_count int not null default 0,
  first_told_at timestamptz not null default now(),
  last_told_at timestamptz not null default now(),
  reminded_for date,
  confirmation_code text,
  confirmed_at timestamptz,
  ticket_id uuid,
  updated_at timestamptz not null default now(),
  primary key (mode, hospitable_reservation_id),
  constraint front_desk_state_property_id_fkey foreign key (property_id) references public.properties (id) on delete cascade,
  constraint front_desk_state_ticket_id_fkey foreign key (ticket_id) references public.tickets (id) on delete set null
);

-- ---------- every email planned / sent ----------
create table public.front_desk_notices (
  id bigint generated always as identity primary key,
  mode text not null check (mode in ('dry_run', 'live')),
  kind text not null check (kind in ('new', 'change', 'cancel', 'reminder')),
  hospitable_reservation_id text not null,
  property_id uuid not null,
  guest_name text,
  check_in date not null,
  check_out date not null,
  prev_check_in date,
  prev_check_out date,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'planned' check (status in ('planned', 'sending', 'sent', 'simulated', 'failed', 'skipped')),
  error text,
  gmail_message_id text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint front_desk_notices_property_id_fkey foreign key (property_id) references public.properties (id) on delete cascade
);
create index front_desk_notices_open_idx on public.front_desk_notices (mode, status) where status in ('planned', 'sending');

-- ---------- the desk's confirmation replies ----------
create table public.front_desk_confirmations (
  gmail_message_id text primary key,
  confirmation_code text,
  suite_code text,
  arrival date,
  departure date,
  property_id uuid,
  hospitable_reservation_id text,
  ticket_id uuid,
  received_at timestamptz not null default now(),
  constraint front_desk_confirmations_property_id_fkey foreign key (property_id) references public.properties (id) on delete set null,
  constraint front_desk_confirmations_ticket_id_fkey foreign key (ticket_id) references public.tickets (id) on delete set null
);

alter table public.front_desk_contacts enable row level security;
alter table public.front_desk_state enable row level security;
alter table public.front_desk_notices enable row level security;
alter table public.front_desk_confirmations enable row level security;

create policy front_desk_contacts_team_read on public.front_desk_contacts for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
create policy front_desk_state_team_read on public.front_desk_state for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
create policy front_desk_notices_team_read on public.front_desk_notices for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
create policy front_desk_confirmations_team_read on public.front_desk_confirmations for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy front_desk_contacts_service_all on public.front_desk_contacts for all to service_role using (true) with check (true);
create policy front_desk_state_service_all on public.front_desk_state for all to service_role using (true) with check (true);
create policy front_desk_notices_service_all on public.front_desk_notices for all to service_role using (true) with check (true);
create policy front_desk_confirmations_service_all on public.front_desk_confirmations for all to service_role using (true) with check (true);

insert into public.automation_flags (key, value, note) values
  ('front_desk_notices_mode', 'dry_run', 'dry_run = simulate front desk emails (no email, no tickets); live = n8n sends them. Change with set_front_desk_notices_mode(). Turn the Zapier Zap "320 Wolf - Draft Email" off when going live.'),
  ('front_desk_notices_since', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'Bookings made before this get the day-before reminder only, never a "new reservation" email.'),
  ('front_desk_notices_batch', '5', 'Max emails n8n may send per run.')
on conflict (key) do nothing;

-- ---------- ticket type ----------
insert into public.ticket_type_clocks (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable, default_team_id)
values ('front_desk_notice', 'created', 'start', '6 hours', null, false, null, '2 hours', null, false,
        (select id from public.teams where name = 'Customer Service'))
on conflict (type) do nothing;

-- ---------- wording ----------
create or replace function public.fd_range(p_in date, p_out date)
returns text
language sql
immutable
as $$
  -- 'Sept 21 - 26, 2026', 'Sept 26 - Oct 3, 2026', 'Dec 30, 2026 - Jan 2, 2027'
  with m as (select array['Jan','Feb','Mar','Apr','May','June','July','Aug','Sept','Oct','Nov','Dec'] as a)
  select case
    when extract(year from p_in) <> extract(year from p_out) then
      a[extract(month from p_in)::int] || ' ' || extract(day from p_in) || ', ' || extract(year from p_in)
      || ' - ' || a[extract(month from p_out)::int] || ' ' || extract(day from p_out) || ', ' || extract(year from p_out)
    when extract(month from p_in) <> extract(month from p_out) then
      a[extract(month from p_in)::int] || ' ' || extract(day from p_in)
      || ' - ' || a[extract(month from p_out)::int] || ' ' || extract(day from p_out) || ', ' || extract(year from p_out)
    else
      a[extract(month from p_in)::int] || ' ' || extract(day from p_in) || ' - ' || extract(day from p_out) || ', ' || extract(year from p_out)
  end
  from m;
$$;

create or replace function public.fd_long_date(p date)
returns text
language sql
immutable
as $$ select to_char(p, 'FMMonth FMDD, YYYY') $$;

create or replace function public.fd_compose(
  c public.front_desk_contacts, p_kind text, p_owner_stay boolean, p_guest text, p_guests int,
  p_in date, p_out date, p_prev_in date, p_prev_out date
)
returns table (subject text, body text)
language plpgsql
immutable
as $$
declare
  v_sig text := E'Thanks,\nMichael Stead\nCustomer Support\n\nPique Properties Inc.\n780-230-0267\ninfo@piquepropertiesinc.com\nhttps://piquelifestyle.com/';
  v_guest text := coalesce(nullif(p_guest, ''), 'Guest');
  v_details text := E'Guest Name: ' || v_guest
    || E'\n\nNumber of Guests: ' || coalesce(p_guests::text, '-')
    || E'\n\nCheck in date: ' || fd_long_date(p_in)
    || E'\n\nCheck out date: ' || fd_long_date(p_out);
  v_intro text := 'We have a reservation at ' || c.unit_phrase || '.' || coalesce(E'\n' || c.owner_line, '');
begin
  if p_kind = 'new' and p_owner_stay then
    subject := 'Owner Staying ' || c.subject_label || ' | ' || fd_range(p_in, p_out);
    body := E'Hi there,\n\nThe owner of ' || c.owner_stay_phrase || ' will be staying from ' || fd_long_date(p_in)
      || ' to ' || fd_long_date(p_out) || E'.\n\nNumber of Guests: ' || coalesce(p_guests::text, '-') || E'\n\n' || v_sig;
  elsif p_kind = 'new' then
    subject := 'New Reservation ' || c.subject_label || ' | ' || fd_range(p_in, p_out);
    body := E'Hi there,\n\n' || v_intro || E'\n\n' || v_details || E'\n\n' || v_sig;
  elsif p_kind = 'change' then
    subject := 'Updated Reservation ' || c.subject_label || ' | ' || fd_range(p_in, p_out);
    body := E'Hi there,\n\nThe dates have changed for ' || case when p_owner_stay then 'the owner stay' else 'this reservation' end
      || ' at ' || c.unit_phrase || E'. Please update your system.\n\nPrevious dates: ' || fd_range(p_prev_in, p_prev_out)
      || E'\n\n' || v_details || E'\n\n' || v_sig;
  elsif p_kind = 'cancel' then
    subject := 'Canceled Reservation ' || c.subject_label || ' | ' || fd_range(p_prev_in, p_prev_out);
    body := E'Hi there,\n\nThe ' || case when p_owner_stay then 'owner stay' else 'reservation for Guest Name: ' || v_guest end
      || ' (' || fd_range(p_prev_in, p_prev_out) || E') has been cancelled, please do not give access.\n\n' || v_sig;
  else -- reminder
    subject := 'Arriving Tomorrow - ' || c.subject_label || ' | ' || fd_range(p_in, p_out);
    body := E'Hi there,\n\nJust a reminder that ' || case when p_owner_stay then 'the owner is' else 'we have a guest' end
      || ' arriving tomorrow at ' || c.unit_phrase || '.' || coalesce(E'\n' || c.owner_line, '')
      || E'\n\n' || v_details
      || E'\n\nIf you don''t have this reservation on file, please let us know.\n\n' || v_sig;
  end if;
  return next;
end;
$$;

-- ---------- the planner ----------
-- p_snapshot: the "data" array from Hospitable GET /v2/reservations?include=guest
-- for one property. Missing bookings are never read as cancelled; only an
-- explicit cancelled status is.
create or replace function public.plan_front_desk_notices(p_property_id uuid, p_snapshot jsonb, p_mode text)
returns table (
  kind text, hospitable_reservation_id text, guest_name text, owner_stay boolean, guest_count int,
  check_in date, check_out date, prev_check_in date, prev_check_out date, dedupe_key text
)
language sql
stable
set search_path = public
as $$
with cfg as (
  select (now() at time zone 'America/Edmonton')::date as today,
         (now() at time zone 'America/Edmonton')::time as now_time,
         coalesce((select value from automation_flags where key = 'front_desk_notices_since')::timestamptz, now()) as since
),
snap as (
  select e->>'id' as hid,
    coalesce(e->'reservation_status'->'current'->>'category', e->>'status', '') as status,
    left(e->>'arrival_date', 10)::date as check_in,
    left(e->>'departure_date', 10)::date as check_out,
    case when e->'guests'->>'total' ~ '^\d+$' then (e->'guests'->>'total')::int end as guest_count,
    nullif(trim(concat(e->'guest'->>'first_name', ' ', e->'guest'->>'last_name')), '') as guest_name,
    (e->>'booking_date')::timestamptz as booked_at,
    (e->>'stay_type' = 'owner_stay'
      or (e->>'platform' = 'manual' and coalesce(e->'guest'->>'first_name', '') ~* '^owner')) as owner_stay
  from jsonb_array_elements(case when jsonb_typeof(p_snapshot) = 'array' then p_snapshot else '[]'::jsonb end) e
  where e->>'id' is not null and e->>'arrival_date' is not null and e->>'departure_date' is not null
),
j as (
  select s.*, st.told_status, st.told_check_in, st.told_check_out, st.sent_count, st.last_told_at, st.reminded_for,
    (st.hospitable_reservation_id is not null) as has_state,
    s.status = 'accepted' as active,
    s.status ~* '(cancel|declin|denied|expired|not accepted)' as dead
  from snap s
  left join front_desk_state st on st.mode = p_mode and st.hospitable_reservation_id = s.hid
),
planned as (
  select
    case
      when j.active and j.check_in >= cfg.today and not j.has_state and coalesce(j.booked_at, now()) >= cfg.since then 'new'
      when j.active and j.check_in >= cfg.today and j.has_state and j.told_status <> 'accepted' then 'new'
      when j.active and j.check_in >= cfg.today and j.has_state
           and (j.check_in, j.check_out) is distinct from (j.told_check_in, j.told_check_out) then 'change'
      when j.active and j.check_in = cfg.today + 1 and cfg.now_time >= time '09:00'
           and (
             (not j.has_state and coalesce(j.booked_at, now()) < cfg.since)
             or (j.has_state and j.reminded_for is distinct from j.check_in
                 and j.last_told_at < ((j.check_in - 3)::timestamp at time zone 'America/Edmonton'))
           ) then 'reminder'
      when j.dead and j.has_state and j.told_status = 'accepted' and j.told_check_in >= cfg.today then 'cancel'
    end as kind,
    j.*
  from j cross join cfg
)
select p.kind, p.hid, p.guest_name, p.owner_stay, p.guest_count, p.check_in, p.check_out,
  p.told_check_in, p.told_check_out,
  p_mode || ':' || p.kind || ':' || p.hid || ':' || coalesce(p.sent_count, 0)
from planned p
where p.kind is not null;
$$;

-- ---------- tickets (live only) ----------
create or replace function public.fd_touch_ticket(n public.front_desk_notices)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_ref text := 'front_desk:' || n.hospitable_reservation_id;
  v_res uuid;
  v_ticket uuid;
  v_status text;
  v_due timestamptz;
begin
  select id into v_res from reservations where hospitable_reservation_id = n.hospitable_reservation_id;
  v_due := least(now() + interval '6 hours',
                 greatest(now() + interval '1 hour', (n.check_in + time '16:00') at time zone 'America/Edmonton'));

  select id, status into v_ticket, v_status from tickets where external_ref = v_ref;
  if v_ticket is null then
    insert into tickets (type, status, priority, property_id, reservation_id, guest_name, source, external_ref, due_at, metadata)
    values ('front_desk_notice', 'open', 'normal', n.property_id, v_res, n.guest_name, 'automation', v_ref, v_due,
            jsonb_build_object('title', 'Front desk notice' || coalesce(' – ' || n.guest_name, ''),
                               'hospitable_reservation_id', n.hospitable_reservation_id))
    returning id, status into v_ticket, v_status;
    insert into ticket_items (ticket_id, label, sort_order) values
      (v_ticket, 'Front desk emailed', 0), (v_ticket, 'Front desk confirmation received', 1);
    insert into ticket_events (ticket_id, event_type, to_value, note)
    values (v_ticket, 'status_change', 'open', 'Created automatically from the booking');
  end if;

  insert into ticket_events (ticket_id, event_type, note, payload)
  values (v_ticket, 'comment', 'Emailed the front desk: ' || n.subject,
          jsonb_build_object('front_desk_notice_id', n.id, 'kind', n.kind, 'gmail_message_id', n.gmail_message_id, 'to', n.to_email));

  update tickets set
    reservation_id = coalesce(reservation_id, v_res),
    metadata = metadata || jsonb_build_object('check_in', n.check_in, 'check_out', n.check_out, 'last_notice', n.kind)
  where id = v_ticket;

  update ticket_items set is_done = true, done_at = now()
  where ticket_id = v_ticket and label = 'Front desk emailed' and not is_done;

  if n.kind in ('new', 'change') then
    -- Wait for the desk's confirmation for these dates; Customer Service sees it go Behind if none comes.
    update ticket_items set is_done = false, done_at = null
    where ticket_id = v_ticket and label = 'Front desk confirmation received' and is_done;
    update tickets set status = 'open', closed_at = null, due_at = v_due where id = v_ticket;
    if v_status not in ('open', 'in_progress', 'blocked') then
      insert into ticket_events (ticket_id, event_type, from_value, to_value, note)
      values (v_ticket, 'status_change', v_status, 'open', 'Reopened - waiting for the front desk to confirm the new dates');
    end if;
  elsif v_status in ('open', 'in_progress', 'blocked') and (n.kind = 'cancel' or n.prev_check_in is null) then
    -- Cancellation sent, or a day-before reminder for a booking made before go-live:
    -- nothing more to wait for.
    update tickets set status = 'resolved', closed_at = now() where id = v_ticket;
    insert into ticket_events (ticket_id, event_type, from_value, to_value, note)
    values (v_ticket, 'status_change', v_status, 'resolved',
            case when n.kind = 'cancel' then 'Front desk told the booking is cancelled' else 'Day-before reminder sent to the front desk' end);
  end if;
  return v_ticket;
end;
$$;

-- ---------- apply a sent (or simulated) notice ----------
create or replace function public.fd_apply(n public.front_desk_notices)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_ticket uuid;
begin
  if n.mode = 'live' then
    v_ticket := fd_touch_ticket(n);
  end if;

  insert into front_desk_state as s (mode, hospitable_reservation_id, property_id, told_status, told_check_in, told_check_out,
                                     sent_count, reminded_for, ticket_id)
  values (n.mode, n.hospitable_reservation_id, n.property_id,
          case when n.kind = 'cancel' then 'cancelled' else 'accepted' end,
          case when n.kind = 'cancel' then n.prev_check_in else n.check_in end,
          case when n.kind = 'cancel' then n.prev_check_out else n.check_out end,
          1, case when n.kind = 'reminder' then n.check_in end, v_ticket)
  on conflict (mode, hospitable_reservation_id) do update set
    told_status = excluded.told_status,
    told_check_in = excluded.told_check_in,
    told_check_out = excluded.told_check_out,
    sent_count = s.sent_count + 1,
    last_told_at = now(),
    reminded_for = case when n.kind = 'reminder' then n.check_in else s.reminded_for end,
    confirmation_code = case when n.kind in ('new', 'change') then null else s.confirmation_code end,
    confirmed_at = case when n.kind in ('new', 'change') then null else s.confirmed_at end,
    ticket_id = coalesce(v_ticket, s.ticket_id),
    updated_at = now();
end;
$$;

-- ---------- entry point for n8n ----------
create or replace function public.run_front_desk_notices(p_property_id uuid, p_snapshot jsonb)
returns table (id bigint, to_email text, subject text, body text)
language plpgsql
set search_path = public
as $$
declare
  v_mode text := coalesce((select value from automation_flags where key = 'front_desk_notices_mode'), 'dry_run');
  v_batch int := coalesce(nullif((select value from automation_flags where key = 'front_desk_notices_batch'), '')::int, 5);
  c front_desk_contacts;
  n front_desk_notices;
begin
  select * into c from front_desk_contacts where property_id = p_property_id and enabled;
  if not found then
    return;
  end if;

  -- A run that died mid-send leaves rows in 'sending'; hand them to a person
  -- rather than risk emailing the desk twice.
  perform mark_front_desk_notice_failed(f.id, 'Send did not finish (n8n run stopped) - check info@ Sent before resending')
  from front_desk_notices f
  where f.mode = 'live' and f.property_id = p_property_id and f.status = 'sending' and f.created_at < now() - interval '30 minutes';

  create temporary table if not exists _fd_plan on commit drop as
    select * from plan_front_desk_notices(p_property_id, p_snapshot, v_mode) limit 0;
  truncate _fd_plan;
  insert into _fd_plan select * from plan_front_desk_notices(p_property_id, p_snapshot, v_mode);

  insert into front_desk_notices (mode, kind, hospitable_reservation_id, property_id, guest_name, check_in, check_out,
                                  prev_check_in, prev_check_out, to_email, subject, body, dedupe_key)
  select v_mode, p.kind, p.hospitable_reservation_id, p_property_id, p.guest_name, p.check_in, p.check_out,
         p.prev_check_in, p.prev_check_out, c.email, m.subject, m.body, p.dedupe_key
  from _fd_plan p
  cross join lateral fd_compose(c, p.kind, p.owner_stay, p.guest_name, p.guest_count,
                                p.check_in, p.check_out, p.prev_check_in, p.prev_check_out) m
  on conflict (dedupe_key) do nothing;

  -- Queued but no longer wanted (e.g. cancelled before the "new" email went out).
  update front_desk_notices f set status = 'skipped', error = 'no longer in the plan'
  where f.mode = v_mode and f.property_id = p_property_id and f.status = 'planned'
    and not exists (select 1 from _fd_plan p where p.dedupe_key = f.dedupe_key);

  if v_mode <> 'live' then
    for n in
      update front_desk_notices f set status = 'simulated', sent_at = now()
      where f.mode = v_mode and f.property_id = p_property_id and f.status = 'planned'
      returning f.*
    loop
      perform fd_apply(n);
    end loop;
    return;
  end if;

  -- Hand n8n the next batch; 'sending' stops an overlapping run picking them up twice.
  return query
  update front_desk_notices f set status = 'sending'
  where f.id in (
    select q.id from front_desk_notices q
    where q.mode = 'live' and q.property_id = p_property_id and q.status = 'planned'
    order by q.check_in, q.id
    limit greatest(v_batch, 0)
    for update skip locked
  )
  returning f.id, f.to_email, f.subject, f.body;
end;
$$;

create or replace function public.mark_front_desk_notice_sent(p_id bigint, p_gmail_message_id text)
returns void
language plpgsql
set search_path = public
as $$
declare
  n front_desk_notices;
begin
  update front_desk_notices set status = 'sent', sent_at = now(), gmail_message_id = p_gmail_message_id
  where id = p_id and status = 'sending'
  returning * into n;
  if found then
    perform fd_apply(n);
  end if;
end;
$$;

-- A failed send is not retried automatically (it may have gone out). It opens the
-- ticket so Customer Service sends it by hand.
create or replace function public.mark_front_desk_notice_failed(p_id bigint, p_error text)
returns void
language plpgsql
set search_path = public
as $$
declare
  n front_desk_notices;
  v_ref text;
  v_ticket uuid;
begin
  update front_desk_notices set status = 'failed', error = left(p_error, 1000)
  where id = p_id and status = 'sending'
  returning * into n;
  if not found then
    return;
  end if;
  v_ref := 'front_desk:' || n.hospitable_reservation_id;
  insert into tickets (type, status, priority, property_id, reservation_id, guest_name, source, external_ref, due_at, metadata)
  values ('front_desk_notice', 'open', 'high', n.property_id,
          (select r.id from reservations r where r.hospitable_reservation_id = n.hospitable_reservation_id),
          n.guest_name, 'automation', v_ref, now() + interval '1 hour',
          jsonb_build_object('title', 'Front desk notice' || coalesce(' – ' || n.guest_name, ''),
                             'hospitable_reservation_id', n.hospitable_reservation_id))
  on conflict (external_ref) do update set status = 'open', priority = 'high', closed_at = null, due_at = now() + interval '1 hour'
  returning id into v_ticket;
  if not exists (select 1 from ticket_items where ticket_id = v_ticket) then
    insert into ticket_items (ticket_id, label, sort_order) values
      (v_ticket, 'Front desk emailed', 0), (v_ticket, 'Front desk confirmation received', 1);
  end if;
  insert into ticket_events (ticket_id, event_type, note, payload)
  values (v_ticket, 'comment', 'Automatic email to the front desk failed - please send it by hand: ' || n.subject,
          jsonb_build_object('front_desk_notice_id', n.id, 'error', left(p_error, 500), 'to', n.to_email, 'body', n.body));
end;
$$;

-- ---------- the desk's "Confirmation: 182027 (ROSSOL)" replies ----------
create or replace function public.record_front_desk_confirmation(p_gmail_message_id text, p_subject text, p_body text)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_mode text := coalesce((select value from automation_flags where key = 'front_desk_notices_mode'), 'dry_run');
  v_code text;
  v_suite text;
  v_arrival date;
  v_departure date;
  c front_desk_contacts;
  st front_desk_state;
  v_status text;
begin
  if exists (select 1 from front_desk_confirmations where gmail_message_id = p_gmail_message_id) then
    return (select ticket_id from front_desk_confirmations where gmail_message_id = p_gmail_message_id);
  end if;

  v_code := coalesce(substring(p_subject from 'Confirmation:\s*(\d+)'), substring(p_body from 'confirmation number is\s*(\d+)'));
  v_suite := substring(p_body from 'Suite Number:\s*(\S+)');
  begin
    v_arrival := to_date(substring(p_body from 'Arrival Date:\s*([A-Za-z]+ \d{1,2}, \d{4})'), 'FMMonth FMDD, YYYY');
    v_departure := to_date(substring(p_body from 'Departure Date:\s*([A-Za-z]+ \d{1,2}, \d{4})'), 'FMMonth FMDD, YYYY');
  exception when others then
    v_arrival := null;
    v_departure := null;
  end;

  select * into c from front_desk_contacts where suite_code = v_suite;
  if found and v_arrival is not null then
    select * into st from front_desk_state s
    where s.mode = v_mode and s.property_id = c.property_id and s.told_status = 'accepted' and s.told_check_in = v_arrival
    order by (s.told_check_out = v_departure) desc, s.last_told_at desc
    limit 1;
  end if;

  insert into front_desk_confirmations (gmail_message_id, confirmation_code, suite_code, arrival, departure,
                                        property_id, hospitable_reservation_id, ticket_id)
  values (p_gmail_message_id, v_code, v_suite, v_arrival, v_departure, c.property_id, st.hospitable_reservation_id, st.ticket_id);

  if st.hospitable_reservation_id is null then
    return null;
  end if;

  update front_desk_state set confirmation_code = v_code, confirmed_at = now(), updated_at = now()
  where mode = st.mode and hospitable_reservation_id = st.hospitable_reservation_id;

  if st.ticket_id is not null then
    update tickets set metadata = metadata || jsonb_build_object('front_desk_confirmation', v_code)
    where id = st.ticket_id
    returning status into v_status;
    update ticket_items set is_done = true, done_at = now()
    where ticket_id = st.ticket_id and label = 'Front desk confirmation received' and not is_done;
    insert into ticket_events (ticket_id, event_type, note, payload)
    values (st.ticket_id, 'comment', 'Front desk confirmed - confirmation #' || coalesce(v_code, '?'),
            jsonb_build_object('gmail_message_id', p_gmail_message_id, 'arrival', v_arrival, 'departure', v_departure));
    if v_status in ('open', 'in_progress', 'blocked') then
      update tickets set status = 'resolved', closed_at = now() where id = st.ticket_id;
      insert into ticket_events (ticket_id, event_type, from_value, to_value, note)
      values (st.ticket_id, 'status_change', v_status, 'resolved', 'Front desk confirmed #' || coalesce(v_code, '?'));
    end if;
  end if;
  return st.ticket_id;
end;
$$;

-- ---------- switching modes ----------
create or replace function public.set_front_desk_notices_mode(p_mode text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_mode not in ('dry_run', 'live') then
    raise exception 'mode must be dry_run or live';
  end if;
  update automation_flags set value = p_mode, updated_at = now() where key = 'front_desk_notices_mode';
  if p_mode = 'live' then
    -- Bookings made before now were handled by the Zap / by hand: remind only.
    update automation_flags set value = to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), updated_at = now()
    where key = 'front_desk_notices_since';
  end if;
end;
$$;

revoke execute on function public.plan_front_desk_notices(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.fd_touch_ticket(public.front_desk_notices) from public, anon, authenticated;
revoke execute on function public.fd_apply(public.front_desk_notices) from public, anon, authenticated;
revoke execute on function public.run_front_desk_notices(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.mark_front_desk_notice_sent(bigint, text) from public, anon, authenticated;
revoke execute on function public.mark_front_desk_notice_failed(bigint, text) from public, anon, authenticated;
revoke execute on function public.record_front_desk_confirmation(text, text, text) from public, anon, authenticated;
revoke execute on function public.set_front_desk_notices_mode(text) from public, anon, authenticated;
