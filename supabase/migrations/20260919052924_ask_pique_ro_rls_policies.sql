-- Bug fix: GRANT authenticated TO ask_pique_ro WITH INHERIT FALSE (in the
-- ask_pique_backend migration) does NOT make "to authenticated" RLS
-- policies apply to ask_pique_ro. Postgres resolves RLS role-matching via
-- has_privs_of_role() (pg_has_role(..., 'usage')), which is false under
-- INHERIT FALSE - only raw membership (pg_has_role(..., 'member')) is true.
-- So every RLS-protected table silently returned zero rows to Ask Pique
-- regardless of auth.uid(), rather than an error - a correctness bug, not
-- a security one (default-deny), but real all the same (confirmed empirically:
-- true counts of 256 open tickets / 3 one-star reviews both came back as 0).
--
-- Fix, staying additive per the project's "never edit what's already
-- working" rule: brand new SELECT-only policies scoped directly TO
-- ask_pique_ro, each mirroring the EXACT qual of that table's existing
-- "authenticated" policy - so Ask Pique can see exactly what a signed-in
-- staff member already sees today, no more. No existing policy is touched.
-- (ask_pique_ro's ACL grants remain SELECT-only regardless of RLS command
-- scope, so mirroring an ALL-command policy's qual here as a SELECT-only
-- policy cannot grant it any write capability.)

create policy "ask_pique_ro_read_ask_log" on public.ask_log
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_calls" on public.calls
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_conversations" on public.conversations
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_guests" on public.guests
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_messages" on public.messages
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_profiles" on public.profiles
  for select to ask_pique_ro
  using (true);

create policy "ask_pique_ro_read_properties" on public.properties
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_reservations" on public.reservations
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_review_removal_drafts" on public.review_removal_drafts
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_reviews" on public.reviews
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_ticket_attachments" on public.ticket_attachments
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_ticket_comments" on public.ticket_comments
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_ticket_events" on public.ticket_events
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_ticket_items" on public.ticket_items
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "ask_pique_ro_read_tickets" on public.tickets
  for select to ask_pique_ro
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
