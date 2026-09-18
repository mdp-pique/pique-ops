-- Fix: profiles_admin_write's policy queried public.profiles from within its
-- own USING/WITH CHECK clause, which re-triggers RLS on profiles and causes
-- "infinite recursion detected in policy for relation profiles" on every
-- request - silently swallowed by the app as "no profile", but a real
-- Postgres error underneath. Standard fix: a SECURITY DEFINER helper
-- function that checks admin status without going back through RLS.

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = uid and role = 'admin'
  );
$$;

comment on function public.is_admin is
  'SECURITY DEFINER helper so profiles RLS policies can check admin status without recursively re-triggering RLS on profiles itself.';

drop policy if exists "profiles_admin_write" on public.profiles;

create policy "profiles_admin_write"
  on public.profiles for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

notify pgrst, 'reload schema';
