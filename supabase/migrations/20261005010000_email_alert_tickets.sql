-- Zapier migration, email alerts (docs/zapier-migration.md, lane E).
-- Replaces the ten Zaps that watch the info@piquepropertiesinc.com inbox and
-- post "mark with a checkmark" messages to Slack. One n8n workflow
-- (Pique-Email-Alerts) checks the inbox every 5 minutes against each active
-- rule below and calls record_email_alert() for every match. Pique Bot posts
-- the resulting email_alert tickets (src/lib/pique-bot/config.ts, rule key
-- 'email:{rule}'), silent until switched on like every Zap replacement.
--
-- A rule starts unarmed: its first run only records the emails already there
-- as seen, so switching a rule on never floods the queue with old mail. Each
-- message makes at most one ticket per rule (email_alert_messages is the
-- seen-list; tickets are also unique on external_ref 'email:{rule}:{message}').

create table public.email_alert_rules (
  key text primary key,
  label text not null,
  -- Gmail search, as typed in the Gmail search box.
  gmail_query text not null default '',
  -- Gmail label ids the message must carry (for label-based rules).
  label_ids text[] not null default '{}',
  -- Prefix for the ticket title; the email subject follows it.
  title text not null,
  items text[] not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  replaces_zap text,
  active boolean not null default true,
  armed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_alert_messages (
  rule_key text not null references public.email_alert_rules(key) on delete cascade,
  message_id text not null,
  thread_id text,
  from_name text,
  from_email text,
  subject text,
  received_at timestamptz,
  ticket_id uuid references public.tickets(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  primary key (rule_key, message_id)
);

alter table public.email_alert_rules enable row level security;
alter table public.email_alert_messages enable row level security;
create policy email_alert_rules_read on public.email_alert_rules for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));
create policy email_alert_messages_read on public.email_alert_messages for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid()));

insert into public.email_alert_rules (key, label, gmail_query, label_ids, title, items, priority, replaces_zap) values
  ('airbnb_support', 'Airbnb Support', 'in:inbox from:no-reply@supportmessaging.airbnb.com subject:"New message from Airbnb Support" newer_than:2d', '{}',
   'Airbnb Support email', array['Reviewed and replied'], 'high', 'Airbnb Support Email Notification to Slack'),
  ('robert_reply', 'Reply from Robert', 'in:inbox from:robert.raimondi@ext.airbnb.com newer_than:2d', '{}',
   'Reply from Robert', array['Reviewed and replied'], 'high', 'Reply from Robert Notification to Slack'),
  ('invoice', 'Invoice', 'in:inbox subject:invoice newer_than:2d', '{}',
   'Invoice to review', array['Reviewed'], 'normal', 'Invoice To Slack - Email'),
  ('invoice_reviewed', 'Invoice reviewed', '', array['Label_3146702778011170559'],
   'Enter invoice in QBO and Plooto', array['Entered in QBO and Plooto'], 'normal', 'Gmail Tagged as ''Reviewed'' --> Notify Cristine'),
  ('etransfer', 'e-Transfer', 'in:inbox from:notify@payments.interac.ca newer_than:2d', '{}',
   'Interac e-Transfer', array['Reviewed'], 'normal', 'e-Transfer To Slack - Email'),
  ('aircover', 'Aircover email', 'in:inbox subject:"Airbnb Reimbursement Request" newer_than:2d', '{}',
   'Airbnb reimbursement email', array['Reviewed and replied'], 'normal', 'Aircover Gmail -> Slack Notification'),
  ('truvi', 'Truvi email', 'newer_than:2d', array['Label_3504656635125649064'],
   'Truvi resolution email', array['Reviewed and replied'], 'normal', 'Truvi Resolution Email -> Slack Notification'),
  ('mykey', 'MyKey request', 'in:inbox subject:"MyKey Housing Request" newer_than:2d', '{}',
   'MyKey housing request', array['Assigned, reviewed and replied'], 'normal', 'MyKey Housing Request'),
  ('sinistar', 'Sinistar offer', 'in:inbox from:info@sinistar.com subject:"rental offer" newer_than:2d', '{}',
   'Sinistar rental offer', array['Assigned, reviewed and replied'], 'normal', 'Sinistar Rental Offer -> Slack Notification'),
  ('ondilo', 'Ondilo / Booking.com', 'in:inbox from:(support@ondilo.eu.zohosupport.com OR melanie.lim1@booking.com) newer_than:2d', '{}',
   'Email from Ondilo / Booking.com', array['Reviewed and replied'], 'normal', 'Ondilo Email -> Slack Notification');

insert into public.ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values ('email_alert', 'created', 'start', interval '1 day', null, false, null, interval '4 hours', null, true)
on conflict (type) do nothing;

-- Called by n8n once per matching message. p_msg: id, thread_id, from_name,
-- from_email, subject, snippet, received_at (ISO). Returns what happened:
-- 'ticket', 'seen' (already recorded), 'baseline' (rule not armed yet), 'skipped'.
create or replace function public.record_email_alert(p_rule text, p_msg jsonb)
returns text
language plpgsql
set search_path = public
as $$
declare
  r email_alert_rules%rowtype;
  v_msg text := p_msg->>'id';
  v_inserted text;
  v_ticket uuid;
  v_subject text := left(coalesce(nullif(p_msg->>'subject', ''), '(no subject)'), 200);
begin
  select * into r from email_alert_rules where key = p_rule and active;
  if not found or v_msg is null then
    return 'skipped';
  end if;

  insert into email_alert_messages (rule_key, message_id, thread_id, from_name, from_email, subject, received_at)
  values (p_rule, v_msg, p_msg->>'thread_id', p_msg->>'from_name', p_msg->>'from_email', v_subject,
          nullif(p_msg->>'received_at', '')::timestamptz)
  on conflict (rule_key, message_id) do nothing
  returning message_id into v_inserted;
  if v_inserted is null then
    return 'seen';
  end if;
  if not r.armed then
    return 'baseline';
  end if;

  insert into tickets (type, status, priority, source, external_ref, metadata)
  values ('email_alert', 'open', r.priority, 'email', 'email:' || p_rule || ':' || v_msg,
          jsonb_build_object(
            'title', r.title || ': ' || v_subject,
            'rule', p_rule,
            'from_name', p_msg->>'from_name',
            'from_email', p_msg->>'from_email',
            'subject', v_subject,
            'snippet', left(coalesce(p_msg->>'snippet', ''), 300),
            'received_at', p_msg->>'received_at',
            'gmail_url', 'https://mail.google.com/mail/u/info@piquepropertiesinc.com/#all/' || coalesce(p_msg->>'thread_id', v_msg)))
  on conflict (external_ref) do nothing
  returning id into v_ticket;

  if v_ticket is not null then
    insert into ticket_items (ticket_id, label, sort_order)
    select v_ticket, label, ord - 1 from unnest(r.items) with ordinality as t(label, ord);
    insert into ticket_events (ticket_id, event_type, to_value, note)
    values (v_ticket, 'status_change', 'open', 'Created automatically from an email (' || r.label || ')');
    update email_alert_messages set ticket_id = v_ticket where rule_key = p_rule and message_id = v_msg;
  end if;
  return 'ticket';
end;
$$;

revoke execute on function public.record_email_alert(text, jsonb) from public, anon, authenticated;
