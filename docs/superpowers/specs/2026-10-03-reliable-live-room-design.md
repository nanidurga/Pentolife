# Sub-project 1 — Reliable Live Room

**Date:** 2026-10-03
**Status:** Draft for review
**Branch:** `basic-features`
**Parent roadmap:** Stage 1 + Stage 2 (see "Roadmap context" below)

## 1. Intent

PentoLive is a personal (later: startup) tool for technical interviews. The candidate writes on a tablet with a stylus — probability derivations, algorithm walkthroughs, system-design sketches — while the laptop runs Meet/Zoom. The interviewer watches the handwriting live through a browser link. After the interview, the candidate gets a reviewable record of what was asked and how they answered (sub-project 3).

This sub-project makes the live link **trustworthy enough to use in a real interview** on the Supabase free tier. Nothing in later sub-projects matters if strokes lag, drop, or vanish on refresh.

### Success criteria

1. A stroke drawn on the tablet appears in the viewer while it is being drawn (pen motion visible, not just finished strokes), with p95 editor→viewer latency under 250 ms on normal networks.
2. A viewer who joins late sees the full canvas within 3 s.
3. A 15-second network drop on the tablet loses no work; the viewer catches up within 5 s of reconnect.
4. Refreshing either side restores the correct canvas.
5. Reopening a board from the dashboard does **not** invalidate a previously shared viewer link.
6. The Supabase project never pauses due to inactivity.
7. A 60-minute interview stays well within free-tier quotas (target < 100k Realtime messages).

### Free-tier limits (verified 2026-10-03, supabase.com)

| Limit | Value |
|---|---|
| Realtime messages / month | 2,000,000 |
| Realtime messages / second | 100 |
| Broadcast payload | 256 KB |
| Realtime concurrent connections | 200 |
| Presence calls per client | 5 per 30 s |
| Database size | 500 MB |
| Edge Function invocations / month | 500,000 |
| Egress | 5 GB |
| Pausing | after 1 week of inactivity |

## 2. Roadmap context (for orientation only)

| # | Sub-project | Scope |
|---|---|---|
| **1** | **Reliable live room (this spec)** | Delta sync, late join, reconnect, presence, QR pairing, viewer-link fix, event log, keep-alive |
| 2 | Interview canvas | Question frames, templates, interviewer pointer + comment pins, on-demand convert-to-text, "No AI assistance active" badge |
| 3 | Journal + AI recap | Interview metadata, End interview → AI recap per question, searchable journal |
| 4 | Insights | Topic map, replay timeline, practice mode |

Product rules that apply to all sub-projects:
- AI never runs automatically during a live session.
- No audio/video recording; the candidate owns and can delete their data.
- The live canvas works without an account; journal/recap/insights require the owner's account.

## 3. Current state (what exists)

- Next.js 16.3 App Router, Excalidraw 0.18.1, supabase-js 2.117.
- `components/Board.tsx` broadcasts the **entire scene** on every Excalidraw `onChange` on channel `room:{id}`; the viewer replaces its scene wholesale. Snapshot saved via the `rooms` Edge Function on a 1.5 s timer.
- `supabase/functions/rooms` handles `create`, `owner-access`, `join`, `snapshot`. Tokens stored only as SHA-256 hashes.
- `owner-access` rotates **both** tokens → previously shared viewer links break.
- Realtime RLS: room members may receive on topics whose second `:`-segment is the room id; only editors may send.
- No tests, no test runner.

## 4. Design

### 4.1 Sync protocol

**Message types** (all JSON, all include `from: clientId`):

| Channel | Type | Sender | Payload |
|---|---|---|---|
| `room:{id}` | `elements` | editor | `{ elements: ExcalidrawElement[] }` — changed elements only |
| `room:{id}` | `scene` | editor | `{ elements: ExcalidrawElement[] }` — full scene (late-join reply / reconnect), possibly chunked |
| `room:{id}:interact` | `sync-request` | any member | `{}` |
| `room:{id}:interact` | presence | any member | tracked state `{ role: "editor" \| "viewer" }` |

`elements` and `scene` are handled identically on the receiver (reconcile + render); the distinct type is for debugging and logging.

**Editor send path**
1. Maintain `sentVersions: Map<elementId, version>`.
2. On `onChange`, compute `changed = elements.filter(e => sentVersions.get(e.id) !== e.version)`. Deleted elements remain in Excalidraw's array with `isDeleted: true`, so deletions are covered.
3. Changed elements are merged into a pending map keyed by id (latest version wins).
4. A throttled flusher sends pending elements at most every **80 ms** (`SYNC_INTERVAL_MS`, a tunable constant). No message is sent when pending is empty.
5. Before sending, the batch is split into chunks whose serialized size is ≤ **200 KB** (`MAX_CHUNK_BYTES`, under the 256 KB limit). A single element larger than the limit is sent alone and logged as a warning.
6. After a successful send, update `sentVersions`.

**Receiver path** (viewer, and any second editor tab)
1. Ignore messages where `from === clientId`.
2. `merged = reconcileElements(localElements, remoteElements, appState)` (Excalidraw built-in, version-based, idempotent, order-insensitive).
3. `api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER })` so remote changes never enter local undo history.

**Late join**
1. Viewer calls `join` → receives DB snapshot (≤ ~10 s stale) → renders it.
2. Viewer subscribes, then sends `sync-request` on the interact channel.
3. Any editor that receives `sync-request` sends its full scene as `scene` (chunked). Throttle: at most one full-scene reply per 2 s per editor.

**Reconnect**
- Channel status `SUBSCRIBED` → badge **LIVE**; `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` → **Reconnecting…**; no browser connectivity (`navigator.onLine === false`) → **Offline**.
- supabase-js rejoins automatically. On every transition back to `SUBSCRIBED`: editor broadcasts full `scene`; viewer sends `sync-request`.
- Editor edits made while disconnected stay in the local scene and in pending; they flush on reconnect.

**Local backup (editor only)**
- On each flush, write the scene to `localStorage` under `pentolive:backup:{roomId}` (wrapped in try/catch). On load, if the backup is newer than the DB snapshot (compare `getSceneVersion`), reconcile it in.

**Presence**
- All members `track({ role })` once on the interact channel after subscribe.
- Editor top bar: `👁 N watching` (count of viewer presences). Viewer top bar: `Candidate online` / `Candidate offline` (any editor presence).

### 4.2 Code structure

```
lib/sync/
  diff.ts        collectChanged(elements, sentVersions) → elements; markSent(...)
  chunk.ts       chunkBySize(elements, maxBytes) → elements[][]
  throttle.ts    createFlusher({ intervalMs, flush }) — trailing throttle, timer-injectable
  saver.ts       createSaver({ idleMs, maxWaitMs, save }) — idle debounce + max-wait, timer-injectable
  messages.ts    message type definitions + constants
lib/realtime/
  roomChannel.ts wires Supabase channels (room + interact), presence, status → callbacks
components/
  Board.tsx      Excalidraw ↔ sync/realtime glue only
  ShareDialog.tsx QR (editor link) + copy viewer link
  StatusBar.tsx  connection badge, watching count, save state
```

`lib/sync/*` is pure TypeScript with no React/Supabase imports, so it can be unit-tested.

### 4.3 Persistence

**Saving policy (`saver.ts`)**
- Save after **2 s idle** (no changes), and at least every **10 s** during continuous drawing.
- On `visibilitychange → hidden` and `pagehide`: save immediately using `fetch(..., { keepalive: true })` to the Edge Function URL with the user's access token.
- Failed saves retry with exponential backoff (1 s, 2 s, 4 s, max 30 s); status shows `Not saved — retrying`. Local backup still protects work.

**`snapshot` action payload** becomes `{ scene, events }` where `events` is the list of elements changed since the last successful save (deduplicated by id, latest version).

**Server limits** (Edge Function): reject `scene` > 2 MB and `events` > 512 KB with HTTP 413.

### 4.4 Database migration (`supabase/migrations/202610030001_reliable_live_room.sql`)

```sql
-- Viewer links survive owner re-entry
alter table public.rooms add column if not exists viewer_token text;

-- Owned boards never expire
alter table public.rooms alter column expires_at drop not null;
update public.rooms set expires_at = null where owner_id is not null;

-- Event log for replay (sub-project 4)
create table if not exists public.room_events (
  id bigserial primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  elements jsonb not null
);
create index if not exists room_events_room_idx on public.room_events (room_id, id);
alter table public.room_events enable row level security;
revoke all on public.room_events from anon, authenticated;

-- Any member may send on the interact channel
create policy "room members send interact messages" on realtime.messages
  for insert to authenticated with check (
    split_part(realtime.topic(), ':', 3) = 'interact'
    and exists (
      select 1 from public.room_members m
      where m.user_id = auth.uid()
        and m.room_id::text = split_part(realtime.topic(), ':', 2)
    )
  );

-- Keep-alive probe target
create or replace function public.keepalive() returns int
  language sql stable security definer set search_path = '' as $$ select 1 $$;
grant execute on function public.keepalive() to anon;
```

Notes:
- The existing editor send policy matches any topic for the room; editors may therefore also send on `interact` — intended.
- `viewer_token` is stored in plaintext. It is a read-only capability; it is returned only by the Edge Function to the authenticated owner. The existing `owners list their boards` select policy exposes it to the owner via REST, which is acceptable (same person). The dashboard query continues to select only `id,title,created_at,updated_at`.
- Existing rooms have `viewer_token = null`; on their first `owner-access`, a new viewer token is minted and stored (one-time break for pre-migration boards only).

### 4.5 Edge Function changes (`supabase/functions/rooms`)

| Action | Change |
|---|---|
| `create` | Also store `viewer_token`; `expires_at = null` when the creator is a non-anonymous user. |
| `owner-access` | Rotate **editor** token only; return stored `viewer_token` (mint + store if null). |
| `join` | Accept rooms with `expires_at is null or expires_at > now()`. |
| `snapshot` | Accept `{ scene, events }`; enforce size limits; update `rooms.snapshot`; insert `room_events` row when `events` is non-empty. |

### 4.6 Keep-alive cron

- Route `app/api/cron/keepalive/route.ts`: verifies `Authorization: Bearer ${CRON_SECRET}`, calls `supabase.rpc("keepalive")` with the publishable key, returns 200/500.
- Schedule once daily via `vercel.ts` (`crons: [{ path: "/api/cron/keepalive", schedule: "0 6 * * *" }]`), allowed on the Hobby plan.
- New env var: `CRON_SECRET` (Vercel, all environments).

### 4.7 Share dialog & status bar

- **Share** button (editor only) opens a dialog:
  1. QR code of the **editor** URL (generated client-side with the `qrcode` package), labelled "Scan with your tablet — don't share this one."
  2. **Copy viewer link** button with the viewer URL shown read-only.
- Top bar: brand · connection badge (LIVE / Reconnecting… / Offline) · `👁 N watching` (editor) or `Candidate online/offline` (viewer) · save state (Saved / Saving… / Not saved — retrying) · Share.
- Invalid/expired room from `join` → full-page message "This board link is invalid or expired" with a link home, instead of a blank canvas.

### 4.8 Out of scope

Interviewer pointer, comment pins, templates, question frames UX, convert-to-text, any AI, interview metadata, replay UI. (The event log is written here so replay has data later.)

## 5. Testing

### Automated (Vitest, new dev dependency)
- `diff`: new element detected; unchanged skipped; version bump detected; deleted element (`isDeleted: true`) detected; `markSent` updates map.
- `chunk`: small batch → one chunk; batch over limit → multiple chunks each ≤ limit; oversized single element → its own chunk.
- `throttle`: multiple schedules within interval → one flush; no flush when empty; trailing flush delivers the latest pending.
- `saver`: saves after idle; saves at max-wait during continuous changes; `flushNow` saves immediately; retry backoff sequence on failure.
- Merge behaviour: applying the same remote batch twice yields the same scene; applying an older version after a newer one keeps the newer (using Excalidraw's `reconcileElements`).

### Manual acceptance (real devices: Samsung tablet + S Pen, laptop Chrome)
1. Laptop: sign in, create board, open Share, scan QR with tablet.
2. Tablet: draw 50 strokes; confirm laptop viewer (second browser/profile via viewer link) sees pen motion live.
3. Open a third viewer late; it shows all 50 strokes within 3 s; editor shows `👁 2 watching`.
4. Disable tablet Wi-Fi 15 s, keep drawing; badge shows Offline/Reconnecting. Re-enable; viewers catch up within 5 s.
5. Refresh viewer and tablet; canvas intact.
6. Close the board; reopen from dashboard; the previously copied viewer link still works.
7. Check Supabase dashboard: `room_events` rows exist for the room; Realtime message count for the session is < 100k.
8. Trigger the cron route manually with the secret; returns 200.

## 6. Risks

- **Excalidraw `onChange` frequency on low-end tablets**: `collectChanged` is O(n) per change; acceptable to a few thousand elements. If profiling shows jank, cache by `getSceneVersion` and skip when unchanged.
- **`reconcileElements` signature changes between Excalidraw versions**: `package.json` uses `latest`; pin `@excalidraw/excalidraw` to `0.18.x` in this sub-project.
- **Presence call limit (5 / 30 s)**: track once per subscribe; never re-track on every render.
