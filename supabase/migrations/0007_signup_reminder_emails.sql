-- Weekly signup-reminder emails (step 6 follow-up). Every Monday, the
-- cron-triggered Go function (api-go/signup-reminders.go) emails any user
-- who hasn't claimed all MAX_SLOTS_PER_USER_PER_WEEK slots for the current
-- week. This log makes each week's send idempotent per user, the same way
-- office_hours_slots.reminder_sent_at (0006) does for the daily digest —
-- except keyed by week_start rather than a single timestamp column, since
-- the same user needs a fresh reminder every week, not just once ever.
--
-- Run this the same way as 0001-0006: paste into the Supabase Dashboard SQL
-- Editor, or `supabase db push`.

create table public.signup_reminder_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  week_start date not null,
  sent_at    timestamptz not null default now(),
  constraint signup_reminder_log_user_week_key unique (user_id, week_start)
);

-- Service-role-only table (the cron function authenticates with the service
-- role, which bypasses RLS) — RLS is enabled with no policies so neither
-- anon nor authenticated clients can read or write it directly.
alter table public.signup_reminder_log enable row level security;
