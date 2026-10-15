-- Coastal Calm's Connecteam job, so Pique-Client-Cleaning-Shifts creates its cleaning shifts (tech request
-- 10-14). The listing row came in 20261014070000; this waited until Laurice put the job id in column B of the
-- Connecteam Lookup sheet's Jobs tab (she confirmed 10-14 by DM to Pique-a-choo), so shifts carry the access notes.

insert into public.client_listing_jobs (hospitable_property_id, connecteam_job_id, shift_label, minutes) values
  ('fbfa448f-9590-409f-9c96-71080c94d6d0', 'b144f1d0-4df7-da73-11e4-999e54ffdd02', 'Coastal Calm', 240)
on conflict do nothing;
