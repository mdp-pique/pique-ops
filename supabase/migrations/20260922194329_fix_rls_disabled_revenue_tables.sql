-- Critical security fix (Supabase advisory, ERROR level): these 5 pre-existing
-- tables had RLS completely disabled, meaning anyone with the project's
-- public anon key could read/write them with no restriction at all via
-- PostgREST. Unrelated to the Pique Ops ticketing app - these belong to the
-- revenue-management side (VR platform statements, QuickBooks transactions,
-- commission rates).
--
-- Enabling RLS with no policy (same already-accepted pattern as review_flags,
-- slack_channels, etc. in this same database) does not change any existing
-- legitimate behavior: whatever currently reads/writes these tables via
-- service_role continues to work exactly as before, since service_role
-- always bypasses RLS regardless of policies. Only anon/authenticated
-- access - which should never have been open - is now blocked by default.

alter table public.vr_statements enable row level security;
alter table public.qbo_transactions enable row level security;
alter table public.vr_listing_map enable row level security;
alter table public.vr_statement_summary enable row level security;
alter table public.agreed_commission_rates enable row level security;
