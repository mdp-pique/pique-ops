-- Coastal Calm joins Padmore's client cleaning shifts (tech request 10-14; Laurice confirmed we clean it).
-- Left out on 10-14 (20261014010000) because it had no Connecteam job; the job "Coastal Calm" is
-- b144f1d0-4df7-da73-11e4-999e54ffdd02 (looked up 10-14 with the n8n helper Pique-Connecteam-List-Jobs).
-- Only the listing is added here, so Pique-Client-Bookings-Sync-Padmore copies its bookings. The job row
-- (which lets the planner write shifts) waits until the job id is in column B of the Connecteam Lookup
-- sheet, so the first shift carries the access notes; it gets its own migration. Applied to production
-- 10-14 before this file was written.

insert into public.client_listings (hospitable_property_id, account, name, address, checkout_time, checkin_time) values
  ('fbfa448f-9590-409f-9c96-71080c94d6d0', 'padmore', 'CC (12436) Coastal Calm', 'Suite 2, 12436 88 Street NW, Edmonton, AB', '11:00', '16:00')
on conflict do nothing;
