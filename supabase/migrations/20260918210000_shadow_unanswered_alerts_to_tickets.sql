-- Shadow-mirror public.unanswered_message_alerts into public.tickets.
--
-- Purpose: let us build and validate the unanswered_message ticket flow
-- against real production data WITHOUT touching the two live n8n workflows
-- that currently own this feature (Hospitable-Webhook-Receiver,
-- Pique-Unanswered-Message-Followup). Those workflows keep writing to
-- unanswered_message_alerts exactly as before, completely unaware this
-- trigger exists. Nothing about the existing Slack alert/escalation
-- behavior changes.
--
-- Safety: the entire body runs inside a nested BEGIN/EXCEPTION block. If
-- this trigger ever errors, it logs a warning and returns normally instead
-- of raising - a bug here can never roll back or block the original insert/
-- update into unanswered_message_alerts.
--
-- This is a bridge, not the final design: once the new app is ready and
-- trusted, cutting the two n8n workflows over to write tickets directly
-- (and dropping this trigger + the old table) is a separate, deliberate step.

create or replace function public.mirror_unanswered_alert_to_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_id uuid;
  v_prior_status text;
  v_prior_escalation_count integer;
  v_property_id uuid;
begin
  begin
    select r.property_id into v_property_id
    from public.reservations r
    where r.id = new.reservation_id;

    select t.id, t.status, (t.metadata ->> 'escalation_count')::integer
      into v_ticket_id, v_prior_status, v_prior_escalation_count
    from public.tickets t
    where t.external_ref = 'unanswered:' || new.hospitable_message_id;

    if v_ticket_id is null then
      insert into public.tickets (
        type, status, priority, property_id, reservation_id, source, external_ref, metadata, closed_at
      ) values (
        'unanswered_message',
        case when new.resolved_at is not null then 'resolved' else 'open' end,
        'high', v_property_id, new.reservation_id, 'automation',
        'unanswered:' || new.hospitable_message_id,
        jsonb_build_object(
          'hospitable_message_id', new.hospitable_message_id,
          'slack_channel', new.slack_channel,
          'slack_ts', new.slack_ts,
          'escalation_count', new.escalation_count,
          'alerted_at', new.alerted_at,
          'resolved_by', new.resolved_by,
          'mirrored_from', 'unanswered_message_alerts'
        ),
        new.resolved_at
      )
      returning id into v_ticket_id;

      insert into public.ticket_events (ticket_id, event_type, to_value, note)
      values (
        v_ticket_id, 'status_change',
        case when new.resolved_at is not null then 'resolved' else 'open' end,
        'Shadow-mirrored from unanswered_message_alerts (existing alert system unchanged)'
      );

      return new;
    end if;

    if new.resolved_at is not null and coalesce(v_prior_status, '') <> 'resolved' then
      update public.tickets
        set status = 'resolved',
            closed_at = new.resolved_at,
            metadata = metadata || jsonb_build_object('escalation_count', new.escalation_count, 'resolved_by', new.resolved_by)
        where id = v_ticket_id;

      insert into public.ticket_events (ticket_id, event_type, from_value, to_value, note)
      values (v_ticket_id, 'status_change', v_prior_status, 'resolved', 'Mirrored resolution (resolved_by=' || coalesce(new.resolved_by, 'auto') || ')');

      return new;
    end if;

    if new.escalation_count is distinct from v_prior_escalation_count
       and new.escalation_count > coalesce(v_prior_escalation_count, 0) then
      update public.tickets
        set sla_breached = true,
            metadata = metadata || jsonb_build_object('escalation_count', new.escalation_count, 'last_escalated_at', new.last_escalated_at)
        where id = v_ticket_id;

      insert into public.ticket_events (ticket_id, event_type, to_value, note)
      values (v_ticket_id, 'escalation', new.escalation_count::text, 'Still unanswered, escalation #' || new.escalation_count);
    end if;

  exception when others then
    raise warning 'mirror_unanswered_alert_to_ticket failed for alert id %: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

comment on function public.mirror_unanswered_alert_to_ticket is
  'Shadow-copies unanswered_message_alerts rows into tickets for testing the new app alongside the existing n8n alert flow. Exception-safe: never blocks the original write. Bridge only - remove once tickets is the system of record.';

create trigger unanswered_alerts_mirror_to_tickets
  after insert or update on public.unanswered_message_alerts
  for each row execute function public.mirror_unanswered_alert_to_ticket();

-- Backfill: mirror the ~45 alerts that already exist so the ticket queue
-- has real historical data to test against from day one. A no-op update
-- (reassigning escalation_count to itself) fires the same AFTER UPDATE
-- trigger above without changing any existing value.
update public.unanswered_message_alerts
  set escalation_count = escalation_count;
