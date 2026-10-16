-- MDP 10-16: asked in Slack to "log this as a ticket so it's not dropped" (cancel Prohost), Pique-a-choo
-- said it couldn't make tickets, then could only offer a tech request. It can now offer a plain team
-- to-do: the same proposal + button flow as tech requests (slack_assistant_tech_proposals), with
-- kind = 'task'. The tap opens one team_task ticket (ref task:{proposal}, checklist "Done", assigned
-- to the first owner named), not posted to #tech-support and no changelog entry.

alter table public.slack_assistant_tech_proposals
  add column if not exists kind text not null default 'tech' check (kind in ('tech', 'task')),
  add column if not exists owner_slack_ids text[];

-- Due in 3 days (soft), like a tech request's clock but shorter.
insert into public.ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values
  ('team_task', 'created', 'start', interval '3 days', null, false, null, interval '1 day', null, true)
on conflict (type) do nothing;
