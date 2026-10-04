# Reliable Live Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PentoLive's live tablet→viewer link reliable enough for a real interview on the Supabase free tier: delta sync, late join, reconnect, presence, QR pairing, stable viewer links, an event log for replay, and a keep-alive cron.

**Architecture:** Pure, unit-tested sync primitives live in `lib/sync/` (diff, pending buffer, chunking, merge, throttle, saver). `lib/rooms/api.ts` wraps the `rooms` Edge Function; `lib/realtime/roomChannel.ts` wraps two Supabase Realtime channels (`room:{id}` for drawing, `room:{id}:interact` for sync requests and presence). `components/Board.tsx` becomes thin glue between Excalidraw and those modules. Server changes are one SQL migration plus edits to `supabase/functions/rooms/index.ts`.

**Tech Stack:** Next.js 16.3 (App Router), React, TypeScript, Excalidraw 0.18.1, supabase-js 2.117, Supabase Edge Functions (Deno), Vitest 5, `qrcode`.

**Spec:** `docs/superpowers/specs/2026-10-03-reliable-live-room-design.md`

## Global Constraints

- Excalidraw pinned to exactly `0.18.1`.
- Sync flush interval `SYNC_INTERVAL_MS = 80`.
- Max broadcast chunk `MAX_CHUNK_BYTES = 200_000` (Supabase free-tier payload limit is 256 KB).
- Save after `SAVE_IDLE_MS = 2000` idle, at least every `SAVE_MAX_WAIT_MS = 10_000`.
- Save retry backoff `[1000, 2000, 4000, 8000, 16000, 30000]` ms.
- Full-scene reply at most once per `SYNC_REPLY_MIN_GAP_MS = 2000` per editor.
- `keepalive: true` only when request body < `KEEPALIVE_MAX_BYTES = 60_000`.
- Server rejects `scene` > 2,000,000 bytes or `events` > 512,000 bytes with HTTP 413.
- Owned rooms: `expires_at = null`. Anonymous rooms: 30 days.
- Remote changes are applied with `captureUpdate: "NEVER"` (never enter local undo history).
- Excalidraw must only be loaded via `next/dynamic` with `ssr: false`; other files may import **types only** from `@excalidraw/excalidraw/*`.
- Never put the Supabase service-role key in Next.js or Vercel env vars.
- Viewers can send only on `room:{id}:interact`; only editors send on `room:{id}`.
- Status copy: `LIVE`, `Reconnecting…`, `Offline`, `Connecting…`, `Local prototype`; save copy: `Saved`, `Saving…`, `Not saved — retrying`, `Too large to save — kept on this device`.

## Review Focus

1. **Tablet sleeps with a large board** — a keepalive request over 64 KB is silently dropped by browsers; expected: large saves go out as a normal request and the local backup still holds the work. Pinned by `buildSnapshotRequest` tests in Task 6.
2. **Board grows past 2 MB** — the server returns 413; expected: no infinite retry storm, status says it's kept on this device. Pinned by the saver permanent-error test (Task 5) and the 413 test (Task 6).
3. **Two editor tabs open** (laptop + tablet both as editor) — expected: no echo loop where each tab re-broadcasts what it just received. Pinned by the "remote elements marked sent are not re-collected" test in Task 1.
4. **Elements arrive in a different z-order than drawn** (chunked or out-of-order batches) — expected: viewer stacking matches the editor. Pinned by the index-ordering test in Task 3.
5. **Expired or mistyped link** — expected: a clear "invalid or expired" page, not a blank canvas. Pinned by `classifyJoinError` tests in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `vitest.config.ts` | Test runner config with `@/` alias |
| `lib/sync/types.ts` | `SyncElement` minimal element shape |
| `lib/sync/messages.ts` | Constants, event names, topic helpers, payload type |
| `lib/sync/diff.ts` | `collectChanged`, `markSent`, `unmarkSent` |
| `lib/sync/pending.ts` | `createPendingSet` latest-version-per-id buffer |
| `lib/sync/chunk.ts` | `byteSize`, `chunkBySize` |
| `lib/sync/merge.ts` | `mergeByVersion`, `isNewer` |
| `lib/sync/throttle.ts` | `createFlusher` |
| `lib/sync/saver.ts` | `createSaver`, `PermanentSaveError`, `SaveState` |
| `lib/rooms/api.ts` | `joinRoom`, `saveSnapshot`, `buildSnapshotRequest`, `classifyJoinError`, `Scene` |
| `lib/realtime/presence.ts` | `countPresence` |
| `lib/realtime/roomChannel.ts` | `openRoomConnection` (Supabase channels, status, presence) |
| `lib/ui/statusLabels.ts` | `connectionLabel`, `presenceLabel`, `saveLabel` |
| `components/StatusBar.tsx` | Top bar UI |
| `components/ShareDialog.tsx` | QR (editor link) + copy viewer link |
| `components/Board.tsx` | Excalidraw ↔ sync glue (rewritten) |
| `supabase/migrations/202610030001_reliable_live_room.sql` | Schema + realtime policy + keepalive fn |
| `supabase/functions/rooms/index.ts` | create / owner-access / join / snapshot changes |
| `app/api/cron/keepalive/route.ts` | Daily DB ping |
| `vercel.json` | Cron schedule |

---

### Task 1: Test tooling, sync types, and change detection

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `lib/sync/types.ts`
- Create: `lib/sync/messages.ts`
- Create: `lib/sync/diff.ts`
- Test: `lib/sync/diff.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type SyncElement = { id: string; version: number; versionNonce: number; index?: string | null; isDeleted?: boolean }`
  - `collectChanged<T extends SyncElement>(elements: readonly T[], sent: ReadonlyMap<string, number>): T[]`
  - `markSent(sent: Map<string, number>, elements: readonly SyncElement[]): void`
  - `unmarkSent(sent: Map<string, number>, elements: readonly SyncElement[]): void`
  - constants `SYNC_INTERVAL_MS, MAX_CHUNK_BYTES, SAVE_IDLE_MS, SAVE_MAX_WAIT_MS, SYNC_REPLY_MIN_GAP_MS, KEEPALIVE_MAX_BYTES`, `EVENTS`, `roomTopic(id)`, `interactTopic(id)`, `type ElementsPayload = { from: string; elements: SyncElement[] }`

- [ ] **Step 1: Install Vitest and pin Excalidraw**

Run:
```bash
npm install -D vitest@^5.0.3
npm install --save-exact @excalidraw/excalidraw@0.18.1
```
Then add a `test` script to `package.json` `scripts`:
```json
"test": "vitest run"
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "supabase/functions/**"],
  },
});
```

- [ ] **Step 3: Create `lib/sync/types.ts`**

```ts
// The subset of an Excalidraw element that sync logic relies on.
export type SyncElement = {
  id: string;
  version: number;
  versionNonce: number;
  index?: string | null;
  isDeleted?: boolean;
};
```

- [ ] **Step 4: Create `lib/sync/messages.ts`**

```ts
import type { SyncElement } from "./types";

export const SYNC_INTERVAL_MS = 80;
export const MAX_CHUNK_BYTES = 200_000;
export const SAVE_IDLE_MS = 2000;
export const SAVE_MAX_WAIT_MS = 10_000;
export const SYNC_REPLY_MIN_GAP_MS = 2000;
export const KEEPALIVE_MAX_BYTES = 60_000;

export const EVENTS = { elements: "elements", scene: "scene", syncRequest: "sync-request" } as const;

export const roomTopic = (roomId: string) => `room:${roomId}`;
export const interactTopic = (roomId: string) => `room:${roomId}:interact`;

export type ElementsPayload = { from: string; elements: SyncElement[] };
```

- [ ] **Step 5: Write the failing test `lib/sync/diff.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { collectChanged, markSent, unmarkSent } from "./diff";
import type { SyncElement } from "./types";

const el = (id: string, version: number, extra: Partial<SyncElement> = {}): SyncElement =>
  ({ id, version, versionNonce: 1, ...extra });

describe("collectChanged", () => {
  it("returns elements never sent", () => {
    expect(collectChanged([el("a", 1)], new Map())).toEqual([el("a", 1)]);
  });

  it("skips elements whose version was already sent", () => {
    expect(collectChanged([el("a", 3)], new Map([["a", 3]]))).toEqual([]);
  });

  it("returns elements whose version changed", () => {
    expect(collectChanged([el("a", 4)], new Map([["a", 3]]))).toEqual([el("a", 4)]);
  });

  it("returns deleted elements so deletions propagate", () => {
    const deleted = el("a", 5, { isDeleted: true });
    expect(collectChanged([deleted], new Map([["a", 4]]))).toEqual([deleted]);
  });
});

describe("markSent / unmarkSent", () => {
  it("records versions and never moves backwards", () => {
    const sent = new Map<string, number>([["a", 5]]);
    markSent(sent, [el("a", 3), el("b", 2)]);
    expect(sent.get("a")).toBe(5);
    expect(sent.get("b")).toBe(2);
  });

  it("remote elements marked sent are not re-collected (no echo between editor tabs)", () => {
    const sent = new Map<string, number>();
    const remote = [el("x", 7)];
    markSent(sent, remote);
    expect(collectChanged(remote, sent)).toEqual([]);
  });

  it("unmarkSent forgets only the exact version so a failed send is retried", () => {
    const sent = new Map<string, number>([["a", 2], ["b", 9]]);
    unmarkSent(sent, [el("a", 2), el("b", 3)]);
    expect(sent.has("a")).toBe(false);
    expect(sent.get("b")).toBe(9);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run lib/sync/diff.test.ts`
Expected: FAIL — cannot resolve `./diff`.

- [ ] **Step 7: Implement `lib/sync/diff.ts`**

```ts
import type { SyncElement } from "./types";

export function collectChanged<T extends SyncElement>(elements: readonly T[], sent: ReadonlyMap<string, number>): T[] {
  return elements.filter((element) => sent.get(element.id) !== element.version);
}

export function markSent(sent: Map<string, number>, elements: readonly SyncElement[]) {
  for (const element of elements) {
    const previous = sent.get(element.id);
    if (previous === undefined || element.version > previous) sent.set(element.id, element.version);
  }
}

export function unmarkSent(sent: Map<string, number>, elements: readonly SyncElement[]) {
  for (const element of elements) {
    if (sent.get(element.id) === element.version) sent.delete(element.id);
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run lib/sync/diff.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/sync/types.ts lib/sync/messages.ts lib/sync/diff.ts lib/sync/diff.test.ts
git commit -m "feat(sync): add vitest and element change detection"
```

---

### Task 2: Pending buffer and size-based chunking

**Files:**
- Create: `lib/sync/pending.ts`
- Create: `lib/sync/chunk.ts`
- Test: `lib/sync/pending.test.ts`
- Test: `lib/sync/chunk.test.ts`

**Interfaces:**
- Consumes: `SyncElement` (Task 1)
- Produces:
  - `type PendingSet<T extends SyncElement> = { add(elements: readonly T[]): void; take(): T[]; restore(elements: readonly T[]): void; readonly size: number }`
  - `createPendingSet<T extends SyncElement>(): PendingSet<T>`
  - `byteSize(value: unknown): number`
  - `chunkBySize<T>(items: readonly T[], maxBytes: number): T[][]`

- [ ] **Step 1: Write the failing tests**

`lib/sync/pending.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createPendingSet } from "./pending";
import type { SyncElement } from "./types";

const el = (id: string, version: number): SyncElement => ({ id, version, versionNonce: 1 });

describe("createPendingSet", () => {
  it("keeps only the latest version per id", () => {
    const pending = createPendingSet<SyncElement>();
    pending.add([el("a", 1), el("a", 3), el("a", 2)]);
    expect(pending.take()).toEqual([el("a", 3)]);
  });

  it("take empties the set", () => {
    const pending = createPendingSet<SyncElement>();
    pending.add([el("a", 1)]);
    pending.take();
    expect(pending.size).toBe(0);
    expect(pending.take()).toEqual([]);
  });

  it("restore puts back a failed batch without overwriting newer pending versions", () => {
    const pending = createPendingSet<SyncElement>();
    pending.add([el("a", 1), el("b", 1)]);
    const batch = pending.take();
    pending.add([el("a", 2)]);
    pending.restore(batch);
    expect(pending.take().sort((x, y) => x.id.localeCompare(y.id))).toEqual([el("a", 2), el("b", 1)]);
  });
});
```

`lib/sync/chunk.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { byteSize, chunkBySize } from "./chunk";

const item = (n: number, pad: number) => ({ id: String(n), data: "x".repeat(pad) });

describe("chunkBySize", () => {
  it("returns a single chunk when everything fits", () => {
    const items = [item(1, 10), item(2, 10)];
    expect(chunkBySize(items, 1000)).toEqual([items]);
  });

  it("splits into chunks that each serialize within the limit", () => {
    const items = Array.from({ length: 50 }, (_, i) => item(i, 100));
    const chunks = chunkBySize(items, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(byteSize(chunk)).toBeLessThanOrEqual(1000);
    expect(chunks.flat()).toEqual(items);
  });

  it("puts an oversized single item in its own chunk", () => {
    const big = item(1, 5000);
    const chunks = chunkBySize([item(0, 10), big, item(2, 10)], 1000);
    expect(chunks).toContainEqual([big]);
    expect(chunks.flat()).toHaveLength(3);
  });

  it("returns no chunks for no items", () => {
    expect(chunkBySize([], 1000)).toEqual([]);
  });

  it("measures UTF-8 bytes, not string length", () => {
    expect(byteSize("é")).toBe(4); // quotes + 2-byte char
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/sync/pending.test.ts lib/sync/chunk.test.ts`
Expected: FAIL — cannot resolve `./pending` and `./chunk`.

- [ ] **Step 3: Implement `lib/sync/pending.ts`**

```ts
import type { SyncElement } from "./types";

export type PendingSet<T extends SyncElement> = {
  add(elements: readonly T[]): void;
  take(): T[];
  restore(elements: readonly T[]): void;
  readonly size: number;
};

export function createPendingSet<T extends SyncElement>(): PendingSet<T> {
  const items = new Map<string, T>();
  const put = (element: T) => {
    const current = items.get(element.id);
    if (!current || element.version >= current.version) items.set(element.id, element);
  };
  return {
    add(elements) { elements.forEach(put); },
    take() {
      const batch = [...items.values()];
      items.clear();
      return batch;
    },
    // Anything added since the batch was taken is newer, so it wins.
    restore(elements) {
      for (const element of elements) if (!items.has(element.id)) items.set(element.id, element);
    },
    get size() { return items.size; },
  };
}
```

- [ ] **Step 4: Implement `lib/sync/chunk.ts`**

```ts
const encoder = new TextEncoder();

export function byteSize(value: unknown) {
  return encoder.encode(JSON.stringify(value)).length;
}

// Serialized array = "[" + items joined by "," + "]", so each item costs its size + 1.
export function chunkBySize<T>(items: readonly T[], maxBytes: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = 2;
  for (const item of items) {
    const size = byteSize(item) + 1;
    if (current.length > 0 && currentBytes + size > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/sync/pending.test.ts lib/sync/chunk.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/sync/pending.ts lib/sync/pending.test.ts lib/sync/chunk.ts lib/sync/chunk.test.ts
git commit -m "feat(sync): add pending buffer and size-based chunking"
```

---

### Task 3: Version-based merge

**Files:**
- Create: `lib/sync/merge.ts`
- Test: `lib/sync/merge.test.ts`

**Interfaces:**
- Consumes: `SyncElement` (Task 1)
- Produces:
  - `isNewer(candidate: SyncElement, current: SyncElement): boolean`
  - `mergeByVersion<T extends SyncElement>(local: readonly T[], remote: readonly T[], protectedIds?: ReadonlySet<string>): T[]`

- [ ] **Step 1: Write the failing test `lib/sync/merge.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { mergeByVersion } from "./merge";
import type { SyncElement } from "./types";

const el = (id: string, version: number, extra: Partial<SyncElement> = {}): SyncElement =>
  ({ id, version, versionNonce: 100, index: id, ...extra });

describe("mergeByVersion", () => {
  it("adds remote elements that are new locally", () => {
    expect(mergeByVersion([el("a", 1)], [el("b", 1)])).toEqual([el("a", 1), el("b", 1)]);
  });

  it("takes the remote element when its version is higher", () => {
    expect(mergeByVersion([el("a", 1)], [el("a", 2)])).toEqual([el("a", 2)]);
  });

  it("keeps the local element when the remote version is older", () => {
    expect(mergeByVersion([el("a", 5)], [el("a", 2)])).toEqual([el("a", 5)]);
  });

  it("breaks version ties with the lower versionNonce", () => {
    const local = el("a", 3, { versionNonce: 50 });
    const remote = el("a", 3, { versionNonce: 10 });
    expect(mergeByVersion([local], [remote])).toEqual([remote]);
    expect(mergeByVersion([remote], [local])).toEqual([remote]);
  });

  it("is idempotent", () => {
    const local = [el("a", 1)];
    const remote = [el("a", 2), el("b", 1)];
    const once = mergeByVersion(local, remote);
    expect(mergeByVersion(once, remote)).toEqual(once);
  });

  it("propagates deletions", () => {
    const deleted = el("a", 2, { isDeleted: true });
    expect(mergeByVersion([el("a", 1)], [deleted])).toEqual([deleted]);
  });

  it("does not touch elements the local user is editing", () => {
    expect(mergeByVersion([el("a", 1)], [el("a", 9)], new Set(["a"]))).toEqual([el("a", 1)]);
  });

  it("orders the result by fractional index regardless of arrival order", () => {
    const merged = mergeByVersion([el("c", 1, { index: "a2" })], [el("z", 1, { index: "a0" }), el("m", 1, { index: "a1" })]);
    expect(merged.map((e) => e.id)).toEqual(["z", "m", "c"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sync/merge.test.ts`
Expected: FAIL — cannot resolve `./merge`.

- [ ] **Step 3: Implement `lib/sync/merge.ts`**

```ts
import type { SyncElement } from "./types";

// Excalidraw's rule: higher version wins; on a tie, the lower versionNonce wins.
export function isNewer(candidate: SyncElement, current: SyncElement) {
  return candidate.version > current.version
    || (candidate.version === current.version && candidate.versionNonce < current.versionNonce);
}

export function mergeByVersion<T extends SyncElement>(
  local: readonly T[],
  remote: readonly T[],
  protectedIds: ReadonlySet<string> = new Set(),
): T[] {
  const byId = new Map<string, T>();
  const order: string[] = [];
  for (const element of local) {
    if (!byId.has(element.id)) order.push(element.id);
    byId.set(element.id, element);
  }
  for (const incoming of remote) {
    const current = byId.get(incoming.id);
    if (!current) {
      byId.set(incoming.id, incoming);
      order.push(incoming.id);
    } else if (!protectedIds.has(incoming.id) && isNewer(incoming, current)) {
      byId.set(incoming.id, incoming);
    }
  }
  return sortByIndex(order.map((id) => byId.get(id)!));
}

// Excalidraw 0.18 gives every element a fractional `index` string that sorts lexicographically.
// Elements without one keep their relative position.
function sortByIndex<T extends SyncElement>(elements: T[]): T[] {
  return elements
    .map((element, position) => ({ element, position }))
    .sort((a, b) => {
      const ai = a.element.index;
      const bi = b.element.index;
      if (ai && bi && ai !== bi) return ai < bi ? -1 : 1;
      return a.position - b.position;
    })
    .map(({ element }) => element);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sync/merge.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/merge.ts lib/sync/merge.test.ts
git commit -m "feat(sync): add version-based element merge"
```

---

### Task 4: Send throttle

**Files:**
- Create: `lib/sync/throttle.ts`
- Test: `lib/sync/throttle.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Flusher = { schedule(): void; flushNow(): void; cancel(): void }`
  - `createFlusher(options: { intervalMs: number; flush: () => void }): Flusher`

- [ ] **Step 1: Write the failing test `lib/sync/throttle.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlusher } from "./throttle";

describe("createFlusher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flushes the first schedule right away (next tick)", () => {
    const flush = vi.fn();
    createFlusher({ intervalMs: 80, flush }).schedule();
    vi.advanceTimersByTime(0);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("collapses schedules within the interval into one trailing flush", () => {
    const flush = vi.fn();
    const flusher = createFlusher({ intervalMs: 80, flush });
    flusher.schedule();
    vi.advanceTimersByTime(0);
    for (let i = 0; i < 5; i++) { flusher.schedule(); vi.advanceTimersByTime(10); }
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(80);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("never flushes faster than the interval", () => {
    const flush = vi.fn();
    const flusher = createFlusher({ intervalMs: 80, flush });
    for (let t = 0; t < 800; t += 5) { flusher.schedule(); vi.advanceTimersByTime(5); }
    expect(flush.mock.calls.length).toBeLessThanOrEqual(11);
  });

  it("flushNow runs immediately and replaces a pending flush", () => {
    const flush = vi.fn();
    const flusher = createFlusher({ intervalMs: 80, flush });
    flusher.schedule();
    flusher.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("cancel drops a pending flush", () => {
    const flush = vi.fn();
    const flusher = createFlusher({ intervalMs: 80, flush });
    flusher.schedule();
    flusher.cancel();
    vi.advanceTimersByTime(200);
    expect(flush).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sync/throttle.test.ts`
Expected: FAIL — cannot resolve `./throttle`.

- [ ] **Step 3: Implement `lib/sync/throttle.ts`**

```ts
export type Flusher = { schedule(): void; flushNow(): void; cancel(): void };

// Leading + trailing throttle: at most one flush per interval; the caller's
// flush reads whatever is pending at that moment, so nothing is lost.
export function createFlusher({ intervalMs, flush }: { intervalMs: number; flush: () => void }): Flusher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = -Infinity;
  const run = () => {
    timer = null;
    last = Date.now();
    flush();
  };
  return {
    schedule() {
      if (timer !== null) return;
      timer = setTimeout(run, Math.max(0, last + intervalMs - Date.now()));
    },
    flushNow() {
      if (timer !== null) clearTimeout(timer);
      run();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sync/throttle.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/throttle.ts lib/sync/throttle.test.ts
git commit -m "feat(sync): add send throttle"
```

---

### Task 5: Snapshot saver (idle debounce, max wait, retry, permanent failure)

**Files:**
- Create: `lib/sync/saver.ts`
- Test: `lib/sync/saver.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type SaveState = "saved" | "saving" | "retrying" | "failed"`
  - `class PermanentSaveError extends Error` with `readonly permanent = true`
  - `DEFAULT_BACKOFF_MS: number[]`
  - `type Saver = { notifyChange(): void; flushNow(): Promise<void>; dispose(): void }`
  - `createSaver(options: { idleMs: number; maxWaitMs: number; save: () => Promise<void>; onState?: (state: SaveState) => void; backoffMs?: number[] }): Saver`

- [ ] **Step 1: Write the failing test `lib/sync/saver.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaver, PermanentSaveError, type SaveState } from "./saver";

describe("createSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (save = vi.fn(async () => {})) => {
    const states: SaveState[] = [];
    const saver = createSaver({ idleMs: 2000, maxWaitMs: 10_000, save, onState: (s) => states.push(s) });
    return { saver, save, states };
  };

  it("saves once after the idle period following rapid changes", async () => {
    const { saver, save } = setup();
    saver.notifyChange(); saver.notifyChange(); saver.notifyChange();
    await vi.advanceTimersByTimeAsync(1999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves at the max wait during continuous drawing", async () => {
    const { saver, save } = setup();
    for (let t = 0; t < 10_000; t += 500) { saver.notifyChange(); await vi.advanceTimersByTimeAsync(500); }
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flushNow saves immediately, and does nothing when clean", async () => {
    const { saver, save } = setup();
    await saver.flushNow();
    expect(save).not.toHaveBeenCalled();
    saver.notifyChange();
    await saver.flushNow();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("reports saving then saved", async () => {
    const { saver, states } = setup();
    saver.notifyChange();
    await saver.flushNow();
    expect(states).toEqual(["saving", "saved"]);
  });

  it("retries failures with backoff", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("net")).mockRejectedValueOnce(new Error("net")).mockResolvedValue(undefined);
    const { saver, states } = setup(save);
    saver.notifyChange();
    await saver.flushNow();
    expect(states.at(-1)).toBe("retrying");
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toBe("saved");
  });

  it("does not retry a permanent failure (board too large)", async () => {
    const save = vi.fn().mockRejectedValue(new PermanentSaveError("too large"));
    const { saver, states } = setup(save);
    saver.notifyChange();
    await saver.flushNow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("failed");
  });

  it("saves again when changes arrive during an in-flight save", async () => {
    let finish!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { finish = r; })).mockResolvedValue(undefined);
    const { saver } = setup(save);
    saver.notifyChange();
    const first = saver.flushNow();
    saver.notifyChange();
    finish();
    await first;
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels pending saves", async () => {
    const { saver, save } = setup();
    saver.notifyChange();
    saver.dispose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sync/saver.test.ts`
Expected: FAIL — cannot resolve `./saver`.

- [ ] **Step 3: Implement `lib/sync/saver.ts`**

```ts
export type SaveState = "saved" | "saving" | "retrying" | "failed";

export class PermanentSaveError extends Error {
  readonly permanent = true;
}

export const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export type Saver = { notifyChange(): void; flushNow(): Promise<void>; dispose(): void };

type Timer = ReturnType<typeof setTimeout> | null;

export function createSaver(options: {
  idleMs: number;
  maxWaitMs: number;
  save: () => Promise<void>;
  onState?: (state: SaveState) => void;
  backoffMs?: number[];
}): Saver {
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  let idleTimer: Timer = null;
  let maxTimer: Timer = null;
  let retryTimer: Timer = null;
  let dirty = false;
  let disposed = false;
  let attempt = 0;
  let inFlight: Promise<void> | null = null;

  const clearTimers = () => {
    for (const timer of [idleTimer, maxTimer, retryTimer]) if (timer !== null) clearTimeout(timer);
    idleTimer = maxTimer = retryTimer = null;
  };

  const schedule = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void trigger(), options.idleMs);
    if (maxTimer === null) maxTimer = setTimeout(() => void trigger(), options.maxWaitMs);
  };

  function trigger(): Promise<void> {
    clearTimers();
    if (inFlight) return inFlight.then(() => (dirty ? trigger() : undefined));
    if (!dirty || disposed) return Promise.resolve();
    dirty = false;
    options.onState?.("saving");
    inFlight = options.save().then(
      () => {
        inFlight = null;
        attempt = 0;
        if (!dirty) options.onState?.("saved");
      },
      (error: unknown) => {
        inFlight = null;
        dirty = true;
        if ((error as { permanent?: boolean } | null)?.permanent) {
          attempt = 0;
          options.onState?.("failed");
          return;
        }
        options.onState?.("retrying");
        const delay = backoff[Math.min(attempt, backoff.length - 1)];
        attempt += 1;
        if (!disposed) retryTimer = setTimeout(() => void trigger(), delay);
      },
    );
    return inFlight;
  }

  return {
    notifyChange() {
      if (disposed) return;
      dirty = true;
      schedule();
    },
    flushNow: () => trigger(),
    dispose() {
      disposed = true;
      clearTimers();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sync/saver.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/saver.ts lib/sync/saver.test.ts
git commit -m "feat(sync): add snapshot saver with retry and permanent failure"
```

---

### Task 6: Rooms API client

**Files:**
- Create: `lib/rooms/api.ts`
- Test: `lib/rooms/api.test.ts`

**Interfaces:**
- Consumes: `KEEPALIVE_MAX_BYTES` (Task 1), `PermanentSaveError` (Task 5), `SyncElement` (Task 1)
- Produces:
  - `type Scene = { elements: SyncElement[]; appState?: { viewBackgroundColor?: string } }`
  - `type JoinResult = { ok: true; snapshot: Scene | null } | { ok: false; reason: "invalid" | "offline" }`
  - `classifyJoinError(status: number | undefined): "invalid" | "offline"`
  - `buildSnapshotRequest(input: { url: string; publishableKey: string; accessToken: string; body: unknown; keepalive: boolean }): { url: string; init: RequestInit }`
  - `checkSnapshotResponse(status: number): void` (throws `PermanentSaveError` on 413, `Error` on other non-2xx)
  - `joinRoom(supabase: SupabaseClient, params: { roomId: string; token: string; role: "editor" | "viewer" }): Promise<JoinResult>`
  - `saveSnapshot(supabase: SupabaseClient, params: { roomId: string; token: string; scene: Scene; events: SyncElement[]; keepalive?: boolean }): Promise<void>`

- [ ] **Step 1: Write the failing test `lib/rooms/api.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildSnapshotRequest, checkSnapshotResponse, classifyJoinError } from "./api";
import { PermanentSaveError } from "@/lib/sync/saver";

const base = { url: "https://p.supabase.co", publishableKey: "pk", accessToken: "jwt" };

describe("buildSnapshotRequest", () => {
  it("targets the rooms function with auth headers", () => {
    const { url, init } = buildSnapshotRequest({ ...base, body: { a: 1 }, keepalive: false });
    expect(url).toBe("https://p.supabase.co/functions/v1/rooms");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer jwt", apikey: "pk", "Content-Type": "application/json" });
    expect(init.body).toBe('{"a":1}');
  });

  it("uses keepalive for small bodies when asked", () => {
    expect(buildSnapshotRequest({ ...base, body: { a: 1 }, keepalive: true }).init.keepalive).toBe(true);
  });

  it("drops keepalive for bodies over 60 KB (browsers silently discard them)", () => {
    const body = { data: "x".repeat(70_000) };
    expect(buildSnapshotRequest({ ...base, body, keepalive: true }).init.keepalive).toBe(false);
  });
});

describe("checkSnapshotResponse", () => {
  it("accepts 2xx", () => {
    expect(() => checkSnapshotResponse(200)).not.toThrow();
  });

  it("treats 413 as permanent", () => {
    expect(() => checkSnapshotResponse(413)).toThrow(PermanentSaveError);
  });

  it("treats other failures as retryable", () => {
    let error: unknown;
    try { checkSnapshotResponse(500); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentSaveError);
  });
});

describe("classifyJoinError", () => {
  it.each([400, 403, 404])("treats %i as an invalid link", (status) => {
    expect(classifyJoinError(status)).toBe("invalid");
  });

  it.each([undefined, 500, 503])("treats %s as offline", (status) => {
    expect(classifyJoinError(status)).toBe("offline");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/rooms/api.test.ts`
Expected: FAIL — cannot resolve `./api`.

- [ ] **Step 3: Implement `lib/rooms/api.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { KEEPALIVE_MAX_BYTES } from "@/lib/sync/messages";
import { PermanentSaveError } from "@/lib/sync/saver";
import type { SyncElement } from "@/lib/sync/types";

export type Scene = { elements: SyncElement[]; appState?: { viewBackgroundColor?: string } };
export type JoinResult = { ok: true; snapshot: Scene | null } | { ok: false; reason: "invalid" | "offline" };

export function classifyJoinError(status: number | undefined): "invalid" | "offline" {
  return status === 400 || status === 403 || status === 404 ? "invalid" : "offline";
}

export function buildSnapshotRequest(input: {
  url: string;
  publishableKey: string;
  accessToken: string;
  body: unknown;
  keepalive: boolean;
}): { url: string; init: RequestInit } {
  const body = JSON.stringify(input.body);
  const small = new TextEncoder().encode(body).length < KEEPALIVE_MAX_BYTES;
  return {
    url: `${input.url}/functions/v1/rooms`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, apikey: input.publishableKey, "Content-Type": "application/json" },
      body,
      keepalive: input.keepalive && small,
    },
  };
}

export function checkSnapshotResponse(status: number) {
  if (status === 413) throw new PermanentSaveError("Board too large to save");
  if (status < 200 || status >= 300) throw new Error(`Snapshot save failed with ${status}`);
}

export async function joinRoom(
  supabase: SupabaseClient,
  params: { roomId: string; token: string; role: "editor" | "viewer" },
): Promise<JoinResult> {
  const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "join", ...params } });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    return { ok: false, reason: classifyJoinError(status) };
  }
  return { ok: true, snapshot: (data?.snapshot as Scene | undefined) ?? null };
}

// Uses fetch directly (not functions.invoke) so it can set `keepalive` on page hide.
export async function saveSnapshot(
  supabase: SupabaseClient,
  params: { roomId: string; token: string; scene: Scene; events: SyncElement[]; keepalive?: boolean },
) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("No Supabase session");
  const { url, init } = buildSnapshotRequest({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    accessToken: session.access_token,
    body: { action: "snapshot", roomId: params.roomId, token: params.token, role: "editor", scene: params.scene, events: params.events },
    keepalive: params.keepalive ?? false,
  });
  const response = await fetch(url, init);
  checkSnapshotResponse(response.status);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/rooms/api.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/rooms/api.ts lib/rooms/api.test.ts
git commit -m "feat(rooms): add rooms API client with keepalive and error classification"
```

---

### Task 7: Database migration and Edge Function changes

**Files:**
- Create: `supabase/migrations/202610030001_reliable_live_room.sql`
- Modify: `supabase/functions/rooms/index.ts` (full replacement below)

**Interfaces:**
- Consumes: request bodies sent by `joinRoom` / `saveSnapshot` (Task 6): `{ action: "join", roomId, token, role }`, `{ action: "snapshot", roomId, token, role: "editor", scene, events }`
- Produces: `create` → `{ roomId, editorToken, viewerToken }`; `owner-access` → `{ roomId, editorToken, viewerToken }` (viewerToken stable); `join` → `{ role, snapshot }`; `snapshot` → `{ ok: true }` | 413 | 403; DB function `public.keepalive()`; table `public.room_events`.

No automated tests (Deno is not installed and Edge Functions run remotely). Verification is the deploy + manual checks in Steps 4–6.

- [ ] **Step 1: Create the migration**

`supabase/migrations/202610030001_reliable_live_room.sql`:
```sql
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
```

- [ ] **Step 2: Replace `supabase/functions/rooms/index.ts`**

```ts
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_SCENE_BYTES = 2_000_000;
const MAX_EVENTS_BYTES = 512_000;
const ANONYMOUS_ROOM_DAYS = 30;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value ?? null)).length;

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: request.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return json({ error: "Sign in anonymously before calling this function." }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const body = await request.json();

  if (body.action === "create") {
    const editorToken = randomToken();
    const viewerToken = randomToken();
    const owned = !user.is_anonymous;
    const { data: room, error } = await admin.from("rooms").insert({
      editor_token_hash: await hash(editorToken),
      viewer_token_hash: await hash(viewerToken),
      viewer_token: viewerToken,
      owner_id: owned ? user.id : null,
      expires_at: owned ? null : new Date(Date.now() + ANONYMOUS_ROOM_DAYS * 86_400_000).toISOString(),
    }).select("id").single();
    if (error || !room) return json({ error: "Could not create room." }, 500);
    await admin.from("room_members").insert({ room_id: room.id, user_id: user.id, role: "editor" });
    return json({ roomId: room.id, editorToken, viewerToken });
  }

  if (body.action === "owner-access") {
    if (user.is_anonymous || !body.roomId) return json({ error: "Sign in with your personal account first." }, 403);
    const { data: ownedRoom } = await admin.from("rooms").select("id, viewer_token").eq("id", body.roomId).eq("owner_id", user.id).maybeSingle();
    if (!ownedRoom) return json({ error: "Board not found." }, 404);
    // Rotate only the editor capability; keep the viewer link stable so shared links keep working.
    const editorToken = randomToken();
    const viewerToken = ownedRoom.viewer_token ?? randomToken();
    const update: Record<string, string> = { editor_token_hash: await hash(editorToken), updated_at: new Date().toISOString() };
    if (!ownedRoom.viewer_token) {
      update.viewer_token = viewerToken;
      update.viewer_token_hash = await hash(viewerToken);
    }
    await admin.from("rooms").update(update).eq("id", body.roomId);
    return json({ roomId: body.roomId, editorToken, viewerToken });
  }

  const { roomId, token } = body;
  if (!roomId || !token) return json({ error: "A room and capability token are required." }, 400);
  const now = new Date().toISOString();
  const { data: room } = await admin.from("rooms").select("*").eq("id", roomId)
    .or(`expires_at.is.null,expires_at.gt."${now}"`).maybeSingle();
  if (!room) return json({ error: "Room not found or expired." }, 404);
  const requestedRole = body.role === "editor" ? "editor" : "viewer";
  const tokenMatches = await hash(token) === (requestedRole === "editor" ? room.editor_token_hash : room.viewer_token_hash);
  if (!tokenMatches) return json({ error: "Invalid room capability." }, 403);

  if (body.action === "join") {
    await admin.from("room_members").upsert({ room_id: roomId, user_id: user.id, role: requestedRole });
    return json({ role: requestedRole, snapshot: room.snapshot });
  }

  if (body.action === "snapshot") {
    if (requestedRole !== "editor") return json({ error: "Editor access required." }, 403);
    if (!Array.isArray(body.scene?.elements)) return json({ error: "Invalid scene." }, 400);
    if (byteSize(body.scene) > MAX_SCENE_BYTES || byteSize(body.events) > MAX_EVENTS_BYTES) {
      return json({ error: "Board too large." }, 413);
    }
    const { error } = await admin.from("rooms").update({ snapshot: body.scene, updated_at: now }).eq("id", roomId);
    if (error) return json({ error: "Could not save snapshot." }, 500);
    if (Array.isArray(body.events) && body.events.length > 0) {
      await admin.from("room_events").insert({ room_id: roomId, elements: body.events });
    }
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202610030001_reliable_live_room.sql supabase/functions/rooms/index.ts
git commit -m "feat(rooms): stable viewer links, event log, size limits, interact policy"
```

- [ ] **Step 4: Apply the migration (USER ACTION — confirm before running)**

Earlier migrations were applied through the SQL Editor (per README), so do **not** run `supabase db push` (it would try to re-apply them). Instead: open Supabase Dashboard → SQL Editor → paste the full contents of `supabase/migrations/202610030001_reliable_live_room.sql` → Run.
Expected: "Success. No rows returned."

- [ ] **Step 5: Deploy the Edge Function (outward-facing — confirm with the user first)**

Run: `supabase functions deploy rooms`
Expected: `Deployed Functions on project <ref>: rooms`.

- [ ] **Step 6: Smoke-check in SQL Editor**

```sql
select column_name from information_schema.columns where table_name = 'rooms' and column_name = 'viewer_token';
select public.keepalive();
select policyname from pg_policies where tablename = 'messages' and policyname = 'room members send interact messages';
```
Expected: one row each (`viewer_token`, `1`, the policy name).

---

### Task 8: Realtime connection (channels, status, presence)

**Files:**
- Create: `lib/realtime/presence.ts`
- Test: `lib/realtime/presence.test.ts`
- Create: `lib/realtime/roomChannel.ts`

**Interfaces:**
- Consumes: `chunkBySize`, `byteSize` (Task 2); `EVENTS`, `MAX_CHUNK_BYTES`, `roomTopic`, `interactTopic`, `ElementsPayload` (Task 1); `SyncElement` (Task 1)
- Produces:
  - `type PresenceCounts = { editors: number; viewers: number }`
  - `countPresence(state: Record<string, Array<{ role?: unknown }>>, selfKey: string): PresenceCounts`
  - `type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline"`
  - `type RoomRole = "editor" | "viewer"`
  - `type RoomChannelHandlers = { onElements(elements: SyncElement[]): void; onSyncRequest(): void; onStatus(status: ConnectionStatus): void; onPresence(counts: PresenceCounts): void; onSubscribed(): void }`
  - `type RoomConnection = { sendElements(kind: "elements" | "scene", elements: readonly SyncElement[]): Promise<boolean>; requestSync(): void; close(): void }`
  - `openRoomConnection(supabase: SupabaseClient, options: { roomId: string; clientId: string; role: RoomRole }, handlers: RoomChannelHandlers): RoomConnection`

- [ ] **Step 1: Write the failing test `lib/realtime/presence.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { countPresence } from "./presence";

describe("countPresence", () => {
  it("counts other editors and viewers, excluding self", () => {
    const state = {
      me: [{ role: "editor" }],
      v1: [{ role: "viewer" }],
      v2: [{ role: "viewer" }],
      tab2: [{ role: "editor" }],
    };
    expect(countPresence(state, "me")).toEqual({ editors: 1, viewers: 2 });
  });

  it("counts a key once even with several presence entries", () => {
    expect(countPresence({ v1: [{ role: "viewer" }, { role: "viewer" }] }, "me")).toEqual({ editors: 0, viewers: 1 });
  });

  it("ignores entries without a known role", () => {
    expect(countPresence({ x: [{ role: "admin" }], y: [{}] }, "me")).toEqual({ editors: 0, viewers: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/realtime/presence.test.ts`
Expected: FAIL — cannot resolve `./presence`.

- [ ] **Step 3: Implement `lib/realtime/presence.ts`**

```ts
export type PresenceCounts = { editors: number; viewers: number };

// Presence is keyed by clientId; each key may hold several entries (e.g. after a rejoin).
export function countPresence(state: Record<string, Array<{ role?: unknown }>>, selfKey: string): PresenceCounts {
  const counts: PresenceCounts = { editors: 0, viewers: 0 };
  for (const [key, entries] of Object.entries(state)) {
    if (key === selfKey) continue;
    const role = entries[0]?.role;
    if (role === "editor") counts.editors += 1;
    else if (role === "viewer") counts.viewers += 1;
  }
  return counts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/realtime/presence.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `lib/realtime/roomChannel.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { byteSize, chunkBySize } from "@/lib/sync/chunk";
import { EVENTS, MAX_CHUNK_BYTES, interactTopic, roomTopic, type ElementsPayload } from "@/lib/sync/messages";
import type { SyncElement } from "@/lib/sync/types";
import { countPresence, type PresenceCounts } from "./presence";

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";
export type RoomRole = "editor" | "viewer";

export type RoomChannelHandlers = {
  onElements(elements: SyncElement[]): void;
  onSyncRequest(): void;
  onStatus(status: ConnectionStatus): void;
  onPresence(counts: PresenceCounts): void;
  onSubscribed(): void;
};

export type RoomConnection = {
  sendElements(kind: "elements" | "scene", elements: readonly SyncElement[]): Promise<boolean>;
  requestSync(): void;
  close(): void;
};

export function openRoomConnection(
  supabase: SupabaseClient,
  { roomId, clientId, role }: { roomId: string; clientId: string; role: RoomRole },
  handlers: RoomChannelHandlers,
): RoomConnection {
  let closed = false;
  let online = navigator.onLine;
  let channelStatus: Exclude<ConnectionStatus, "offline"> = "connecting";
  const emitStatus = () => handlers.onStatus(online ? channelStatus : "offline");

  const room = supabase.channel(roomTopic(roomId), { config: { private: true, broadcast: { self: false } } });
  const interact = supabase.channel(interactTopic(roomId), {
    config: { private: true, broadcast: { self: false }, presence: { key: clientId } },
  });

  const receive = (payload: ElementsPayload | undefined) => {
    if (closed || !payload || payload.from === clientId || !Array.isArray(payload.elements)) return;
    handlers.onElements(payload.elements);
  };

  room
    .on("broadcast", { event: EVENTS.elements }, ({ payload }) => receive(payload as ElementsPayload))
    .on("broadcast", { event: EVENTS.scene }, ({ payload }) => receive(payload as ElementsPayload))
    .subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        channelStatus = "live";
        emitStatus();
        handlers.onSubscribed();
      } else {
        channelStatus = "reconnecting";
        emitStatus();
      }
    });

  interact
    .on("broadcast", { event: EVENTS.syncRequest }, ({ payload }) => {
      if (!closed && (payload as { from?: string } | undefined)?.from !== clientId) handlers.onSyncRequest();
    })
    .on("presence", { event: "sync" }, () => {
      if (!closed) handlers.onPresence(countPresence(interact.presenceState(), clientId));
    })
    .subscribe((status) => {
      // Track once per (re)subscribe; free tier allows 5 presence calls per 30 s per client.
      if (!closed && status === "SUBSCRIBED") void interact.track({ role });
    });

  const onOnline = () => { online = true; emitStatus(); };
  const onOffline = () => { online = false; emitStatus(); };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  emitStatus();

  return {
    async sendElements(kind, elements) {
      let ok = true;
      for (const chunk of chunkBySize(elements, MAX_CHUNK_BYTES)) {
        if (chunk.length === 1 && byteSize(chunk) > MAX_CHUNK_BYTES) {
          console.warn("PentoLive: element exceeds broadcast size limit", chunk[0].id);
        }
        const payload: ElementsPayload = { from: clientId, elements: chunk };
        const result = await room.send({ type: "broadcast", event: EVENTS[kind], payload });
        if (result !== "ok") ok = false;
      }
      return ok;
    },
    requestSync() {
      void interact.send({ type: "broadcast", event: EVENTS.syncRequest, payload: { from: clientId } });
    },
    close() {
      closed = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      void supabase.removeChannel(room);
      void supabase.removeChannel(interact);
    },
  };
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/realtime/presence.ts lib/realtime/presence.test.ts lib/realtime/roomChannel.ts
git commit -m "feat(realtime): add room connection with interact channel and presence"
```

---

### Task 9: Status bar and share dialog

**Files:**
- Modify: `package.json` (add `qrcode`, `@types/qrcode`)
- Create: `lib/ui/statusLabels.ts`
- Test: `lib/ui/statusLabels.test.ts`
- Create: `components/StatusBar.tsx`
- Create: `components/ShareDialog.tsx`
- Modify: `app/globals.css` (append styles)

**Interfaces:**
- Consumes: `ConnectionStatus`, `RoomRole` (Task 8); `PresenceCounts` (Task 8); `SaveState` (Task 5)
- Produces:
  - `connectionLabel(status: ConnectionStatus | "local"): string`
  - `presenceLabel(role: RoomRole, counts: PresenceCounts): string`
  - `saveLabel(state: SaveState): string`
  - `<StatusBar role status presence saveState onShare? />` with props `{ role: RoomRole; status: ConnectionStatus | "local"; presence: PresenceCounts; saveState: SaveState | null; onShare?: () => void }`
  - `<ShareDialog editorUrl viewerUrl onClose />` with props `{ editorUrl: string; viewerUrl: string; onClose: () => void }`

- [ ] **Step 1: Install QR dependency**

Run:
```bash
npm install qrcode@^1.5.4
npm install -D @types/qrcode@^1.5.6
```

- [ ] **Step 2: Write the failing test `lib/ui/statusLabels.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { connectionLabel, presenceLabel, saveLabel } from "./statusLabels";

describe("status labels", () => {
  it("labels connection states", () => {
    expect(connectionLabel("live")).toBe("LIVE");
    expect(connectionLabel("reconnecting")).toBe("Reconnecting…");
    expect(connectionLabel("offline")).toBe("Offline");
    expect(connectionLabel("connecting")).toBe("Connecting…");
    expect(connectionLabel("local")).toBe("Local prototype");
  });

  it("shows watching count to the editor", () => {
    expect(presenceLabel("editor", { editors: 0, viewers: 2 })).toBe("👁 2 watching");
  });

  it("shows candidate presence to the viewer", () => {
    expect(presenceLabel("viewer", { editors: 1, viewers: 0 })).toBe("Candidate online");
    expect(presenceLabel("viewer", { editors: 0, viewers: 3 })).toBe("Candidate offline");
  });

  it("labels save states", () => {
    expect(saveLabel("saved")).toBe("Saved");
    expect(saveLabel("saving")).toBe("Saving…");
    expect(saveLabel("retrying")).toBe("Not saved — retrying");
    expect(saveLabel("failed")).toBe("Too large to save — kept on this device");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/ui/statusLabels.test.ts`
Expected: FAIL — cannot resolve `./statusLabels`.

- [ ] **Step 4: Implement `lib/ui/statusLabels.ts`**

```ts
import type { PresenceCounts } from "@/lib/realtime/presence";
import type { ConnectionStatus, RoomRole } from "@/lib/realtime/roomChannel";
import type { SaveState } from "@/lib/sync/saver";

const CONNECTION: Record<ConnectionStatus | "local", string> = {
  connecting: "Connecting…",
  live: "LIVE",
  reconnecting: "Reconnecting…",
  offline: "Offline",
  local: "Local prototype",
};

const SAVE: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  retrying: "Not saved — retrying",
  failed: "Too large to save — kept on this device",
};

export const connectionLabel = (status: ConnectionStatus | "local") => CONNECTION[status];
export const saveLabel = (state: SaveState) => SAVE[state];

export function presenceLabel(role: RoomRole, counts: PresenceCounts) {
  if (role === "editor") return `👁 ${counts.viewers} watching`;
  return counts.editors > 0 ? "Candidate online" : "Candidate offline";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/ui/statusLabels.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Create `components/StatusBar.tsx`**

```tsx
import type { PresenceCounts } from "@/lib/realtime/presence";
import type { ConnectionStatus, RoomRole } from "@/lib/realtime/roomChannel";
import type { SaveState } from "@/lib/sync/saver";
import { connectionLabel, presenceLabel, saveLabel } from "@/lib/ui/statusLabels";

type StatusBarProps = {
  role: RoomRole;
  status: ConnectionStatus | "local";
  presence: PresenceCounts;
  saveState: SaveState | null;
  onShare?: () => void;
};

export default function StatusBar({ role, status, presence, saveState, onShare }: StatusBarProps) {
  const warn = status === "offline" || status === "reconnecting";
  return <header className="topbar">
    <span className="brand">PentoLive</span>
    <span className={`status ${warn ? "offline" : ""}`} role="status">{connectionLabel(status)}</span>
    {status !== "local" && <span className="presence">{presenceLabel(role, presence)}</span>}
    {saveState && <span className={`save ${saveState === "retrying" || saveState === "failed" ? "warn" : ""}`}>{saveLabel(saveState)}</span>}
    {onShare && <button className="copy" onClick={onShare}>Share</button>}
  </header>;
}
```

- [ ] **Step 7: Create `components/ShareDialog.tsx`**

```tsx
"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

type ShareDialogProps = { editorUrl: string; viewerUrl: string; onClose: () => void };

export default function ShareDialog({ editorUrl, viewerUrl, onClose }: ShareDialogProps) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(editorUrl, { margin: 1, width: 240 }).then((url) => { if (active) setQr(url); }, () => {});
    return () => { active = false; };
  }, [editorUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyViewer() {
    await navigator.clipboard.writeText(viewerUrl);
    setCopied(true);
  }

  return <div className="share-backdrop" onClick={onClose}>
    <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(event) => event.stopPropagation()}>
      <h2 id="share-title">Share this whiteboard</h2>
      <div className="share-block">
        <strong>Open on your tablet</strong>
        {qr ? <img className="share-qr" src={qr} alt="QR code for the editor link" width={240} height={240} /> : <div className="share-qr" />}
        <p className="muted">Scan with your tablet — don&apos;t share this one. It lets anyone edit.</p>
      </div>
      <div className="share-block">
        <strong>Interviewer link (view only)</strong>
        <input className="share-link" readOnly value={viewerUrl} onFocus={(event) => event.currentTarget.select()} />
        <button className="primary" onClick={copyViewer}>{copied ? "Copied" : "Copy viewer link"}</button>
      </div>
      <button className="copy share-close" onClick={onClose}>Close</button>
    </section>
  </div>;
}
```

- [ ] **Step 8: Append styles to `app/globals.css`**

```css
.presence { color: #b7bdd0; font-size: .85rem; }
.save { color: #8f98b2; font-size: .8rem; }
.save.warn { color: #f6c76c; }
.share-backdrop { align-items: center; background: rgba(5, 8, 18, .72); display: flex; inset: 0; justify-content: center; padding: 16px; position: fixed; z-index: 50; }
.share-dialog { background: #101526; border: 1px solid #2a3552; border-radius: 16px; display: grid; gap: 18px; max-height: 100%; overflow: auto; padding: 22px; width: min(420px, 100%); }
.share-dialog h2 { margin: 0; }
.share-block { display: grid; gap: 8px; }
.share-block .primary { margin-top: 0; }
.share-qr { background: #fff; border-radius: 12px; height: 240px; justify-self: center; width: 240px; }
.share-link { background: #0b0f1c; border: 1px solid #35405e; border-radius: 8px; color: #f7f8fc; font: inherit; font-size: .8rem; padding: 10px; width: 100%; }
.share-close { justify-self: end; }
.link-error { align-content: center; display: grid; gap: 12px; justify-items: start; min-height: 100vh; margin: 0 auto; max-width: 520px; padding: 24px; }
@media (max-width: 640px) { .presence, .save { font-size: .75rem; } }
```

- [ ] **Step 9: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add package.json package-lock.json lib/ui/statusLabels.ts lib/ui/statusLabels.test.ts components/StatusBar.tsx components/ShareDialog.tsx app/globals.css
git commit -m "feat(ui): add status bar and QR share dialog"
```

---

### Task 10: Rewrite Board to use the sync modules

**Files:**
- Modify: `components/Board.tsx` (full replacement below)

**Interfaces:**
- Consumes: everything from Tasks 1–9:
  - `collectChanged`, `markSent`, `unmarkSent` (Task 1); `SYNC_INTERVAL_MS`, `SAVE_IDLE_MS`, `SAVE_MAX_WAIT_MS`, `SYNC_REPLY_MIN_GAP_MS` (Task 1)
  - `createPendingSet` (Task 2); `mergeByVersion` (Task 3); `createFlusher` (Task 4); `createSaver`, `SaveState` (Task 5)
  - `joinRoom`, `saveSnapshot`, `Scene` (Task 6)
  - `openRoomConnection`, `ConnectionStatus`, `RoomConnection`, `PresenceCounts` (Task 8)
  - `StatusBar`, `ShareDialog` (Task 9)
  - existing `ensureAnonymousSession`, `getSupabase` (`lib/supabase.ts`), `localRoomKey`, `makeCapability` (`lib/room.ts`)
- Produces: default export `Board({ roomId, role, token, viewerToken, local })` — same props as today, so `app/room/[roomId]/page.tsx` is unchanged.

- [ ] **Step 1: Replace `components/Board.tsx`**

```tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import ShareDialog from "@/components/ShareDialog";
import StatusBar from "@/components/StatusBar";
import { localRoomKey, makeCapability } from "@/lib/room";
import { joinRoom, saveSnapshot, type Scene } from "@/lib/rooms/api";
import type { PresenceCounts } from "@/lib/realtime/presence";
import { openRoomConnection, type ConnectionStatus, type RoomConnection } from "@/lib/realtime/roomChannel";
import { ensureAnonymousSession, getSupabase } from "@/lib/supabase";
import { collectChanged, markSent, unmarkSent } from "@/lib/sync/diff";
import { mergeByVersion } from "@/lib/sync/merge";
import { SAVE_IDLE_MS, SAVE_MAX_WAIT_MS, SYNC_INTERVAL_MS, SYNC_REPLY_MIN_GAP_MS } from "@/lib/sync/messages";
import { createPendingSet } from "@/lib/sync/pending";
import { createSaver, type SaveState, type Saver } from "@/lib/sync/saver";
import { createFlusher, type Flusher } from "@/lib/sync/throttle";
import type { SyncElement } from "@/lib/sync/types";

const Excalidraw = dynamic(() => import("@excalidraw/excalidraw").then((module) => module.Excalidraw), { ssr: false });

type Role = "editor" | "viewer";
type BoardProps = { roomId: string; role: Role; token: string; viewerToken: string; local: boolean };
// CaptureUpdateAction.NEVER — inlined so this file never imports the Excalidraw runtime during SSR.
const NEVER = "NEVER" as const;

const sceneOf = (api: ExcalidrawImperativeAPI): Scene => ({
  elements: api.getSceneElementsIncludingDeleted() as unknown as SyncElement[],
  appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor },
});

// Elements the local user is mid-gesture on must not be overwritten by remote updates.
function protectedIds(api: ExcalidrawImperativeAPI) {
  const state = api.getAppState();
  const ids = new Set<string>();
  for (const element of [state.newElement, state.editingTextElement, state.resizingElement]) if (element) ids.add(element.id);
  if (state.selectedElementsAreBeingDragged) for (const id of Object.keys(state.selectedElementIds)) ids.add(id);
  return ids;
}

function readBackup(roomId: string): Scene | null {
  try {
    const raw = window.localStorage.getItem(localRoomKey(roomId));
    return raw ? (JSON.parse(raw) as Scene) : null;
  } catch {
    return null;
  }
}

function writeBackup(roomId: string, scene: Scene) {
  try { window.localStorage.setItem(localRoomKey(roomId), JSON.stringify(scene)); } catch { /* storage full or blocked */ }
}

export default function Board({ roomId, role, token, viewerToken, local }: BoardProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const clientId = useMemo(() => makeCapability(), []);
  const connectionRef = useRef<RoomConnection | null>(null);
  const sentRef = useRef(new Map<string, number>());
  const pendingRef = useRef(createPendingSet<SyncElement>());
  const unsavedRef = useRef(createPendingSet<SyncElement>());
  const flusherRef = useRef<Flusher | null>(null);
  const saverRef = useRef<Saver | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | "local">(local ? "local" : "connecting");
  const [presence, setPresence] = useState<PresenceCounts>({ editors: 0, viewers: 0 });
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [share, setShare] = useState<{ editorUrl: string; viewerUrl: string } | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let connection: RoomConnection | null = null;
    let lastSceneReply = 0;
    const backup = readBackup(roomId);

    if (local) {
      if (backup) api.updateScene({ elements: backup.elements as never, appState: backup.appState, captureUpdate: NEVER });
      setReady(true);
      return;
    }

    const sendFullScene = () => {
      const elements = api.getSceneElementsIncludingDeleted() as unknown as SyncElement[];
      markSent(sentRef.current, elements);
      void connectionRef.current?.sendElements("scene", elements);
    };

    const flusher = createFlusher({
      intervalMs: SYNC_INTERVAL_MS,
      flush: () => {
        const batch = pendingRef.current.take();
        if (batch.length === 0) return;
        writeBackup(roomId, sceneOf(api));
        const current = connectionRef.current;
        // Not connected yet: keep the batch; the full-scene send on subscribe covers it.
        if (!current) { pendingRef.current.restore(batch); return; }
        markSent(sentRef.current, batch);
        void current.sendElements("elements", batch).then((ok) => {
          if (ok) return;
          unmarkSent(sentRef.current, batch);
          pendingRef.current.restore(batch);
        });
      },
    });

    async function persist(keepalive: boolean) {
      const supabase = getSupabase();
      if (!supabase || !api) return;
      const events = unsavedRef.current.take();
      try {
        await saveSnapshot(supabase, { roomId, token, scene: sceneOf(api), events, keepalive });
      } catch (error) {
        unsavedRef.current.restore(events);
        throw error;
      }
    }

    const saver = role === "editor"
      ? createSaver({ idleMs: SAVE_IDLE_MS, maxWaitMs: SAVE_MAX_WAIT_MS, onState: setSaveState, save: () => persist(false) })
      : null;
    flusherRef.current = flusher;
    saverRef.current = saver;

    const applyRemote = (remote: SyncElement[]) => {
      const localElements = api.getSceneElementsIncludingDeleted() as unknown as SyncElement[];
      const merged = mergeByVersion(localElements, remote, protectedIds(api));
      api.updateScene({ elements: merged as never, captureUpdate: NEVER });
      // Mark as sent so a second editor tab never echoes these back.
      if (role === "editor") markSent(sentRef.current, remote);
    };

    async function start() {
      const supabase = await ensureAnonymousSession().catch(() => null);
      if (cancelled) return;
      if (!supabase) { setStatus("offline"); setReady(true); return; }
      const joined = await joinRoom(supabase, { roomId, token, role });
      if (cancelled) return;
      if (!joined.ok && joined.reason === "invalid") { setLinkError(true); return; }

      const base = joined.ok ? joined.snapshot?.elements ?? [] : [];
      const elements = role === "editor" && backup ? mergeByVersion(base, backup.elements) : base;
      // Elements already in the DB snapshot are not new changes; only backup-only edits get re-sent and re-saved.
      markSent(sentRef.current, base);
      api!.updateScene({
        elements: elements as never,
        appState: (joined.ok ? joined.snapshot?.appState : undefined) ?? backup?.appState,
        captureUpdate: NEVER,
      });
      setReady(true);
      if (!joined.ok) { setStatus("offline"); return; }

      connection = openRoomConnection(supabase, { roomId, clientId, role }, {
        onElements: applyRemote,
        onSyncRequest: () => {
          if (role !== "editor") return;
          const now = Date.now();
          if (now - lastSceneReply < SYNC_REPLY_MIN_GAP_MS) return;
          lastSceneReply = now;
          sendFullScene();
        },
        onStatus: setStatus,
        onPresence: setPresence,
        onSubscribed: () => {
          connection?.requestSync();
          if (role === "editor") sendFullScene();
        },
      });
      connectionRef.current = connection;
    }

    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      flusher.flushNow();
      void saver?.flushNow();
    };
    const onPageHide = () => {
      flusher.flushNow();
      if (role === "editor" && unsavedRef.current.size > 0) void persist(true).catch(() => {});
    };

    void start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      flusher.cancel();
      saver?.dispose();
      connection?.close();
      connectionRef.current = null;
      flusherRef.current = null;
      saverRef.current = null;
    };
  }, [api, clientId, local, role, roomId, token]);

  const onChange = useCallback((elements: readonly unknown[], appState: { viewBackgroundColor: string }) => {
    if (role === "viewer") return;
    if (local) {
      writeBackup(roomId, { elements: elements as SyncElement[], appState: { viewBackgroundColor: appState.viewBackgroundColor } });
      return;
    }
    const changed = collectChanged(elements as readonly SyncElement[], sentRef.current);
    if (changed.length === 0) return;
    pendingRef.current.add(changed);
    unsavedRef.current.add(changed);
    flusherRef.current?.schedule();
    saverRef.current?.notifyChange();
  }, [local, role, roomId]);

  const openShare = () => {
    const origin = window.location.origin;
    setShare({
      editorUrl: window.location.href,
      viewerUrl: `${origin}/room/${roomId}?role=viewer&token=${viewerToken}${local ? "&local=1" : ""}`,
    });
  };

  if (linkError) {
    return <main className="link-error">
      <h1>This board link is invalid or expired</h1>
      <p className="muted">Ask for a fresh link, or create a new board.</p>
      <Link className="primary" href="/">Go home</Link>
    </main>;
  }

  return <main className="room">
    <StatusBar role={role} status={status} presence={presence} saveState={saveState} onShare={role === "editor" ? openShare : undefined} />
    <section className="canvas">
      {!ready && <div className="loading">Opening board…</div>}
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={onChange}
        viewModeEnabled={role === "viewer"}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
      />
    </section>
    {share && <ShareDialog editorUrl={share.editorUrl} viewerUrl={share.viewerUrl} onClose={() => setShare(null)} />}
  </main>;
}
```

- [ ] **Step 2: Typecheck, lint, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: no type errors, all Vitest suites pass, `next build` succeeds.
Then run `npm run lint`. The repo currently has no ESLint config file; if lint fails only for that reason, record it in the task report and move on (adding a lint config is out of scope). Fix any real lint errors in files this plan touched.

If `onChange`'s parameter types do not match Excalidraw's `onChange` prop, change the signature to `(elements: readonly OrderedExcalidrawElement[], appState: AppState)` importing those as **types** from `@excalidraw/excalidraw/element/types` and `@excalidraw/excalidraw/types`, keeping the body identical.

- [ ] **Step 3: Local smoke test**

Run: `npm run dev`, open `http://localhost:3000`, click **Create a whiteboard**, then open the copied viewer link (via **Share → Copy viewer link**) in a second browser profile.
Expected: editor shows `LIVE` and `👁 1 watching`; drawing a stroke appears in the viewer while it is being drawn; viewer shows `Candidate online`; editor save state cycles `Saving…` → `Saved`.

- [ ] **Step 4: Commit**

```bash
git add components/Board.tsx
git commit -m "feat(board): delta sync, late join, presence, backups, and share dialog"
```

---

### Task 11: Keep-alive cron and docs

**Files:**
- Create: `app/api/cron/keepalive/route.ts`
- Create: `vercel.json`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: DB function `public.keepalive()` (Task 7)
- Produces: `GET /api/cron/keepalive` → 200 `{ ok: true }` | 401 | 500

- [ ] **Step 1: Create `app/api/cron/keepalive/route.ts`**

```ts
import { createClient } from "@supabase/supabase-js";

// Called once a day by Vercel Cron so the free-tier Supabase project never pauses.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  const { error } = await createClient(url, key).rpc("keepalive");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Create `vercel.json`**

```json
{
  "crons": [{ "path": "/api/cron/keepalive", "schedule": "0 6 * * *" }]
}
```

- [ ] **Step 3: Add to `.env.example`**

Append:
```text
# Random string; Vercel Cron sends it as "Authorization: Bearer <value>" to /api/cron/keepalive.
CRON_SECRET=
```

- [ ] **Step 4: Update `README.md`**

In "Connect Supabase", replace step 3 with:
```markdown
3. Open the SQL Editor and run, in order, every file in [`supabase/migrations`](supabase/migrations).
```
In "Deploy to Vercel" step 3, add `CRON_SECRET` to the env var list with the note: "any long random string; enables the daily keep-alive that stops the free-tier Supabase project from pausing."
Replace the last line of "Security model" (`For now, rooms expire after 30 days...`) with:
```markdown
- Viewers may send only on the `room:{id}:interact` channel (sync requests and presence); drawing stays editor-only.
- Boards created while signed in never expire. Anonymous boards expire after 30 days.
- Reopening a board from the dashboard rotates the editor link but keeps the viewer link, so links you already shared keep working. Rescan the QR on your tablet after reopening.

Do not share editor links with interviewers.
```

- [ ] **Step 5: Verify the route locally**

Run `npm run dev` with `CRON_SECRET=test` in `.env.local`, then:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/cron/keepalive
curl -s -H "Authorization: Bearer test" http://localhost:3000/api/cron/keepalive
```
Expected: `401`, then `{"ok":true}` (requires Task 7 migration applied).

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/keepalive/route.ts vercel.json .env.example README.md
git commit -m "feat(ops): daily keep-alive cron for free-tier Supabase"
```

---

### Task 12: Manual acceptance on real devices

**Files:** none (verification only)

**Interfaces:**
- Consumes: the whole feature deployed (Vercel preview or production with `CRON_SECRET` set, Task 7 migration applied, function deployed)

- [ ] **Step 1: Run the spec's acceptance script** (spec §5, Samsung tablet + S Pen and laptop Chrome)

1. Laptop: sign in, create a board, open **Share**, scan the QR with the tablet.
2. Tablet: draw 50 strokes; a second browser profile on the laptop, opened via the viewer link, shows pen motion live.
3. Open a third viewer late; it shows all 50 strokes within 3 s; editor shows `👁 2 watching`.
4. Disable tablet Wi-Fi 15 s and keep drawing; badge shows `Offline`/`Reconnecting…`. Re-enable; viewers catch up within 5 s.
5. Refresh the viewer and the tablet; the canvas is intact.
6. Close the board; reopen from the dashboard; the previously copied viewer link still works.
7. In Supabase: `select count(*) from room_events where room_id = '<id>';` returns > 0; Realtime usage for the session is < 100k messages.
8. `curl -H "Authorization: Bearer $CRON_SECRET" https://<deployment>/api/cron/keepalive` returns `{"ok":true}`.

- [ ] **Step 2: Record results**

Note any failed step with what you saw; failures go back to the owning task (sync → Tasks 1–5/10, server → Task 7, UI → Task 9).
