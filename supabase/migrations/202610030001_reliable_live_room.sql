-- Sub-project 1: reliable live room.

-- Viewer links survive the owner reopening a board.
alter table public.rooms add column if not exists viewer_token text;

-- Boards owned by an account never expire; anonymous rooms keep the 30-day default.
alter table public.rooms alter column expires_at drop not null;
update public.rooms set expires_at = null where owner_id is not null;

-- Append-only element log, read later by replay (sub-project 4).
create table if not exists public.room_events (
  id bigserial primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  elements jsonb not null
);
create index if not exists room_events_room_idx on public.room_events (room_id, id);
alter table public.room_events enable row level security;
revoke all on public.room_events from anon, authenticated;

-- Any room member (viewer included) may send on room:{id}:interact.
-- Drawing on room:{id} stays editor-only via the existing policy.
drop policy if exists "room members send interact messages" on realtime.messages;
create policy "room members send interact messages" on realtime.messages
  for insert to authenticated with check (
    split_part(realtime.topic(), ':', 3) = 'interact'
    and exists (
      select 1 from public.room_members m
      where m.user_id = auth.uid()
        and m.room_id::text = split_part(realtime.topic(), ':', 2)
    )
  );

-- Target for the daily keep-alive cron so the free-tier project never pauses.
create or replace function public.keepalive() returns int
  language sql stable security definer set search_path = '' as $$ select 1 $$;
grant execute on function public.keepalive() to anon;
