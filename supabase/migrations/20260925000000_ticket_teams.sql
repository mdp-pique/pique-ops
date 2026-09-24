-- Team (group) assignment. A ticket can belong to a team, a person, or both
-- (team owns it, a teammate picks it up). Each ticket type can default to a
-- team, filled on insert when nobody is assigned. Additive: new tables, a new
-- nullable column, and an exception-safe BEFORE trigger.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null,
  profile_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (team_id, profile_id),
  constraint team_members_team_id_fkey foreign key (team_id) references public.teams(id) on delete cascade,
  constraint team_members_profile_id_fkey foreign key (profile_id) references public.profiles(id) on delete cascade
);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

create policy teams_read on public.teams for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));
create policy teams_manage on public.teams for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'ops_manager')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'ops_manager')));

create policy team_members_read on public.team_members for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));
create policy team_members_manage on public.team_members for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'ops_manager')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'ops_manager')));

alter table public.tickets add column if not exists assignee_team_id uuid;
alter table public.tickets add constraint tickets_assignee_team_id_fkey
  foreign key (assignee_team_id) references public.teams(id) on delete set null;
create index if not exists tickets_assignee_team_idx on public.tickets (assignee_team_id) where assignee_team_id is not null;

alter table public.ticket_type_clocks add column if not exists default_team_id uuid;
alter table public.ticket_type_clocks add constraint ticket_type_clocks_default_team_id_fkey
  foreign key (default_team_id) references public.teams(id) on delete set null;

create policy ticket_type_clocks_manage on public.ticket_type_clocks for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'ops_manager')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'ops_manager')));

create or replace function public.tickets_default_team()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  begin
    if new.assignee_id is null and new.assignee_team_id is null then
      select default_team_id into new.assignee_team_id from ticket_type_clocks where type = new.type;
    end if;
  exception when others then
    raise warning 'tickets_default_team failed for ticket %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger tickets_default_team
  before insert on public.tickets
  for each row execute function public.tickets_default_team();
