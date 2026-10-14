-- Padmore joins the client cleaning shifts (replaces the Zap "New - Cleaning from Padmore to Connecteam",
-- docs/zapier-migration.md P2-31; MDP 10-14 added the "Padmore Hospitable" credential in n8n).
-- n8n Pique-Client-Bookings-Sync-Padmore (hourly at :27, read-only) copies the bookings; the existing
-- client planner makes the shifts. DUAL-ROYAL ALEX is the joint listing over both suites, so it gets
-- both jobs (like Stephan's Joint Listing). Coastal Calm (12436) and Casa del Norte (Airdrie) are left
-- out: no Connecteam job for either yet. Applied to production 10-14 before this file was written.

insert into public.client_listings (hospitable_property_id, account, name, address) values
  ('e30d4768-8091-4de1-b98a-6a5b76b394eb', 'padmore', 'RA-1 (11249) - Royal Alex 1', 'BSMT, 11249 97 Street Northwest, Edmonton, AB T5G 1X2'),
  ('f271bbd0-4e79-4a50-b0cf-a2fb03b6d61f', 'padmore', 'RA-2 (11247) - Royal Alex 2', 'BSMT, 11247 97 Street Northwest, Edmonton, AB T5G 1X2'),
  ('4aa0f196-d056-41d6-a58b-980d8d6b8023', 'padmore', 'DUAL-ROYAL ALEX', '11247 / 11249 97 Street Northwest, Edmonton, AB T5G 1X2'),
  ('076a2c05-6500-43aa-b9c3-f6df317436b5', 'padmore', 'RR (8127) - Restful Retreat', '8127 225 Street Northwest, Edmonton, AB T5T 7G6')
on conflict do nothing;

insert into public.client_listing_jobs (hospitable_property_id, connecteam_job_id, shift_label, minutes) values
  ('e30d4768-8091-4de1-b98a-6a5b76b394eb', '0bcc28c7-cce9-f19e-9466-a4721de9c203', '11249-ROYAL ALEX', 240),
  ('f271bbd0-4e79-4a50-b0cf-a2fb03b6d61f', 'c636048e-fa96-258d-0c1e-85daabdb5fba', '11247-ROYAL ALEX', 240),
  ('4aa0f196-d056-41d6-a58b-980d8d6b8023', '0bcc28c7-cce9-f19e-9466-a4721de9c203', '11249-ROYAL ALEX', 240),
  ('4aa0f196-d056-41d6-a58b-980d8d6b8023', 'c636048e-fa96-258d-0c1e-85daabdb5fba', '11247-ROYAL ALEX', 240),
  ('076a2c05-6500-43aa-b9c3-f6df317436b5', '7d9a7f4a-b7b1-ebbb-0c35-397785357ac0', '8127 Restful Retreat', 240)
on conflict do nothing;
