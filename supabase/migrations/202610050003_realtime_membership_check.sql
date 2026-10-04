-- Realtime authorizes private channels by evaluating these policies as the `authenticated` role,
-- which has no access to public.room_members (revoked on purpose in 202609250001). The membership
-- subquery therefore failed with "permission denied" and every private channel join was refused
-- ("Unauthorized: You do not have permissions to read from this Channel topic").
-- A security definer helper answers only "is the current user a member (or editor) of this topic's
-- room?", so room_members stays unreadable through the API. Rules are unchanged. Safe to re-run.
create or replace function public.is_room_member(topic text, editor_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
    where m.user_id = (select auth.uid())
      and m.room_id::text = split_part(topic, ':', 2)
      and (not editor_only or m.role = 'editor')
  );
$$;

revoke all on function public.is_room_member(text, boolean) from public, anon;
grant execute on function public.is_room_member(text, boolean) to authenticated;

drop policy if exists "room members receive room broadcasts" on realtime.messages;
create policy "room members receive room broadcasts" on realtime.messages
  for select to authenticated
  using (public.is_room_member((select realtime.topic())));

drop policy if exists "room editors send room broadcasts" on realtime.messages;
create policy "room editors send room broadcasts" on realtime.messages
  for insert to authenticated
  with check (public.is_room_member((select realtime.topic()), true));

drop policy if exists "room members send interact messages" on realtime.messages;
create policy "room members send interact messages" on realtime.messages
  for insert to authenticated
  with check (
    split_part((select realtime.topic()), ':', 3) = 'interact'
    and public.is_room_member((select realtime.topic()))
  );
