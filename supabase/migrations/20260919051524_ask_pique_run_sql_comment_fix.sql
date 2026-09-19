-- Correction to the source comment in ask_pique_run_sql (no behavior change,
-- CREATE OR REPLACE preserves ownership by ask_pique_ro): empirically,
-- Postgres rejects a data-modifying CTE in this FROM-subquery position
-- outright ("WITH clause containing a data-modifying statement must be at
-- the top level") rather than accepting it and relying on the role's
-- SELECT-only grants to block it. The role grant remains the correct
-- backstop for other potential vectors (e.g. a caller-reachable writable
-- function), just not for this specific one.
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
