-- Board name already exists as rooms.title. Adds the interview's role and company. Safe to re-run.
alter table public.rooms add column if not exists role text;
alter table public.rooms add column if not exists company text;
create index if not exists rooms_owner_created_idx on public.rooms (owner_id, created_at desc);
