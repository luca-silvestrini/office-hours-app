-- Office Hours Self-Scheduling App — initial schema
-- Run against your Supabase project:
--   supabase db push            (with the Supabase CLI linked to your project)
-- or paste into the Supabase Dashboard → SQL Editor and run.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.slot_status as enum ('open', 'claimed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.check_in_method as enum ('geolocation', 'manual');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- users — application-facing mirror of auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

drop policy if exists "Users can view their own profile" on public.users;
create policy "Users can view their own profile"
  on public.users for select
  to authenticated
  using (auth.uid() = id);

-- Keep public.users in sync with auth.users (magic-link signups land in auth.users).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- office_hours_slots
--
-- Design note: the weekly grid (Sun–Sat, 09:00–21:00 hourly) is virtual on the
-- client. A row exists here ONLY for a claimed slot. Claiming = INSERT; releasing
-- = DELETE. The UNIQUE (start_time) constraint is what prevents double-booking:
-- two concurrent claims for the same hour, the second INSERT fails.
-- `status` is kept for spec fidelity and is always 'claimed' while a row exists.
-- ---------------------------------------------------------------------------
create table if not exists public.office_hours_slots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users (id) on delete set null,
  start_time timestamptz not null,
  end_time   timestamptz not null,
  status     public.slot_status not null default 'claimed',
  created_at timestamptz not null default now(),
  constraint office_hours_slots_start_time_key unique (start_time),
  constraint office_hours_slots_time_order check (end_time > start_time),
  constraint office_hours_slots_status_user check (
    (status = 'claimed' and user_id is not null) or
    (status = 'open'    and user_id is null)
  )
);

create index if not exists office_hours_slots_start_time_idx on public.office_hours_slots (start_time);
create index if not exists office_hours_slots_user_id_idx    on public.office_hours_slots (user_id);

alter table public.office_hours_slots enable row level security;

drop policy if exists "Authenticated users can view slots" on public.office_hours_slots;
create policy "Authenticated users can view slots"
  on public.office_hours_slots for select
  to authenticated
  using (true);

-- Claim a slot: you may only insert a row that belongs to you.
drop policy if exists "Users can claim a slot for themselves" on public.office_hours_slots;
create policy "Users can claim a slot for themselves"
  on public.office_hours_slots for insert
  to authenticated
  with check (user_id = auth.uid() and status = 'claimed');

-- Release a slot: you may only delete your own row.
drop policy if exists "Users can release their own slot" on public.office_hours_slots;
create policy "Users can release their own slot"
  on public.office_hours_slots for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- check_ins
--
-- One check-in per slot. Two paths:
--   * geolocation — written server-side by the Go function using the service
--     role AFTER it verifies the browser is within the office radius. Clients
--     cannot insert method='geolocation' directly (RLS below forbids it), so a
--     forged distance_miles is not possible.
--   * manual — the retroactive "I forgot to check in" path. Inserted directly by
--     the client, allowed only for a past slot the user owns, and flagged by
--     method='manual' for later review.
-- ---------------------------------------------------------------------------
create table if not exists public.check_ins (
  id             uuid primary key default gen_random_uuid(),
  slot_id        uuid not null references public.office_hours_slots (id) on delete cascade,
  user_id        uuid not null references public.users (id) on delete cascade,
  checked_in_at  timestamptz not null default now(),
  method         public.check_in_method not null,
  latitude       double precision,
  longitude      double precision,
  distance_miles double precision,
  created_at     timestamptz not null default now(),
  constraint check_ins_slot_id_key unique (slot_id)
);

create index if not exists check_ins_user_id_idx on public.check_ins (user_id);

alter table public.check_ins enable row level security;

drop policy if exists "Users can view their own check-ins" on public.check_ins;
create policy "Users can view their own check-ins"
  on public.check_ins for select
  to authenticated
  using (user_id = auth.uid());

-- Direct client inserts are limited to the manual/retroactive path, for a past
-- slot the user owns. Geolocation check-ins bypass this via the service role.
drop policy if exists "Users can create their own manual check-ins" on public.check_ins;
create policy "Users can create their own manual check-ins"
  on public.check_ins for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and method = 'manual'
    and exists (
      select 1 from public.office_hours_slots s
      where s.id = check_ins.slot_id
        and s.user_id = auth.uid()
        and s.end_time < now()
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (RLS is still the gate; these just expose the tables to the roles)
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select                         on public.users              to authenticated;
grant select, insert, delete         on public.office_hours_slots to authenticated;
grant select, insert                 on public.check_ins          to authenticated;
