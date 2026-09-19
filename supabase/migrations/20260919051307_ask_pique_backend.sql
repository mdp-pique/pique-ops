-- Ask Pique (PRD §7.7 / UI spec §10): a conversational read-only SQL agent.
-- The real guarantee per spec is a dedicated SELECT-only Postgres role, not
-- just the app-layer validator - so even a successfully-injected mutating
-- statement fails on a DB-level permission error, not just app logic.

-- Dedicated read-only role. NOLOGIN - never connected to directly, only used
-- as the owner identity a SECURITY DEFINER function executes as.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ask_pique_ro') then
    create role ask_pique_ro nologin;
  end if;
end
$$;

-- Migrations run as `postgres`, which needs membership to transfer function
-- ownership to this new role below.
grant ask_pique_ro to postgres;

grant usage on schema public to ask_pique_ro;
grant select on all tables in schema public to ask_pique_ro;
-- (no ALTER DEFAULT PRIVILEGES here - postgres doesn't own the public schema
-- on this project; re-run the GRANT SELECT above if new tables are added.)

-- Membership in `authenticated` so existing "to authenticated" RLS policies
-- match this role too (RLS role-matching is membership-based) - WITHOUT
-- inheriting authenticated's own write grants (tickets/comments/etc we
-- added for the app's own actions). This role only ever has the explicit
-- SELECT grant above.
grant authenticated to ask_pique_ro with inherit false;

create table public.ask_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  question text not null,
  queries jsonb not null default '[]'::jsonb,
  row_counts jsonb not null default '[]'::jsonb,
  tool_call_count int not null default 0,
  total_tokens int,
  duration_ms int,
  error text,
  created_at timestamptz not null default now()
);

alter table public.ask_log enable row level security;

create policy "authenticated_read_ask_log"
  on public.ask_log for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "authenticated_insert_ask_log"
  on public.ask_log for insert
  to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));

create or replace function public.ask_pique_run_sql(query text)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  set local statement_timeout = '5000ms';
  -- Wrapping as a FROM-subquery is itself a structural guard: Postgres's
  -- grammar only accepts a single SELECT-shaped expression here, so a
  -- second statement after a semicolon is a syntax error, and a
  -- data-modifying CTE is rejected outright for not being top-level -
  -- neither ever executes. This function still always runs as ask_pique_ro
  -- (SELECT-only, granted separately) as a backstop against other vectors,
  -- independent of what the app-layer validator already caught or missed.
  return query execute format('select to_jsonb(t) from (%s) as t limit 500', query);
end;
$$;

-- ALTER ... OWNER TO requires the new owner to hold CREATE on the function's
-- schema at the moment of transfer (a Postgres preflight check, not an
-- ongoing requirement) - grant it just long enough to make the transfer,
-- then revoke it immediately. Ownership persists independent of the owner's
-- current schema grants, so ask_pique_ro ends up owning this function while
-- still holding no CREATE privilege anywhere.
grant create on schema public to ask_pique_ro;
alter function public.ask_pique_run_sql(text) owner to ask_pique_ro;
revoke create on schema public from ask_pique_ro;

revoke all on function public.ask_pique_run_sql(text) from public;
grant execute on function public.ask_pique_run_sql(text) to authenticated;

comment on function public.ask_pique_run_sql is
  'Ask Pique agent tool (UI spec §10.2). Executes caller-supplied read SQL as the ask_pique_ro role, which has SELECT-only grants and no write privileges anywhere - the real guarantee, independent of the app-layer validator. Runs with the real requesting user''s auth.uid() context via the request.jwt.claims GUC PostgREST sets before invoking any function, so existing RLS policies still apply exactly as they would for a normal authenticated query.';
