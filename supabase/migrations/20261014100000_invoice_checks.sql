-- Invoice checks (tech requests 10-14 from Michael Stead, logged by Laurice): each invoice email in
-- invoices@ is read once and checked against our data. Cleaning invoices: the clean dates billed per
-- unit against that listing's checkouts. Maintenance invoices: each job against the maintenance
-- tickets at that listing. n8n Pique-Invoice-Check reads the email and its PDFs (read-only) and posts
-- the text to /api/pique-bot/invoice-check (src/lib/pique-bot/invoiceCheck.ts), which extracts the
-- lines with Claude, compares, saves the result here, adds a comment to the invoice's ticket(s) and a
-- summary line to its Pique-a-choo post. One row per Gmail message, so a message on two rules
-- (invoice + invoice_reviewed) is checked once. Service role only.

create table if not exists public.invoice_checks (
  message_id text primary key,
  ticket_ids uuid[] not null default '{}',
  status text not null default 'checking' check (status in ('checking', 'done', 'skipped', 'failed')),
  kind text,
  vendor text,
  summary text[],
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);

alter table public.invoice_checks enable row level security;

create policy invoice_checks_service_role on public.invoice_checks
  for all to service_role using (true) with check (true);

-- What n8n should read next: invoice emails recorded in the last 3 days with no check yet (or a
-- failed one, retried until a day old), newest first.
create or replace function public.invoice_checks_pending(p_limit int default 5)
returns table (message_id text, ticket_ids uuid[], subject text, mailbox_email text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select m.message_id, array_agg(distinct m.ticket_id), max(m.subject),
         coalesce(max(t.metadata->>'mailbox_email'), 'invoices@piquepropertiesinc.com')
  from email_alert_messages m
  join email_alert_rules r on r.key = m.rule_key and r.mailbox = 'invoices' and r.key in ('invoice', 'invoice_reviewed')
  join tickets t on t.id = m.ticket_id
  where m.ticket_id is not null
    and m.first_seen_at > now() - interval '3 days'
    and not exists (
      select 1 from invoice_checks c
      where c.message_id = m.message_id
        and (c.status <> 'failed' or c.created_at < now() - interval '1 day')
    )
  group by m.message_id
  order by max(m.first_seen_at) desc
  limit greatest(1, least(p_limit, 20));
$function$;

revoke execute on function public.invoice_checks_pending(int) from public, anon, authenticated;
grant execute on function public.invoice_checks_pending(int) to service_role;
