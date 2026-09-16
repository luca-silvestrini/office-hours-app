-- Recurring weekly claims. A "recurring claim" is just a marker row grouping
-- together the concrete office_hours_slots rows it produced — claiming a slot
-- with "repeat weekly" bulk-inserts real slot rows tagged with this marker's
-- id for a long horizon (RECURRING_HORIZON_WEEKS in src/lib/config.ts), rather
-- than computing virtual occurrences on the fly. This keeps the grid, the
-- multi-claim display, and the check-in flow all reading plain concrete rows,
-- unchanged.
--
-- Run this the same way as 0001/0002: paste into the Supabase Dashboard SQL
-- Editor, or `supabase db push`.

create table public.recurring_claims (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.recurring_claims enable row level security;

create policy "Users can view their own recurring claims"
  on public.recurring_claims for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can create their own recurring claims"
  on public.recurring_claims for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can delete their own recurring claims"
  on public.recurring_claims for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.recurring_claims to authenticated;

-- Nullable, on delete set null (not cascade): cancelling a series ("this and
-- all future") must never delete already-past occurrences or their check-in
-- history — it only stops the series from being treated as active.
alter table public.office_hours_slots
  add column recurring_claim_id uuid references public.recurring_claims (id) on delete set null;

create index office_hours_slots_recurring_claim_id_idx
  on public.office_hours_slots (recurring_claim_id);
