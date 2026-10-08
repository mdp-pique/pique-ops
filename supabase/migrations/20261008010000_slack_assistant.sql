-- Pique-a-choo as a Slack assistant (MDP 10-08): DM it or @mention it, and it answers from the
-- database the same way the app's assistant does (read-only SQL as ask_pique_ro), in a thread.
-- Only people with a Pique Ops profile get answers. Feature asks / bugs are offered as a
-- "Log as tech request" button; a tap opens a tech_request ticket.

-- Slack calls arrive with no signed-in user, so the RLS policies on ask_pique_ro (which all
-- require auth.uid() to be a profile) would return nothing. This runs the same read-only query
-- with auth.uid() set to the profile the Slack user was matched to. Owned by ask_pique_ro like
-- ask_pique_run_sql; only the server (service_role) may call it.
create or replace function public.ask_pique_run_sql_as(query text, p_profile uuid)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_profile::text, true);
  -- After the claims are set: profiles' own RLS for ask_pique_ro checks auth.uid().
  if not exists (select 1 from profiles where id = p_profile) then
    raise exception 'not a Pique Ops user';
  end if;
  set local statement_timeout = '5000ms';
  return query execute format('select to_jsonb(t) from (%s) as t limit 500', query);
end;
$$;
-- Same as ask_pique_run_sql: CREATE on the schema only for the moment of the transfer.
grant create on schema public to ask_pique_ro;
alter function public.ask_pique_run_sql_as(text, uuid) owner to ask_pique_ro;
revoke create on schema public from ask_pique_ro;
revoke execute on function public.ask_pique_run_sql_as(text, uuid) from public, anon, authenticated;
grant execute on function public.ask_pique_run_sql_as(text, uuid) to service_role;

-- Channels the assistant must never read (it reads the synced Slack copy, which includes
-- private channels). #cleaning-health-check carries summaries of cleaners' DMs.
create table public.assistant_hidden_channels (
  channel_id text primary key,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.assistant_hidden_channels enable row level security;
create policy assistant_hidden_channels_read on public.assistant_hidden_channels for select to authenticated, ask_pique_ro
  using (exists (select 1 from profiles p where p.id = auth.uid()));
grant select on public.assistant_hidden_channels to ask_pique_ro;
insert into public.assistant_hidden_channels (channel_id, reason) values
  ('C0BJM1A4MDY', '#cleaning-health-check: summaries of cleaner DMs (office only)')
on conflict do nothing;

-- Slack history for the assistant: app users only, never a hidden channel.
create policy ask_pique_ro_read_slack_messages on public.slack_messages for select to ask_pique_ro
  using (exists (select 1 from profiles p where p.id = auth.uid())
         and not exists (select 1 from assistant_hidden_channels h where h.channel_id = slack_messages.channel_id));
create policy ask_pique_ro_read_slack_channels on public.slack_channels for select to ask_pique_ro
  using (exists (select 1 from profiles p where p.id = auth.uid())
         and not exists (select 1 from assistant_hidden_channels h where h.channel_id = slack_channels.channel_id));
create policy ask_pique_ro_read_slack_users on public.slack_users for select to ask_pique_ro
  using (exists (select 1 from profiles p where p.id = auth.uid()));

-- One row per Slack conversation thread the assistant is in: who started it and the turns so
-- far (question / answer pairs), so follow-ups in the thread keep the context.
create table public.slack_assistant_threads (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  thread_ts text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  turns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, thread_ts)
);
alter table public.slack_assistant_threads enable row level security;
create policy slack_assistant_threads_read on public.slack_assistant_threads for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

-- Slack retries an event it thinks we missed; each event is handled once.
create table public.slack_assistant_events (
  event_id text primary key,
  created_at timestamptz not null default now()
);
alter table public.slack_assistant_events enable row level security;

-- A tech request the assistant offered; the button tap turns it into a ticket (once).
create table public.slack_assistant_tech_proposals (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.slack_assistant_threads(id) on delete cascade,
  title text not null,
  summary text not null,
  asked_by uuid references public.profiles(id) on delete set null,
  question text,
  slack_url text,
  ticket_id uuid references public.tickets(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.slack_assistant_tech_proposals enable row level security;
create policy slack_assistant_tech_proposals_read on public.slack_assistant_tech_proposals for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

insert into ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values ('tech_request', 'created', 'start', interval '7 days', null, false, null, interval '2 days', null, true)
on conflict (type) do nothing;
