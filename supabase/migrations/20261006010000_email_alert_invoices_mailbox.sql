-- Email alerts for the second Gmail account (the invoices inbox), follow-up
-- to 20261005020000. n8n now has a login for it ("invoices" credential), so
-- Pique-Email-Alerts reads it in its own branch and passes the account's
-- address as p_msg.mailbox_email, which the Gmail link uses. The three
-- invoice rules stay off (and unarmed): on 2026-10-06 the "invoices" login
-- turned out to be signed in as mdp@, not the invoices inbox. Switch them on
-- (active = true, still unarmed so the first run only marks mail as seen)
-- once the login is redone, then publish the workflow's invoices branch.

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
  v_mailbox text := coalesce(nullif(p_msg->>'mailbox_email', ''), 'info@piquepropertiesinc.com');
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
            'mailbox', v_mailbox,
            'from_name', p_msg->>'from_name',
            'from_email', p_msg->>'from_email',
            'subject', v_subject,
            'snippet', left(coalesce(p_msg->>'snippet', ''), 300),
            'received_at', p_msg->>'received_at',
            'gmail_url', 'https://mail.google.com/mail/u/' || v_mailbox || '/#all/' || coalesce(p_msg->>'thread_id', v_msg)))
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

update public.email_alert_rules
set active = false, armed = false, updated_at = now()
where mailbox = 'invoices';
