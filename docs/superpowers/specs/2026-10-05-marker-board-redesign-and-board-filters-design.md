# Sub-project — Marker Board Redesign, Board Details and Dashboard Filters

**Date:** 2026-10-05
**Status:** Draft for review
**Branch:** `feat/marker-board-redesign` (from `main`)
**Source:** `Pentolife Features_extended.docx`, items 1, 2 and 4. Item 3 (algorithm visualizer) gets its own spec.

## 1. Intent

PentoLive should feel like a real product built around the whiteboard. The whole UI moves to the "Marker Board" direction (option B of the style study at https://claude.ai/artifact/Lsiz57oU5crkGETP8Ghv1b): hand-lettered headings, ink outlines, offset sketch shadows, a highlighter-yellow accent and ruled paper. The owner can also name a board and tag it with the interview's **role** and **company** when creating it, and can filter the dashboard by date range, role and company.

### Success criteria

1. Every existing screen (landing, the four auth pages, dashboard, username notice, room top bar, share dialog, link-error page) uses the Marker Board style. The Excalidraw canvas looks and behaves exactly as before.
2. "New board" opens a dialog with **Name**, **Role** and **Company**. All three are optional; an empty name becomes "Untitled whiteboard".
3. Role and Company suggest values already used on the owner's boards while typing, with a board count per value. A new value can always be typed.
4. The owner can edit the name, role and company of any existing board from the dashboard.
5. The dashboard can be sorted (newest, oldest, recently edited, name A–Z) and filtered by a creation-date range, a role and a company, in any combination. It shows "N of M boards" and has a Clear action.
6. Filters and sort survive a page refresh (they live in the URL).
7. Role and company values that differ only in case or spacing ("Razorpay", " razorpay ") are treated as the same value in suggestions and filters.
8. All behaviour from earlier specs (joining, saving, sync, presence, auth) is unchanged. `npm test`, `npx tsc --noEmit` and `npm run build` are green.

### Non-goals

- Dark mode. The app has none today, and the paper look is light by nature.
- Restyling the Excalidraw canvas, its toolbar or its fonts.
- A managed list of roles or companies, or deleting tags across boards.
- Server-side filtering or pagination. One owner's board count is small; filtering runs in the browser.
- The algorithm visualizer (separate spec).

## 2. Delivery

Two PRs into `main`, both from this spec:

1. **PR 1, redesign.** Visual only: tokens, fonts, CSS and markup of existing screens. No data or behaviour changes.
2. **PR 2, board details and filters.** Migration, Edge Function changes, New board / Edit details dialog, filter bar.

## 3. Visual system (PR 1)

### Fonts

Loaded with `next/font/google` in `app/layout.tsx`, exposed as CSS variables. They replace Inter.

| Role | Face | Variable |
|---|---|---|
| Display: headings, logo wordmark, dialog titles | Kalam 400/700 | `--font-display` |
| Body: text, buttons, fields | Nunito 400/600/700/800 | `--font-sans` |
| Data: timestamps, counts, links in the share dialog | JetBrains Mono 400/500 | `--font-mono` |

### Tokens (`app/globals.css`, `:root`)

| Token | Value | Use |
|---|---|---|
| `--ink` | `#1e1b2e` | text, borders, shadows |
| `--paper` | `#fffdf6` | page ground |
| `--rule` | `#e9eef7` | ruled-paper lines |
| `--surface` | `#ffffff` | cards, dialogs, fields |
| `--muted` | `#6f6a80` | secondary text |
| `--line` | `#e6e2d6` | soft dividers inside cards |
| `--accent` | `#ffcf3f` | highlighter yellow: primary buttons, focus, live dot |
| `--accent-soft` | `rgba(255, 207, 63, .28)` | focus rings, selected filter pills, highlighter swipe |
| `--accent-text` | `#6b4e00` | text on soft accent |
| `--mint-bg` / `--mint-fg` | `#d9f2e4` / `#145c38` | role chips; success text |
| `--lilac-bg` / `--lilac-fg` | `#e3e0ff` / `#3a2f9e` | company chips |
| `--warning` | `#b45309` | offline / save warnings (unchanged meaning) |
| `--danger` | `#c2410c` | form errors |
| `--border-w` | `2px` | ink outline width |
| `--shadow` | `4px 4px 0 var(--ink)` | cards and dialogs |
| `--shadow-sm` | `2px 2px 0 var(--ink)` | buttons |
| `--radius-card` | `14px 18px 12px 16px` | slightly uneven "hand-cut" corners |
| `--radius` | `10px` | buttons, fields, chips use `999px` |

Rules:

- Primary buttons: yellow fill, ink border, `--shadow-sm`. Pressing shifts the button 2px down-right and removes the shadow, like pressing a sticker.
- Secondary buttons: white fill, ink border, no shadow until hover.
- Focus: `outline: 3px solid var(--ink)` plus `--accent-soft` ring; never removed.
- Touch targets are at least 44px tall on every interactive element.
- Cards may tilt by at most 0.4°. Inputs, buttons and anything tappable inside a form are never rotated, so taps land where they look.
- Hover wiggle and the press shift are disabled under `prefers-reduced-motion: reduce`. The live-dot pulse already is.
- Ruled-paper ground (`.paper`) replaces the dot grid on landing, auth pages and dashboard. The room page has no paper ground (the canvas fills it).

### Logo

`LogoMark` keeps the P pentomino, drawn with an ink stroke and the "live" tile filled yellow. The wordmark uses Kalam.

## 4. Screens (PR 1)

| Screen | Treatment |
|---|---|
| Landing | Ruled paper. Kalam headline with a yellow highlighter swipe behind "on paper". The live pill becomes an ink-outlined sticker. Existing doodles redrawn in ink with the yellow dot. |
| `/signup`, `/signin`, `/forgot-password`, `/reset-password` | `AuthCard` becomes an "index card": white, ink border, `--shadow`, uneven corners, Kalam title. Fields use ink borders; errors in `--danger`. |
| Dashboard | Header with Kalam wordmark, **New board** primary button, `@username` menu as an outlined sticker. "Boards" in Kalam with a mono count. Each board is its own ink-outlined card (gap between cards) with title, mono timestamp, and role/company chips. Empty state: dashed ink border and a small doodle. |
| Username notice | Index card style, yellow highlighter on "Choose a username". |
| Room top bar (`StatusBar`) | White bar, 2px ink bottom border, at most 52px tall so the canvas keeps its space. Status, presence and save text in Nunito; warnings in `--warning`. Share is a secondary sticker button. |
| Share dialog | Index card dialog over a translucent ink backdrop. Viewer link in mono. |
| Link-error page | Index card centred on ruled paper. |

All copy stays as it is today. Status copy stays in `lib/ui/statusLabels.ts`, unchanged.

## 5. Board details (PR 2)

### Data

Migration `supabase/migrations/202610050004_board_details.sql`, safe to re-run:

```sql
alter table public.rooms add column if not exists role text;
alter table public.rooms add column if not exists company text;
create index if not exists rooms_owner_created_idx on public.rooms (owner_id, created_at desc);
```

`title` already exists (`not null default 'Untitled whiteboard'`). No new grants: owners already `select` their rooms; all writes stay in the Edge Function.

### Validation (shared)

`supabase/functions/_shared/boardDetails.ts`, re-exported to the app by `lib/rooms/details.ts` (same pattern as `username.ts`):

- `normalizeDetails(input)` returns `{ title, role, company }`:
  - Each value is trimmed and has runs of whitespace collapsed to one space.
  - Empty title becomes `"Untitled whiteboard"`; empty role or company becomes `null`.
  - Limits: title 80 characters, role 60, company 60. Longer values are rejected, not truncated.
  - Control characters are rejected.
- Returns `{ ok: false, field, message }` on failure, so the dialog can show the message under the right field.

### Edge Function (`supabase/functions/rooms/index.ts`)

- `create` accepts optional `title`, `role`, `company`, runs `normalizeDetails`, and stores them. Invalid input returns 400 with the field. Calls without these fields behave as today.
- New action `update-details` with `{ roomId, title, role, company }`:
  - Only for a signed-in, non-anonymous user who is the room's `owner_id`; otherwise 403 / 404 as `owner-access` does.
  - Updates only `title`, `role`, `company`. It does **not** change `updated_at`, so "recently edited" keeps meaning drawing activity.
  - Returns the normalized values.

Deploy order: apply the migration, then deploy the function immediately.

### New board / Edit details dialog

One component, `components/BoardDetailsDialog.tsx`, used in two modes:

- **Create:** opened by **New board**. Submit calls `create` with the details, then opens the board as today.
- **Edit:** opened from an **Edit details** item on each board card's menu. Prefilled. Submit calls `update-details` and updates the card in place.

Behaviour:

- Fields: Name, Role, Company. Name is focused on open. Esc and the backdrop close the dialog; focus returns to the button that opened it.
- Role and Company use a custom combobox (`components/TagInput.tsx`), not `<datalist>`, so it behaves the same on Android and iPad.
  - Suggestions are values from the owner's loaded boards, matched by prefix first, then substring, on the normalized key (see below), at most 6.
  - Each suggestion shows its board count ("Razorpay · 6 boards").
  - When the typed text matches no existing key, the last row offers it as new: `Use "Ra…"`.
  - Arrow keys move, Enter picks, Esc closes the list; ARIA `combobox`/`listbox` roles.
  - Picking a suggestion fills in the existing spelling, so values converge.
- Errors from validation or the function show under the field or as a form error. The submit button shows "Creating…" / "Saving…" while pending.

### Same-value rule

`tagKey(value) = value.trim().replace(/\s+/g, " ").toLowerCase()`. Suggestions and filters group by this key. A group's display label is its most common spelling; ties go to the most recently created board.

## 6. Dashboard filters (PR 2)

### Data loading

The dashboard query adds `created_at, role, company`: `select("id,title,role,company,created_at,updated_at")`. Filtering and sorting run in the browser on this list.

### Controls (filter bar under the "Boards" heading)

| Control | Options | URL param |
|---|---|---|
| Sort | Newest (default; by `created_at` desc), Oldest, Recently edited (`updated_at` desc), Name A–Z | `sort=newest\|oldest\|edited\|name` |
| Date range | From and To dates on **creation date**, inclusive, in the viewer's local time zone. Either may be empty. If From is after To they are swapped. | `from=YYYY-MM-DD`, `to=YYYY-MM-DD` |
| Role | Any, or one role key from the loaded boards | `role=<key>` |
| Company | Any, or one company key from the loaded boards | `company=<key>` |

- Active filters show as yellow-soft pills with an × to remove that one filter. **Clear** removes all filters and keeps the sort.
- The heading count reads "N of M" when any filter is active, else "M".
- When filters match nothing: "No boards match these filters." with a **Clear filters** button.
- Unknown or malformed URL params are ignored (treated as unset), never an error.
- Filter changes use `router.replace` so they do not fill browser history.
- The component reading `useSearchParams` sits inside a `Suspense` boundary, as App Router requires for client-side search params.

### Pure logic

`lib/dashboard/filter.ts`:

- `parseFilters(params: URLSearchParams): Filters`
- `filtersToParams(f: Filters): URLSearchParams` (omits defaults)
- `applyFilters(boards: Board[], f: Filters): Board[]` (filter, then sort; Name A–Z uses `localeCompare` with `sensitivity: "base"`)

`lib/dashboard/tags.ts`:

- `tagKey(value)`
- `tagOptions(boards, field): { key, label, count }[]`, sorted by count desc, then label
- `suggest(options, typed, limit = 6)`

## 7. Error handling

- Board list fails to load: existing "Couldn't load your boards" message; filters hidden.
- `create` fails: dialog stays open with "Couldn't create the board. Try again." Field errors from the function show under the field.
- `update-details` fails: dialog stays open with "Couldn't save the changes. Try again." The card is unchanged.
- The dialog cannot be submitted twice while pending.

## 8. Testing

- vitest:
  - `lib/dashboard/filter.test.ts`: parse/serialize round trip, malformed params, each sort, inclusive date edges at local midnight, swapped range, combined filters, boards with null role/company.
  - `lib/dashboard/tags.test.ts`: key folding, label choice and tie-break, counts, prefix-before-substring ordering, limit, "new value" case.
  - `lib/rooms/details.test.ts`: trimming, whitespace collapse, defaults, each limit, control characters.
- Manual, in the browser, at 1280px, tablet (820×1180) and phone (390px) widths: every screen in section 4, the dialog in both modes including autocomplete by keyboard and touch, every filter, refresh keeping filters.
- Live project after PR 2 deploy: `information_schema.columns` shows `role` and `company`; `supabase functions list` shows the new `rooms` version; creating and editing a board round-trips.
- Gates: `npm test`, `npx tsc --noEmit`, `npm run build`.
