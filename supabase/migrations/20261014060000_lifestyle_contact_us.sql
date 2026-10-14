-- "Lifestyle Contact Us" Zap (found 10-14, MDP): the Lifestyle website's Contact Us form in N2P
-- (GHL) sent a webhook; the Zap posted name, email, phone and the CRM link to #lifestyle-contact-us
-- asking for a ✅. Now the N2P workflow's webhook goes to n8n Pique-Lifestyle-Contact-Us, which calls
-- record_contact_us(): one contact_us ticket per contact per day (contact_us:{contact}:{day}, so a
-- double submit makes one ticket), checklist "Followed up", which Pique-a-choo posts there with
-- Done / Not yet (rule contact_us, today tier). Under Requests in the app.

insert into ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values ('contact_us', 'created', 'start', interval '1 day', null, false, null, interval '4 hours', null, true)
on conflict (type) do nothing;

-- p: N2P's webhook body (first_name, last_name, full_name, email, phone, contact_id).
-- Returns 'ticket' or 'seen'.
create or replace function public.record_contact_us(p jsonb)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_contact text := nullif(trim(p->>'contact_id'), '');
  v_name text := coalesce(nullif(trim(p->>'full_name'), ''),
                          nullif(trim(concat_ws(' ', p->>'first_name', p->>'last_name')), ''), '(no name)');
  v_day text := to_char(now() at time zone 'America/Edmonton', 'YYYY-MM-DD');
  v_ticket uuid;
begin
  insert into tickets (type, status, priority, stage, source, guest_name, external_ref, metadata)
  values ('contact_us', 'open', 'normal', 'book', 'automation', v_name,
          'contact_us:' || coalesce(v_contact, md5(coalesce(p->>'email', '') || coalesce(p->>'phone', ''))) || ':' || v_day,
          jsonb_build_object(
            'title', 'Lifestyle Contact Us: ' || v_name,
            'name', v_name,
            'email', nullif(trim(p->>'email'), ''),
            'phone', nullif(trim(p->>'phone'), ''),
            'contact_id', v_contact,
            'crm_url', case when v_contact is not null
                            then 'https://app.nurture2profit.com/v2/location/u73d3C5ZwI041uuXCERc/contacts/detail/' || v_contact end))
  on conflict (external_ref) do nothing
  returning id into v_ticket;

  if v_ticket is null then
    return 'seen';
  end if;
  insert into ticket_items (ticket_id, label, sort_order) values (v_ticket, 'Followed up', 0);
  insert into ticket_events (ticket_id, event_type, to_value, note)
  values (v_ticket, 'status_change', 'open', 'Created automatically from the Lifestyle Contact Us form');
  return 'ticket';
end;
$$;

revoke execute on function public.record_contact_us(jsonb) from public, anon, authenticated;
