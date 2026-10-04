# Accounts and Minimal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real sign-up / sign-in with email, self-chosen username and password; the dashboard at `/` for signed-in users; and a light, monochrome, minimalist UI across the app.

**Architecture:** Usernames live on `public.profiles`. They are reserved at sign-up by the existing profile trigger and checked live through a `security definer` RPC. A new `auth` Edge Function resolves "email or username" on the server and returns only session tokens, so emails never reach the browser. Pages stay client-rendered. A `useSession` hook decides between the landing page and the dashboard at `/`. Styling is plain CSS variables in `app/globals.css` plus Inter via `next/font`.

**Tech Stack:** Next.js 16.3 App Router, React, `@supabase/supabase-js` v2, Supabase Postgres + Edge Functions (Deno), vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-auth-and-minimal-ui-design.md`

## Global Constraints

- Branch: `frontend`. Never stage `next-env.d.ts`.
- Usernames match `^[a-z0-9_]{3,20}$`. They are stored lowercase. The reserved list is identical in `supabase/functions/_shared/username.ts` and `public.is_reserved_username()`.
- Minimum password length: 8.
- Sign-in failure copy is always "Incorrect username/email or password." It never reveals which part was wrong.
- The Supabase service-role key is used only inside Edge Functions. Nothing secret gets a `NEXT_PUBLIC_` prefix.
- Migrations must be safe to re-run (`if not exists`, `create or replace`, `drop ... if exists`).
- Excalidraw stays at exactly `0.18.1`, loaded via `next/dynamic` with `ssr: false`. `components/Board.tsx` sync logic is untouched.
- Room status copy stays in `lib/ui/statusLabels.ts`, unchanged.
- Colour tokens:
  - `--bg #fafafa`, `--surface #ffffff`, `--border #e5e5e5`
  - `--text #0a0a0a`, `--muted #737373`, `--subtle #a3a3a3`
  - `--success #16a34a`, `--warning #b45309`, `--danger #dc2626`
  - `--radius 6px`
- `npm test`, `npx tsc --noEmit` and `npm run build` must be green at the end of every task.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  ```
- Live Supabase changes (migration, function deploy, auth config) require the user's explicit go-ahead in the session before running.

## Review Focus

1. **Expired or already-used email links** (confirmation or reset). The callback and reset pages must show "This link is invalid or has expired." with a way forward. They must never hang on "Checking…". This is pinned by the `emailLinkError` tests in Task 2 and the failure branches in Task 9.
2. **People typing `@handle` or `Handle` into "Email or username".** It should resolve to the username `handle`. This is pinned by the `resolveIdentifier` tests in Task 1.
3. **Fast typing in the username field.** A slow availability response for an older value must never show "available" for the current value. This is pinned by the derived `checked.name === name` guard in Task 7, and checked manually in Task 11.
4. **Double-submitting a form** (pressing Enter twice, or a slow network). Each form ignores submits while `pending` and disables its button. This is in every page in Tasks 8–10.
5. **Availability check failing** (offline, RPC error). The field shows "Couldn't check availability" and still allows submit, because the database unique index is the real guard. This is pinned by the `unknown` status in Task 7 and the `authErrorMessage` mapping test in Task 2.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/username.ts` | Username format, reserved list, normalization, email-vs-username resolution. No imports; shared by Next and Deno. |
| `lib/auth/username.ts` | Re-exports the shared module for app code. |
| `lib/auth/password.ts` | Password rules. |
| `lib/auth/messages.ts` | All user-facing auth copy and error → copy mapping. |
| `lib/auth/api.ts` | Browser calls: sign up/in/out, availability, reset, claim, email-link finishing. |
| `lib/ui/relativeTime.ts` | "Edited 2 days ago" formatting. |
| `supabase/migrations/202610050001_usernames.sql` | Column, constraint, index, RPCs, trigger update. |
| `supabase/functions/auth/index.ts` | `signin` action. |
| `components/auth/Field.tsx` | Labelled input with inline message. |
| `components/auth/AuthCard.tsx` | Shared narrow layout for auth pages. |
| `components/auth/UsernameField.tsx` | Debounced availability check. |
| `components/auth/useSession.ts` | Session + profile state; `useRedirectWhenSignedIn`. |
| `components/Landing.tsx` | Signed-out home. |
| `components/Dashboard.tsx` | Signed-in home, including the one-time "Choose a username" card. |
| `app/{signup,signin,forgot-password,reset-password}/page.tsx` | Auth pages. |
| `app/page.tsx`, `app/auth/callback/page.tsx`, `app/layout.tsx`, `app/globals.css`, `next.config.ts` | Modified. |
| `app/dashboard/page.tsx`, `app/login/page.tsx` | Deleted. Replaced by redirects in `next.config.ts`. |

---

### Task 1: Shared username rules and identifier resolution

**Files:**
- Create: `supabase/functions/_shared/username.ts`
- Create: `lib/auth/username.ts`
- Test: `lib/auth/username.test.ts`

**Interfaces:**
- Produces:
  - `USERNAME_PATTERN: RegExp`
  - `RESERVED_USERNAMES: readonly string[]`
  - `type UsernameError = "too_short" | "too_long" | "invalid_chars" | "reserved"`
  - `normalizeUsername(raw: string): string`
  - `validateUsername(name: string): UsernameError | null`
  - `type Identifier = { kind: "email"; email: string } | { kind: "username"; username: string } | { kind: "invalid" }`
  - `resolveIdentifier(raw: string): Identifier`
  - All of the above are re-exported from `@/lib/auth/username`.

- [ ] **Step 1: Write the failing test** — `lib/auth/username.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { RESERVED_USERNAMES, normalizeUsername, resolveIdentifier, validateUsername } from "./username";

describe("normalizeUsername", () => {
  it("trims, lowercases and drops one leading @", () => {
    expect(normalizeUsername("  @Prajay_01 ")).toBe("prajay_01");
  });
});

describe("validateUsername", () => {
  it("accepts 3-20 lowercase letters, digits and underscores", () => {
    expect(validateUsername("abc")).toBeNull();
    expect(validateUsername("a_very_long_name_20c")).toBeNull();
  });

  it("rejects short, long, bad characters and reserved names", () => {
    expect(validateUsername("ab")).toBe("too_short");
    expect(validateUsername("a".repeat(21))).toBe("too_long");
    expect(validateUsername("pra jay")).toBe("invalid_chars");
    expect(validateUsername("prajay!")).toBe("invalid_chars");
    expect(validateUsername("Prajay")).toBe("invalid_chars");
    expect(validateUsername("admin")).toBe("reserved");
    expect(validateUsername("signin")).toBe("reserved");
  });

  it("reserves every top-level route name", () => {
    for (const route of ["api", "auth", "dashboard", "login", "room", "signin", "signup"]) {
      expect(RESERVED_USERNAMES).toContain(route);
    }
  });
});

describe("resolveIdentifier", () => {
  it("treats input containing @ as a lowercased email", () => {
    expect(resolveIdentifier("  Me@Example.com ")).toEqual({ kind: "email", email: "me@example.com" });
  });

  it("treats other input as a normalized username", () => {
    expect(resolveIdentifier(" Prajay ")).toEqual({ kind: "username", username: "prajay" });
  });

  it("accepts a leading @ on a username", () => {
    expect(resolveIdentifier("@prajay")).toEqual({ kind: "username", username: "prajay" });
  });

  it("rejects input that is neither", () => {
    expect(resolveIdentifier("no spaces allowed")).toEqual({ kind: "invalid" });
    expect(resolveIdentifier("")).toEqual({ kind: "invalid" });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run lib/auth/username.test.ts`
Expected: FAIL. The run reports it cannot resolve `./username`.

- [ ] **Step 3: Implement** — `supabase/functions/_shared/username.ts`

```ts
// Shared by the Next.js app (via lib/auth/username.ts) and the `auth` Edge Function.
// Keep RESERVED_USERNAMES identical to public.is_reserved_username() in
// supabase/migrations/202610050001_usernames.sql.
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export const RESERVED_USERNAMES: readonly string[] = [
  "admin", "administrator", "api", "app", "auth", "callback", "dashboard", "help", "login",
  "logout", "me", "null", "pentolive", "reset", "room", "rooms", "root", "settings", "signin",
  "signout", "signup", "support", "system", "undefined", "user", "www",
];

export type UsernameError = "too_short" | "too_long" | "invalid_chars" | "reserved";

export type Identifier =
  | { kind: "email"; email: string }
  | { kind: "username"; username: string }
  | { kind: "invalid" };

export function normalizeUsername(raw: string) {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export function validateUsername(name: string): UsernameError | null {
  if (name.length < 3) return "too_short";
  if (name.length > 20) return "too_long";
  if (!/^[a-z0-9_]+$/.test(name)) return "invalid_chars";
  if (RESERVED_USERNAMES.includes(name)) return "reserved";
  return null;
}

export function resolveIdentifier(raw: string): Identifier {
  const username = normalizeUsername(raw);
  if (username.includes("@")) return { kind: "email", email: raw.trim().toLowerCase() };
  return USERNAME_PATTERN.test(username) ? { kind: "username", username } : { kind: "invalid" };
}
```

Then `lib/auth/username.ts`:

```ts
export {
  RESERVED_USERNAMES,
  USERNAME_PATTERN,
  normalizeUsername,
  resolveIdentifier,
  validateUsername,
  type Identifier,
  type UsernameError,
} from "@/supabase/functions/_shared/username";
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run lib/auth/username.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/username.ts lib/auth/username.ts lib/auth/username.test.ts
git commit -m "feat(auth): shared username rules and identifier resolution

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Password rules and auth copy

**Files:**
- Create: `lib/auth/password.ts`
- Create: `lib/auth/messages.ts`
- Test: `lib/auth/password.test.ts`
- Test: `lib/auth/messages.test.ts`

**Interfaces:**
- Consumes: `UsernameError` from `@/lib/auth/username`.
- Produces:
  - `MIN_PASSWORD_LENGTH = 8`
  - `type PasswordError = "too_short" | "mismatch"`
  - `validatePassword(password: string, confirm: string): PasswordError | null`
  - `USERNAME_MESSAGES: Record<UsernameError, string>`
  - `PASSWORD_MESSAGES: Record<PasswordError, string>`
  - `EXPIRED_LINK_MESSAGE: string`
  - `GENERIC_ERROR_MESSAGE: string`
  - `signInMessage(code: string | undefined): string`
  - `authErrorMessage(error: { message?: string; code?: string; status?: number }): string`
  - `emailLinkError(search: string, hash: string): string | null`

- [ ] **Step 1: Write the failing tests**

`lib/auth/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validatePassword } from "./password";

describe("validatePassword", () => {
  it("needs at least 8 characters", () => {
    expect(validatePassword("short", "short")).toBe("too_short");
    expect(validatePassword("12345678", "12345678")).toBeNull();
  });

  it("needs the confirmation to match", () => {
    expect(validatePassword("longenough", "different")).toBe("mismatch");
    expect(validatePassword("longenough", "longenough")).toBeNull();
  });
});
```

`lib/auth/messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EXPIRED_LINK_MESSAGE, GENERIC_ERROR_MESSAGE, authErrorMessage, emailLinkError, signInMessage } from "./messages";

describe("signInMessage", () => {
  it("never says which credential was wrong", () => {
    expect(signInMessage("invalid_credentials")).toBe("Incorrect username/email or password.");
  });

  it("explains unconfirmed email, rate limits and network failures", () => {
    expect(signInMessage("email_not_confirmed")).toBe("Confirm your email first. Check your inbox for the link.");
    expect(signInMessage("rate_limited")).toBe("Too many attempts. Wait a minute and try again.");
    expect(signInMessage("network")).toBe("Can't reach the server. Check your connection.");
  });

  it("falls back to a generic message", () => {
    expect(signInMessage(undefined)).toBe(GENERIC_ERROR_MESSAGE);
    expect(signInMessage("server_error")).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe("authErrorMessage", () => {
  it("maps a sign-up rejected by the username index or trigger", () => {
    expect(authErrorMessage({ message: "Database error saving new user" })).toBe("That username isn't available. Try another.");
    expect(authErrorMessage({ message: "username_taken" })).toBe("That username isn't available. Try another.");
  });

  it("maps password and rate-limit errors", () => {
    expect(authErrorMessage({ code: "weak_password" })).toBe("Use at least 8 characters.");
    expect(authErrorMessage({ code: "same_password" })).toBe("Choose a password different from your current one.");
    expect(authErrorMessage({ code: "over_email_send_rate_limit" })).toBe("Too many attempts. Wait a minute and try again.");
    expect(authErrorMessage({ status: 429 })).toBe("Too many attempts. Wait a minute and try again.");
  });

  it("falls back to a generic message", () => {
    expect(authErrorMessage({ message: "something odd" })).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe("emailLinkError", () => {
  it("detects an expired link reported in the hash", () => {
    const hash = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
    expect(emailLinkError("", hash)).toBe(EXPIRED_LINK_MESSAGE);
  });

  it("detects an error reported in the query string", () => {
    expect(emailLinkError("?error=server_error", "")).toBe(EXPIRED_LINK_MESSAGE);
  });

  it("returns null for a normal link", () => {
    expect(emailLinkError("?code=abc", "")).toBeNull();
    expect(emailLinkError("", "#access_token=x&type=signup")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run lib/auth/password.test.ts lib/auth/messages.test.ts`
Expected: FAIL. The run reports it cannot resolve the modules.

- [ ] **Step 3: Implement**

`lib/auth/password.ts`:

```ts
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordError = "too_short" | "mismatch";

export function validatePassword(password: string, confirm: string): PasswordError | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password !== confirm) return "mismatch";
  return null;
}
```

`lib/auth/messages.ts`:

```ts
import type { PasswordError } from "./password";
import type { UsernameError } from "./username";

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Try again.";
export const EXPIRED_LINK_MESSAGE = "This link is invalid or has expired.";
const RATE_LIMITED = "Too many attempts. Wait a minute and try again.";
const USERNAME_UNAVAILABLE = "That username isn't available. Try another.";

export const USERNAME_MESSAGES: Record<UsernameError, string> = {
  too_short: "Use at least 3 characters.",
  too_long: "Use at most 20 characters.",
  invalid_chars: "Use lowercase letters, numbers and underscores only.",
  reserved: "That username is reserved.",
};

export const PASSWORD_MESSAGES: Record<PasswordError, string> = {
  too_short: "Use at least 8 characters.",
  mismatch: "Passwords don't match.",
};

export function signInMessage(code: string | undefined) {
  if (code === "invalid_credentials") return "Incorrect username/email or password.";
  if (code === "email_not_confirmed") return "Confirm your email first. Check your inbox for the link.";
  if (code === "rate_limited") return RATE_LIMITED;
  if (code === "network") return "Can't reach the server. Check your connection.";
  return GENERIC_ERROR_MESSAGE;
}

// Sign-up, claim and password errors from supabase-js or PostgREST.
export function authErrorMessage(error: { message?: string; code?: string; status?: number }) {
  // The unique index, format check and reserved-name check in the profile trigger
  // all surface from auth.signUp as this one message.
  if (error.message === "Database error saving new user" || error.message === "username_taken") return USERNAME_UNAVAILABLE;
  if (error.code === "weak_password") return PASSWORD_MESSAGES.too_short;
  if (error.code === "same_password") return "Choose a password different from your current one.";
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") return RATE_LIMITED;
  return GENERIC_ERROR_MESSAGE;
}

// Supabase reports a failed email link as `error`/`error_description` in the query or hash.
export function emailLinkError(search: string, hash: string) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  return query.has("error") || fragment.has("error") ? EXPIRED_LINK_MESSAGE : null;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run lib/auth && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/password.ts lib/auth/password.test.ts lib/auth/messages.ts lib/auth/messages.test.ts
git commit -m "feat(auth): password rules and auth error copy

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Usernames migration (write, apply live, verify)

**Files:**
- Create: `supabase/migrations/202610050001_usernames.sql`

**Interfaces:**
- Produces, in Postgres:
  - `public.profiles.username text`, which is unique and format-checked
  - `public.is_reserved_username(name text) returns boolean`
  - `public.username_available(name text) returns boolean`, executable by `anon` and `authenticated`
  - `public.claim_username(name text) returns void`, executable by `authenticated`. It raises `username_taken`, `username_already_set` or `not_signed_in`.
  - The profile trigger now stores `raw_user_meta_data ->> 'username'`.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Ask the user for the go-ahead to apply it to the live project.** Stop until they say yes.

- [ ] **Step 3: Apply via the Management API** (bash; `SCRATCH` is the session scratchpad path)

```bash
set -a && . ./.env.local && set +a
node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync("supabase/migrations/202610050001_usernames.sql","utf8")}))' > "$SCRATCH/mig.json"
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @"$SCRATCH/mig.json"
```

Expected: `[]`

- [ ] **Step 4: Re-run the same curl command to prove the migration is safe to re-run.** Expected: `[]` again.

- [ ] **Step 5: Verify the live objects.** Send each of these queries with the same curl pattern, putting the query in `{"query": "..."}`:

```sql
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('is_reserved_username','username_available','claim_username','create_profile_for_new_user') order by 1;
```

Expected: 4 rows.

```sql
select public.username_available('admin') as reserved, public.username_available('ab') as short, public.username_available('free_name_42') as free;
```

Expected: `reserved: false, short: false, free: true`.

```sql
select indexname from pg_indexes where tablename = 'profiles' and indexname = 'profiles_username_key';
```

Expected: 1 row.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202610050001_usernames.sql
git commit -m "feat(db): usernames on profiles with availability and claim RPCs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `auth` Edge Function (sign in with email or username)

**Files:**
- Create: `supabase/functions/auth/index.ts`

**Interfaces:**
- Consumes: `resolveIdentifier` from `../_shared/username.ts`.
- Produces: `POST /functions/v1/auth`, called with `{ action: "signin", identifier, password }`.
  - Success: `200 { access_token, refresh_token }`.
  - Wrong credentials: `401 { error: "invalid_credentials" }`.
  - Unconfirmed email: `403 { error: "email_not_confirmed" }`.
  - Rate limited: `429 { error: "rate_limited" }`.
  - Anything else: `500 { error: "server_error" }`.

- [ ] **Step 1: Write the function**

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveIdentifier } from "../_shared/username.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const invalid = () => json({ error: "invalid_credentials" }, 401);

// Callers are signed out, so this function is deployed with --no-verify-jwt.
// Every lookup failure returns the same 401 so sign-in never reveals which usernames exist.
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "server_error" }, 405);

  let body: { action?: unknown; identifier?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  if (body.action !== "signin" || typeof body.identifier !== "string" || typeof body.password !== "string" || !body.password) {
    return invalid();
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const identity = resolveIdentifier(body.identifier);

  let email: string | null = null;
  if (identity.kind === "email") email = identity.email;
  if (identity.kind === "username") {
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", options);
    const { data: profile } = await admin.from("profiles").select("id").eq("username", identity.username).maybeSingle();
    if (profile) {
      const { data } = await admin.auth.admin.getUserById(profile.id);
      email = data.user?.email ?? null;
    }
  }
  if (!email) return invalid();

  const publicClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", options);
  const { data, error } = await publicClient.auth.signInWithPassword({ email, password: body.password });
  if (error || !data.session) {
    if (error?.code === "email_not_confirmed") return json({ error: "email_not_confirmed" }, 403);
    if (error?.status === 429) return json({ error: "rate_limited" }, 429);
    if (error?.code === "invalid_credentials" || error?.status === 400) return invalid();
    return json({ error: "server_error" }, 500);
  }
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});
```

- [ ] **Step 2: Ask the user for the go-ahead to deploy.** Stop until they say yes.

- [ ] **Step 3: Deploy**

```bash
set -a && . ./.env.local && set +a
supabase functions deploy auth --project-ref "$SUPABASE_PROJECT_REF" --use-api --no-verify-jwt
supabase functions list --project-ref "$SUPABASE_PROJECT_REF"
```

Expected: `auth` is listed as `ACTIVE`.

- [ ] **Step 4: Smoke-test the failure paths.** Read `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from `.env.local` without printing them:

```bash
set -a && . ./.env.local && set +a
for id in nobody_here_123 "nobody@example.com" "bad id"; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$NEXT_PUBLIC_SUPABASE_URL/functions/v1/auth" \
    -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
    -d "{\"action\":\"signin\",\"identifier\":\"$id\",\"password\":\"wrong-password\"}"
done
```

Expected: `401` three times.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/auth/index.ts
git commit -m "feat(auth): edge function to sign in with email or username

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Client auth API

**Files:**
- Create: `lib/auth/api.ts`
- Test: `lib/auth/api.test.ts`

**Interfaces:**
- Consumes:
  - `getSupabase` from `@/lib/supabase`
  - `normalizeUsername` from Task 1
  - `signInMessage`, `authErrorMessage`, `emailLinkError`, `EXPIRED_LINK_MESSAGE` from Task 2
- Produces:
  - `type AuthResult = { ok: true } | { ok: false; message: string }`
  - `errorCodeFrom(error: unknown): Promise<string>`
  - `checkUsername(name: string): Promise<boolean | null>`. `null` means it couldn't check.
  - `signUp(input: { email: string; username: string; password: string }): Promise<AuthResult>`
  - `signIn(identifier: string, password: string): Promise<AuthResult>`
  - `resendConfirmation(email: string): Promise<AuthResult>`
  - `sendPasswordReset(email: string): Promise<AuthResult>`
  - `updatePassword(password: string): Promise<AuthResult>`
  - `claimUsername(name: string): Promise<AuthResult>`
  - `finishEmailLink(): Promise<AuthResult>`
  - `signOut(): Promise<void>`

- [ ] **Step 1: Write the failing test** — `lib/auth/api.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { errorCodeFrom } from "./api";

describe("errorCodeFrom", () => {
  it("reads the error code from the function's JSON response", async () => {
    const error = { context: new Response(JSON.stringify({ error: "invalid_credentials" }), { status: 401 }) };
    expect(await errorCodeFrom(error)).toBe("invalid_credentials");
  });

  it("reports network when the request never got a response", async () => {
    expect(await errorCodeFrom({ context: new TypeError("Failed to fetch") })).toBe("network");
    expect(await errorCodeFrom(new Error("boom"))).toBe("network");
  });

  it("falls back to server_error when the body is not our JSON", async () => {
    expect(await errorCodeFrom({ context: new Response("<html>", { status: 502 }) })).toBe("server_error");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run lib/auth/api.test.ts`
Expected: FAIL. The run reports it cannot resolve `./api`.

- [ ] **Step 3: Implement** — `lib/auth/api.ts`

```ts
import { getSupabase } from "@/lib/supabase";
import { EXPIRED_LINK_MESSAGE, authErrorMessage, emailLinkError, signInMessage } from "./messages";
import { normalizeUsername } from "./username";

export type AuthResult = { ok: true } | { ok: false; message: string };

const OK: AuthResult = { ok: true };
const NOT_CONFIGURED: AuthResult = { ok: false, message: "Supabase is not configured." };

const fail = (message: string): AuthResult => ({ ok: false, message });
const origin = () => window.location.origin;

// functions.invoke puts the HTTP Response on `error.context` for non-2xx replies,
// and the underlying fetch error there when the request never completed.
export async function errorCodeFrom(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return "network";
  try {
    const body = await context.json();
    return typeof body?.error === "string" ? body.error : "server_error";
  } catch {
    return "server_error";
  }
}

export async function checkUsername(name: string): Promise<boolean | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("username_available", { name });
  return error ? null : data === true;
}

export async function signUp(input: { email: string; username: string; password: string }): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: { data: { username: normalizeUsername(input.username) }, emailRedirectTo: `${origin()}/auth/callback` },
  });
  return error ? fail(authErrorMessage(error)) : OK;
}

export async function signIn(identifier: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.functions.invoke("auth", { body: { action: "signin", identifier, password } });
  if (error) return fail(signInMessage(await errorCodeFrom(error)));
  const { error: sessionError } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
  return sessionError ? fail(signInMessage(undefined)) : OK;
}

export async function resendConfirmation(email: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${origin()}/auth/callback` } });
  return error ? fail(authErrorMessage(error)) : OK;
}

export async function sendPasswordReset(email: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${origin()}/reset-password` });
  return error ? fail(authErrorMessage(error)) : OK;
}

export async function updatePassword(password: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.auth.updateUser({ password });
  return error ? fail(authErrorMessage(error)) : OK;
}

export async function claimUsername(name: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.rpc("claim_username", { name: normalizeUsername(name) });
  return error ? fail(authErrorMessage(error)) : OK;
}

// Confirmation and reset emails land here with either `?code=` (PKCE) or `#access_token=` (implicit,
// picked up by the client on load). The client may already have exchanged the code itself, and React
// may run this twice, so a failed exchange is not final: the session check below decides.
export async function finishEmailLink(): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return NOT_CONFIGURED;
  const linkError = emailLinkError(window.location.search, window.location.hash);
  if (linkError) return fail(linkError);
  const code = new URLSearchParams(window.location.search).get("code");
  if (code) await supabase.auth.exchangeCodeForSession(code);
  const { data: { session } } = await supabase.auth.getSession();
  return session && !session.user.is_anonymous ? OK : fail(EXPIRED_LINK_MESSAGE);
}

export async function signOut() {
  await getSupabase()?.auth.signOut();
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/api.ts lib/auth/api.test.ts
git commit -m "feat(auth): client auth api

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Visual system (tokens, Inter, restyled room)

**Files:**
- Modify: `app/layout.tsx`
- Rewrite: `app/globals.css`

**Interfaces:**
- Produces these CSS classes for later tasks:
  - Buttons: `.button`, `.primary`, `.block`, `.text-link`, `.small`
  - Layout: `.wordmark`, `.landing`, `.landing-inner`, `.actions`
  - Auth: `.auth-page`, `.auth-card`, `.auth-form`, `.auth-footer`
  - Fields: `.field`, `.field-label`, `.field-message` (with `.muted`, `.success`, `.danger`), `.form-error`
  - Dashboard: `.app-header`, `.spacer`, `.menu`, `.menu-panel`, `.menu-item`, `.dashboard`, `.section-head`, `.board-list`, `.board-row`, `.empty`, `.notice`, `.blank`
  - Existing room classes stay as they are.

- [ ] **Step 1: Load Inter** — `app/layout.tsx`

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "PentoLive",
  description: "A live whiteboard for technical interviews",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={inter.variable}><body>{children}</body></html>;
}
```

- [ ] **Step 2: Replace `app/globals.css` entirely**

```css
@import "@excalidraw/excalidraw/index.css";

:root {
  color-scheme: light;
  --bg: #fafafa;
  --surface: #ffffff;
  --border: #e5e5e5;
  --border-strong: #d4d4d4;
  --text: #0a0a0a;
  --muted: #737373;
  --subtle: #a3a3a3;
  --success: #16a34a;
  --warning: #b45309;
  --danger: #dc2626;
  --radius: 6px;
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: var(--bg); color: var(--text); font-family: var(--font-sans), system-ui, sans-serif; font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
h1, h2 { font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; margin: 0; }
h1 { font-size: 26px; }
h2 { font-size: 17px; }
p { margin: 0; }
button { font: inherit; cursor: pointer; }
:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.muted { color: var(--muted); }
.blank { min-height: 100vh; }

/* Buttons and links */
.button, .primary, .copy { align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); display: inline-flex; font-size: 14px; font-weight: 500; gap: 6px; height: 36px; justify-content: center; padding: 0 14px; text-decoration: none; white-space: nowrap; }
.button:hover, .copy:hover { background: var(--bg); border-color: var(--border-strong); }
.primary { background: var(--text); border-color: var(--text); color: #fff; }
.primary:hover { background: #262626; }
.button:disabled, .primary:disabled, .copy:disabled { cursor: not-allowed; opacity: .5; }
.block { width: 100%; }
.text-link { color: var(--text); font-weight: 500; text-underline-offset: 3px; }
.small { font-size: 13px; }
.wordmark { color: var(--text); font-weight: 600; letter-spacing: -0.02em; text-decoration: none; }

/* Landing */
.landing { display: grid; min-height: 100vh; padding: 24px 16px; place-items: center; }
.landing-inner { display: grid; gap: 12px; max-width: 440px; width: 100%; }
.landing h1 { font-size: 32px; margin-top: 32px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }

/* Auth */
.auth-page { display: grid; min-height: 100vh; padding: 24px 16px; place-items: center; }
.auth-card { display: grid; gap: 8px; max-width: 360px; width: 100%; }
.auth-card h1 { margin-top: 32px; }
.auth-form { display: grid; gap: 16px; margin-top: 24px; }
.auth-footer { color: var(--muted); font-size: 14px; margin-top: 16px; }
.field { display: grid; gap: 6px; }
.field-label { align-items: baseline; display: flex; font-size: 13px; font-weight: 500; justify-content: space-between; }
.field input { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font: inherit; height: 40px; padding: 0 12px; width: 100%; }
.field input:focus { border-color: var(--text); outline: none; }
.field input::placeholder { color: var(--subtle); }
.field input[aria-invalid="true"] { border-color: var(--danger); }
.field-message { color: var(--muted); font-size: 13px; }
.field-message.success { color: var(--success); }
.field-message.danger, .form-error { color: var(--danger); }
.form-error { font-size: 14px; }

/* App shell and dashboard */
.app-header { align-items: center; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; gap: 8px; height: 56px; padding: 0 max(16px, calc((100vw - 880px) / 2)); }
.spacer { flex: 1; }
.menu { position: relative; }
.menu summary { list-style: none; }
.menu summary::-webkit-details-marker { display: none; }
.menu-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); display: grid; min-width: 160px; padding: 4px; position: absolute; right: 0; top: calc(100% + 6px); z-index: 10; }
.menu-item { background: none; border: 0; border-radius: 4px; color: var(--text); font-size: 14px; padding: 8px 10px; text-align: left; }
.menu-item:hover { background: var(--bg); }
.dashboard { display: grid; gap: 20px; margin: 0 auto; max-width: 880px; padding: 40px 16px; }
.section-head { align-items: baseline; display: flex; gap: 12px; justify-content: space-between; }
.board-list { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); list-style: none; margin: 0; overflow: hidden; padding: 0; }
.board-row { align-items: center; background: none; border: 0; border-bottom: 1px solid var(--border); color: var(--text); display: flex; gap: 16px; justify-content: space-between; padding: 14px 16px; text-align: left; width: 100%; }
.board-list li:last-child .board-row { border-bottom: 0; }
.board-row:hover { background: var(--bg); }
.board-row strong { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-row span { color: var(--muted); font-size: 13px; white-space: nowrap; }
.empty { border: 1px dashed var(--border-strong); border-radius: var(--radius); display: grid; gap: 12px; justify-items: start; padding: 32px 24px; }
.notice { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); display: grid; gap: 4px; padding: 20px; }
.notice .auth-form { margin-top: 12px; max-width: 360px; }

/* Room */
.room { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
.topbar { align-items: center; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; flex-wrap: wrap; font-size: 13px; gap: 16px; min-height: 48px; padding: 6px 16px; }
.brand { font-weight: 600; letter-spacing: -0.02em; }
.status { color: var(--success); font-weight: 500; margin-right: auto; }
.status.offline { color: var(--warning); }
.presence, .save { color: var(--muted); }
.save.warn { color: var(--warning); }
.topbar .copy { height: 32px; }
.canvas { min-height: 0; position: relative; }
.loading { align-items: center; color: var(--muted); display: flex; height: 100%; justify-content: center; }
.share-backdrop { align-items: center; background: rgba(10, 10, 10, .24); display: flex; inset: 0; justify-content: center; padding: 16px; position: fixed; z-index: 50; }
.share-dialog { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 30px rgba(0, 0, 0, .08); display: grid; gap: 20px; max-height: 100%; overflow: auto; padding: 24px; width: min(400px, 100%); }
.share-block { display: grid; gap: 8px; }
.share-qr { background: #fff; border: 1px solid var(--border); border-radius: var(--radius); height: 240px; justify-self: center; width: 240px; }
.share-link { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font: inherit; font-size: 13px; padding: 8px 10px; width: 100%; }
.share-close { justify-self: end; }
.link-error { align-content: center; display: grid; gap: 12px; justify-items: start; margin: 0 auto; max-width: 440px; min-height: 100vh; padding: 24px 16px; }

@media (max-width: 640px) {
  .topbar { gap: 10px; padding: 6px 10px; }
  .brand { display: none; }
  .landing h1 { font-size: 26px; }
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green. `StatusBar`, `ShareDialog` and `Board` keep their class names, so they need no code change.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "style: light monochrome design tokens and Inter

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Auth building blocks (Field, AuthCard, UsernameField, useSession)

**Files:**
- Create: `components/auth/Field.tsx`
- Create: `components/auth/AuthCard.tsx`
- Create: `components/auth/UsernameField.tsx`
- Create: `components/auth/useSession.ts`

**Interfaces:**
- Consumes:
  - `checkUsername` (Task 5)
  - `USERNAME_MESSAGES` (Task 2)
  - `normalizeUsername`, `validateUsername` (Task 1)
- Produces:
  - `type FieldMessage = { text: string; tone: "muted" | "success" | "danger" }`
  - `<Field label message? aside? ...inputProps />`
  - `<AuthCard title subtitle? footer?>{children?}</AuthCard>`
  - `type UsernameStatus = "empty" | "invalid" | "checking" | "available" | "taken" | "unknown"`
  - `<UsernameField value onChange(value) onStatus(status) />`
  - `type SessionState = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; user: User; profile: { username: string | null } }`
  - `useSession(): SessionState & { reload(): void }`
  - `useRedirectWhenSignedIn(): void`

- [ ] **Step 1: `components/auth/Field.tsx`**

```tsx
import { useId, type InputHTMLAttributes, type ReactNode } from "react";

export type FieldMessage = { text: string; tone: "muted" | "success" | "danger" };

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; message?: FieldMessage | null; aside?: ReactNode };

export default function Field({ label, message, aside, ...input }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  return <div className="field">
    <div className="field-label"><label htmlFor={id}>{label}</label>{aside}</div>
    <input id={id} aria-describedby={message ? messageId : undefined} aria-invalid={message?.tone === "danger" || undefined} {...input} />
    {message && <span id={messageId} className={`field-message ${message.tone}`} aria-live="polite">{message.text}</span>}
  </div>;
}
```

- [ ] **Step 2: `components/auth/AuthCard.tsx`**

```tsx
import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthCard({ title, subtitle, footer, children }: { title: string; subtitle?: string; footer?: ReactNode; children?: ReactNode }) {
  return <main className="auth-page"><section className="auth-card">
    <Link href="/" className="wordmark">PentoLive</Link>
    <h1>{title}</h1>
    {subtitle && <p className="muted">{subtitle}</p>}
    {children}
    {footer && <p className="auth-footer">{footer}</p>}
  </section></main>;
}
```

- [ ] **Step 3: `components/auth/UsernameField.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Field, { type FieldMessage } from "@/components/auth/Field";
import { checkUsername } from "@/lib/auth/api";
import { USERNAME_MESSAGES } from "@/lib/auth/messages";
import { normalizeUsername, validateUsername } from "@/lib/auth/username";

export type UsernameStatus = "empty" | "invalid" | "checking" | "available" | "taken" | "unknown";

type Checked = { name: string; status: "available" | "taken" | "unknown" };

const CHECK_DELAY_MS = 400;

export default function UsernameField({ value, onChange, onStatus }: {
  value: string;
  onChange: (value: string) => void;
  onStatus: (status: UsernameStatus) => void;
}) {
  const name = normalizeUsername(value);
  const formatError = name ? validateUsername(name) : null;
  const [checked, setChecked] = useState<Checked | null>(null);

  useEffect(() => {
    if (!name || formatError) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const available = await checkUsername(name);
      if (!stale) setChecked({ name, status: available === null ? "unknown" : available ? "available" : "taken" });
    }, CHECK_DELAY_MS);
    return () => { stale = true; clearTimeout(timer); };
  }, [name, formatError]);

  // A result only counts for the exact name it was checked for, so a slow reply never labels newer input.
  const status: UsernameStatus = !name ? "empty" : formatError ? "invalid" : checked?.name === name ? checked.status : "checking";

  useEffect(() => { onStatus(status); }, [status, onStatus]);

  const message: FieldMessage =
    formatError ? { text: USERNAME_MESSAGES[formatError], tone: "danger" }
    : status === "checking" ? { text: "Checking…", tone: "muted" }
    : status === "available" ? { text: `@${name} is available`, tone: "success" }
    : status === "taken" ? { text: "That username is taken.", tone: "danger" }
    : status === "unknown" ? { text: "Couldn't check availability. You can still continue.", tone: "muted" }
    : { text: "3–20 characters: lowercase letters, numbers, underscores.", tone: "muted" };

  return <Field label="Username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required
    placeholder="yourname" value={value} onChange={(event) => onChange(event.target.value.toLowerCase())} message={message} />;
}
```

- [ ] **Step 4: `components/auth/useSession.ts`**

```ts
"use client";

import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: User; profile: { username: string | null } };

// Anonymous users (people who only opened a shared room link) count as signed out.
export function useSession(): SessionState & { reload: () => void } {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setState({ status: "signed-out" });
      return;
    }
    let cancelled = false;
    async function load(user: User | null) {
      if (!user || user.is_anonymous) {
        if (!cancelled) setState({ status: "signed-out" });
        return;
      }
      const { data } = await supabase!.from("profiles").select("username").eq("id", user.id).maybeSingle();
      if (!cancelled) setState({ status: "signed-in", user, profile: { username: data?.username ?? null } });
    }
    // Supabase must not be called from inside the auth callback itself (it can deadlock), so defer.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => void load(session?.user ?? null), 0);
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [version]);

  return { ...state, reload: () => setVersion((value) => value + 1) };
}

export function useRedirectWhenSignedIn() {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session.status === "signed-in") router.replace("/");
  }, [session.status, router]);
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add components/auth
git commit -m "feat(auth): form field, auth card, username field and session hook

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Sign-up and sign-in pages

**Files:**
- Create: `app/signup/page.tsx`
- Create: `app/signin/page.tsx`

**Interfaces:**
- Consumes:
  - `AuthCard`, `Field`, `UsernameField`, `UsernameStatus`, `useRedirectWhenSignedIn` (Task 7)
  - `signUp`, `signIn`, `resendConfirmation` (Task 5)
  - `PASSWORD_MESSAGES` (Task 2)
  - `validatePassword` (Task 2)

- [ ] **Step 1: `app/signup/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import AuthCard from "@/components/auth/AuthCard";
import Field from "@/components/auth/Field";
import UsernameField, { type UsernameStatus } from "@/components/auth/UsernameField";
import { useRedirectWhenSignedIn } from "@/components/auth/useSession";
import { resendConfirmation, signUp } from "@/lib/auth/api";
import { PASSWORD_MESSAGES } from "@/lib/auth/messages";
import { validatePassword } from "@/lib/auth/password";

export default function SignUpPage() {
  useRedirectWhenSignedIn();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("empty");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const passwordError = validatePassword(password, confirm);
  const usernameOk = usernameStatus === "available" || usernameStatus === "unknown";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!usernameOk) return setError("Choose an available username.");
    if (passwordError) return setError(PASSWORD_MESSAGES[passwordError]);
    setPending(true);
    setError("");
    const result = await signUp({ email, username, password });
    setPending(false);
    if (result.ok) setSentTo(email.trim());
    else setError(result.message);
  }

  if (sentTo) {
    return <AuthCard title="Check your inbox" subtitle={`We sent a confirmation link to ${sentTo}. Open it to finish creating your account.`}
      footer={<Link className="text-link" href="/signin">Back to sign in</Link>}>
      <ResendButton email={sentTo} />
    </AuthCard>;
  }

  return <AuthCard title="Create your account" subtitle="Your boards are saved to your account."
    footer={<>Already have an account? <Link className="text-link" href="/signin">Sign in</Link></>}>
    <form className="auth-form" onSubmit={submit}>
      <Field label="Email" type="email" name="email" autoComplete="email" required placeholder="you@example.com"
        value={email} onChange={(event) => setEmail(event.target.value)} />
      <UsernameField value={username} onChange={setUsername} onStatus={setUsernameStatus} />
      <Field label="Password" type="password" autoComplete="new-password" required
        value={password} onChange={(event) => setPassword(event.target.value)}
        message={password && passwordError === "too_short" ? { text: PASSWORD_MESSAGES.too_short, tone: "danger" } : { text: "At least 8 characters.", tone: "muted" }} />
      <Field label="Confirm password" type="password" autoComplete="new-password" required
        value={confirm} onChange={(event) => setConfirm(event.target.value)}
        message={confirm && passwordError === "mismatch" ? { text: PASSWORD_MESSAGES.mismatch, tone: "danger" } : null} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary block" type="submit" disabled={pending}>{pending ? "Creating account…" : "Create account"}</button>
    </form>
  </AuthCard>;
}

function ResendButton({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function resend() {
    setState("sending");
    const result = await resendConfirmation(email);
    setState(result.ok ? "sent" : "failed");
  }

  return <div className="auth-form">
    <button className="button block" type="button" onClick={resend} disabled={state === "sending" || state === "sent"}>
      {state === "sending" ? "Sending…" : state === "sent" ? "Email sent again" : "Resend email"}
    </button>
    {state === "failed" && <p className="form-error" role="alert">Couldn&apos;t resend. Wait a minute and try again.</p>}
  </div>;
}
```

- [ ] **Step 2: `app/signin/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import AuthCard from "@/components/auth/AuthCard";
import Field from "@/components/auth/Field";
import { useRedirectWhenSignedIn } from "@/components/auth/useSession";
import { signIn } from "@/lib/auth/api";

export default function SignInPage() {
  useRedirectWhenSignedIn();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const result = await signIn(identifier, password);
    if (result.ok) return router.replace("/");
    setPending(false);
    setError(result.message);
  }

  return <AuthCard title="Sign in" subtitle="Welcome back."
    footer={<>New to PentoLive? <Link className="text-link" href="/signup">Create an account</Link></>}>
    <form className="auth-form" onSubmit={submit}>
      <Field label="Email or username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required
        value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
      <Field label="Password" type="password" name="password" autoComplete="current-password" required
        value={password} onChange={(event) => setPassword(event.target.value)}
        aside={<Link className="text-link small" href="/forgot-password">Forgot password?</Link>} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary block" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  </AuthCard>;
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: green. The build output lists `/signup` and `/signin`.

- [ ] **Step 4: Commit**

```bash
git add app/signup app/signin
git commit -m "feat(auth): sign-up with username and sign-in with email or username

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Forgot password, reset password, and email-link callback

**Files:**
- Create: `app/forgot-password/page.tsx`
- Create: `app/reset-password/page.tsx`
- Rewrite: `app/auth/callback/page.tsx`

**Interfaces:**
- Consumes:
  - `sendPasswordReset`, `updatePassword`, `finishEmailLink` (Task 5)
  - `validatePassword`, `PASSWORD_MESSAGES` (Task 2)
  - `AuthCard`, `Field` (Task 7)

- [ ] **Step 1: `app/forgot-password/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import AuthCard from "@/components/auth/AuthCard";
import Field from "@/components/auth/Field";
import { sendPasswordReset } from "@/lib/auth/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const result = await sendPasswordReset(email);
    setPending(false);
    if (result.ok) setSentTo(email.trim());
    else setError(result.message);
  }

  if (sentTo) {
    return <AuthCard title="Check your inbox" subtitle={`If an account uses ${sentTo}, we sent it a link to reset the password.`}
      footer={<Link className="text-link" href="/signin">Back to sign in</Link>} />;
  }

  return <AuthCard title="Reset your password" subtitle="Enter your account email and we'll send you a reset link."
    footer={<>Remembered it? <Link className="text-link" href="/signin">Sign in</Link></>}>
    <form className="auth-form" onSubmit={submit}>
      <Field label="Email" type="email" name="email" autoComplete="email" required placeholder="you@example.com"
        value={email} onChange={(event) => setEmail(event.target.value)} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary block" type="submit" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  </AuthCard>;
}
```

- [ ] **Step 2: `app/reset-password/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import AuthCard from "@/components/auth/AuthCard";
import Field from "@/components/auth/Field";
import { finishEmailLink, updatePassword } from "@/lib/auth/api";
import { PASSWORD_MESSAGES } from "@/lib/auth/messages";
import { validatePassword } from "@/lib/auth/password";

type LinkState = { state: "checking" } | { state: "ready" } | { state: "failed"; message: string };

export default function ResetPasswordPage() {
  const router = useRouter();
  const [link, setLink] = useState<LinkState>({ state: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    finishEmailLink().then((result) => setLink(result.ok ? { state: "ready" } : { state: "failed", message: result.message }));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const problem = validatePassword(password, confirm);
    if (problem) return setError(PASSWORD_MESSAGES[problem]);
    setPending(true);
    setError("");
    const result = await updatePassword(password);
    if (result.ok) return router.replace("/");
    setPending(false);
    setError(result.message);
  }

  if (link.state === "checking") return <AuthCard title="Reset your password" subtitle="Checking your link…" />;
  if (link.state === "failed") {
    return <AuthCard title="Link expired" subtitle={link.message}
      footer={<Link className="text-link" href="/forgot-password">Send a new link</Link>} />;
  }

  return <AuthCard title="Choose a new password">
    <form className="auth-form" onSubmit={submit}>
      <Field label="New password" type="password" autoComplete="new-password" required
        value={password} onChange={(event) => setPassword(event.target.value)} message={{ text: "At least 8 characters.", tone: "muted" }} />
      <Field label="Confirm new password" type="password" autoComplete="new-password" required
        value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary block" type="submit" disabled={pending}>{pending ? "Saving…" : "Update password"}</button>
    </form>
  </AuthCard>;
}
```

- [ ] **Step 3: Rewrite `app/auth/callback/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AuthCard from "@/components/auth/AuthCard";
import { finishEmailLink } from "@/lib/auth/api";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    finishEmailLink().then((result) => {
      if (result.ok) router.replace("/");
      else setFailure(result.message);
    });
  }, [router]);

  if (failure) {
    return <AuthCard title="Link expired" subtitle={failure}
      footer={<Link className="text-link" href="/signin">Go to sign in</Link>} />;
  }
  return <AuthCard title="Signing you in…" />;
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add app/forgot-password app/reset-password app/auth/callback/page.tsx
git commit -m "feat(auth): password reset and email-link callback with expired-link handling

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Home: landing or dashboard, plus redirects for old routes

**Files:**
- Create: `lib/ui/relativeTime.ts`
- Test: `lib/ui/relativeTime.test.ts`
- Create: `components/Landing.tsx`
- Create: `components/Dashboard.tsx`
- Rewrite: `app/page.tsx`
- Modify: `next.config.ts`
- Delete: `app/dashboard/page.tsx`, `app/login/page.tsx`

**Interfaces:**
- Consumes:
  - `useSession` (Task 7)
  - `UsernameField`, `UsernameStatus` (Task 7)
  - `claimUsername`, `signOut` (Task 5)
  - `getSupabase` from `@/lib/supabase`
- Produces:
  - `relativeTime(date: Date, now: Date): string`
  - `<Landing />`
  - `<Dashboard username={string | null} onProfileChange={() => void} />`

- [ ] **Step 1: Write the failing test** — `lib/ui/relativeTime.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

const now = new Date("2026-10-05T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("says just now under a minute", () => {
    expect(relativeTime(ago(30_000), now)).toBe("just now");
  });

  it("uses minutes, hours and days", () => {
    expect(relativeTime(ago(5 * MIN), now)).toBe("5 minutes ago");
    expect(relativeTime(ago(3 * HOUR), now)).toBe("3 hours ago");
    expect(relativeTime(ago(DAY), now)).toBe("yesterday");
    expect(relativeTime(ago(2 * DAY), now)).toBe("2 days ago");
  });

  it("falls back to a date after 30 days", () => {
    expect(relativeTime(new Date("2026-08-21T12:00:00Z"), now)).toBe("Aug 21, 2026");
  });

  it("treats future timestamps (clock skew) as just now", () => {
    expect(relativeTime(new Date(now.getTime() + 5 * MIN), now)).toBe("just now");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run lib/ui/relativeTime.test.ts`
Expected: FAIL. The run reports it cannot resolve `./relativeTime`.

- [ ] **Step 3: Implement** — `lib/ui/relativeTime.ts`

```ts
const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(date: Date, now: Date) {
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return formatter.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return formatter.format(-Math.floor(elapsed / HOUR), "hour");
  if (elapsed < 30 * DAY) return formatter.format(-Math.floor(elapsed / DAY), "day");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
```

Run: `npx vitest run lib/ui/relativeTime.test.ts`
Expected: PASS.

- [ ] **Step 4: `components/Landing.tsx`**

```tsx
import Link from "next/link";

export default function Landing() {
  return <main className="landing"><div className="landing-inner">
    <span className="wordmark">PentoLive</span>
    <h1>A live whiteboard for technical interviews.</h1>
    <p className="muted">Draw on your tablet. Your interviewer follows along from one private link.</p>
    <div className="actions">
      <Link className="primary" href="/signup">Create account</Link>
      <Link className="button" href="/signin">Sign in</Link>
    </div>
  </div></main>;
}
```

- [ ] **Step 5: `components/Dashboard.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import UsernameField, { type UsernameStatus } from "@/components/auth/UsernameField";
import { claimUsername, signOut } from "@/lib/auth/api";
import { getSupabase } from "@/lib/supabase";
import { relativeTime } from "@/lib/ui/relativeTime";

type Board = { id: string; title: string; updated_at: string };
type RoomRequest = { action: "create" } | { action: "owner-access"; roomId: string };

export default function Dashboard({ username, onProfileChange }: { username: string | null; onProfileChange: () => void }) {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getSupabase()?.from("rooms").select("id,title,updated_at").order("updated_at", { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) setError("Couldn't load your boards. Refresh to try again.");
        setBoards(data ?? []);
      });
  }, []);

  async function enter(body: RoomRequest) {
    const supabase = getSupabase();
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    const { data, error: openError } = await supabase.functions.invoke("rooms", { body });
    if (!openError && data?.roomId) {
      router.push(`/room/${data.roomId}?role=editor&token=${data.editorToken}&viewer=${data.viewerToken}`);
      return;
    }
    setBusy(false);
    setError("Couldn't open the board. Try again.");
  }

  const now = new Date();

  return <>
    <header className="app-header">
      <Link href="/" className="wordmark">PentoLive</Link>
      <span className="spacer" />
      <button className="primary" onClick={() => enter({ action: "create" })} disabled={busy}>New board</button>
      <details className="menu">
        <summary className="button">{username ? `@${username}` : "Account"}</summary>
        <div className="menu-panel"><button className="menu-item" onClick={() => signOut()}>Sign out</button></div>
      </details>
    </header>
    <main className="dashboard">
      {!username && <ClaimUsername onClaimed={onProfileChange} />}
      <div className="section-head"><h1>Boards</h1>{boards && boards.length > 0 && <span className="muted">{boards.length}</span>}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {boards === null ? <p className="muted">Loading…</p>
        : boards.length === 0 ? <div className="empty">
          <p className="muted">No boards yet.</p>
          <button className="primary" onClick={() => enter({ action: "create" })} disabled={busy}>New board</button>
        </div>
        : <ul className="board-list">{boards.map((board) => <li key={board.id}>
          <button className="board-row" onClick={() => enter({ action: "owner-access", roomId: board.id })} disabled={busy}>
            <strong>{board.title}</strong><span>Edited {relativeTime(new Date(board.updated_at), now)}</span>
          </button>
        </li>)}</ul>}
    </main>
  </>;
}

function ClaimUsername({ onClaimed }: { onClaimed: () => void }) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<UsernameStatus>("empty");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const ready = status === "available" || status === "unknown";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !ready) return;
    setPending(true);
    setError("");
    const result = await claimUsername(value);
    setPending(false);
    if (result.ok) onClaimed();
    else setError(result.message);
  }

  return <section className="notice">
    <h2>Choose a username</h2>
    <p className="muted">You can sign in with it instead of your email.</p>
    <form className="auth-form" onSubmit={submit}>
      <UsernameField value={value} onChange={setValue} onStatus={setStatus} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={pending || !ready}>{pending ? "Saving…" : "Save username"}</button>
    </form>
  </section>;
}
```

- [ ] **Step 6: Rewrite `app/page.tsx`**

```tsx
"use client";

import Dashboard from "@/components/Dashboard";
import Landing from "@/components/Landing";
import { useSession } from "@/components/auth/useSession";

export default function Home() {
  const session = useSession();
  if (session.status === "loading") return <main className="blank" aria-busy="true" />;
  if (session.status === "signed-out") return <Landing />;
  return <Dashboard username={session.profile.username} onProfileChange={session.reload} />;
}
```

- [ ] **Step 7: Redirect the old routes.** In `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/dashboard", destination: "/", permanent: false },
      { source: "/login", destination: "/signin", permanent: false },
    ];
  },
};

export default nextConfig;
```

Then delete the old pages:

```bash
git rm app/dashboard/page.tsx app/login/page.tsx
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: green. The build no longer lists `/dashboard` or `/login` as pages.

Run `grep -rn "ensureAnonymousSession\|/dashboard\|/login" app components lib`.
Expected:
- `ensureAnonymousSession` appears only in `lib/supabase.ts` and `components/Board.tsx`, if Board uses it.
- There are no links to `/dashboard` or `/login`.

- [ ] **Step 9: Commit**

```bash
git add lib/ui/relativeTime.ts lib/ui/relativeTime.test.ts components/Landing.tsx components/Dashboard.tsx app/page.tsx next.config.ts
git commit -m "feat(home): dashboard at / when signed in, minimal landing otherwise

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Supabase auth settings and end-to-end verification

**Files:**
- Modify: `AGENTS.md` (Layout section: new routes and the `auth` function)

- [ ] **Step 1: Read the current auth config.** Print only the relevant keys:

```bash
set -a && . ./.env.local && set +a
curl -s "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log(JSON.stringify({site_url:c.site_url,uri_allow_list:c.uri_allow_list,mailer_autoconfirm:c.mailer_autoconfirm,password_min_length:c.password_min_length,smtp_host:c.smtp_host?"(custom)":null},null,2))})'
```

- [ ] **Step 2: Show the user the proposed change and ask for the go-ahead.**
  - The change: `password_min_length: 8`, `mailer_autoconfirm: false`, and `uri_allow_list` extended with `http://localhost:3000/auth/callback`, `http://localhost:3000/reset-password`, `<site_url>/auth/callback` and `<site_url>/reset-password`. Keep the existing entries.
  - Tell them that without custom SMTP, Supabase's built-in email sender only delivers to the project's team members and is rate-limited. Other people's sign-ups need custom SMTP before launch.

- [ ] **Step 3: Apply the change** with a `PATCH` to the same URL, sending a JSON body that holds the three fields. Then re-run Step 1 and confirm the values.

- [ ] **Step 4: Full checks**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 5: Manual browser run on `npm run dev`.** Record each result.
  1. `/` signed out shows the landing page. `/dashboard` goes to `/`, and `/login` goes to `/signin`.
  2. `/signup`:
     - Typing `admin` shows "reserved".
     - Typing fast and then settling on a free name ends on "available" for that exact name.
  3. Ask the user's permission first. Then sign up a throwaway account (`pentolive-e2e-<timestamp>@example.com`, username `e2e_<timestamp>`). Confirm it with SQL through the Management API (`update auth.users set email_confirmed_at = now() where email = '<that email>'`), because example.com can't receive mail.
  4. Sign in using that account:
     - by username
     - by `@username`
     - by email
     - with a wrong password, which shows the generic error
  5. Signed in, `/` shows the dashboard. Create a board, return to it from the list, and open its viewer link in a private window with no account.
  6. Visit `/auth/callback#error=access_denied&error_code=otp_expired` and see "Link expired".
  7. Delete the throwaway user: `delete from auth.users where email = '<that email>'`.
  8. The user then runs the real-email flows themselves on their own address: sign-up confirmation, and forgot → reset password.
  9. Stop the dev server (see the AGENTS.md gotcha on ports 3000/3123).

- [ ] **Step 6: Update `AGENTS.md`.** Replace the `dashboard`, `login` and `auth/callback` bullet under Layout → `app/` with:

```markdown
  - `/` shows the landing page when signed out and the dashboard when signed in. `signup`, `signin`, `forgot-password`, `reset-password` and `auth/callback` handle email + password accounts with self-chosen usernames.
```

Also add under the `supabase/functions/rooms/index.ts` bullet:

```markdown
- `supabase/functions/auth/index.ts`: resolves "email or username" for sign-in. Deploy it with `--no-verify-jwt`. It shares `supabase/functions/_shared/username.ts` with the app, and the reserved-name list there must match `public.is_reserved_username()`.
```

- [ ] **Step 7: Commit, then use the project skill `finishing-a-feature`**

```bash
git add AGENTS.md
git commit -m "docs: document account routes and auth function

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
