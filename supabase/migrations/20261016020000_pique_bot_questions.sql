-- Questions Pique-a-choo DMs to someone on the tech team's behalf (e.g. Janina on invoice checks,
-- Laurice on the door-code sheet). MDP 10-16: "when their replies come in, could they DM me?"
-- While a question is open (7 days, or until closed_at), that person's replies are forwarded to
-- forward_to (MDP) as Pique-a-choo instead of being answered as new questions: anything in the
-- question's thread, plus their first top-level DM after it (reply_ts), and that reply's thread.
-- Later top-level DMs go to the assistant as usual (Laurice DMs it her own questions). Service role only.

create table if not exists public.pique_bot_questions (
  id uuid primary key default gen_random_uuid(),
  slack_user_id text not null,
  channel text not null,
  ts text not null,
  topic text not null,
  forward_to text not null,
  acked_at timestamptz,
  last_forwarded_at timestamptz,
  reply_ts text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (channel, ts)
);

create index if not exists pique_bot_questions_open on public.pique_bot_questions (slack_user_id, channel) where closed_at is null;

alter table public.pique_bot_questions enable row level security;

create policy pique_bot_questions_service_role on public.pique_bot_questions
  for all to service_role using (true) with check (true);

insert into public.pique_bot_questions (slack_user_id, channel, ts, topic, forward_to, created_at) values
  ('U06SZU27S5B', 'D0C585682JH', '1792106148.621069', 'Invoice checks (cleaning and maintenance invoices)', 'U0414DNAC2V', to_timestamp(1792106148)),
  ('U049F2880MR', 'D0C67N76X08', '1792169850.311969', 'Door-code sheet (MASTER Internal STR Property Details 2.0)', 'U0414DNAC2V', to_timestamp(1792169850))
on conflict (channel, ts) do nothing;
