-- reservations, properties, guests, reviews, and messages were only ever
-- readable by service_role (n8n's automations) - there was no `authenticated`
-- policy at all, so the app's user-session client got empty results on every
-- query against them (Reservations screen showing 0, Queue rows showing
-- "Unknown property"/blank guest, Today's "in stay" bubbles empty, etc).
--
-- Purely additive: read-only SELECT for any authenticated app user with a
-- profiles row, same pattern as the tickets/conversations policies. Does not
-- touch the existing service_role_all policy or change what n8n can do.

create policy "authenticated_read_reservations"
  on public.reservations for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "authenticated_read_properties"
  on public.properties for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "authenticated_read_guests"
  on public.guests for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "authenticated_read_reviews"
  on public.reviews for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "authenticated_read_messages"
  on public.messages for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
