-- Slack channel the n8n Pique-Front-Desk-Notices workflow pings after every
-- front desk email (and on failures). Empty = no ping.
insert into public.automation_flags (key, value, note) values
  ('front_desk_notices_slack_channel', '', 'Slack channel id n8n pings after every front desk email (and on failures). Empty = no ping.')
on conflict (key) do nothing;
