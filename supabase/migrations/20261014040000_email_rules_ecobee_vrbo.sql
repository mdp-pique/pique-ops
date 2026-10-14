-- Two more inbox Zaps become email rules (MDP 10-14, found outside the original 42):
--  * "Ecobee Reminder -> Slack Notification": ecobee alerts (noreply@ecobee.com with "alert" in the
--    subject) and ecobee notices (notice@eml.ecobee.com: filter changes, HVAC inspections, possible
--    AC problems), never "Remote sensor" ones -> #2-operations.
--  * "Overdue VRBO Payment -> Slack Notification": Vrbo's "payment is overdue" reminders ->
--    #overdue-vrbo-payments.
-- Both read info@ (the Zaps' Gmail labels live there too). Start unarmed: the first run only
-- records existing mail as seen. Pique-a-choo posts them with the start of the email (config.ts).
insert into public.email_alert_rules (key, label, gmail_query, title, items, priority, replaces_zap, mailbox, active, armed)
values
  ('ecobee', 'Ecobee',
   '((from:noreply@ecobee.com subject:alert) OR from:notice@eml.ecobee.com) -subject:"remote sensor" newer_than:2d -from:me',
   'Ecobee reminder', array['Checked and actioned'], 'normal',
   'Ecobee Reminder -> Slack Notification', 'info', true, false),
  ('vrbo_overdue', 'Overdue VRBO payment',
   'from:vrbo@partners.expediagroup.com "payment is overdue" newer_than:2d -from:me',
   'Overdue VRBO payment', array['Reviewed'], 'normal',
   'Overdue VRBO Payment -> Slack Notification', 'info', true, false)
on conflict (key) do nothing;
