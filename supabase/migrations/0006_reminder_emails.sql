-- Reminder emails (step 6). Tracks whether a claimed slot's check-in-window
-- reminder has already gone out, so the cron-triggered Go function
-- (api-go/reminders.go) never double-sends on a later run.
--
-- Run this the same way as 0001-0005: paste into the Supabase Dashboard SQL
-- Editor, or `supabase db push`.

alter table public.office_hours_slots
  add column reminder_sent_at timestamptz;

-- Powers the cron query's WHERE reminder_sent_at is null AND start_time <= ...
create index office_hours_slots_reminder_pending_idx
  on public.office_hours_slots (start_time)
  where reminder_sent_at is null;
