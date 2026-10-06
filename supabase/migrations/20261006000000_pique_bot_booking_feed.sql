-- Pique Bot booking feed (docs/zapier-migration.md P1-45, "New Reservations").
-- Michael and Katrina want every new booking in #new-reservations as it comes
-- in: who, where, when, source and payout. FYI only - no ticket, no buttons.
-- src/lib/pique-bot/bookings.ts posts each accepted reservation once; this
-- table is the claim (one row per reservation), so a re-run never double-posts.
-- Service role writes; staff can read.

create table public.pique_bot_booking_posts (
  reservation_id uuid primary key references public.reservations(id) on delete cascade,
  channel_id text not null,
  slack_ts text,
  created_at timestamptz not null default now()
);

alter table public.pique_bot_booking_posts enable row level security;
create policy pique_bot_booking_posts_read on public.pique_bot_booking_posts for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

-- The Zap posted every booking up to Amber Wiebe's (2026-10-05 19:59 UTC), then
-- stopped. Mark those as already posted so the first run only catches up on
-- the ones it missed.
insert into public.pique_bot_booking_posts (reservation_id, channel_id)
select id, 'zapier'
from public.reservations
where created_at <= '2026-10-05 20:00:00+00' and created_at > '2026-10-03 00:00:00+00'
on conflict do nothing;
