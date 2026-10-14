-- The Evergreen Château moved from Padmore's Hospitable account into ours (10-13), so the Padmore Zap
-- stopped making its shifts. Adding its Connecteam job puts it on the live shift planner (MDP sign-off
-- 10-14). First run adopted its 5 existing shifts and created the 3 missing ones (Oct 16, Nov 4, Dec 17).
-- Applied to production 10-14 before this file was written.
insert into public.cleaning_property_jobs (property_id, connecteam_job_id)
values ('abab3654-1784-4c22-9d0f-99dc180684fc', '39d274d3-608a-74df-b77b-d68917818595')
on conflict do nothing;
