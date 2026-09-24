-- Ticket clocks and health (PRD §8.2). Additive: new table, new nullable
-- columns, and triggers on tickets that are exception-safe - a bug in any of
-- them logs a warning and lets the original write through unchanged, so the
-- shadow-mirror triggers and the app keep working no matter what.

create table public.ticket_type_clocks (
  type text primary key,
  start_anchor text not null default 'created' check (start_anchor in ('created', 'checkout')),
  due_anchor text not null default 'start' check (due_anchor in ('start', 'checkin', 'checkout', 'next_checkin', 'visit_at')),
  due_offset interval not null default '0',
  due_hour int check (due_hour between 0 and 23),
  due_is_hard boolean not null default false,
  target_offset interval,
  warn_before interval,
  critical_before interval,
  pausable boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.ticket_type_clocks is 'Per ticket type: when the clock starts, when it is due, and the warning windows that drive tickets.health (PRD §8.2). due_hour is property-local (America/Edmonton) and only applies to date anchors.';

alter table public.ticket_type_clocks enable row level security;
create policy ticket_type_clocks_read_authenticated on public.ticket_type_clocks
  for select to authenticated using (exists (select 1 from profiles p where p.id = auth.uid()));

insert into public.ticket_type_clocks (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable) values
  ('review_flag',               'created',  'start',        '2 days',   null, false, null,      '1 day',    null,      true),
  ('review_removal_case',       'created',  'start',        '5 days',   null, false, null,      '1 day',    null,      true),
  ('review_removal_escalation', 'created',  'start',        '2 days',   null, false, null,      '1 day',    null,      true),
  ('review_action_item',        'created',  'start',        '7 days',   null, false, null,      '2 days',   null,      true),
  ('guest_review_reminder',     'checkout', 'checkout',     '14 days',  23,   true,  '10 days', '4 days',   '1 day',   false),
  ('unanswered_message',        'created',  'start',        '30 minutes', null, false, null,    '10 minutes', null,    false),
  ('extension_request',         'created',  'start',        '2 hours',  null, false, null,      '30 minutes', null,    false),
  ('missed_call',               'created',  'start',        '1 hour',   null, false, null,      '15 minutes', null,    false),
  ('maintenance_ticket',        'created',  'next_checkin', '0',        15,   true,  null,      '1 day',    '4 hours', false),
  ('maintenance_access',        'created',  'visit_at',     '-1 day',   9,    true,  null,      '1 day',    '4 hours', false),
  ('property_security_check',   'created',  'start',        '12 hours', null, false, null,      '4 hours',  null,      false),
  ('claim_tracker',             'checkout', 'checkout',     '14 days',  23,   true,  '7 days',  '7 days',   '2 days',  false),
  ('guest_block_report',        'created',  'start',        '1 day',    null, false, null,      '4 hours',  null,      false),
  ('vehicle_registration',      'created',  'checkin',      '0',        12,   true,  null,      '1 day',    '4 hours', false),
  ('pack_n_play',               'created',  'checkin',      '0',        12,   true,  null,      '2 days',   '1 day',   false),
  ('direct_booking_id_check',   'created',  'checkin',      '0',        12,   true,  null,      '2 days',   '1 day',   false),
  ('guest_vetting',             'created',  'checkin',      '0',        12,   true,  null,      '2 days',   '1 day',   false),
  ('pet_fee',                   'created',  'start',        '2 days',   null, false, null,      '1 day',    null,      true),
  ('cleaner_late_noshow',       'created',  'start',        '1 day',    null, false, null,      '4 hours',  null,      false),
  ('incomplete_cleaning_form',  'created',  'start',        '1 day',    null, false, null,      '4 hours',  null,      false),
  ('cleaning_overtime_approval','created',  'start',        '1 day',    null, false, null,      '4 hours',  null,      false),
  ('cleaning_issue',            'created',  'start',        '1 day',    null, false, null,      '4 hours',  null,      false),
  ('qc_inspection',             'created',  'start',        '1 day',    null, false, null,      '4 hours',  null,      false),
  ('system_health',             'created',  'start',        '1 day',    null, false, null,      '4 hours',  null,      false);

alter table public.tickets
  add column if not exists started_at timestamptz,
  add column if not exists target_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists health text check (health in ('on_track', 'attention', 'behind', 'missed', 'waiting'));

comment on column public.tickets.health is 'Computed by trigger + refresh_ticket_health() from the clock (started_at/target_at/due_at), ticket_type_clocks and checklist progress. Never set by hand. Null = resolved or no clock.';

create index if not exists tickets_open_health_idx on public.tickets (health) where status in ('open', 'in_progress', 'blocked');

-- Fill started_at / due_at / target_at from the type's clock, only where null
-- (a due date set by a person or an automation always wins).
create or replace function public.fill_ticket_clock(p public.tickets)
returns public.tickets
language plpgsql
set search_path = public
as $$
declare
  c ticket_type_clocks;
  v_check_in date;
  v_check_out date;
  v_due_offset interval;
  v_target_offset interval;
  v_anchor_date date;
  v_hour int;
begin
  select * into c from ticket_type_clocks where type = p.type;
  if not found then
    p.started_at := coalesce(p.started_at, p.created_at, now());
    return p;
  end if;

  if p.reservation_id is not null then
    select check_in, check_out into v_check_in, v_check_out from reservations where id = p.reservation_id;
  end if;

  if p.started_at is null then
    p.started_at := case
      when c.start_anchor = 'checkout' and v_check_out is not null
        then (v_check_out + time '11:00') at time zone 'America/Edmonton'
      else coalesce(p.created_at, now())
    end;
  end if;

  v_due_offset := c.due_offset;
  v_target_offset := c.target_offset;
  if p.type = 'claim_tracker' and p.metadata->>'platform' = 'Truvi' then
    v_due_offset := '30 days';
    v_target_offset := '15 days';
  end if;
  v_hour := coalesce(c.due_hour, 12);

  if p.due_at is null then
    v_anchor_date := case c.due_anchor
      when 'checkin' then v_check_in
      when 'checkout' then v_check_out
      when 'visit_at' then (case when p.metadata->>'visit_at' ~ '^\d{4}-\d{2}-\d{2}' then left(p.metadata->>'visit_at', 10)::date end)
      when 'next_checkin' then (
        select min(nr.check_in) from reservations nr
        where nr.property_id = p.property_id
          and nr.check_in >= (p.started_at at time zone 'America/Edmonton')::date
          and coalesce(nr.status, '') !~* '(cancel|declin|denied|expired|inquiry)'
      )
    end;

    if c.due_anchor = 'start' then
      p.due_at := p.started_at + v_due_offset;
    elsif v_anchor_date is not null then
      p.due_at := (v_anchor_date + v_due_offset + make_interval(hours => v_hour)) at time zone 'America/Edmonton';
    elsif c.due_anchor = 'next_checkin' then
      p.due_at := p.started_at + interval '3 days';
    end if;
  end if;

  if p.target_at is null and v_target_offset is not null then
    p.target_at := p.started_at + v_target_offset;
  end if;

  return p;
end;
$$;

create or replace function public.compute_ticket_health(p public.tickets)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  c ticket_type_clocks;
  v_hard boolean := false;
  v_total int;
  v_done int;
  v_elapsed numeric;
begin
  if p.status in ('resolved', 'closed') or p.due_at is null then
    return null;
  end if;

  select * into c from ticket_type_clocks where type = p.type;
  v_hard := coalesce(c.due_is_hard, false);

  if p.status = 'blocked' and coalesce(c.pausable, false) and not v_hard then
    return 'waiting';
  end if;

  if now() > p.due_at then
    return case when v_hard then 'missed' else 'behind' end;
  end if;

  if p.target_at is not null and now() > p.target_at then
    return 'behind';
  end if;

  select count(*), count(*) filter (where is_done) into v_total, v_done
  from ticket_items where ticket_id = p.id;

  if c.critical_before is not null and p.due_at - now() <= c.critical_before and v_done < v_total then
    return 'behind';
  end if;

  if c.warn_before is not null and p.due_at - now() <= c.warn_before then
    return 'attention';
  end if;

  if v_total > 0 and p.started_at is not null and p.due_at > p.started_at then
    v_elapsed := extract(epoch from now() - p.started_at) / extract(epoch from p.due_at - p.started_at);
    if v_elapsed > 0.25 and v_elapsed - (v_done::numeric / v_total) > (1.0 / 3) then
      return 'attention';
    end if;
  end if;

  return 'on_track';
end;
$$;

create or replace function public.tickets_clock_before()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c ticket_type_clocks;
  v_shift interval;
begin
  begin
    if tg_op = 'INSERT' then
      new := fill_ticket_clock(new);
    else
      select * into c from ticket_type_clocks where type = new.type;

      -- A review removal case's follow-up clock restarts with each new attempt.
      if new.type = 'review_removal_case'
         and new.metadata->>'attempt_number' is distinct from old.metadata->>'attempt_number' then
        new.started_at := now();
        new.due_at := now() + coalesce(c.due_offset, interval '5 days');
      end if;

      -- Waiting on someone else pauses soft clocks: the time spent blocked is added back.
      if new.status = 'blocked' and old.status is distinct from 'blocked' then
        new.paused_at := now();
      elsif old.status = 'blocked' and new.status is distinct from 'blocked' then
        if old.paused_at is not null and coalesce(c.pausable, false) and not coalesce(c.due_is_hard, false) then
          v_shift := now() - old.paused_at;
          new.due_at := new.due_at + v_shift;
          new.target_at := new.target_at + v_shift;
        end if;
        new.paused_at := null;
      end if;
    end if;

    new.health := compute_ticket_health(new);
    if new.type <> 'unanswered_message' and new.health is not null then
      new.sla_breached := new.health in ('behind', 'missed');
    end if;
  exception when others then
    raise warning 'tickets_clock_before failed for ticket %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger tickets_clock_before
  before insert or update on public.tickets
  for each row execute function public.tickets_clock_before();

-- Checklist changes move health (progress vs time), so touch the parent ticket.
create or replace function public.ticket_items_touch_ticket()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  begin
    update tickets set health = health where id = coalesce(new.ticket_id, old.ticket_id);
  exception when others then
    raise warning 'ticket_items_touch_ticket failed: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger ticket_items_touch_ticket
  after insert or update or delete on public.ticket_items
  for each row execute function public.ticket_items_touch_ticket();

-- Time passing: recompute open tickets whose health would change. Called every
-- 15 minutes by the n8n workflow Pique-Ticket-Health-Refresh.
create or replace function public.refresh_ticket_health()
returns int
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  update tickets t set health = x.h
  from (
    select id, compute_ticket_health(tk) as h from tickets tk
    where tk.status in ('open', 'in_progress', 'blocked')
  ) x
  where x.id = t.id and t.health is distinct from x.h;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.refresh_ticket_health() from public, anon, authenticated;
revoke execute on function public.fill_ticket_clock(public.tickets) from public, anon;
revoke execute on function public.compute_ticket_health(public.tickets) from public, anon;

-- Backfill before the history trigger exists, so existing tickets don't each
-- get a "health changed" entry. Mirrored tickets start from their source record,
-- not from when the mirror was installed.
update tickets t set started_at = rf.created_at
from review_flags rf
where t.type = 'review_flag' and t.started_at is null
  and t.external_ref = 'review_flag:' || rf.id;

update tickets t set started_at = d.last_attempt
from (
  select review_id, max(created_at) as last_attempt from review_removal_drafts group by review_id
) d
where t.type = 'review_removal_case' and t.started_at is null
  and t.external_ref = 'review_removal:' || d.review_id;

update tickets t set
  started_at = f.started_at,
  due_at = f.due_at,
  target_at = f.target_at
from (select (fill_ticket_clock(tk)).* from tickets tk) f
where f.id = t.id and (t.started_at is null or t.due_at is null or t.target_at is null);

update tickets set health = health where status in ('open', 'in_progress', 'blocked');

-- History entry whenever health changes on an open ticket.
create or replace function public.tickets_health_event()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  begin
    insert into ticket_events (ticket_id, event_type, from_value, to_value, note)
    values (
      new.id,
      case when new.health in ('behind', 'missed') then 'escalation' else 'field_change' end,
      old.health,
      new.health,
      'Clock: ' || coalesce(initcap(replace(old.health, '_', ' ')), 'None') || ' → ' || initcap(replace(new.health, '_', ' '))
    );
  exception when others then
    raise warning 'tickets_health_event failed for ticket %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger tickets_health_event
  after update on public.tickets
  for each row
  when (old.health is distinct from new.health and new.health is not null)
  execute function public.tickets_health_event();
