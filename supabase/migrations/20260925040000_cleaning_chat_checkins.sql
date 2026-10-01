-- Noon + 3 pm cleaning chat check-ins (requested by Tammy, 2026-09-25).
--
-- Reads the Connecteam chat that Connecteam-Chat-Capture (n8n rAwkafl0v6w1a755)
-- already writes to connecteam_chat_messages. Nothing here touches that workflow
-- or its tables' writers - all additive.
--
--   connecteam_conversations  chat titles ("Kaylee's Cleaning"), synced daily from
--                             the Connecteam Chat API by Pique-Connecteam-Directory-Sync.
--                             The webhook only carries a title on create/rename, so
--                             older chats had none.
--   connecteam_office_staff   who counts as office. Used to (a) scope DMs - only
--                             cleaner<->office DMs are read, never cleaner<->cleaner -
--                             and (b) decide whether a cleaner's message got a reply.
--   cleaning_chat_digests     one saved summary per day per slot, so the 3 pm run can
--                             see what noon already reported and the team can review.
--
-- cleaning_chat_digest_input(slot) builds the transcript + the unanswered list the
-- n8n workflow Pique-Cleaning-Chat-Checkins hands to Claude.
--
-- All three tables are service-role only: they hold DM content.

create table public.connecteam_conversations (
  conversation_id text primary key,
  title text,
  conversation_type text,
  raw jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.connecteam_conversations enable row level security;
create policy connecteam_conversations_service_all on public.connecteam_conversations
  for all to service_role using (true) with check (true);

create table public.connecteam_office_staff (
  user_id bigint primary key,
  note text,
  created_at timestamptz not null default now(),
  constraint connecteam_office_staff_user_id_fkey foreign key (user_id) references public.connecteam_users (user_id) on delete cascade
);

alter table public.connecteam_office_staff enable row level security;
create policy connecteam_office_staff_service_all on public.connecteam_office_staff
  for all to service_role using (true) with check (true);

-- Seeded with Connecteam's owner/manager accounts (Team = Admin/VA), which match who
-- answers across the cleaners' channels in the chat history. Edit freely. Katrina,
-- Michael and Ma Laurice were only added after the first directory sync put them in
-- connecteam_users; the select skips anyone not synced yet.
insert into public.connecteam_office_staff (user_id, note)
select u.user_id, u.full_name
from public.connecteam_users u
where u.user_id in (
  7936536,  -- Tammy Formoe
  7843631,  -- Janina Coyoca
  11081094, -- Glenn Michael
  7926299,  -- Kelechi Ogbonna
  7927354,  -- Cristine Chavez
  7747546,  -- Ma Laurice Eclipse
  7660611,  -- Katrina Stead
  7725794   -- Michael Stead
)
on conflict do nothing;

create table public.cleaning_chat_digests (
  id uuid primary key default gen_random_uuid(),
  digest_date date not null,
  slot text not null check (slot in ('noon', '3pm')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  message_count integer not null default 0,
  unanswered_count integer not null default 0,
  summary text,
  slack_ts text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cleaning_chat_digests_date_slot_key unique (digest_date, slot)
);

alter table public.cleaning_chat_digests enable row level security;
create policy cleaning_chat_digests_service_all on public.cleaning_chat_digests
  for all to service_role using (true) with check (true);

-- p_slot 'noon': today from midnight. '3pm': today from midnight too (so follow-ups on
-- morning issues are visible), with messages since 12:00 marked NEW and the noon digest
-- passed along. p_now is overridable for testing.
create or replace function public.cleaning_chat_digest_input(p_slot text, p_now timestamptz default now())
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with params as (
  select p_now as now_at,
         ((p_now at time zone 'America/Edmonton')::date)::timestamp at time zone 'America/Edmonton' as day_start,
         ((p_now at time zone 'America/Edmonton')::date + time '12:00') at time zone 'America/Edmonton' as noon_at,
         (p_now at time zone 'America/Edmonton')::date as today
),
office as (select user_id from connecteam_office_staff),
-- DMs where someone from the office is on either end.
office_dms as (
  select distinct m.conversation_id
  from connecteam_chat_messages m
  where m.conversation_type = 'private'
    and (m.sender_id in (select user_id from office) or m.recipient_id in (select user_id from office))
),
-- One stable label per DM ("DM Glenn Michael & Kyla Coligado"), whoever sent each message.
dm_labels as (
  select d.conversation_id,
         'DM ' || string_agg(distinct coalesce(u.full_name, 'User ' || p.uid), ' & ') as label
  from office_dms d
  join lateral (
    select m.sender_id as uid from connecteam_chat_messages m where m.conversation_id = d.conversation_id
    union
    select m.recipient_id from connecteam_chat_messages m where m.conversation_id = d.conversation_id and m.recipient_id is not null
  ) p on true
  left join connecteam_users u on u.user_id = p.uid
  group by d.conversation_id
),
-- Fallback titles from the webhook's own conversation_created/updated events.
event_titles as (
  select distinct on (e.raw->'body'->'data'->'conversation'->>'id')
         e.raw->'body'->'data'->'conversation'->>'id' as conversation_id,
         e.raw->'body'->'data'->'conversation'->>'title' as title
  from connecteam_chat_events e
  where e.event_type in ('conversation_created', 'conversation_updated')
    and e.raw->'body'->'data'->'conversation'->>'title' is not null
  order by e.raw->'body'->'data'->'conversation'->>'id', e.received_at desc
),
msgs as (
  select m.connecteam_message_id, m.conversation_id, m.conversation_type, m.sender_id, m.sent_at,
         coalesce(u.full_name, 'User ' || m.sender_id) as sender,
         m.sender_id in (select user_id from office) as from_office,
         coalesce(dl.label, c.title, et.title, 'team chat ' || left(m.conversation_id, 8)) as chat,
         nullif(trim(left(m.content, 600)), '') as content,
         coalesce(jsonb_array_length(case when jsonb_typeof(m.attachments) = 'array' then m.attachments end), 0) as n_att
  from connecteam_chat_messages m
  cross join params p
  left join connecteam_users u on u.user_id = m.sender_id
  left join dm_labels dl on dl.conversation_id = m.conversation_id
  left join connecteam_conversations c on c.conversation_id = m.conversation_id
  left join event_titles et on et.conversation_id = m.conversation_id
  where m.sent_at >= p.day_start and m.sent_at <= p.now_at
    and m.conversation_source = 'chat'
    and m.is_system is not true
    and m.event_type is distinct from 'message_deleted'
    and (m.conversation_type in ('team', 'channel') or m.conversation_id in (select conversation_id from office_dms))
),
-- The last message in a chat, from a cleaner, 30+ min old with nothing after it.
unanswered as (
  select m.chat, m.sender, m.sent_at, coalesce(m.content, '[' || m.n_att || ' photo(s)]') as content
  from msgs m, params p
  where not m.from_office
    and m.sent_at <= p.now_at - interval '30 minutes'
    and not exists (select 1 from msgs x where x.conversation_id = m.conversation_id and x.sent_at > m.sent_at)
)
select jsonb_build_object(
  'slot', p_slot,
  'date', (select today from params),
  'window_start', (select day_start from params),
  'window_end', (select now_at from params),
  'message_count', (select count(*) from msgs),
  'unanswered_count', (select count(*) from unanswered),
  'transcript', coalesce((
    select string_agg(
      case when p_slot = '3pm' and m.sent_at >= (select noon_at from params) then 'NEW ' else '' end
      || to_char(m.sent_at at time zone 'America/Edmonton', 'HH24:MI') || ' [' || m.chat || '] '
      || m.sender || case when m.from_office then ' (office)' else '' end || ': '
      || coalesce(m.content, '') || case when m.n_att > 0 then ' [' || m.n_att || ' photo(s)]' else '' end,
      E'\n' order by m.chat, m.sent_at)
    from msgs m), ''),
  'unanswered', coalesce((
    select string_agg(to_char(sent_at at time zone 'America/Edmonton', 'HH24:MI') || ' [' || chat || '] ' || sender || ': ' || content, E'\n' order by sent_at)
    from unanswered), ''),
  'noon_summary', case when p_slot = '3pm' then (
    select d.summary from cleaning_chat_digests d where d.digest_date = (select today from params) and d.slot = 'noon') end
);
$function$;

revoke execute on function public.cleaning_chat_digest_input(text, timestamptz) from public, anon, authenticated;
