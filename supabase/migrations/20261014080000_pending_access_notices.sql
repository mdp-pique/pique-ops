-- Someone signed in to Pique Ops with no profile lands on /pending ("Access pending"). Glenn sat there
-- on 10-14 until he mentioned it in a Slack thread (MDP kept admin approval, 10-14). The page now DMs
-- MDP once per person, as Pique-a-choo, with a link to Admin > Users. This table is that "once".
-- Service role only (the page writes it with the admin client); nobody else needs to read it.

create table if not exists public.pending_access_notices (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.pending_access_notices enable row level security;

create policy pending_access_notices_service_role on public.pending_access_notices
  for all to service_role using (true) with check (true);
