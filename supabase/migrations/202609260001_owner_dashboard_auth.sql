-- Authenticated owners get a persistent private dashboard. Anonymous interview
-- rooms remain possible, but are not listed in an account dashboard.
alter table public.rooms
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists title text not null default 'Untitled whiteboard';

create index if not exists rooms_owner_updated_idx on public.rooms (owner_id, updated_at desc);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.rooms to authenticated;

create policy "users view their profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy "users update their profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "owners list their boards" on public.rooms
  for select to authenticated using ((select auth.uid()) = owner_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if coalesce(new.is_anonymous, false) = false then
    insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();
