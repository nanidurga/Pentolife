-- Run this migration with the Supabase CLI or paste it into the Supabase SQL Editor.
-- Board contents never need to be readable by a public/anonymous database role.
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  editor_token_hash text not null,
  viewer_token_hash text not null,
  snapshot jsonb not null default '{"elements":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
revoke all on public.rooms, public.room_members from anon, authenticated;

-- The Edge Function is the only normal path to fetch or write board snapshots.
-- These policies are for the authenticated Realtime service, not direct REST table access.
grant select, insert on realtime.messages to authenticated;

create policy "room members receive room broadcasts" on realtime.messages
  for select to authenticated using (
    exists (
      select 1 from public.room_members m
      where m.user_id = auth.uid()
        and m.room_id::text = split_part(realtime.topic(), ':', 2)
    )
  );

create policy "room editors send room broadcasts" on realtime.messages
  for insert to authenticated with check (
    exists (
      select 1 from public.room_members m
      where m.user_id = auth.uid()
        and m.role = 'editor'
        and m.room_id::text = split_part(realtime.topic(), ':', 2)
    )
  );
