-- Failed Stripe payments and charge disputes → tickets (MDP 10-07: "payment success is
-- just a notification, payment failed needs a task"). Replaces the Zaps that posted
-- both to #stripe-payment-failed-notification with "mark with a checkmark" text.
-- The Pique Stripe account's webhook (/api/stripe/webhook, src/lib/stripe/payments.ts)
-- calls these functions; Pique Bot asks the tickets in that channel with Done / Not yet
-- (rules payment_failed, payment_dispute). Both under Requests in the app.
--
-- payment_failed: one ticket per booking (reservation code from the charge or the
-- payment's "Booking HOST-..." description, else the payment intent), ref
-- 'stripe_failed:{code}'. Another failure adds a comment, or reopens it if closed.
-- A later successful payment for the same booking resolves it.
--
-- payment_dispute: one ticket per dispute, ref 'stripe_dispute:{dispute}', due when
-- Stripe's evidence window closes. Resolved when Stripe closes the dispute.

insert into ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values ('payment_failed', 'created', 'start', interval '1 day', null, false, null, interval '4 hours', null, true)
on conflict (type) do nothing;

insert into ticket_type_clocks
  (type, start_anchor, due_anchor, due_offset, due_hour, due_is_hard, target_offset, warn_before, critical_before, pausable)
values ('payment_dispute', 'created', 'start', interval '5 days', null, true, null, interval '2 days', null, false)
on conflict (type) do nothing;

-- p: {payment_intent, code, name, amount, currency, reason}. Returns the ticket id.
create or replace function public.record_stripe_payment_failed(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := nullif(upper(trim(coalesce(p->>'code', ''))), '');
  v_pi text := p->>'payment_intent';
  v_ref text;
  v_res_id uuid;
  v_prop uuid;
  v_guest text;
  v_amount text;
  v_note text;
  v_ticket uuid;
  v_status text;
begin
  -- Keyed on the code without its HOST- prefix, so either spelling finds the same ticket.
  v_ref := 'stripe_failed:' || coalesce(regexp_replace(v_code, '^HOST-', ''), v_pi);
  if v_code is not null then
    select res.id, res.property_id, g.full_name into v_res_id, v_prop, v_guest
    from reservations res left join guests g on g.id = res.guest_id
    where upper(res.confirmation_code) in (v_code, 'HOST-' || v_code, regexp_replace(v_code, '^HOST-', ''))
    order by res.created_at desc
    limit 1;
  end if;
  v_amount := to_char((p->>'amount')::numeric, 'FM999,999,990.00') || ' ' || upper(coalesce(p->>'currency', ''));
  v_note := 'Payment of ' || v_amount || ' failed' || coalesce(': ' || nullif(p->>'reason', ''), '');

  select id, status into v_ticket, v_status from tickets where external_ref = v_ref;
  if v_ticket is not null then
    if v_status in ('resolved', 'closed') then
      update tickets set status = 'open', closed_at = null where id = v_ticket;
      insert into ticket_events (ticket_id, event_type, from_value, to_value, note, payload)
      values (v_ticket, 'status_change', v_status, 'open', 'Reopened: ' || v_note, jsonb_build_object('payment_intent', v_pi));
    else
      insert into ticket_events (ticket_id, event_type, note, payload)
      values (v_ticket, 'comment', v_note, jsonb_build_object('payment_intent', v_pi, 'source', 'stripe'));
    end if;
    update tickets
    set metadata = metadata || jsonb_build_object('amount', v_amount, 'reason', p->>'reason', 'payment_intent', v_pi,
                                                  'failures', coalesce((metadata->>'failures')::int, 1) + 1)
    where id = v_ticket;
    return v_ticket;
  end if;

  insert into tickets (type, status, priority, stage, source, property_id, reservation_id, guest_name, external_ref, metadata)
  values ('payment_failed', 'open', 'high', 'book', 'automation', v_prop, v_res_id,
          coalesce(nullif(p->>'name', ''), v_guest), v_ref,
          jsonb_build_object(
            'title', 'Payment failed - ' || v_amount || coalesce(' - ' || coalesce(nullif(p->>'name', ''), v_guest), ''),
            'amount', v_amount,
            'reason', p->>'reason',
            'code', v_code,
            'payment_intent', v_pi,
            'failures', 1))
  on conflict (external_ref) do nothing
  returning id into v_ticket;
  if v_ticket is not null then
    insert into ticket_items (ticket_id, label, sort_order)
    values (v_ticket, 'Payment info noted in Hospitable (name and email used)', 0), (v_ticket, 'Payment collected', 1);
    insert into ticket_events (ticket_id, event_type, to_value, note, payload)
    values (v_ticket, 'status_change', 'open', 'Created automatically: ' || v_note, jsonb_build_object('payment_intent', v_pi));
  end if;
  return v_ticket;
end;
$$;

-- A successful payment for the same booking (or the same payment intent) resolves it.
create or replace function public.resolve_stripe_payment_failed(p_code text, p_payment_intent text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := nullif(upper(trim(coalesce(p_code, ''))), '');
begin
  if v_code is not null then
    perform resolve_request_ticket('stripe_failed:' || regexp_replace(v_code, '^HOST-', ''), 'Payment went through');
  end if;
  if p_payment_intent is not null then
    perform resolve_request_ticket('stripe_failed:' || p_payment_intent, 'Payment went through');
  end if;
end;
$$;

-- p: {dispute, payment_intent, charge, code, name, email, amount, currency, reason, due_by}.
create or replace function public.record_stripe_dispute(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := nullif(upper(trim(coalesce(p->>'code', ''))), '');
  v_res_id uuid;
  v_prop uuid;
  v_guest text;
  v_amount text;
  v_name text;
  v_ticket uuid;
begin
  if v_code is not null then
    select res.id, res.property_id, g.full_name into v_res_id, v_prop, v_guest
    from reservations res left join guests g on g.id = res.guest_id
    where upper(res.confirmation_code) in (v_code, 'HOST-' || v_code, regexp_replace(v_code, '^HOST-', ''))
    order by res.created_at desc
    limit 1;
  end if;
  v_amount := to_char((p->>'amount')::numeric, 'FM999,999,990.00') || ' ' || upper(coalesce(p->>'currency', ''));
  v_name := coalesce(nullif(p->>'name', ''), v_guest);

  insert into tickets (type, status, priority, stage, source, property_id, reservation_id, guest_name, due_at, external_ref, metadata)
  values ('payment_dispute', 'open', 'urgent', 'accountability', 'automation', v_prop, v_res_id, v_name,
          nullif(p->>'due_by', '')::timestamptz, 'stripe_dispute:' || (p->>'dispute'),
          jsonb_build_object(
            'title', 'Charge dispute - ' || v_amount || coalesce(' - ' || v_name, ''),
            'amount', v_amount,
            'reason', p->>'reason',
            'code', v_code,
            'email', nullif(p->>'email', ''),
            'dispute', p->>'dispute',
            'payment_intent', p->>'payment_intent'))
  on conflict (external_ref) do nothing
  returning id into v_ticket;
  if v_ticket is not null then
    insert into ticket_items (ticket_id, label, sort_order)
    values (v_ticket, 'Reviewed the case', 0), (v_ticket, 'Responded in Stripe', 1);
    insert into ticket_events (ticket_id, event_type, to_value, note, payload)
    values (v_ticket, 'status_change', 'open',
            'Created automatically: charge dispute for ' || v_amount || coalesce(' (' || nullif(p->>'reason', '') || ')', ''),
            jsonb_build_object('dispute', p->>'dispute'));
  end if;
  return v_ticket;
end;
$$;

-- Stripe closed the dispute (won, lost, or warning closed).
create or replace function public.resolve_stripe_dispute(p_dispute text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform resolve_request_ticket('stripe_dispute:' || p_dispute, 'Stripe closed the dispute: ' || coalesce(replace(p_status, '_', ' '), 'closed'));
end;
$$;

revoke execute on function public.resolve_stripe_dispute(text, text) from public, anon, authenticated;
grant execute on function public.resolve_stripe_dispute(text, text) to service_role;
revoke execute on function public.record_stripe_dispute(jsonb) from public, anon, authenticated;
grant execute on function public.record_stripe_dispute(jsonb) to service_role;
revoke execute on function public.record_stripe_payment_failed(jsonb) from public, anon, authenticated;
revoke execute on function public.resolve_stripe_payment_failed(text, text) from public, anon, authenticated;
grant execute on function public.record_stripe_payment_failed(jsonb) to service_role;
grant execute on function public.resolve_stripe_payment_failed(text, text) to service_role;
