-- Pique Ops: ticketing & conversations foundation (PRD v1.1 §5, M0)
--
-- This migration is purely additive: new tables, new nullable columns on
-- existing tables. Nothing is dropped or renamed. See CLAUDE.md for the
-- schema-overlap findings that shaped the decisions below.

-- ---------------------------------------------------------------------------
-- profiles: app users. No such table exists yet; role drives RLS everywhere.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'ops_manager', 'customer_service', 'cleaning_coordinator', 'finance')),
  display_name text,
  slack_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'App users (PRD §2). Provisioned by an admin, not self-serve signup.';

alter table public.profiles enable row level security;

-- Every signed-in app user with a profile row can see the team roster.
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- Only admins manage other users' profiles (PRD §2: user management is admin-only).
create policy "profiles_admin_write"
  on public.profiles for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- conversations: thin grouping table. public.messages already carries
-- reservation_id/guest_id from the existing Hospitable sync, so this table's
-- job is only to (a) give calls something to attach to when there's no
-- reservation match, and (b) hold the unanswered/last-activity flags that
-- used to live on the now-deprecated unanswered_message_alerts table.
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations (id),
  property_id uuid references public.properties (id),
  guest_id uuid references public.guests (id),
  guest_name text,
  guest_phone text,
  channel text not null check (channel in ('hospitable_message', 'phone_call', 'sms')),
  external_id text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  unanswered boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_reservation_id_idx on public.conversations (reservation_id);
create index conversations_property_id_idx on public.conversations (property_id);
create unique index conversations_external_id_idx on public.conversations (channel, external_id) where external_id is not null;

alter table public.conversations enable row level security;

create policy "conversations_all_authenticated"
  on public.conversations for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));

-- ---------------------------------------------------------------------------
-- public.messages already exists (~193k rows, synced by Hospitable-Webhook-
-- Receiver and Hospitable-Sync-Messages-Daily). Extend it in place instead
-- of creating a parallel table.
-- ---------------------------------------------------------------------------
alter table public.messages
  add column conversation_id uuid references public.conversations (id),
  add column intent text check (intent in ('question', 'extension_request', 'complaint_cleaning', 'complaint_maintenance', 'early_checkin', 'late_checkout', 'other')),
  add column intent_confidence numeric;

create index messages_conversation_id_idx on public.messages (conversation_id);

-- ---------------------------------------------------------------------------
-- calls: genuinely new. GoHighLevel calls/voicemail (PRD §7.3, §10).
-- ---------------------------------------------------------------------------
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations (id),
  phone_number text,
  direction text not null check (direction in ('inbound', 'outbound')),
  call_status text not null check (call_status in ('missed', 'answered', 'voicemail')),
  duration_seconds integer,
  recording_url text,
  transcript text,
  occurred_at timestamptz not null,
  provider text not null default 'ghl',
  provider_call_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calls_conversation_id_idx on public.calls (conversation_id);
create index calls_phone_number_idx on public.calls (phone_number);

alter table public.calls enable row level security;

create policy "calls_all_authenticated"
  on public.calls for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));

-- ---------------------------------------------------------------------------
-- tickets: one generic ticketing system (PRD §5 core principle).
-- ---------------------------------------------------------------------------
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  stage text check (stage in ('book', 'checkin', 'stay', 'checkout', 'turnover', 'accountability')),
  property_id uuid references public.properties (id),
  reservation_id uuid references public.reservations (id),
  conversation_id uuid references public.conversations (id),
  guest_name text,
  staff_ref text,
  assignee_id uuid references public.profiles (id),
  created_by uuid references public.profiles (id),
  source text not null check (source in ('manual', 'automation', 'guest_message', 'missed_call', 'email')),
  external_ref text unique,
  parent_ticket_id uuid references public.tickets (id),
  rollover_count integer not null default 0,
  due_at timestamptz,
  sla_breached boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index tickets_type_idx on public.tickets (type);
create index tickets_status_idx on public.tickets (status);
create index tickets_property_id_idx on public.tickets (property_id);
create index tickets_reservation_id_idx on public.tickets (reservation_id);
create index tickets_assignee_id_idx on public.tickets (assignee_id);
create index tickets_stage_idx on public.tickets (stage);

alter table public.tickets enable row level security;

-- Baseline for M0: any authenticated app user (has a profiles row) can read
-- and write all tickets. Per-role restriction by ticket `type` (cleaning
-- roles see cleaning types, finance sees claims/fees, etc. — PRD §2/§6) is
-- deferred to M1, once the actual queue/detail UI actions are built and the
-- type-to-role mapping can be tested against real usage rather than guessed.
create policy "tickets_all_authenticated"
  on public.tickets for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));

create table public.ticket_items (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  label text not null,
  is_done boolean not null default false,
  done_by uuid references public.profiles (id),
  done_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index ticket_items_ticket_id_idx on public.ticket_items (ticket_id);

alter table public.ticket_items enable row level security;

create policy "ticket_items_all_authenticated"
  on public.ticket_items for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));

create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  author_id uuid references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);

create index ticket_comments_ticket_id_idx on public.ticket_comments (ticket_id);

alter table public.ticket_comments enable row level security;

create policy "ticket_comments_all_authenticated"
  on public.ticket_comments for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));

create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  storage_path text not null,
  kind text not null check (kind in ('photo', 'document', 'audio')),
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index ticket_attachments_ticket_id_idx on public.ticket_attachments (ticket_id);

alter table public.ticket_attachments enable row level security;

create policy "ticket_attachments_all_authenticated"
  on public.ticket_attachments for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  event_type text not null check (event_type in ('status_change', 'assignment', 'field_change', 'rollover', 'escalation', 'item_done', 'comment')),
  actor_id uuid references public.profiles (id),
  from_value text,
  to_value text,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ticket_events_ticket_id_idx on public.ticket_events (ticket_id);
create index ticket_events_event_type_idx on public.ticket_events (event_type);

alter table public.ticket_events enable row level security;

create policy "ticket_events_all_authenticated"
  on public.ticket_events for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Reservation-spine backfill columns (PRD §5 "Required changes to existing
-- tables"). cleaning_form_submission and cleaning_shift_check are per-
-- occurrence records (composite PK includes check_date), so a reservation_id
-- fix is meaningful here. cleaning_job_map is the static Connecteam-job-to-
-- property mapping, not a per-occurrence record — see CLAUDE.md; it is
-- intentionally NOT touched by this migration.
-- ---------------------------------------------------------------------------
alter table public.cleaning_form_submission
  add column reservation_id uuid references public.reservations (id);

alter table public.cleaning_shift_check
  add column reservation_id uuid references public.reservations (id);

create index cleaning_form_submission_reservation_id_idx on public.cleaning_form_submission (reservation_id);
create index cleaning_shift_check_reservation_id_idx on public.cleaning_shift_check (reservation_id);
