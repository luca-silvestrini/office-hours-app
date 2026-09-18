-- Names (for password-auth signup and showing who's signed up per slot) and a
-- narrow public directory view so the app can display names without widening
-- access to the users table itself (which still holds email addresses).
--
-- Run this the same way as 0001-0003: paste into the Supabase Dashboard SQL
-- Editor, or `supabase db push`.

alter table public.users add column name text;

-- Re-create the existing trigger function (same trigger binding from 0001) to
-- also copy `name` out of the signup metadata that supabase.auth.signUp's
-- `options.data.name` populates. Magic-link-era rows keep name = null.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name)
  values (new.id, new.email, new.raw_user_meta_data->>'name')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- Views run with their owner's privileges by default, so granting select on
-- this view exposes only (id, name) — not email — to any authenticated user,
-- without touching public.users' own RLS policy.
create or replace view public.member_names as
  select id, name from public.users;

grant select on public.member_names to authenticated;
