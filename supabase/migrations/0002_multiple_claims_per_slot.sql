-- Allow more than one person to claim the same hour — office hours can be
-- staffed by multiple people at once. A user can still only claim a given
-- hour once (that's what actually prevents double-booking now).
--
-- Run this the same way as 0001_init.sql: paste into the Supabase Dashboard
-- SQL Editor, or `supabase db push`.

alter table public.office_hours_slots
  drop constraint if exists office_hours_slots_start_time_key;

alter table public.office_hours_slots
  add constraint office_hours_slots_user_start_key unique (user_id, start_time);
