-- Email alerts, follow-up to 20261005010000. The Zaps watch two Gmail accounts:
-- Invoice, invoice tagged Reviewed and e-Transfer read a second account (the
-- invoices inbox); the other seven read info@. n8n only has info@ so far, so
-- the three invoice rules wait (active = false) until that login is added.
-- Mail is also auto-labelled and archived within seconds of arriving, so rules
-- search all mail rather than the inbox (applied by hand on 2026-10-05, recorded
-- here). The seven info@ rules are armed after their first (baseline) run.

alter table public.email_alert_rules add column mailbox text not null default 'info' check (mailbox in ('info', 'invoices'));

update public.email_alert_rules
set gmail_query = trim(replace(gmail_query, 'in:inbox ', '')) || ' -from:me', updated_at = now()
where gmail_query like 'in:inbox %';

update public.email_alert_rules
set mailbox = 'invoices', active = false, updated_at = now()
where key in ('invoice', 'invoice_reviewed', 'etransfer');

update public.email_alert_rules
set armed = true, updated_at = now()
where mailbox = 'info' and active;
