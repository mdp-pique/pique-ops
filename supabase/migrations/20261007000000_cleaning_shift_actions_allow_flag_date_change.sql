-- Fix: the cleaning shift planner stalled overnight 2026-10-07 (05:10-06:00 UTC).
--
-- 20260928010000_cleaning_respect_manual_reschedules.sql added the flag_date_change
-- action (a claimed shift whose booking's checkout changed is flagged to Slack instead
-- of moved) but never added it to cleaning_shift_actions_action_check. The first such
-- case (HMFFC4ZJHN, checkout Oct 7 -> Oct 8, shift already assigned) made every planner
-- run roll back until someone deleted that shift by hand. The workflow already routes
-- flag_* actions to Slack; only the constraint was missing the value.

alter table public.cleaning_shift_actions drop constraint if exists cleaning_shift_actions_action_check;
alter table public.cleaning_shift_actions add constraint cleaning_shift_actions_action_check
  check (action = any (array['create', 'adopt', 'move', 'remove', 'remove_duplicate', 'flag_claimed', 'flag_date_change']));
