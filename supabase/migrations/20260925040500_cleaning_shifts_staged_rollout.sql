-- Cutover safety for the booking-driven Connecteam shift planner (20260925030000).
--
-- 1. Staged rollout: automation_flags.cleaning_shifts_live_actions (comma list of
--    actions n8n may execute, default all) and cleaning_shifts_batch (max actions
--    per run, default 50). The first live run is limited to one create so the
--    Connecteam write format can be checked before anything is deleted.
-- 2. Re-check before acting: a planned live action that is no longer in the
--    current plan (booking changed, shift claimed, shift already gone) is marked
--    skipped instead of being sent later.

insert into public.automation_flags (key, value) values
  ('cleaning_shifts_live_actions', 'create,move,remove,remove_duplicate,flag_claimed'),
  ('cleaning_shifts_batch', '50')
on conflict (key) do nothing;

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
    'create,move,remove,remove_duplicate,flag_claimed'), ' ', ''), ',');
  v_batch int := coalesce(nullif((select value from public.automation_flags where key = 'cleaning_shifts_batch'), '')::int, 50);
begin
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
  where a.mode = 'live' and a.status = 'planned' and a.action = any (v_actions)
  -- Creates first: a missing clean matters more than a leftover one.
  order by case a.action when 'create' then 0 when 'move' then 1 when 'flag_claimed' then 2 else 3 end, a.check_out, a.id
  limit greatest(v_batch, 0);
end;
$function$;

revoke execute on function public.run_cleaning_shift_planner() from public, anon, authenticated;
grant execute on function public.run_cleaning_shift_planner() to service_role;
