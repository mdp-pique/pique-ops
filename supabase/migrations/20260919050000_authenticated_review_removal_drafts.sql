-- review_removal_drafts only had a service_role_all policy (same gap as the
-- earlier reservations/properties/guests/reviews/messages fix), so the app's
-- new in-app "draft a removal request" feature couldn't read prior attempts
-- or log a new one. Purely additive: read for any authenticated app user
-- with a profiles row (same pattern as other tables), insert so staff can
-- log a manually-drafted attempt as a new row - never update/delete, since
-- editing an existing row is the automated n8n workflow's job, not ours.
-- Does not touch the existing service_role_all policy or n8n's own access.

create policy "authenticated_read_review_removal_drafts"
  on public.review_removal_drafts for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

create policy "authenticated_insert_review_removal_drafts"
  on public.review_removal_drafts for insert
  to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));
