-- One reminder for a "Log as tech request" button nobody tapped (tech request 10-14, MDP: requests were
-- getting lost). The changelog run (every 5 min) posts it in the thread ~5 minutes after the proposal,
-- with the button again and a "No thanks". nudged_at claims the reminder (once per proposal);
-- dismissed_at records "No thanks", so nothing asks again.

alter table public.slack_assistant_tech_proposals
  add column if not exists nudged_at timestamptz,
  add column if not exists dismissed_at timestamptz;
