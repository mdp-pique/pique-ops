-- Pique Bot: the 7 AM Slack check-ins that ask the team about open Requests
-- tickets (pet fee, direct booking ID, parking, pack 'n play) and let them tick
-- the checklist from Slack. One row per channel per morning. The unique key
-- makes a re-run skip a channel it already posted to, and ticket_ids is the
-- server-side list of what that post asked about: button taps are only
-- honoured for tickets in it.
--
-- Additive: a new table, written only by the app's service-role routes
-- (/api/pique-bot/morning, /api/slack/interactions).

create table public.pique_bot_posts (
  id uuid primary key default gen_random_uuid(),
  post_date date not null,
  channel_id text not null,
  slack_ts text,
  ticket_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pique_bot_posts_date_channel_key unique (post_date, channel_id)
);

alter table public.pique_bot_posts enable row level security;

create policy pique_bot_posts_team_read on public.pique_bot_posts
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy pique_bot_posts_service_all on public.pique_bot_posts
  for all to service_role using (true) with check (true);
