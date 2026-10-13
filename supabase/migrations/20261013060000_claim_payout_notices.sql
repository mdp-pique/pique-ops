-- Claim payout trackers (replaces the Zaps "Aircover Claim Payout Tracker Spreadsheet" and "Truvi Claim
-- Payout Tracker Spreadsheet", docs/zapier-migration.md P1-111 / P1-118; straight copy, MDP 10-13).
-- n8n Pique-Claim-Payouts reads the claims sheet ("For Aircover Claim": Aircover and Truvi tabs) every
-- 5 min. When a claim's reimbursed amount is filled in (Aircover column L, Truvi column M), it adds one
-- row per damage line to "Claim Payout Tracker 2026" and posts to #partnershipreports tagging Cristine,
-- like the Zaps did. This table remembers which payouts were handled (key = tab|code|amount, so a
-- corrected amount counts again, as the Zap's dedupe on that column did). The first run only records
-- what is already filled in (automation_flags.claim_payouts_armed).

create table public.claim_payout_notices (
  key text primary key,
  tab text not null check (tab in ('aircover', 'truvi')),
  code text,
  property text,
  amount text,
  baseline boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.claim_payout_notices enable row level security;
create policy claim_payout_notices_read on public.claim_payout_notices for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

insert into public.automation_flags (key, value, note)
values ('claim_payouts_armed', 'false',
        'Pique-Claim-Payouts: false = only record payouts already in the claims sheet (first run); true = add payout rows and post new ones.')
on conflict (key) do nothing;

-- p_rows: [{key, tab, code, property, amount, ...}] for every claim row with a reimbursed amount.
-- Not armed yet: records them all as already handled, arms, returns nothing. Armed: returns the ones
-- not handled yet (n8n adds their payout rows, posts, then calls claim_payout_done).
create or replace function public.claim_payouts_pending(p_rows jsonb)
returns setof jsonb
language plpgsql
set search_path = public
as $$
begin
  if coalesce((select value from automation_flags where key = 'claim_payouts_armed'), 'false') <> 'true' then
    insert into claim_payout_notices (key, tab, code, property, amount, baseline, done_at)
    select r->>'key', r->>'tab', r->>'code', r->>'property', r->>'amount', true, now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    on conflict (key) do nothing;
    update automation_flags set value = 'true' where key = 'claim_payouts_armed';
    return;
  end if;
  return query
  select r from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where not exists (select 1 from claim_payout_notices n where n.key = r->>'key' and n.done_at is not null);
end;
$$;

create or replace function public.claim_payout_done(p_row jsonb)
returns text
language sql
set search_path = public
as $$
  insert into claim_payout_notices (key, tab, code, property, amount, done_at)
  values (p_row->>'key', p_row->>'tab', p_row->>'code', p_row->>'property', p_row->>'amount', now())
  on conflict (key) do update set done_at = now()
  returning key;
$$;

revoke execute on function public.claim_payouts_pending(jsonb) from public, anon, authenticated;
revoke execute on function public.claim_payout_done(jsonb) from public, anon, authenticated;
