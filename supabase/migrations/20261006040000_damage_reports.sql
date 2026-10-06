-- Damage reports from Connecteam (docs/zapier-migration.md lane C). Replaces four
-- Zaps: "Connecteam to Slack - Damages", "Connecteam - Linens Damaged by Guest",
-- "New Aircover Claim" and "New Truvi Claim". Before, a cleaner's form landed in
-- Slack and the team reacted with an emoji; a second Zap watched for the
-- AirCover / Truvi emoji and asked Laurice to prepare the claim.
--
-- Now: n8n Pique-Damage-Forms reads both forms every 5 minutes and calls
-- record_damage_report(), which opens one damage_report ticket per submission
-- (property matched from the form's location, the stay matched from the
-- property's latest checkout). Pique Bot posts it where the Zap did, with
-- AirCover claim / Truvi claim / Wear and tear buttons instead of emojis. The
-- choice runs decide_damage_report(): the damage ticket resolves and a
-- claim_tracker ticket (deadline from checkout: AirCover 14 days, Truvi 30) or
-- a maintenance_ticket opens. Claims post to #new-claim-notification tagging
-- Laurice, like the claim Zaps did.

insert into ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values ('damage_report', 'created', 'start', interval '1 day', null, false, null, interval '4 hours', null, true)
on conflict (type) do nothing;

-- Every submission seen, so each makes at most one ticket. The first run only
-- records what is already there (automation_flags.damage_reports_armed).
create table public.damage_report_submissions (
  submission_id text primary key,
  form text not null check (form in ('damage', 'linens')),
  ticket_id uuid references public.tickets(id) on delete set null,
  first_seen_at timestamptz not null default now()
);
alter table public.damage_report_submissions enable row level security;
create policy damage_report_submissions_read on public.damage_report_submissions for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

insert into public.automation_flags (key, value, note)
values ('damage_reports_armed', 'false',
        'Pique-Damage-Forms: false = only record existing Connecteam submissions as seen (first run); true = open damage_report tickets.')
on conflict (key) do nothing;

-- The form's Location answer to a property: the cleaning form's option map
-- first (same names, already matched by hand), then the property name.
create or replace function public.damage_report_property(p_location text)
returns uuid
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select m.property_id from cleaning_form_option_map m
     where lower(trim(m.option_text)) = lower(trim(p_location)) and m.property_id is not null
       and not coalesce(m.is_deleted, false)
     limit 1),
    (select p.id from properties p
     where lower(regexp_replace(trim(p.property_name), '\*+$', '')) = lower(regexp_replace(trim(p_location), '\*+$', ''))
     limit 1));
$$;

-- Called by n8n once per submission. p_sub: id, form ('damage' | 'linens'),
-- submitted_at (ISO), submitted_by_id, location, description, photos[], videos[].
-- Returns 'ticket', 'seen' (already recorded), 'baseline' (not armed yet) or 'skipped'.
create or replace function public.record_damage_report(p_sub jsonb)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_id text := p_sub->>'id';
  v_form text := p_sub->>'form';
  v_inserted text;
  v_property uuid;
  v_when timestamptz := coalesce(nullif(p_sub->>'submitted_at', '')::timestamptz, now());
  v_day date := (v_when at time zone 'America/Edmonton')::date;
  v_res record;
  v_by text;
  v_desc text := coalesce(nullif(trim(p_sub->>'description'), ''), '(no description)');
  v_ticket uuid;
begin
  if v_id is null or v_form not in ('damage', 'linens') then
    return 'skipped';
  end if;

  insert into damage_report_submissions (submission_id, form) values (v_id, v_form)
  on conflict (submission_id) do nothing
  returning submission_id into v_inserted;
  if v_inserted is null then
    return 'seen';
  end if;
  if coalesce((select value from automation_flags where key = 'damage_reports_armed'), 'false') <> 'true' then
    return 'baseline';
  end if;

  v_property := damage_report_property(p_sub->>'location');
  -- The stay that just ended there: cleaners fill this in on the turnover.
  if v_property is not null then
    select r.id, g.full_name into v_res
    from reservations r left join guests g on g.id = r.guest_id
    where r.property_id = v_property and r.status = 'accepted'
      and r.check_out between v_day - 3 and v_day
    order by r.check_out desc
    limit 1;
  end if;
  select full_name into v_by from connecteam_users where user_id::text = p_sub->>'submitted_by_id';

  insert into tickets (type, status, priority, stage, source, property_id, reservation_id, guest_name, external_ref, metadata)
  values ('damage_report', 'open', 'normal', 'accountability', 'automation', v_property, v_res.id, v_res.full_name,
          'damage:' || v_id,
          jsonb_build_object(
            'title', case v_form when 'linens' then 'Linens damaged' else 'Damage reported' end || ': ' || left(v_desc, 80),
            'form', v_form,
            'location', p_sub->>'location',
            'description', v_desc,
            'photos', coalesce(p_sub->'photos', '[]'::jsonb),
            'videos', coalesce(p_sub->'videos', '[]'::jsonb),
            'submitted_by', v_by,
            'submitted_at', v_when,
            'connecteam_submission_id', v_id))
  on conflict (external_ref) do nothing
  returning id into v_ticket;

  if v_ticket is not null then
    insert into ticket_items (ticket_id, label, sort_order) values (v_ticket, 'Claim or wear and tear decided', 0);
    insert into ticket_events (ticket_id, event_type, to_value, note)
    values (v_ticket, 'status_change', 'open', 'Created automatically from a Connecteam ' ||
            case v_form when 'linens' then 'linens damage' else 'damage' end || ' form' || coalesce(' by ' || v_by, ''));
    update damage_report_submissions set ticket_id = v_ticket where submission_id = v_id;
  end if;
  return 'ticket';
end;
$$;

-- The decision from Pique Bot (or the app). Resolves the damage ticket and opens
-- the follow-up: 'aircover' / 'truvi' -> claim_tracker, 'wear' -> maintenance_ticket.
-- Idempotent: once decided, later taps change nothing.
create or replace function public.decide_damage_report(p_ticket uuid, p_choice text, p_actor uuid, p_actor_name text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  t tickets%rowtype;
  v_platform text := case p_choice when 'aircover' then 'AirCover' when 'truvi' then 'Truvi' end;
  v_label text := case p_choice when 'aircover' then 'AirCover claim' when 'truvi' then 'Truvi claim' when 'wear' then 'Wear and tear' end;
  v_checkout date;
  v_due timestamptz;
  v_follow uuid;
  v_desc text;
  v_where text;
begin
  if v_label is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown choice');
  end if;
  select * into t from tickets where id = p_ticket and type = 'damage_report' for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not a damage report');
  end if;
  if t.status not in ('open', 'in_progress', 'blocked') then
    return jsonb_build_object('ok', false, 'reason', 'already decided', 'decision', t.metadata->>'decision');
  end if;

  v_desc := coalesce(t.metadata->>'description', '');
  v_where := coalesce(t.metadata->>'location', 'unit');

  if v_platform is not null then
    select check_out into v_checkout from reservations where id = t.reservation_id;
    v_due := ((coalesce(v_checkout, ((t.metadata->>'submitted_at')::timestamptz at time zone 'America/Edmonton')::date)
               + case v_platform when 'Truvi' then 30 else 14 end) + time '23:00') at time zone 'America/Edmonton';
    insert into tickets (type, status, priority, stage, source, property_id, reservation_id, guest_name, parent_ticket_id,
                         due_at, external_ref, metadata)
    values ('claim_tracker', 'open', 'normal', 'accountability', 'automation', t.property_id, t.reservation_id, t.guest_name, t.id,
            v_due, 'claim:damage:' || t.id,
            jsonb_build_object(
              'title', v_platform || ' claim: ' || v_where,
              'platform', v_platform,
              'charges_summary', v_desc,
              'photos', coalesce(t.metadata->'photos', '[]'::jsonb),
              'videos', coalesce(t.metadata->'videos', '[]'::jsonb),
              'location', t.metadata->>'location',
              'damage_ticket_id', t.id))
    on conflict (external_ref) do nothing
    returning id into v_follow;
    if v_follow is not null then
      insert into ticket_items (ticket_id, label, sort_order)
      select v_follow, label, ord - 1
      from unnest(array['Before/after photos (wide + close-up)', 'Receipts or estimates', 'Third-party invoice',
                        'Proof guest accepted house rules', 'Claim filed']) with ordinality as x(label, ord);
    end if;
  else
    insert into tickets (type, status, priority, stage, source, property_id, reservation_id, guest_name, parent_ticket_id,
                         external_ref, metadata)
    values ('maintenance_ticket', 'open', 'normal', 'turnover', 'automation', t.property_id, t.reservation_id, t.guest_name, t.id,
            'maint:damage:' || t.id,
            jsonb_build_object(
              'title', 'Wear and tear: ' || v_where,
              'description', v_desc,
              'photos', coalesce(t.metadata->'photos', '[]'::jsonb),
              'location', t.metadata->>'location',
              'damage_ticket_id', t.id))
    on conflict (external_ref) do nothing
    returning id into v_follow;
    if v_follow is not null then
      insert into ticket_items (ticket_id, label, sort_order) values (v_follow, left(v_desc, 200), 0);
    end if;
  end if;

  if v_follow is not null then
    insert into ticket_events (ticket_id, event_type, actor_id, to_value, note)
    values (v_follow, 'status_change', p_actor, 'open', 'Opened from a damage report: ' || v_label || ' (' || p_actor_name || ')');
  end if;

  update ticket_items set is_done = true, done_by = p_actor, done_at = now() where ticket_id = t.id and not is_done;
  update tickets set status = 'resolved', closed_at = now(),
    metadata = metadata || jsonb_build_object('decision', p_choice, 'decided_by', p_actor_name, 'followup_ticket_id', v_follow)
  where id = t.id;
  insert into ticket_events (ticket_id, event_type, actor_id, to_value, note, payload) values
    (t.id, 'item_done', p_actor, 'true', 'Decided in Slack by ' || p_actor_name || ': ' || v_label,
     jsonb_build_object('source', 'pique_bot', 'kind', 'done', 'by', p_actor_name)),
    (t.id, 'comment', p_actor, null, 'Decision: ' || v_label,
     jsonb_build_object('source', 'pique_bot', 'kind', 'note', 'by', p_actor_name,
                        'note', v_label || case when v_platform is not null then ' - claim opened' else ' - maintenance ticket opened' end)),
    (t.id, 'status_change', p_actor, 'resolved', 'Resolved: ' || v_label || ' (' || p_actor_name || ')', '{}'::jsonb);

  return jsonb_build_object('ok', true, 'decision', p_choice, 'followup_ticket_id', v_follow);
end;
$$;

revoke execute on function public.record_damage_report(jsonb) from public, anon, authenticated;
revoke execute on function public.decide_damage_report(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.damage_report_property(text) from public, anon, authenticated;
