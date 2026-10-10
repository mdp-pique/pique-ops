-- Tech requests from Pique-a-choo get scoped before they're logged, and the person who
-- asked hears back when it's done (MDP 10-10). Additive columns only.
--   scope              the full scope Pique-a-choo worked out with them (problem, today, wanted, done when)
--   context            the Slack conversation it came from (thread or posts above + the Q&A)
--   tech_post_*        the #tech-support post, so "done" can reply under it too
--   finished_notified_at  when the "done" reply went out (cleared if the ticket is reopened)
--   finished_status       the ticket status that reply was for (resolved / closed)
alter table public.slack_assistant_tech_proposals
  add column if not exists scope text,
  add column if not exists context text,
  add column if not exists tech_post_channel text,
  add column if not exists tech_post_ts text,
  add column if not exists finished_notified_at timestamptz,
  add column if not exists finished_status text;
