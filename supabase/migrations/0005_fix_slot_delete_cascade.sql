-- Fixes a bug present since 0001: office_hours_slots.user_id was
-- `on delete set null`, but the office_hours_slots_status_user check
-- constraint requires status='claimed' rows to always have a non-null
-- user_id. Deleting a user with any claimed slots violated that constraint
-- mid-cascade and made the entire user deletion fail ("Database error
-- deleting user") — never caught before because no one had deleted a user
-- with active claims until now.
--
-- Fix: when a user is deleted, their claimed slots should go with them
-- (freeing the hour for someone else), not be orphaned into an invalid
-- state. Run this the same way as 0001-0004: paste into the Supabase
-- Dashboard SQL Editor, or `supabase db push`.

alter table public.office_hours_slots
  drop constraint office_hours_slots_user_id_fkey;

alter table public.office_hours_slots
  add constraint office_hours_slots_user_id_fkey
  foreign key (user_id) references public.users (id) on delete cascade;
