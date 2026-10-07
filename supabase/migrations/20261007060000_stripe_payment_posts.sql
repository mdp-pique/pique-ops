-- Stripe payment feed (docs/zapier-migration.md P1-13, "Stripe Payment Success
-- Notification to Slack"). The Zap took each payment_intent.succeeded on the Pique
-- Stripe account, looked the reservation code up in the "Hospitable New
-- Reservations" sheet (P1-88) and posted status, name, amount, reservation,
-- property and dates to #stripe-payment-notification. Now Stripe calls the app's
-- /api/stripe/webhook directly (src/lib/stripe/payments.ts), the stay comes from our
-- own reservations table, and Pique Bot posts it. FYI only: no ticket, no buttons.
-- This table is the claim (one row per payment intent), so a Stripe retry never
-- double-posts. Service role writes; staff can read.

create table public.stripe_payment_posts (
  payment_intent_id text primary key,
  event_id text not null,
  reservation_id uuid references public.reservations(id) on delete set null,
  reservation_code text,
  customer_name text,
  amount numeric(12, 2) not null,
  currency text not null,
  channel_id text not null,
  slack_ts text,
  created_at timestamptz not null default now()
);

alter table public.stripe_payment_posts enable row level security;
create policy stripe_payment_posts_read on public.stripe_payment_posts for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));
