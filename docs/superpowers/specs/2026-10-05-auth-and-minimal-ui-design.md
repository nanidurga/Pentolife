# Sub-project — Accounts and Minimal UI

**Date:** 2026-10-05
**Status:** Draft for review
**Branch:** `frontend` (from `basic-features`)

## 1. Intent

PentoLive is used personally today, but the front end should behave like a real product: people create an account with email, a self-chosen username and a password, sign in with either their email or their username, and land on their dashboard at `/`. The whole UI moves to a light, monochrome, minimalist style.

### Success criteria

1. A new visitor can sign up with email + username + password, confirm by email, and arrive at `/` signed in, seeing their (empty) dashboard.
2. The sign-up form tells the user whether a username is available before they submit.
3. Two people can never own the same username, even if they submit at the same moment.
4. A user can sign in with either their email or their username. A failure never reveals which part was wrong or whether a username exists.
5. A user who forgot their password can reset it by email.
6. A signed-in user visiting `/` sees the dashboard; a signed-out user sees a minimal landing page.
7. Editor and viewer room links keep working without an account.
8. The existing owner account (magic link, no username, no password) keeps working: it is asked once to choose a username, and can set a password via "Forgot password".

### Non-goals

- Changing a username after sign-up, avatars, social login (Google etc.).
- Server-side (cookie) sessions. Pages stay client-rendered and check the session in the browser, like the current dashboard.
- Any change to sync, saving, presence or the Excalidraw canvas.

## 2. Routes and flow

| Route | Signed out | Signed in |
|---|---|---|
| `/` | Landing: wordmark, one sentence, **Create account** and **Sign in** | Dashboard: boards list, **New board**, `@username` menu with **Sign out** |
| `/signup` | Email, username (live availability), password, confirm password | Redirect to `/` |
| `/signin` | "Email or username", password, "Forgot password?" link | Redirect to `/` |
| `/forgot-password` | Email field; sends a reset link | Same |
| `/reset-password` | New password + confirm; reached from the reset email | Same |
| `/auth/callback` | Exchanges the `code` from confirmation emails, then goes to `/` | Same |
| `/dashboard` | Redirects to `/` | Redirects to `/` |
| `/login` | Redirects to `/signin` | Redirects to `/` |
| `/room/[roomId]` | Unchanged behaviour; restyled top bar | Same |

**Sign-up:** submit, then a "Check your inbox" screen with a **Resend email** button (`supabase.auth.resend`). Clicking the email link goes to `/auth/callback` and then `/`. If the email is already registered, Supabase returns a success-shaped response; the UI shows the same "Check your inbox" screen, so sign-up does not reveal which emails exist.

**Board creation requires an account.** The anonymous "Create a whiteboard" button is removed. Anonymous sessions remain only for people opening shared room links. The `local=1` fallback (no Supabase configured) stays for the room page but is no longer reachable from the home page.

**Session guard:** a `useSession()` hook returns `{ status: "loading" | "signed-in" | "signed-out", user, profile }`. It listens to `onAuthStateChange`. An anonymous Supabase user counts as signed-out. Pages render a neutral blank state while `loading`, so the landing page never flashes for a signed-in user.

## 3. Accounts and usernames

### 3.1 Database (`supabase/migrations/202610050001_usernames.sql`)

Written to be re-run safely.

- `alter table public.profiles add column if not exists username text;`
- A check constraint: `username is null or username ~ '^[a-z0-9_]{3,20}$'`.
- `create unique index if not exists profiles_username_key on public.profiles (username);`. Usernames are stored lowercase, so the plain unique index is case-insensitive in effect.
- `public.username_available(name text) returns boolean`: `security definer`, `set search_path = ''`, `stable`. It returns false when the name fails the format, is in the reserved list, or already exists. It is granted to `anon` and `authenticated`.
- Reserved list, kept in one SQL function `public.is_reserved_username(name text)` and mirrored in `lib/auth/username.ts`: `admin, administrator, api, app, auth, callback, dashboard, help, login, logout, me, null, pentolive, reset, room, rooms, root, settings, signin, signout, signup, support, system, undefined, user, www`.
- `public.create_profile_for_new_user()` is replaced so it reads `lower(new.raw_user_meta_data ->> 'username')`. When present it inserts it as `username`. A clash raises the unique violation, so `auth.signUp` fails and no user is created. When absent (old flow), it inserts a null username as before.
- `public.claim_username(name text) returns void`: `security definer`. It sets `username` for `auth.uid()` only if their current username is null and the name is available. This is used once by the existing owner account.
- `profiles` select policy is unchanged: users read only their own profile. Availability goes through `username_available`, never through table reads.

### 3.2 Sign-in Edge Function (`supabase/functions/auth/index.ts`)

- It takes one action, `signin`, with `{ identifier, password }`. It is deployed with `--no-verify-jwt`, because callers are signed out.
- Resolution lives in a pure helper `resolveIdentifier(identifier)` → `{ kind: "email", email } | { kind: "username", username } | { kind: "invalid" }`. It contains `@` → email (trimmed, lowercased). Otherwise, if it matches the username format after lowercasing → username. Otherwise → invalid.
- For a username, the service-role client reads `profiles.id` by username, then `auth.admin.getUserById(id)` for the email.
- The function then calls `signInWithPassword` on a publishable-key client and returns `{ access_token, refresh_token }`. The browser calls `supabase.auth.setSession`.
- Errors:
  - Unknown username, wrong password, or invalid identifier → `401 { error: "invalid_credentials" }`.
  - Supabase `email_not_confirmed` → `403 { error: "email_not_confirmed" }`. Supabase checks the password before returning this, so it only leaks to someone who already knows the password.
  - Anything else → `500 { error: "server_error" }`.
- The service-role key stays inside Edge Functions only.
- **Known trade-off:** Supabase's per-IP auth rate limit sees the function's IP, not the user's. That is acceptable for personal and small-scale use; revisit before a public launch.

### 3.3 Client auth library

- `lib/auth/username.ts` (pure, tested):
  - `normalizeUsername` (trim + lowercase).
  - `validateUsername` → `null | "too_short" | "too_long" | "invalid_chars" | "reserved"`.
  - `RESERVED_USERNAMES`.
- `lib/auth/password.ts` (pure, tested): `validatePassword` (min 8 characters) and `passwordsMatch`.
- `lib/auth/messages.ts` (pure, tested): maps error codes and Supabase errors to the UI copy, for example `invalid_credentials` → "Incorrect username/email or password." and a sign-up unique-violation (`Database error saving new user`) → "That username was just taken. Try another."
- `lib/auth/api.ts`: `signUp`, `signIn` (invokes the `auth` function, then `setSession`), `checkUsername` (RPC), `sendPasswordReset`, `updatePassword`, `resendConfirmation`, `claimUsername`, `signOut`.

### 3.4 Supabase project settings

These are applied through the Management API (`PATCH /v1/projects/{ref}/config/auth`), after confirming with the user:

- Email confirmations stay on.
- Minimum password length is 8.
- Redirect allow-list includes `<site>/auth/callback` and `<site>/reset-password` for localhost:3000 and the Vercel domain.

## 4. Visual system

All tokens are CSS variables in `app/globals.css`. No new styling dependency.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#fafafa` | Page background |
| `--surface` | `#ffffff` | Cards, header, top bar, dialogs |
| `--border` | `#e5e5e5` | 1px hairlines |
| `--text` | `#0a0a0a` | Body and headings; primary button fill |
| `--muted` | `#737373` | Secondary text |
| `--subtle` | `#a3a3a3` | Hints, placeholders |
| `--success` | `#16a34a` | "Available", "Saved" |
| `--warning` | `#b45309` | Offline, retrying |
| `--danger` | `#dc2626` | Errors, "Taken" |
| `--radius` | `6px` | All controls |

- `color-scheme: light`. Inter via `next/font/google`. Base size 15px; headings are weight 600, 24–28px; no hero-sized type.
- Spacing on a 4px scale. No shadows, except one soft shadow on the share dialog.
- **Buttons:** primary is solid `--text` fill with white text; secondary is white with a hairline border; a ghost variant is used for menu items. Focus rings are a 2px `--text` outline with offset.
- **Inputs:** white, hairline border, darkened on focus, with an inline error line under the field.

### Screens

- **Landing:** a centred narrow column with the wordmark, the sentence "A live whiteboard for technical interviews.", and two buttons.
- **AuthCard:** a ~360px column with heading, one line of help text, form, and footer link (sign-in ↔ sign-up).
- **UsernameField:** a 400ms debounced check that shows one of "Checking…", "✓ available" (green), "Taken" (red), or the format error. The submit button is disabled unless the username is valid and available.
- **Dashboard:**
  - Header: wordmark, spacer, **New board**, and an `@username` button opening a small menu with Sign out.
  - Body: a "Boards" heading and a list of rows, each with the title and a relative "Edited 2 days ago" time. Rows have hairline separators, and the hovered row gets a `--bg` background.
  - Empty state: one line and a **New board** button.
  - If `profile.username` is null, a one-time "Choose a username" card appears above the list (using `UsernameField` + `claimUsername`).
- **Board top bar, share dialog and link-error page:** restyled with the tokens. Copy stays in `lib/ui/statusLabels.ts`, unchanged. The Excalidraw canvas keeps its default light theme.

## 5. Files

New:
- `app/signup/page.tsx`
- `app/signin/page.tsx`
- `app/forgot-password/page.tsx`
- `app/reset-password/page.tsx`
- `components/auth/AuthCard.tsx`
- `components/auth/UsernameField.tsx`
- `components/auth/useSession.ts`
- `components/Dashboard.tsx`
- `components/Landing.tsx`
- `lib/auth/{username,password,messages,api}.ts` and their tests
- `supabase/functions/auth/index.ts`
- `supabase/functions/auth/resolve.ts` and its test
- `supabase/migrations/202610050001_usernames.sql`

Changed:
- `app/page.tsx`: switches between `Landing` and `Dashboard` on session status.
- `app/dashboard/page.tsx` and `app/login/page.tsx`: become redirects.
- `app/auth/callback/page.tsx`: finishes the code exchange, then goes to `/`.
- `app/layout.tsx`: loads the Inter font.
- `app/globals.css`: rewritten with the tokens.
- `components/StatusBar.tsx` and `components/ShareDialog.tsx`: class names only, where needed.
- `components/Board.tsx`: the "Go home" link styling only.

## 6. Testing and verification

- vitest covers:
  - username validation and normalization
  - password rules
  - error-message mapping
  - `resolveIdentifier`
- `npx tsc --noEmit`, `npm test` and `npm run build` must be green.
- Live checks after applying the migration and deploying the function:
  - `pg_proc` has `username_available`, `claim_username` and `is_reserved_username`.
  - The `profiles.username` constraint and index exist.
  - `supabase functions list` shows `auth`.
- Manual browser run:
  1. Sign up with a new email and username, confirm by email, and land on the dashboard.
  2. Sign out, then sign in by username, then by email.
  3. A wrong password shows the generic error.
  4. Forgot password → reset → sign in with the new password.
  5. Create a board, open it, and open its viewer link in a private window without an account.
  6. `/dashboard` and `/login` redirect correctly.

## 7. Deployment order

1. Apply the migration.
2. Deploy the `auth` function with `--no-verify-jwt`.
3. Update the auth config (redirect URLs, password length).
4. Ship the front end.

The front end depends on all three. The old magic-link `/login` route is removed only in step 4.
