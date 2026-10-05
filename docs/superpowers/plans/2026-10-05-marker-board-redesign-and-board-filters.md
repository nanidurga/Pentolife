# Marker Board Redesign, Board Details and Dashboard Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every PentoLive screen in the "Marker Board" look, then let owners name and tag boards with role and company and filter the dashboard by date range, role and company.

**Architecture:** PR 1 swaps fonts and rewrites `app/globals.css` around new tokens while keeping existing class names, plus a few markup touches. PR 2 adds two nullable columns, one shared validation module used by both the app and the `rooms` Edge Function, pure filter/tag logic in `lib/dashboard/*`, and three small dashboard components. Filters live in the URL and run in the browser.

**Tech Stack:** Next.js 16.3 App Router (client components), React, `next/font/google`, Supabase (Postgres, Edge Functions on Deno), vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-marker-board-redesign-and-board-filters-design.md`

## Global Constraints

- Excalidraw stays pinned at exactly `0.18.1`, loaded only via `next/dynamic` with `ssr: false`. Its canvas, toolbar and fonts must look exactly as before.
- Status copy in `lib/ui/statusLabels.ts` does not change. All other existing copy stays as it is unless a task says otherwise.
- Migrations are safe to re-run (`if not exists`). Apply the migration first, then deploy the `rooms` function immediately.
- The service-role key never appears in Next.js code or env vars.
- `authenticated` gets no new grants; all writes to `rooms` stay in the Edge Function.
- Limits: title 80 characters, role 60, company 60, counted in code points after trimming and collapsing whitespace. Empty title becomes `"Untitled whiteboard"`; empty role/company becomes `null`.
- `update-details` never changes `updated_at`.
- Touch targets are at least 44px tall. Forms, fields, board cards and buttons are never rotated.
- Light theme only.
- Never stage `next-env.d.ts`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Gates before calling any PR done: `npm test`, `npx tsc --noEmit`, `npm run build` all green.

## Review Focus

1. **Tapping a suggestion on a tablet.** A tap on an autocomplete row must pick it, not blur the input and close the list first. Pinned by the `onMouseDown` preventDefault in Task 8 and a touch-emulation check in Task 9 Step 7.
2. **A stale filter in the URL** (a role no board has any more, or a hand-edited link). The page must show "No boards match these filters." with Clear filters, and the Role select must still show the value. Pinned in Task 9 (`TagFilter` adds a missing option) and its Step 7 check.
3. **Every pre-existing board has `role` and `company` null and the default title.** Filters must exclude them cleanly, chips must not render empty, Edit details must prefill without crashing. Pinned by the null-tag tests in Tasks 5 and 6 and the Task 9 Step 7 check.
4. **Global CSS leaking into Excalidraw** (heading font, focus outline, button styles). Pinned by the scoped `.excalidraw` overrides in Task 1 and the canvas check in Task 2 Step 5.
5. **Esc, backdrop click or a second submit while a save is pending.** The dialog must stay open and not submit twice. Pinned by the `pending` guards in Task 8 and the Task 9 Step 7 check.

---

## PR 1: Redesign (branch `feat/marker-board-redesign`, already created; the spec is committed on it)

### Task 1: Fonts and the Marker Board stylesheet

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css` (full rewrite, same class names)

**Interfaces:**
- Produces CSS variables `--font-display`, `--font-sans`, `--font-mono` and the tokens in the stylesheet below. New classes for later tasks: `.highlight`, `.count`, `.board-time`, `.mono`, `.dialog-backdrop`, `.dialog`.

No unit test: this task is visual. It is verified by the build and by Task 2's browser pass.

- [ ] **Step 1: Swap fonts in `app/layout.tsx`**

Replace the whole file with:

```tsx
import type { Metadata } from "next";
import { JetBrains_Mono, Kalam, Nunito } from "next/font/google";
import "./globals.css";

// Kalam is not a variable font, so its weights are listed.
const display = Kalam({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-display" });
const sans = Nunito({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "PentoLive",
  description: "A live whiteboard for technical interviews",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}><body>{children}</body></html>;
}
```

- [ ] **Step 2: Replace `app/globals.css` with the Marker Board stylesheet**

```css
@import "@excalidraw/excalidraw/index.css";

/* Marker Board: ink outlines, offset sketch shadows and a highlighter accent on ruled paper. */
:root {
  color-scheme: light;
  --ink: #1e1b2e;
  --paper: #fffdf6;
  --rule: #e9eef7;
  --surface: #ffffff;
  --text: var(--ink);
  --muted: #6f6a80;
  --line: #e6e2d6;
  --accent: #ffcf3f;
  --accent-soft: rgba(255, 207, 63, .28);
  --accent-text: #6b4e00;
  --mint-bg: #d9f2e4;
  --mint-fg: #145c38;
  --lilac-bg: #e3e0ff;
  --lilac-fg: #3a2f9e;
  --success: #145c38;
  --warning: #b45309;
  --danger: #c2410c;
  --border-w: 2px;
  --shadow: 4px 4px 0 var(--ink);
  --shadow-sm: 2px 2px 0 var(--ink);
  --radius: 10px;
  --radius-card: 14px 18px 12px 16px;
  --tap: 44px;
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: var(--paper); color: var(--text); font-family: var(--font-sans), system-ui, sans-serif; font-size: 16px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
h1, h2 { font-family: var(--font-display), "Comic Sans MS", cursive; font-weight: 700; line-height: 1.15; margin: 0; text-wrap: balance; }
h1 { font-size: 34px; }
h2 { font-size: 22px; }
p { margin: 0; }
button { font: inherit; cursor: pointer; }
:focus-visible { outline: 3px solid var(--ink); outline-offset: 2px; }
/* Keep Excalidraw exactly as it was before the redesign. */
.excalidraw h1, .excalidraw h2 { font-family: inherit; line-height: inherit; text-wrap: inherit; }
.excalidraw :focus-visible { outline: 2px solid #2457e6; outline-offset: 2px; }
.muted { color: var(--muted); }
.mono { font-family: var(--font-mono), ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.blank { min-height: 100vh; }

/* Buttons and links: ink-outlined stickers. Primary is highlighter yellow and "presses" into the page. */
.button, .primary, .copy { align-items: center; background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius); color: var(--ink); display: inline-flex; font-size: 15px; font-weight: 700; gap: 6px; justify-content: center; min-height: var(--tap); padding: 0 16px; text-decoration: none; transition: transform .08s ease, box-shadow .08s ease; white-space: nowrap; }
.button:hover, .copy:hover { box-shadow: var(--shadow-sm); }
.primary { background: var(--accent); box-shadow: var(--shadow-sm); }
.primary:hover { box-shadow: 3px 3px 0 var(--ink); transform: translate(-1px, -1px); }
.button:active, .copy:active, .primary:active { box-shadow: none; transform: translate(2px, 2px); }
.button:disabled, .primary:disabled, .copy:disabled { box-shadow: none; cursor: not-allowed; opacity: .55; transform: none; }
.block { width: 100%; }
.text-link { color: var(--ink); font-weight: 700; text-decoration: underline; text-decoration-color: var(--accent); text-decoration-thickness: 3px; text-underline-offset: 3px; }
.text-link:hover { background: var(--accent-soft); }
.small { font-size: 13px; }

/* Logo, paper and highlighter */
.logo { align-items: center; color: var(--ink); display: inline-flex; font-family: var(--font-display), cursive; font-size: 22px; font-weight: 700; gap: 6px; text-decoration: none; }
.paper { background-color: var(--paper); background-image: linear-gradient(to bottom, transparent 27px, var(--rule) 27px, var(--rule) 28px); background-size: 100% 28px; }
.highlight { -webkit-box-decoration-break: clone; background: linear-gradient(transparent 55%, var(--accent) 55%, var(--accent) 92%, transparent 92%); box-decoration-break: clone; padding: 0 .12em; }
.live-dot { background: var(--accent); border: 2px solid var(--ink); border-radius: 50%; display: inline-block; flex: none; height: 10px; width: 10px; }
.pulse { animation: live-pulse 2s ease-out infinite; }
@keyframes live-pulse {
  0% { box-shadow: 0 0 0 0 rgba(255, 207, 63, .7); }
  70% { box-shadow: 0 0 0 8px rgba(255, 207, 63, 0); }
  100% { box-shadow: 0 0 0 0 rgba(255, 207, 63, 0); }
}

/* Landing */
.landing { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; min-height: 100vh; overflow: hidden; padding: 20px 24px 48px; position: relative; }
.landing-nav { margin: 0 auto; max-width: 1080px; width: 100%; }
.hero { align-content: center; display: grid; gap: 20px; justify-items: center; margin: 0 auto; max-width: 680px; min-width: 0; text-align: center; width: 100%; }
.hero h1 { font-size: clamp(40px, 7vw, 68px); line-height: 1.05; }
.hero p { font-size: 18px; max-width: 46ch; text-wrap: pretty; }
.live-pill { align-items: center; background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: 999px; box-shadow: var(--shadow-sm); display: inline-flex; font-size: 14px; font-weight: 700; gap: 8px; padding: 6px 14px 6px 10px; transform: rotate(-2deg); }
.actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 8px; }
.hero .primary, .hero .button { font-size: 16px; min-height: 48px; padding: 0 22px; }
.doodle { pointer-events: none; position: absolute; }
.doodle-ink { bottom: 12%; color: var(--ink); left: max(24px, calc(50% - 520px)); transform: rotate(-6deg); }
.doodle-tile { color: var(--ink); opacity: .14; right: max(24px, calc(50% - 500px)); top: 22%; transform: rotate(8deg); }

/* Auth: index cards (never rotated, they hold forms) */
.auth-page { display: grid; min-height: 100vh; padding: 24px 16px; place-items: center; }
.auth-card { background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius-card); box-shadow: var(--shadow); display: grid; gap: 8px; max-width: 420px; padding: 32px 28px; width: 100%; }
.auth-card h1 { margin-top: 20px; }
.auth-form { display: grid; gap: 16px; margin-top: 20px; }
.auth-footer { color: var(--muted); font-size: 14px; margin-top: 16px; }
.field { display: grid; gap: 6px; }
.field-label { align-items: baseline; display: flex; font-size: 14px; font-weight: 700; justify-content: space-between; }
.field input { background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius); color: var(--ink); font: inherit; min-height: var(--tap); padding: 0 12px; width: 100%; }
.field input:focus { box-shadow: 0 0 0 5px var(--accent-soft); }
.field input::placeholder { color: var(--muted); }
.field input[aria-invalid="true"] { border-color: var(--danger); }
.field-message { color: var(--muted); font-size: 13px; }
.field-message.success { color: var(--success); }
.field-message.danger, .form-error { color: var(--danger); }
.form-error { font-size: 14px; font-weight: 600; }

/* App shell and dashboard */
.app-shell { min-height: 100vh; }
.app-header { align-items: center; background: var(--surface); border-bottom: var(--border-w) solid var(--ink); display: flex; gap: 10px; min-height: 64px; padding: 8px max(16px, calc((100vw - 920px) / 2)); }
.spacer { flex: 1; }
.menu { position: relative; }
.menu summary { list-style: none; }
.menu summary::-webkit-details-marker { display: none; }
.menu-panel { background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius); box-shadow: var(--shadow-sm); display: grid; min-width: 180px; padding: 6px; position: absolute; right: 0; top: calc(100% + 8px); z-index: 10; }
.menu-item { background: none; border: 0; border-radius: 6px; color: var(--ink); font-size: 15px; font-weight: 600; min-height: var(--tap); padding: 0 12px; text-align: left; }
.menu-item:hover { background: var(--accent-soft); }
.dashboard { display: grid; gap: 20px; margin: 0 auto; max-width: 920px; padding: 40px 16px 64px; }
.section-head { align-items: baseline; display: flex; gap: 12px; }
.section-head h1 { font-size: 38px; }
.count { color: var(--muted); font-family: var(--font-mono), ui-monospace, monospace; font-size: 14px; font-variant-numeric: tabular-nums; }
.board-list { display: grid; gap: 12px; list-style: none; margin: 0; padding: 0; }
.board-row { align-items: center; background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius-card); color: var(--ink); display: flex; gap: 16px; justify-content: space-between; min-height: 60px; padding: 14px 18px; text-align: left; transition: transform .08s ease, box-shadow .08s ease; width: 100%; }
.board-row:hover { box-shadow: var(--shadow-sm); transform: translate(-1px, -1px); }
.board-row strong { font-size: 16px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-time { color: var(--muted); flex: none; font-family: var(--font-mono), ui-monospace, monospace; font-size: 12.5px; white-space: nowrap; }
.empty { background: var(--surface); border: var(--border-w) dashed var(--ink); border-radius: var(--radius-card); display: grid; gap: 14px; justify-items: start; padding: 32px 24px; transform: rotate(-.4deg); }
.notice { background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius-card); box-shadow: var(--shadow); display: grid; gap: 4px; padding: 22px; }
.notice .auth-form { margin-top: 12px; max-width: 360px; }

/* Room */
.room { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
.topbar { align-items: center; background: var(--surface); border-bottom: var(--border-w) solid var(--ink); display: flex; flex-wrap: wrap; font-size: 14px; gap: 16px; min-height: 52px; padding: 4px 16px; }
.brand { align-items: center; border-radius: var(--radius); color: var(--ink); display: inline-flex; font-family: var(--font-display), cursive; font-size: 19px; font-weight: 700; gap: 6px; margin: 0 -8px; min-height: var(--tap); padding: 0 8px; text-decoration: none; }
.brand:hover { background: var(--accent-soft); }
.status { align-items: center; color: var(--ink); display: inline-flex; font-weight: 700; gap: 8px; margin-right: auto; }
.status.offline { color: var(--warning); }
.presence, .save { color: var(--muted); }
.save.warn { color: var(--warning); font-weight: 600; }
.canvas { min-height: 0; position: relative; }
.loading { align-items: center; color: var(--muted); display: flex; font-family: var(--font-display), cursive; font-size: 22px; height: 100%; justify-content: center; }

/* Dialogs: share dialog and (PR 2) board details */
.share-backdrop, .dialog-backdrop { align-items: center; background: rgba(30, 27, 46, .35); display: flex; inset: 0; justify-content: center; padding: 16px; position: fixed; z-index: 50; }
.share-dialog, .dialog { background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius-card); box-shadow: var(--shadow); display: grid; gap: 20px; max-height: 100%; overflow: auto; padding: 24px; width: min(420px, 100%); }
.share-block { display: grid; gap: 8px; }
.share-qr { background: #fff; border: var(--border-w) solid var(--ink); border-radius: var(--radius); height: 240px; justify-self: center; width: 240px; }
.share-link { background: var(--paper); border: var(--border-w) solid var(--ink); border-radius: var(--radius); color: var(--ink); font-family: var(--font-mono), ui-monospace, monospace; font-size: 13px; min-height: var(--tap); padding: 0 10px; width: 100%; }
.share-close { justify-self: end; }
.link-error { display: grid; min-height: 100vh; padding: 24px 16px; place-items: center; }
.link-error .auth-card { gap: 14px; justify-items: start; }

@media (max-width: 640px) {
  .topbar { gap: 10px; padding: 4px 10px; }
  .brand-name { display: none; }
  .doodle { display: none; }
  .landing { padding: 16px 16px 40px; }
  .auth-card { padding: 24px 20px; }
  .section-head h1 { font-size: 32px; }
  .board-row { align-items: flex-start; flex-direction: column; gap: 6px; }
}

@media (prefers-reduced-motion: reduce) {
  .pulse { animation: none; }
  .button, .primary, .copy, .board-row { transition: none; }
  .primary:hover, .board-row:hover, .button:active, .copy:active, .primary:active { transform: none; }
}
```

- [ ] **Step 3: Type check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed. Font downloads happen at build time; a network error here is an environment problem, not a code bug. Retry once, then report it.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "style: Marker Board tokens, fonts and stylesheet

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Markup touches and a browser pass over every screen

**Files:**
- Modify: `components/Landing.tsx` (headline highlight)
- Modify: `components/Logo.tsx` (ink-stroked live tile)
- Modify: `components/Dashboard.tsx` (count and time classes, highlight in username notice)
- Modify: `components/Board.tsx:302-308` (link-error page as an index card)

**Interfaces:**
- Consumes: classes from Task 1 (`.highlight`, `.count`, `.board-time`, `.auth-card`).

- [ ] **Step 1: Landing headline**

In `components/Landing.tsx` replace the `<h1>` line with:

```tsx
      <h1>Think out loud,<br /> <span className="highlight">on paper</span> they can see.</h1>
```

- [ ] **Step 2: Logo live tile**

In `components/Logo.tsx` replace the fourth `<rect>` (the one with the accent fill) with:

```tsx
      <rect x="13" y="13" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" style={{ fill: "var(--accent)" }} />
```

- [ ] **Step 3: Dashboard classes**

In `components/Dashboard.tsx`:

- Change `<span className="muted">{boards.length}</span>` to `<span className="count">{boards.length}</span>`.
- Change `<span>Edited {relativeTime(new Date(board.updated_at), now)}</span>` to `<span className="board-time">Edited {relativeTime(new Date(board.updated_at), now)}</span>`.
- In `ClaimUsername`, change `<h2>Choose a username</h2>` to `<h2>Choose a <span className="highlight">username</span></h2>`.

- [ ] **Step 4: Link-error card**

In `components/Board.tsx` replace the `if (linkError) { ... }` block's JSX with:

```tsx
    return <main className="link-error paper">
      <section className="auth-card">
        <h1>This board link is invalid or expired</h1>
        <p className="muted">Ask for a fresh link, or create a new board.</p>
        <Link className="primary" href="/">Go home</Link>
      </section>
    </main>;
```

- [ ] **Step 5: Browser pass**

Run `npm run dev`. Use the `claude-in-chrome` skill. Check each screen at 1280×800, 820×1180 (tablet) and 390×844 (phone):

- `/` signed out (landing): highlighter behind "on paper", no horizontal scroll at 390px.
- `/signup`, `/signin`, `/forgot-password`, `/reset-password`: upright index cards, focus ring visible when tabbing.
- `/` signed in (dashboard). To sign in without email, create a pre-confirmed user with the admin API as described in AGENTS.md "Gotchas", sign in as them, and **delete the user afterwards**. Check board cards, the username notice (a user created without `username` metadata shows it), the empty state.
- Create a board and open the room: thin top bar, Share dialog restyled. **The Excalidraw toolbar, menus and the help dialog (`?`) look the same as on `main`.** Compare against a `main` checkout screenshot if unsure.
- `/room/<random-uuid>?role=viewer&token=x`: link-error index card.

Fix anything broken in `globals.css` and re-check that screen only. Stop the dev server you started (AGENTS.md "Gotchas").

- [ ] **Step 6: Gates and commit**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass (existing tests are untouched).

```bash
git add components/Landing.tsx components/Logo.tsx components/Dashboard.tsx components/Board.tsx app/globals.css
git commit -m "style: apply Marker Board to landing, dashboard, logo and link-error page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Open PR 1

- [ ] **Step 1:** Use the project skill `finishing-a-feature`. PR 1 has no migration, function or env changes. Push `feat/marker-board-redesign` and open a PR into `main` titled `style: Marker Board redesign`, with the spec link and the screens checked.
- [ ] **Step 2:** Create the PR 2 branch from it: `git switch -c feat/board-details`.

---

## PR 2: Board details and filters (branch `feat/board-details`, from `feat/marker-board-redesign`)

### Task 4: Shared board-details validation

**Files:**
- Create: `supabase/functions/_shared/boardDetails.ts`
- Create: `lib/rooms/details.ts`
- Test: `lib/rooms/details.test.ts`

**Interfaces:**
- Produces (import from `@/lib/rooms/details` in the app, `../_shared/boardDetails.ts` in Deno):
  - `DEFAULT_TITLE: "Untitled whiteboard"`
  - `DETAIL_LIMITS: { title: 80; role: 60; company: 60 }`
  - `type DetailField = "title" | "role" | "company"`
  - `type BoardDetails = { title: string; role: string | null; company: string | null }`
  - `type DetailsResult = { ok: true; details: BoardDetails } | { ok: false; field: DetailField; message: string }`
  - `cleanText(value: string): string` (trim + collapse whitespace)
  - `normalizeDetails(input: Partial<Record<DetailField, unknown>>): DetailsResult`

- [ ] **Step 1: Write the failing test** `lib/rooms/details.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { cleanText, DEFAULT_TITLE, normalizeDetails } from "@/lib/rooms/details";

describe("cleanText", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanText("  LRU   cache\n\tfollow-ups ")).toBe("LRU cache follow-ups");
  });
});

describe("normalizeDetails", () => {
  it("cleans every field", () => {
    expect(normalizeDetails({ title: "  LRU   cache ", role: " Backend\tSDE II ", company: "Razorpay " }))
      .toEqual({ ok: true, details: { title: "LRU cache", role: "Backend SDE II", company: "Razorpay" } });
  });

  it("defaults an empty title and nulls empty tags", () => {
    const empty = { ok: true, details: { title: DEFAULT_TITLE, role: null, company: null } };
    expect(normalizeDetails({ title: "   ", role: "", company: null })).toEqual(empty);
    expect(normalizeDetails({})).toEqual(empty);
  });

  it("accepts values at the limit and rejects one over", () => {
    expect(normalizeDetails({ title: "a".repeat(80), role: "r".repeat(60), company: "c".repeat(60) }).ok).toBe(true);
    expect(normalizeDetails({ title: "a".repeat(81) })).toEqual({ ok: false, field: "title", message: "Name can be at most 80 characters." });
    expect(normalizeDetails({ role: "r".repeat(61) })).toEqual({ ok: false, field: "role", message: "Role can be at most 60 characters." });
    expect(normalizeDetails({ company: "c".repeat(61) })).toEqual({ ok: false, field: "company", message: "Company can be at most 60 characters." });
  });

  it("measures length after cleaning, in characters", () => {
    expect(normalizeDetails({ title: `  ${"a".repeat(80)}  ` }).ok).toBe(true);
    expect(normalizeDetails({ company: "😀".repeat(60) }).ok).toBe(true);
  });

  it("rejects control characters and non-text values", () => {
    expect(normalizeDetails({ role: "Back\u0000end" })).toEqual({ ok: false, field: "role", message: "Role contains characters that aren't allowed." });
    expect(normalizeDetails({ title: 42 })).toEqual({ ok: false, field: "title", message: "Name must be text." });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/rooms/details.test.ts`
Expected: FAIL, cannot resolve `@/lib/rooms/details`.

- [ ] **Step 3: Implement** `supabase/functions/_shared/boardDetails.ts`

```ts
// Shared by the Next.js app (via lib/rooms/details.ts) and the `rooms` Edge Function.
export const DEFAULT_TITLE = "Untitled whiteboard";
export const DETAIL_LIMITS = { title: 80, role: 60, company: 60 } as const;

export type DetailField = keyof typeof DETAIL_LIMITS;
export type BoardDetails = { title: string; role: string | null; company: string | null };
export type DetailsResult = { ok: true; details: BoardDetails } | { ok: false; field: DetailField; message: string };

const LABELS: Record<DetailField, string> = { title: "Name", role: "Role", company: "Company" };
// Tabs and newlines are already collapsed to spaces by cleanText, so anything left here is rejected.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeDetails(input: Partial<Record<DetailField, unknown>>): DetailsResult {
  const cleaned: Record<DetailField, string> = { title: "", role: "", company: "" };
  for (const field of ["title", "role", "company"] as const) {
    const raw = input[field] ?? "";
    if (typeof raw !== "string") return { ok: false, field, message: `${LABELS[field]} must be text.` };
    const value = cleanText(raw);
    if (CONTROL_CHARS.test(value)) return { ok: false, field, message: `${LABELS[field]} contains characters that aren't allowed.` };
    if ([...value].length > DETAIL_LIMITS[field]) {
      return { ok: false, field, message: `${LABELS[field]} can be at most ${DETAIL_LIMITS[field]} characters.` };
    }
    cleaned[field] = value;
  }
  return { ok: true, details: { title: cleaned.title || DEFAULT_TITLE, role: cleaned.role || null, company: cleaned.company || null } };
}
```

And `lib/rooms/details.ts`:

```ts
export {
  DEFAULT_TITLE,
  DETAIL_LIMITS,
  cleanText,
  normalizeDetails,
  type BoardDetails,
  type DetailField,
  type DetailsResult,
} from "@/supabase/functions/_shared/boardDetails";
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run lib/rooms/details.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/boardDetails.ts lib/rooms/details.ts lib/rooms/details.test.ts
git commit -m "feat(rooms): shared board name, role and company validation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Tag grouping and suggestions

**Files:**
- Create: `lib/dashboard/tags.ts`
- Test: `lib/dashboard/tags.test.ts`

**Interfaces:**
- Consumes: `cleanText` from `@/lib/rooms/details`.
- Produces:
  - `type TagField = "role" | "company"`
  - `type TaggedBoard = { role: string | null; company: string | null; created_at: string }`
  - `type TagOption = { key: string; label: string; count: number }`
  - `type Suggestion = { kind: "existing"; option: TagOption } | { kind: "new"; label: string }`
  - `tagKey(value: string): string`
  - `tagOptions(boards: TaggedBoard[], field: TagField): TagOption[]`
  - `suggest(options: TagOption[], typed: string, limit?: number): Suggestion[]`

- [ ] **Step 1: Write the failing test** `lib/dashboard/tags.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { suggest, tagKey, tagOptions } from "@/lib/dashboard/tags";

const board = (role: string | null, company: string | null, created_at: string) => ({ role, company, created_at });

describe("tagKey", () => {
  it("folds case and spacing", () => {
    expect(tagKey("  Backend   SDE II ")).toBe("backend sde ii");
  });
});

describe("tagOptions", () => {
  const boards = [
    board("Backend SDE II", "Razorpay", "2026-09-01T10:00:00Z"),
    board("backend  sde ii", "razorpay", "2026-09-03T10:00:00Z"),
    board("Backend SDE II", "Swiggy", "2026-09-02T10:00:00Z"),
    board(null, "RAZORPAY", "2026-09-04T10:00:00Z"),
    board("  ", null, "2026-09-05T10:00:00Z"),
  ];

  it("groups by key, labels with the most common spelling, ignores empty values", () => {
    expect(tagOptions(boards, "role")).toEqual([{ key: "backend sde ii", label: "Backend SDE II", count: 3 }]);
  });

  it("breaks spelling ties by the most recently created board, and orders by count", () => {
    expect(tagOptions(boards, "company")).toEqual([
      { key: "razorpay", label: "RAZORPAY", count: 3 },
      { key: "swiggy", label: "Swiggy", count: 1 },
    ]);
  });

  it("orders equal counts alphabetically, ignoring case", () => {
    const tied = [board("b", null, "2026-09-01T00:00:00Z"), board("A", null, "2026-09-01T00:00:00Z")];
    expect(tagOptions(tied, "role").map((option) => option.label)).toEqual(["A", "b"]);
  });

  it("returns nothing for boards without tags", () => {
    expect(tagOptions([board(null, null, "2026-09-01T00:00:00Z")], "company")).toEqual([]);
  });
});

describe("suggest", () => {
  const options = [
    { key: "razorpay", label: "Razorpay", count: 6 },
    { key: "zepto", label: "Zepto", count: 3 },
    { key: "rapido", label: "Rapido", count: 1 },
    { key: "amazon", label: "Amazon", count: 1 },
  ];

  it("lists options up to the limit for empty input, with no new row", () => {
    expect(suggest(options, "")).toEqual(options.map((option) => ({ kind: "existing", option })));
    expect(suggest(options, "  ", 2)).toHaveLength(2);
  });

  it("puts prefix matches before substring matches, then offers the typed value", () => {
    expect(suggest(options, " A")).toEqual([
      { kind: "existing", option: options[3] },
      { kind: "existing", option: options[0] },
      { kind: "existing", option: options[2] },
      { kind: "new", label: "A" },
    ]);
  });

  it("offers no new row when the typed value already exists", () => {
    expect(suggest(options, "  RAZORPAY ")).toEqual([{ kind: "existing", option: options[0] }]);
  });

  it("caps existing rows at the limit but keeps the new row", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ key: `team ${index}`, label: `Team ${index}`, count: 1 }));
    const result = suggest(many, "team");
    expect(result.filter((item) => item.kind === "existing")).toHaveLength(6);
    expect(result.at(-1)).toEqual({ kind: "new", label: "team" });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/dashboard/tags.test.ts`
Expected: FAIL, cannot resolve `@/lib/dashboard/tags`.

- [ ] **Step 3: Implement** `lib/dashboard/tags.ts`

```ts
import { cleanText } from "@/lib/rooms/details";

export type TagField = "role" | "company";
export type TaggedBoard = { role: string | null; company: string | null; created_at: string };
export type TagOption = { key: string; label: string; count: number };
export type Suggestion = { kind: "existing"; option: TagOption } | { kind: "new"; label: string };

type Spelling = { count: number; latest: number };

// Values that differ only in case or spacing are the same tag.
export function tagKey(value: string) {
  return cleanText(value).toLowerCase();
}

export function tagOptions(boards: TaggedBoard[], field: TagField): TagOption[] {
  const groups = new Map<string, Map<string, Spelling>>();
  for (const board of boards) {
    const label = cleanText(board[field] ?? "");
    if (!label) continue;
    const key = label.toLowerCase();
    const spellings = groups.get(key) ?? new Map<string, Spelling>();
    groups.set(key, spellings);
    const seen = spellings.get(label) ?? { count: 0, latest: -Infinity };
    spellings.set(label, { count: seen.count + 1, latest: Math.max(seen.latest, Date.parse(board.created_at)) });
  }
  const options = [...groups].map(([key, spellings]) => {
    let best: [string, Spelling] | null = null;
    let count = 0;
    for (const entry of spellings) {
      count += entry[1].count;
      const better = !best || entry[1].count > best[1].count || (entry[1].count === best[1].count && entry[1].latest > best[1].latest);
      if (better) best = entry;
    }
    return { key, label: best ? best[0] : key, count };
  });
  return options.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export function suggest(options: TagOption[], typed: string, limit = 6): Suggestion[] {
  const key = tagKey(typed);
  const prefix = options.filter((option) => option.key.startsWith(key));
  const contains = key ? options.filter((option) => !option.key.startsWith(key) && option.key.includes(key)) : [];
  const items: Suggestion[] = [...prefix, ...contains].slice(0, limit).map((option) => ({ kind: "existing", option }));
  if (key && !options.some((option) => option.key === key)) items.push({ kind: "new", label: cleanText(typed) });
  return items;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run lib/dashboard/tags.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/tags.ts lib/dashboard/tags.test.ts
git commit -m "feat(dashboard): group role and company tags and suggest them

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: Filter and sort logic

**Files:**
- Create: `lib/dashboard/filter.ts`
- Test: `lib/dashboard/filter.test.ts`

**Interfaces:**
- Consumes: `tagKey` from `@/lib/dashboard/tags`.
- Produces:
  - `SORTS = ["newest", "oldest", "edited", "name"] as const`; `type Sort`
  - `type Filters = { sort: Sort; from: string | null; to: string | null; role: string | null; company: string | null }` (role/company hold tag **keys**)
  - `type DashboardBoard = { id: string; title: string; role: string | null; company: string | null; created_at: string; updated_at: string }`
  - `DEFAULT_FILTERS: Filters`
  - `parseFilters(params: URLSearchParams): Filters`
  - `filtersToParams(filters: Filters): URLSearchParams`
  - `hasActiveFilters(filters: Filters): boolean`
  - `applyFilters(boards: DashboardBoard[], filters: Filters): DashboardBoard[]`

- [ ] **Step 1: Write the failing test** `lib/dashboard/filter.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  applyFilters, DEFAULT_FILTERS, filtersToParams, hasActiveFilters, parseFilters,
  type DashboardBoard, type Filters,
} from "@/lib/dashboard/filter";

// Builds timestamps in the test machine's local time zone, so day edges are tested in local time.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const board = (id: string, overrides: Partial<DashboardBoard> = {}): DashboardBoard => ({
  id, title: id, role: null, company: null, created_at: at(2026, 9, 15), updated_at: at(2026, 9, 15), ...overrides,
});
const ids = (list: DashboardBoard[]) => list.map((item) => item.id);

describe("parseFilters and filtersToParams", () => {
  it("parses a full query and folds tags to keys", () => {
    expect(parseFilters(new URLSearchParams("sort=name&from=2026-09-01&to=2026-09-30&role=Backend%20%20SDE%20II&company=razorpay")))
      .toEqual({ sort: "name", from: "2026-09-01", to: "2026-09-30", role: "backend sde ii", company: "razorpay" });
  });

  it("ignores malformed values", () => {
    expect(parseFilters(new URLSearchParams("sort=random&from=2026-02-30&to=yesterday&role=%20%20"))).toEqual(DEFAULT_FILTERS);
  });

  it("swaps a reversed date range", () => {
    expect(parseFilters(new URLSearchParams("from=2026-10-05&to=2026-09-15"))).toMatchObject({ from: "2026-09-15", to: "2026-10-05" });
  });

  it("omits defaults and round-trips", () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("");
    const filters: Filters = { sort: "oldest", from: "2026-09-01", to: null, role: "backend sde ii", company: null };
    expect(parseFilters(filtersToParams(filters))).toEqual(filters);
  });

  it("does not count the sort as a filter", () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, sort: "name" })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, company: "zepto" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, to: "2026-09-01" })).toBe(true);
  });
});

describe("applyFilters", () => {
  const boards = [
    board("a", { title: "beta", created_at: at(2026, 9, 1), updated_at: at(2026, 10, 4) }),
    board("b", { title: "Alpha", created_at: at(2026, 9, 20), updated_at: at(2026, 9, 21), role: "Backend SDE II", company: "Razorpay" }),
    board("c", { title: "gamma", created_at: at(2026, 10, 3), updated_at: at(2026, 10, 3), role: "backend  sde ii", company: "Zepto" }),
  ];

  it("sorts by each option", () => {
    expect(ids(applyFilters(boards, DEFAULT_FILTERS))).toEqual(["c", "b", "a"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, sort: "oldest" }))).toEqual(["a", "b", "c"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, sort: "edited" }))).toEqual(["a", "c", "b"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, sort: "name" }))).toEqual(["b", "a", "c"]);
  });

  it("includes whole local days at both ends of the range", () => {
    const edge = [
      board("start", { created_at: at(2026, 9, 20, 0, 0) }),
      board("end", { created_at: at(2026, 9, 21, 23, 59) }),
      board("before", { created_at: at(2026, 9, 19, 23, 59) }),
      board("after", { created_at: at(2026, 9, 22, 0, 0) }),
    ];
    expect(ids(applyFilters(edge, { ...DEFAULT_FILTERS, from: "2026-09-20", to: "2026-09-21" })).sort()).toEqual(["end", "start"]);
  });

  it("supports open-ended and reversed ranges", () => {
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, from: "2026-09-20" }))).toEqual(["c", "b"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, to: "2026-09-20" }))).toEqual(["b", "a"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, from: "2026-10-31", to: "2026-09-20" }))).toEqual(["c", "b"]);
  });

  it("matches role and company by key and leaves out untagged boards", () => {
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, role: "backend sde ii" }))).toEqual(["c", "b"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, role: "backend sde ii", company: "razorpay" }))).toEqual(["b"]);
    expect(applyFilters(boards, { ...DEFAULT_FILTERS, company: "swiggy" })).toEqual([]);
  });

  it("does not reorder its input", () => {
    const before = ids(boards);
    applyFilters(boards, { ...DEFAULT_FILTERS, sort: "name" });
    expect(ids(boards)).toEqual(before);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/dashboard/filter.test.ts`
Expected: FAIL, cannot resolve `@/lib/dashboard/filter`.

- [ ] **Step 3: Implement** `lib/dashboard/filter.ts`

```ts
import { tagKey } from "@/lib/dashboard/tags";

export const SORTS = ["newest", "oldest", "edited", "name"] as const;
export type Sort = (typeof SORTS)[number];
// role and company hold tag keys (see tagKey), not display labels.
export type Filters = { sort: Sort; from: string | null; to: string | null; role: string | null; company: string | null };
export type DashboardBoard = { id: string; title: string; role: string | null; company: string | null; created_at: string; updated_at: string };

export const DEFAULT_FILTERS: Filters = { sort: "newest", from: null, to: null, role: null, company: null };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// Start of a YYYY-MM-DD day (plus offsetDays) in the viewer's time zone, or null when the date is not real.
function localDay(value: string | null, offsetDays = 0): number | null {
  const match = value ? DAY.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
  return new Date(year, month - 1, day + offsetDays).getTime();
}

const validDay = (value: string | null) => (localDay(value) === null ? null : value);
const ordered = (from: string | null, to: string | null): [string | null, string | null] => (from && to && from > to ? [to, from] : [from, to]);
const tagParam = (value: string | null) => (value ? tagKey(value) : "") || null;

export function parseFilters(params: URLSearchParams): Filters {
  const sort = params.get("sort") ?? "";
  const [from, to] = ordered(validDay(params.get("from")), validDay(params.get("to")));
  return {
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as Sort) : DEFAULT_FILTERS.sort,
    from,
    to,
    role: tagParam(params.get("role")),
    company: tagParam(params.get("company")),
  };
}

export function filtersToParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);
  for (const name of ["from", "to", "role", "company"] as const) {
    const value = filters[name];
    if (value) params.set(name, value);
  }
  return params;
}

export function hasActiveFilters(filters: Filters) {
  return Boolean(filters.from || filters.to || filters.role || filters.company);
}

const newestFirst = (field: "created_at" | "updated_at") => (a: DashboardBoard, b: DashboardBoard) => Date.parse(b[field]) - Date.parse(a[field]);

const COMPARE: Record<Sort, (a: DashboardBoard, b: DashboardBoard) => number> = {
  newest: newestFirst("created_at"),
  oldest: (a, b) => newestFirst("created_at")(b, a),
  edited: newestFirst("updated_at"),
  name: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
};

export function applyFilters(boards: DashboardBoard[], filters: Filters): DashboardBoard[] {
  const [from, to] = ordered(filters.from, filters.to);
  const start = localDay(from) ?? -Infinity;
  const end = localDay(to, 1) ?? Infinity;
  const matches = (value: string | null, key: string | null) => !key || (value !== null && tagKey(value) === key);
  return boards
    .filter((board) => {
      const created = Date.parse(board.created_at);
      return created >= start && created < end && matches(board.role, filters.role) && matches(board.company, filters.company);
    })
    .sort(COMPARE[filters.sort]);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run lib/dashboard/filter.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/filter.ts lib/dashboard/filter.test.ts
git commit -m "feat(dashboard): URL filter state, date range, tag filters and sorting

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: Migration, Edge Function actions and client API

**Files:**
- Create: `supabase/migrations/202610050004_board_details.sql`
- Modify: `supabase/functions/rooms/index.ts` (import, `create` branch at lines 44-57, new `update-details` branch after `owner-access`)
- Create: `lib/rooms/boards.ts`
- Test: `lib/rooms/boards.test.ts`

**Interfaces:**
- Consumes: `normalizeDetails`, `BoardDetails`, `DetailField` (Task 4).
- Produces (`@/lib/rooms/boards`):
  - `type OpenedBoard = { roomId: string; editorToken: string; viewerToken: string }`
  - `type DetailsError = { ok: false; field?: DetailField; message: string }`
  - `detailsErrorFrom(error: unknown, fallback: string): Promise<DetailsError>`
  - `boardUrl(board: OpenedBoard): string`
  - `openOwnedBoard(supabase, roomId: string): Promise<OpenedBoard | null>`
  - `createBoard(supabase, details: BoardDetails): Promise<{ ok: true; board: OpenedBoard } | DetailsError>`
  - `updateBoardDetails(supabase, roomId: string, details: BoardDetails): Promise<{ ok: true; details: BoardDetails } | DetailsError>`
- Edge Function contract: `create` takes optional `title`, `role`, `company`; `update-details` takes `{ roomId, title, role, company }` and returns `{ board: { id, title, role, company } }`. Validation failures return 400 `{ error, field }`.

- [ ] **Step 1: Write the failing client test** `lib/rooms/boards.test.ts`

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { boardUrl, createBoard, detailsErrorFrom, updateBoardDetails } from "@/lib/rooms/boards";

const details = { title: "LRU cache", role: "Backend SDE II", company: "Razorpay" };
const client = (result: { data: unknown; error: unknown }) => {
  const invoke = vi.fn().mockResolvedValue(result);
  return { supabase: { functions: { invoke } } as unknown as SupabaseClient, invoke };
};
const httpError = (status: number, body: unknown) => ({ context: new Response(JSON.stringify(body), { status }) });

describe("detailsErrorFrom", () => {
  it("returns the field error from a 400 response", async () => {
    expect(await detailsErrorFrom(httpError(400, { error: "Role can be at most 60 characters.", field: "role" }), "fallback"))
      .toEqual({ ok: false, field: "role", message: "Role can be at most 60 characters." });
  });

  it("falls back for other statuses, unknown fields and non-JSON bodies", async () => {
    expect(await detailsErrorFrom(httpError(500, { error: "x", field: "role" }), "fallback")).toEqual({ ok: false, message: "fallback" });
    expect(await detailsErrorFrom(httpError(400, { error: "x", field: "owner_id" }), "fallback")).toEqual({ ok: false, message: "fallback" });
    expect(await detailsErrorFrom({ context: new Response("oops", { status: 400 }) }, "fallback")).toEqual({ ok: false, message: "fallback" });
    expect(await detailsErrorFrom(new Error("network"), "fallback")).toEqual({ ok: false, message: "fallback" });
  });
});

describe("createBoard", () => {
  it("sends the details and returns the opened board", async () => {
    const { supabase, invoke } = client({ data: { roomId: "r1", editorToken: "e", viewerToken: "v" }, error: null });
    expect(await createBoard(supabase, details)).toEqual({ ok: true, board: { roomId: "r1", editorToken: "e", viewerToken: "v" } });
    expect(invoke).toHaveBeenCalledWith("rooms", { body: { action: "create", ...details } });
  });

  it("returns the create fallback message on failure", async () => {
    const { supabase } = client({ data: null, error: new Error("down") });
    expect(await createBoard(supabase, details)).toEqual({ ok: false, message: "Couldn't create the board. Try again." });
  });
});

describe("updateBoardDetails", () => {
  it("sends the room and details and returns the saved values", async () => {
    const { supabase, invoke } = client({ data: { board: { id: "r1", ...details } }, error: null });
    expect(await updateBoardDetails(supabase, "r1", details)).toEqual({ ok: true, details });
    expect(invoke).toHaveBeenCalledWith("rooms", { body: { action: "update-details", roomId: "r1", ...details } });
  });

  it("returns the save fallback message on failure", async () => {
    const { supabase } = client({ data: null, error: new Error("down") });
    expect(await updateBoardDetails(supabase, "r1", details)).toEqual({ ok: false, message: "Couldn't save the changes. Try again." });
  });
});

describe("boardUrl", () => {
  it("builds the editor link", () => {
    expect(boardUrl({ roomId: "r1", editorToken: "e", viewerToken: "v" })).toBe("/room/r1?role=editor&token=e&viewer=v");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/rooms/boards.test.ts`
Expected: FAIL, cannot resolve `@/lib/rooms/boards`.

- [ ] **Step 3: Implement** `lib/rooms/boards.ts`

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardDetails, DetailField } from "@/lib/rooms/details";

export type OpenedBoard = { roomId: string; editorToken: string; viewerToken: string };
export type DetailsError = { ok: false; field?: DetailField; message: string };

const FIELDS: readonly string[] = ["title", "role", "company"];

// functions.invoke puts the HTTP Response on error.context for non-2xx replies.
export async function detailsErrorFrom(error: unknown, fallback: string): Promise<DetailsError> {
  const response = (error as { context?: unknown } | null)?.context;
  if (response instanceof Response && response.status === 400) {
    try {
      const body = await response.clone().json() as { error?: unknown; field?: unknown };
      if (typeof body.field === "string" && FIELDS.includes(body.field) && typeof body.error === "string") {
        return { ok: false, field: body.field as DetailField, message: body.error };
      }
    } catch {
      // Not JSON: use the fallback message.
    }
  }
  return { ok: false, message: fallback };
}

export function boardUrl(board: OpenedBoard) {
  return `/room/${board.roomId}?role=editor&token=${board.editorToken}&viewer=${board.viewerToken}`;
}

export async function openOwnedBoard(supabase: SupabaseClient, roomId: string): Promise<OpenedBoard | null> {
  const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "owner-access", roomId } });
  if (error || !data?.roomId) return null;
  return { roomId: data.roomId, editorToken: data.editorToken, viewerToken: data.viewerToken };
}

export async function createBoard(supabase: SupabaseClient, details: BoardDetails): Promise<{ ok: true; board: OpenedBoard } | DetailsError> {
  const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "create", ...details } });
  if (error || !data?.roomId) return detailsErrorFrom(error, "Couldn't create the board. Try again.");
  return { ok: true, board: { roomId: data.roomId, editorToken: data.editorToken, viewerToken: data.viewerToken } };
}

export async function updateBoardDetails(
  supabase: SupabaseClient,
  roomId: string,
  details: BoardDetails,
): Promise<{ ok: true; details: BoardDetails } | DetailsError> {
  const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "update-details", roomId, ...details } });
  if (error || !data?.board) return detailsErrorFrom(error, "Couldn't save the changes. Try again.");
  const { title, role, company } = data.board as BoardDetails;
  return { ok: true, details: { title, role, company } };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run lib/rooms/boards.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the migration** `supabase/migrations/202610050004_board_details.sql`

```sql
-- Board name already exists as rooms.title. Adds the interview's role and company. Safe to re-run.
alter table public.rooms add column if not exists role text;
alter table public.rooms add column if not exists company text;
create index if not exists rooms_owner_created_idx on public.rooms (owner_id, created_at desc);
```

- [ ] **Step 6: Update the Edge Function** `supabase/functions/rooms/index.ts`

Add after the first import line:

```ts
import { normalizeDetails } from "../_shared/boardDetails.ts";
```

In the `create` branch, validate before generating tokens and store the details. The branch becomes:

```ts
  if (body.action === "create") {
    const checked = normalizeDetails(body);
    if (!checked.ok) return json({ error: checked.message, field: checked.field }, 400);
    const editorToken = randomToken();
    const viewerToken = randomToken();
    const owned = !user.is_anonymous;
    const { data: room, error } = await admin.from("rooms").insert({
      ...checked.details,
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
```

Directly after the closing brace of the `owner-access` branch (before `const { roomId, token } = body;`), add:

```ts
  if (body.action === "update-details") {
    if (user.is_anonymous || !body.roomId) return json({ error: "Sign in with your personal account first." }, 403);
    const checked = normalizeDetails(body);
    if (!checked.ok) return json({ error: checked.message, field: checked.field }, 400);
    // Leaves updated_at alone: "recently edited" means drawing, not renaming.
    const { data: board, error } = await admin.from("rooms").update(checked.details)
      .eq("id", body.roomId).eq("owner_id", user.id).select("id, title, role, company").maybeSingle();
    if (error) return json({ error: "Could not save details." }, 500);
    if (!board) return json({ error: "Board not found." }, 404);
    return json({ board });
  }
```

- [ ] **Step 7: Gates**

Run: `npm test && npx tsc --noEmit`
Expected: all pass. (`supabase/functions/**` is excluded from vitest; `tsc` covers the shared module through `lib/rooms/details.ts`.)

- [ ] **Step 8: Apply the migration to the live project, then deploy the function immediately**

The new function is backward compatible: today's frontend sends `create` without details and gets the defaults. So deploying before PR 2 merges is safe. In Git Bash, with `$SCRATCH` set to the session scratchpad:

```bash
set -a && . ./.env.local && set +a
node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync("supabase/migrations/202610050004_board_details.sql","utf8")}))' > "$SCRATCH/mig.json"
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @"$SCRATCH/mig.json"
```

Expected: `[]`. Then:

```bash
supabase functions deploy rooms --project-ref "$SUPABASE_PROJECT_REF" --use-api
```

- [ ] **Step 9: Verify the live project**

```bash
node -e 'process.stdout.write(JSON.stringify({query: "select column_name from information_schema.columns where table_schema = '\''public'\'' and table_name = '\''rooms'\'' and column_name in ('\''role'\'','\''company'\'') order by 1; "}))' > "$SCRATCH/q.json"
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @"$SCRATCH/q.json"
supabase functions list --project-ref "$SUPABASE_PROJECT_REF"
```

Expected: `[{"column_name":"company"},{"column_name":"role"}]`, and the `rooms` version is one higher than before. Never print the env values.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/202610050004_board_details.sql supabase/functions/rooms/index.ts lib/rooms/boards.ts lib/rooms/boards.test.ts
git commit -m "feat(rooms): store board role and company; owner can edit details

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 8: Tag input and the board details dialog

**Files:**
- Create: `components/dashboard/TagInput.tsx`
- Create: `components/dashboard/BoardDetailsDialog.tsx`
- Modify: `app/globals.css` (append dialog and suggestion styles)

**Interfaces:**
- Consumes: `suggest`, `tagOptions`, `TagOption`, `Suggestion` (Task 5); `DashboardBoard` (Task 6); `DetailsError` (Task 7); `normalizeDetails`, `BoardDetails`, `DetailField` (Task 4); `Field`, `FieldMessage` from `components/auth/Field.tsx`.
- Produces:
  - `TagInput({ label, value, onChange, options, placeholder?, message? })`
  - `BoardDetailsDialog({ mode: "create" | "edit", initial?, boards, onSubmit: (details: BoardDetails) => Promise<{ ok: true } | DetailsError>, onClose })`. The dialog validates before calling `onSubmit`. On `{ ok: true }` it stays pending; the parent navigates (create) or unmounts it (edit).

- [ ] **Step 1: Create** `components/dashboard/TagInput.tsx`

```tsx
"use client";

import { type KeyboardEvent, useId, useState } from "react";
import type { FieldMessage } from "@/components/auth/Field";
import { suggest, type Suggestion, type TagOption } from "@/lib/dashboard/tags";

type TagInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: TagOption[];
  placeholder?: string;
  message?: FieldMessage | null;
};

// A combobox, not <datalist>, so suggestions look and behave the same on iPad and Android.
export default function TagInput({ label, value, onChange, options, placeholder, message }: TagInputProps) {
  const id = useId();
  const listId = `${id}-list`;
  const messageId = `${id}-message`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const items = open ? suggest(options, value) : [];
  const showList = items.length > 0;
  const optionId = (index: number) => `${id}-option-${index}`;

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function pick(item: Suggestion) {
    onChange(item.kind === "existing" ? item.option.label : item.label);
    close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      if (items.length === 0) return;
      const down = event.key === "ArrowDown";
      setActive((index) => (down ? (index + 1) % items.length : index <= 0 ? items.length - 1 : index - 1));
    } else if (event.key === "Enter" && showList && items[active]) {
      event.preventDefault();
      pick(items[active]);
    } else if (event.key === "Escape" && showList) {
      // Close only the list; the dialog closes on the next Escape.
      event.stopPropagation();
      close();
    }
  }

  return <div className="field tag-input">
    <div className="field-label"><label htmlFor={id}>{label}</label></div>
    <input id={id} role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
      aria-describedby={message ? messageId : undefined} aria-invalid={message?.tone === "danger" || undefined}
      autoComplete="off" spellCheck={false} placeholder={placeholder} value={value}
      onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
      onFocus={() => setOpen(true)} onBlur={close} onKeyDown={onKeyDown} />
    {showList && <ul id={listId} role="listbox" className="suggest">
      {items.map((item, index) => <li key={item.kind === "existing" ? item.option.key : "new"} id={optionId(index)} role="option"
        aria-selected={index === active} className={index === active ? "active" : undefined}
        // preventDefault keeps focus in the input, so a tap picks the row instead of blurring and closing the list.
        onMouseDown={(event) => event.preventDefault()} onClick={() => pick(item)}>
        {item.kind === "existing"
          ? <><span>{item.option.label}</span><em>{item.option.count} {item.option.count === 1 ? "board" : "boards"}</em></>
          : <><span>Use “{item.label}”</span><em>new</em></>}
      </li>)}
    </ul>}
    {message && <span id={messageId} className={`field-message ${message.tone}`} aria-live="polite">{message.text}</span>}
  </div>;
}
```

- [ ] **Step 2: Create** `components/dashboard/BoardDetailsDialog.tsx`

```tsx
"use client";

import { type FormEvent, type KeyboardEvent, useId, useMemo, useState } from "react";
import Field, { type FieldMessage } from "@/components/auth/Field";
import TagInput from "@/components/dashboard/TagInput";
import type { DashboardBoard } from "@/lib/dashboard/filter";
import { tagOptions } from "@/lib/dashboard/tags";
import type { DetailsError } from "@/lib/rooms/boards";
import { type BoardDetails, type DetailField, normalizeDetails } from "@/lib/rooms/details";

type BoardDetailsDialogProps = {
  mode: "create" | "edit";
  initial?: { title: string; role: string | null; company: string | null };
  boards: DashboardBoard[];
  onSubmit: (details: BoardDetails) => Promise<{ ok: true } | DetailsError>;
  onClose: () => void;
};

export default function BoardDetailsDialog({ mode, initial, boards, onSubmit, onClose }: BoardDetailsDialogProps) {
  const headingId = useId();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [fieldError, setFieldError] = useState<{ field: DetailField; message: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const roles = useMemo(() => tagOptions(boards, "role"), [boards]);
  const companies = useMemo(() => tagOptions(boards, "company"), [boards]);
  const creating = mode === "create";

  function dismiss() {
    if (!pending) onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const checked = normalizeDetails({ title, role, company });
    if (!checked.ok) {
      setFieldError({ field: checked.field, message: checked.message });
      return;
    }
    setPending(true);
    setFieldError(null);
    setFormError("");
    const result = await onSubmit(checked.details);
    // On success the parent navigates away (create) or closes this dialog (edit).
    if (result.ok) return;
    setPending(false);
    if (result.field) setFieldError({ field: result.field, message: result.message });
    else setFormError(result.message);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") dismiss();
  }

  const messageFor = (field: DetailField): FieldMessage | null =>
    fieldError?.field === field ? { text: fieldError.message, tone: "danger" } : null;
  const submitLabel = creating ? (pending ? "Creating…" : "Create board") : (pending ? "Saving…" : "Save changes");

  return <div className="dialog-backdrop" onClick={dismiss}>
    <section className="dialog details-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId}
      onClick={(event) => event.stopPropagation()} onKeyDown={onKeyDown}>
      <h2 id={headingId}>{creating ? "New board" : "Edit details"}</h2>
      <form className="details-form" onSubmit={submit} noValidate>
        <Field label="Board name" name="title" autoComplete="off" placeholder="Untitled whiteboard" autoFocus
          value={title} onChange={(event) => setTitle(event.target.value)} message={messageFor("title")} />
        <div className="details-tags">
          <TagInput label="Role" value={role} onChange={setRole} options={roles} placeholder="e.g. Backend SDE II" message={messageFor("role")} />
          <TagInput label="Company" value={company} onChange={setCompany} options={companies} placeholder="e.g. Razorpay" message={messageFor("company")} />
        </div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={dismiss} disabled={pending}>Cancel</button>
          <button type="submit" className="primary" disabled={pending}>{submitLabel}</button>
        </div>
      </form>
    </section>
  </div>;
}
```

- [ ] **Step 3: Append styles to `app/globals.css`**

Insert directly **before** the `@media (max-width: 640px)` block:

```css
/* Board details dialog and tag autocomplete */
.details-dialog { overflow: visible; width: min(540px, 100%); }
.details-form { display: grid; gap: 16px; }
.details-tags { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.dialog-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
.tag-input { position: relative; }
.suggest { background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius); box-shadow: var(--shadow-sm); left: 0; list-style: none; margin: 0; padding: 4px; position: absolute; right: 0; top: calc(100% + 4px); z-index: 5; }
.suggest li { align-items: center; border-radius: 6px; cursor: pointer; display: flex; font-size: 14px; font-weight: 600; gap: 8px; justify-content: space-between; min-height: var(--tap); padding: 0 10px; }
.suggest li:hover, .suggest li.active { background: var(--accent-soft); }
.suggest span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.suggest em { color: var(--muted); flex: none; font-family: var(--font-mono), ui-monospace, monospace; font-size: 12px; font-style: normal; }
```

And inside the existing `@media (max-width: 640px)` block add:

```css
  .details-tags { grid-template-columns: minmax(0, 1fr); }
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: pass.

The dialog is wired up in Task 9. Its full manual check (keyboard, touch, pending guards) runs in Task 9 Step 7.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/TagInput.tsx components/dashboard/BoardDetailsDialog.tsx app/globals.css
git commit -m "feat(dashboard): board details dialog with role and company autocomplete

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 9: Dashboard with filters, chips and Edit details

**Files:**
- Create: `components/dashboard/FilterBar.tsx`
- Create: `components/dashboard/BoardCard.tsx`
- Modify: `components/Dashboard.tsx` (replace the `Dashboard` function; keep `ClaimUsername` unchanged)
- Modify: `app/page.tsx` (Suspense around `Dashboard`)
- Modify: `app/globals.css` (append filter, card and chip styles)

**Interfaces:**
- Consumes: everything from Tasks 4–8.
- Produces: `FilterBar({ filters, roles, companies, onChange })`, `BoardCard({ board, now, disabled, onOpen, onEdit })`.

- [ ] **Step 1: Create** `components/dashboard/FilterBar.tsx`

```tsx
"use client";

import { useId } from "react";
import { DEFAULT_FILTERS, type Filters, hasActiveFilters, type Sort, SORTS } from "@/lib/dashboard/filter";
import type { TagOption } from "@/lib/dashboard/tags";

const SORT_LABELS: Record<Sort, string> = { newest: "Newest", oldest: "Oldest", edited: "Recently edited", name: "Name A–Z" };

type FilterBarProps = { filters: Filters; roles: TagOption[]; companies: TagOption[]; onChange: (next: Filters) => void };

export default function FilterBar({ filters, roles, companies, onChange }: FilterBarProps) {
  const sortId = useId();
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return <div className="filter-bar" role="group" aria-label="Filter boards">
    <div className="filter">
      <label htmlFor={sortId}>Sort</label>
      <select id={sortId} value={filters.sort} onChange={(event) => set({ sort: event.target.value as Sort })}>
        {SORTS.map((sort) => <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>)}
      </select>
    </div>
    <DateFilter label="From" value={filters.from} onChange={(from) => set({ from })} />
    <DateFilter label="To" value={filters.to} onChange={(to) => set({ to })} />
    <TagFilter label="Role" anyLabel="Any role" value={filters.role} options={roles} onChange={(role) => set({ role })} />
    <TagFilter label="Company" anyLabel="Any company" value={filters.company} options={companies} onChange={(company) => set({ company })} />
    {hasActiveFilters(filters) && <button type="button" className="clear-filters" onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear</button>}
  </div>;
}

function RemoveFilter({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="filter-remove" aria-label={`Remove ${label.toLowerCase()} filter`} onClick={onClick}>×</button>;
}

function DateFilter({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  const id = useId();
  return <div className={`filter${value ? " on" : ""}`}>
    <label htmlFor={id}>{label}</label>
    <div className="filter-control">
      <input id={id} type="date" value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} />
      {value && <RemoveFilter label={`${label} date`} onClick={() => onChange(null)} />}
    </div>
  </div>;
}

type TagFilterProps = { label: string; anyLabel: string; value: string | null; options: TagOption[]; onChange: (value: string | null) => void };

function TagFilter({ label, anyLabel, value, options, onChange }: TagFilterProps) {
  const id = useId();
  // A key from an old link may match no board any more; keep it visible so the empty result makes sense.
  const missing = value !== null && !options.some((option) => option.key === value);
  return <div className={`filter${value ? " on" : ""}`}>
    <label htmlFor={id}>{label}</label>
    <div className="filter-control">
      <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{anyLabel}</option>
        {options.map((option) => <option key={option.key} value={option.key}>{option.label} ({option.count})</option>)}
        {missing && value && <option value={value}>{value}</option>}
      </select>
      {value && <RemoveFilter label={label} onClick={() => onChange(null)} />}
    </div>
  </div>;
}
```

- [ ] **Step 2: Create** `components/dashboard/BoardCard.tsx`

```tsx
"use client";

import type { MouseEvent } from "react";
import type { DashboardBoard } from "@/lib/dashboard/filter";
import { relativeTime } from "@/lib/ui/relativeTime";

type BoardCardProps = { board: DashboardBoard; now: Date; disabled: boolean; onOpen: () => void; onEdit: () => void };

export default function BoardCard({ board, now, disabled, onOpen, onEdit }: BoardCardProps) {
  function edit(event: MouseEvent<HTMLButtonElement>) {
    const menu = event.currentTarget.closest("details");
    menu?.removeAttribute("open");
    // Focus the menu button first so the dialog returns focus there when it closes.
    menu?.querySelector("summary")?.focus();
    onEdit();
  }

  return <li className="board-card">
    <button className="board-row" onClick={onOpen} disabled={disabled}>
      <span className="board-main">
        <strong>{board.title}</strong>
        {(board.role || board.company) && <span className="chips">
          {board.role && <span className="chip">{board.role}</span>}
          {board.company && <span className="chip company">{board.company}</span>}
        </span>}
      </span>
      <span className="board-time">Edited {relativeTime(new Date(board.updated_at), now)}</span>
    </button>
    <details className="menu board-menu">
      <summary className="icon-button" aria-label={`More actions for ${board.title}`}>⋯</summary>
      <div className="menu-panel"><button className="menu-item" onClick={edit}>Edit details</button></div>
    </details>
  </li>;
}
```

- [ ] **Step 3: Replace the `Dashboard` function in `components/Dashboard.tsx`**

Replace everything from the top of the file down to the end of the `Dashboard` function (keep `ClaimUsername` below it as is) with:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Logo, { LogoMark } from "@/components/Logo";
import UsernameField, { type UsernameStatus } from "@/components/auth/UsernameField";
import BoardCard from "@/components/dashboard/BoardCard";
import BoardDetailsDialog from "@/components/dashboard/BoardDetailsDialog";
import FilterBar from "@/components/dashboard/FilterBar";
import { claimUsername, signOut } from "@/lib/auth/api";
import {
  applyFilters, DEFAULT_FILTERS, type DashboardBoard, type Filters, filtersToParams, hasActiveFilters, parseFilters,
} from "@/lib/dashboard/filter";
import { tagOptions } from "@/lib/dashboard/tags";
import { boardUrl, createBoard, type DetailsError, openOwnedBoard, updateBoardDetails } from "@/lib/rooms/boards";
import type { BoardDetails } from "@/lib/rooms/details";
import { getSupabase } from "@/lib/supabase";

type DialogState = { mode: "create" } | { mode: "edit"; board: DashboardBoard } | null;

// `username` is undefined when the profile could not be loaded; null when the account has none yet.
export default function Dashboard({ username, onProfileChange }: { username: string | null | undefined; onProfileChange: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  const [boards, setBoards] = useState<DashboardBoard[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    getSupabase()?.from("rooms").select("id,title,role,company,created_at,updated_at").order("updated_at", { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setLoadFailed(true);
          setError("Couldn't load your boards. Refresh to try again.");
        }
        setBoards((data ?? []) as DashboardBoard[]);
      });
  }, []);

  const visible = useMemo(() => (boards ? applyFilters(boards, filters) : []), [boards, filters]);
  const roles = useMemo(() => tagOptions(boards ?? [], "role"), [boards]);
  const companies = useMemo(() => tagOptions(boards ?? [], "company"), [boards]);
  const filtering = hasActiveFilters(filters);

  function setFilters(next: Filters) {
    const query = filtersToParams(next).toString();
    router.replace(query ? `/?${query}` : "/", { scroll: false });
  }

  function openDialog(state: DialogState) {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog(state);
  }

  function closeDialog() {
    setDialog(null);
    openerRef.current?.focus();
  }

  async function openBoard(roomId: string) {
    const supabase = getSupabase();
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    const opened = await openOwnedBoard(supabase, roomId);
    if (opened) return router.push(boardUrl(opened));
    setBusy(false);
    setError("Couldn't open the board. Try again.");
  }

  async function submitDetails(details: BoardDetails): Promise<{ ok: true } | DetailsError> {
    const supabase = getSupabase();
    if (!supabase || !dialog) return { ok: false, message: "Couldn't reach PentoLive. Try again." };
    if (dialog.mode === "create") {
      const created = await createBoard(supabase, details);
      if (created.ok) router.push(boardUrl(created.board));
      return created;
    }
    const roomId = dialog.board.id;
    const saved = await updateBoardDetails(supabase, roomId, details);
    if (saved.ok) {
      setBoards((list) => list?.map((board) => (board.id === roomId ? { ...board, ...saved.details } : board)) ?? null);
      closeDialog();
    }
    return saved;
  }

  const now = new Date();

  return <div className="app-shell paper">
    <header className="app-header">
      <Logo />
      <span className="spacer" />
      <button className="primary" onClick={() => openDialog({ mode: "create" })} disabled={busy}>New board</button>
      <details className="menu">
        <summary className="button">{username ? `@${username}` : "Account"}</summary>
        <div className="menu-panel"><button className="menu-item" onClick={() => signOut()}>Sign out</button></div>
      </details>
    </header>
    <main className="dashboard">
      {username === null && <ClaimUsername onClaimed={onProfileChange} />}
      <div className="section-head">
        <h1>Boards</h1>
        {boards && boards.length > 0 && <span className="count">{filtering ? `${visible.length} of ${boards.length}` : boards.length}</span>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {boards && boards.length > 0 && !loadFailed && <FilterBar filters={filters} roles={roles} companies={companies} onChange={setFilters} />}
      {boards === null ? <p className="muted">Loading…</p>
        : boards.length === 0 ? <div className="empty">
          <LogoMark size={40} />
          <p className="muted">No boards yet. Create one, then share its link with your interviewer.</p>
          <button className="primary" onClick={() => openDialog({ mode: "create" })} disabled={busy}>New board</button>
        </div>
        : visible.length === 0 ? <div className="empty">
          <p className="muted">No boards match these filters.</p>
          <button className="button" onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear filters</button>
        </div>
        : <ul className="board-list">{visible.map((board) => <BoardCard key={board.id} board={board} now={now} disabled={busy}
          onOpen={() => openBoard(board.id)} onEdit={() => openDialog({ mode: "edit", board })} />)}</ul>}
    </main>
    {dialog && <BoardDetailsDialog mode={dialog.mode} initial={dialog.mode === "edit" ? dialog.board : undefined}
      boards={boards ?? []} onSubmit={submitDetails} onClose={closeDialog} />}
  </div>;
}
```

The old `Board` and `RoomRequest` types, the `enter` function and the `relativeTime` import are gone; `relativeTime` is now used in `BoardCard`.

- [ ] **Step 4: Suspense in `app/page.tsx`**

Replace the file with:

```tsx
"use client";

import { Suspense } from "react";
import Dashboard from "@/components/Dashboard";
import Landing from "@/components/Landing";
import { useSession } from "@/components/auth/useSession";

export default function Home() {
  const session = useSession();
  if (session.status === "loading") return <main className="blank" aria-busy="true" />;
  if (session.status === "signed-out") return <Landing />;
  // Dashboard reads filters with useSearchParams, which needs a Suspense boundary in the App Router.
  return <Suspense fallback={<main className="blank" aria-busy="true" />}>
    <Dashboard username={session.profile.username} onProfileChange={session.reload} />
  </Suspense>;
}
```

- [ ] **Step 5: Append styles to `app/globals.css`**

Insert directly **before** the `@media (max-width: 640px)` block:

```css
/* Board cards, chips and filters */
.board-card { position: relative; }
.board-card .board-row { padding-right: 68px; }
.board-main { display: grid; gap: 8px; min-width: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { background: var(--mint-bg); border-radius: 999px; color: var(--mint-fg); font-size: 12.5px; font-weight: 700; padding: 3px 10px; }
.chip.company { background: var(--lilac-bg); color: var(--lilac-fg); }
.board-menu { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); }
.icon-button { align-items: center; background: var(--surface); border: var(--border-w) solid transparent; border-radius: var(--radius); cursor: pointer; display: inline-flex; font-size: 20px; font-weight: 800; height: var(--tap); justify-content: center; width: var(--tap); }
.icon-button:hover, .menu[open] > .icon-button { border-color: var(--ink); }
.filter-bar { align-items: end; display: flex; flex-wrap: wrap; gap: 10px 12px; }
.filter { color: var(--muted); display: grid; font-size: 12.5px; font-weight: 700; gap: 4px; }
.filter-control { align-items: center; display: flex; gap: 2px; }
.filter select, .filter input { background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius); color: var(--ink); font: inherit; font-size: 14px; font-weight: 600; max-width: 220px; min-height: var(--tap); padding: 0 10px; }
.filter.on select, .filter.on input { background: var(--accent-soft); }
.filter-remove { background: none; border: 0; border-radius: var(--radius); color: var(--ink); font-size: 20px; font-weight: 800; height: var(--tap); width: 36px; }
.filter-remove:hover { background: var(--accent-soft); }
.clear-filters { background: none; border: 0; color: var(--ink); font-weight: 700; min-height: var(--tap); padding: 0 8px; text-decoration: underline; text-decoration-color: var(--accent); text-decoration-thickness: 3px; text-underline-offset: 3px; }
```

And inside the existing `@media (max-width: 640px)` block add:

```css
  .board-menu { top: 10px; transform: none; }
  .filter { flex: 1 1 140px; }
  .filter select, .filter input { max-width: none; width: 100%; }
```

- [ ] **Step 6: Gates**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass. The build must not report a missing Suspense boundary for `useSearchParams`.

- [ ] **Step 7: Browser check (Review Focus items 1, 2, 3 and 5)**

Run `npm run dev`. Sign in with a pre-confirmed test user created through the admin API (AGENTS.md "Gotchas"). Use the `claude-in-chrome` skill at 1280×800, 820×1180 and 390×844:

1. New board with name, role "Backend SDE II" and company "Razorpay" opens the room; back on `/` the card shows both chips.
2. A second New board: typing "ra" in Company suggests "Razorpay · 1 board". Pick it with ArrowDown + Enter. Then repeat by tapping, with touch emulation on (Review Focus 1). Esc with the list open closes only the list; a second Esc closes the dialog.
3. Submit an 81-character name: "Name can be at most 80 characters." shows under the name field, and nothing is sent.
4. Edit details on a card: fields are prefilled, saving updates the card in place, and the card does **not** jump under "Recently edited" (Review Focus 3, plus `updated_at` unchanged).
5. While a create is pending (throttle the network in DevTools), Esc, the backdrop and a second submit do nothing (Review Focus 5).
6. Filters: each sort; From/To including a reversed range; role; company; combinations; the count reads "N of M"; Clear keeps the sort; reload keeps filters.
7. Open `/?role=nobody`: "No boards match these filters.", the Role select shows "nobody", and Clear filters works (Review Focus 2).
8. Old boards with no tags show no empty chip row.

Delete the test user and its boards afterwards. Stop the dev server you started.

- [ ] **Step 8: Commit**

```bash
git add components/dashboard/FilterBar.tsx components/dashboard/BoardCard.tsx components/Dashboard.tsx app/page.tsx app/globals.css
git commit -m "feat(dashboard): filter by date, role and company; edit board details

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 10: Open PR 2

- [ ] **Step 1:** Use the project skill `finishing-a-feature`. In the PR body, note that the migration is applied and the `rooms` function is already deployed (backward compatible), and that it needs no Vercel env changes.
- [ ] **Step 2:** Push `feat/board-details` and open a PR titled `feat: board details and dashboard filters`. Use `main` as the base if PR 1 is merged, otherwise `feat/marker-board-redesign`.
