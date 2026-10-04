-- Self-chosen usernames. Safe to re-run.
alter table public.profiles add column if not exists username text;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,20}$');

create unique index if not exists profiles_username_key on public.profiles (username);

-- Keep identical to RESERVED_USERNAMES in supabase/functions/_shared/username.ts.
create or replace function public.is_reserved_username(name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select name = any (array[
    'admin', 'administrator', 'api', 'app', 'auth', 'callback', 'dashboard', 'help', 'login',
    'logout', 'me', 'null', 'pentolive', 'reset', 'room', 'rooms', 'root', 'settings', 'signin',
    'signout', 'signup', 'support', 'system', 'undefined', 'user', 'www'
  ]);
$$;

create or replace function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select name ~ '^[a-z0-9_]{3,20}$'
    and not public.is_reserved_username(name)
    and not exists (select 1 from public.profiles p where p.username = name);
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- For accounts created before usernames existed (the original magic-link owner).
create or replace function public.claim_username(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_signed_in';
  end if;
  if not public.username_available(name) then
    raise exception 'username_taken';
  end if;
  insert into public.profiles (id, username) values (uid, name)
  on conflict (id) do update set username = excluded.username
  where public.profiles.username is null;
  if not found then
    raise exception 'username_already_set';
  end if;
exception
  when unique_violation then raise exception 'username_taken';
end;
$$;

revoke all on function public.claim_username(text) from public;
grant execute on function public.claim_username(text) to authenticated;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  chosen text := nullif(lower(new.raw_user_meta_data ->> 'username'), '');
begin
  if coalesce(new.is_anonymous, false) = false then
    -- Raising here (reserved name), or the unique index / format check failing on insert,
    -- aborts auth.signUp so no account is created without its username.
    if chosen is not null and public.is_reserved_username(chosen) then
      raise exception 'username_reserved';
    end if;
    insert into public.profiles (id, display_name, username)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), chosen)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
