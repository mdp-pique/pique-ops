-- Wires up the "Add photo" button (a placeholder in the UI since the
-- ticketing_foundation migration - ticket_attachments already existed with
-- no storage bucket behind it) and adds per-review-removal-attempt evidence
-- uploads ("stays with the first and second appeal, etc.").

insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', false)
on conflict (id) do nothing;

-- Private bucket - staff-only via the app's own auth, not a public URL.
create policy "authenticated_insert_ticket_attachments"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'ticket-attachments'
    and exists (select 1 from public.profiles p where p.id = auth.uid())
  );

create policy "authenticated_read_ticket_attachments"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and exists (select 1 from public.profiles p where p.id = auth.uid())
  );

-- Nullable: null means a general ticket-level photo; set means this
-- attachment belongs to one specific review_removal_drafts attempt, so
-- evidence stays attached to whichever appeal round it was gathered for.
alter table public.ticket_attachments
  add column if not exists review_removal_draft_id uuid references public.review_removal_drafts(id);
