<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PentoLive — agent guide

A tablet-first live whiteboard for technical interviews. The candidate draws on a tablet (editor link). Interviewers watch live (viewer link, or a QR code). Stack: Next.js App Router, Excalidraw `0.18.1`, Supabase (anonymous auth, Postgres + RLS, Realtime broadcast, one Edge Function) and Vercel.

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` (port 3000) |
| Unit tests (vitest) | `npm test` |
| Type check | `npx tsc --noEmit` |
| Production build | `npm run build` |
| Lint | `npm run lint`. This currently fails because the repo has no `eslint.config.*`; that is a known pre-existing gap. |

All of tests, type check and build must be green before you call work done.

## Layout

- `app/`: routes.
  - `room/[roomId]` is the board.
  - `/` shows the landing page when signed out and the dashboard when signed in.
  - `signup`, `signin`, `forgot-password`, `reset-password` and `auth/callback` handle email + password accounts with self-chosen usernames.
  - `/dashboard` and `/login` redirect to `/` and `/signin` (see `next.config.ts`).
  - `api/cron/keepalive` is pinged daily by Vercel Cron, see `vercel.json`.
- `components/Board.tsx`: the integration point. It handles:
  - joining with retry
  - the local backup
  - delta broadcast
  - snapshot saves
  - presence
- `lib/sync/*`: pure, unit-tested sync logic: diff, chunk, merge, pending, throttle, saver. Constants live in `lib/sync/messages.ts`.
- `lib/rooms/*`: the Edge Function client (`api.ts`) and join retry.
- `lib/realtime/*`: channels, connection status and presence.
- `supabase/migrations/*.sql`: run in filename order. Write each new migration so it can be re-run safely (`if not exists`, `create or replace`, `drop policy if exists`).
- `supabase/functions/rooms/index.ts`: Deno Edge Function with the `create`, `join`, `snapshot` and `owner-access` actions.
- `supabase/functions/auth/index.ts`: signs in with "email or username" so emails never reach the browser.
  - Deploy it with `--no-verify-jwt`, because callers are signed out.
  - It shares `supabase/functions/_shared/username.ts` with the app (via `lib/auth/username.ts`). The reserved-name list there must match `public.is_reserved_username()`.
- The two Edge Functions are the only code that holds the service-role key.
- `lib/auth/*`: username and password rules, auth error copy, and the browser auth client.
- `docs/superpowers/specs` and `docs/superpowers/plans`: design specs and plans. A new feature gets its spec first.

## Invariants (do not break)

- Excalidraw:
  - Load it only via `next/dynamic` with `ssr: false`. Other files import types only from `@excalidraw/excalidraw/*`.
  - Keep the version pinned to exactly `0.18.1`.
- Apply remote changes with `captureUpdate: "NEVER"`, so they never enter local undo history.
- Send rights:
  - Only editors send on `room:{id}`.
  - Viewers send only on `room:{id}:interact`.
  - Joining via the viewer link must never downgrade an existing editor membership.
- Saving:
  - Never save before a successful join. A failed join must not overwrite the stored board with a local-only scene.
  - Snapshots replace the whole board on the server.
- Broadcast payloads stay at or below `MAX_CHUNK_BYTES`, which is 200 KB; the Supabase free tier caps payloads at 256 KB.
- A failed send must never be retried on a tight timer. The full-scene send on resubscribe covers it.
- Secrets: never put the Supabase service-role key in Next.js or Vercel env vars, or prefix a secret with `NEXT_PUBLIC_`.
- UI status copy is fixed in `lib/ui/statusLabels.ts`. Change it there, together with its tests.
- Accounts:
  - `authenticated` may update only `profiles.display_name` (a column grant). Usernames change only through the sign-up trigger and `claim_username`. Never re-grant table-wide UPDATE.
  - Email-link pages trust only the session that the link's own token or code created (`finishEmailLink`), never a session that already existed in the browser.
  - Sign-in failures always return the same "invalid credentials" error, so they never reveal whether a username exists.

## Backend operations (live Supabase project)

`.env.local` holds `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`. Load them with `set -a && . ./.env.local && set +a`, and never print their values.

- **Run SQL / apply a migration** with the Management API. Build the JSON body with node in a scratch directory (the session scratchpad, not `/tmp`):

  ```bash
  node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync("supabase/migrations/<file>.sql","utf8")}))' > "$SCRATCH/mig.json"
  curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @"$SCRATCH/mig.json"
  ```

  A successful DDL migration returns `[]`.
- **Edge Function env vars:** `supabase secrets set NAME=value --project-ref "$SUPABASE_PROJECT_REF"`. Next.js env vars go in Vercel and `.env.example` instead.

  The earlier migrations were applied by hand, so the CLI's migration history is empty. Before any `supabase db push`, run `supabase migration repair --status applied <versions>` for those migrations.
- **Deploy the Edge Function:** `supabase functions deploy rooms --project-ref "$SUPABASE_PROJECT_REF" --use-api`.
- **Order:** apply the migration first, then deploy the function immediately. The function and the schema depend on each other.
- **Verify the live project** after deploying:
  - query `pg_proc`, `information_schema` and `pg_policies` for the new objects
  - check the function version with `supabase functions list`
- Edge Function secrets are platform-managed. `supabase secrets list` shows only hashes.

## Gotchas

- `next dev` refuses to start a second instance and points at the running one. Process env vars beat `.env.local`, so a dev server started with `FOO=test` keeps answering with the stale value. Always stop dev servers you started (`netstat -ano | grep LISTENING` for ports 3000 and 3123, then `taskkill //PID <pid> //T //F`).
- `next-env.d.ts` flips between `.next/types` (after `next build`) and `.next/dev/types` (after `next dev`). Never stage it. `next dev` also re-adds this file's Next.js block, which is committed; keep it.
- `main` is the default branch and the Vercel production branch. Start every feature or fix on a new branch from `main` (for example `feat/...`, `fix/...`, `chore/...`), open a PR into `main`, and merge it there. `basic-features` is retired.
- The Vercel CLI is not installed. Ask the user to set Vercel env vars.
- Public `auth.signUp` returns the profile trigger's raw Postgres error (`username_reserved`, `... profiles_username_key`), not a generic message. Map new trigger errors in `lib/auth/messages.ts`.
- Auth email uses Supabase's built-in sender: 2 emails per hour, delivered only to project team members. To test sign-in without sending email, create a pre-confirmed user with the admin API (`POST /auth/v1/admin/users`, `email_confirm: true`), then delete it.
- The Supabase client uses the implicit flow, so email links arrive as `#access_token=...`. auth-js clears the hash while it initializes, so read the URL before calling `getSupabase()`.

## Finishing a feature

Use the project skill `.claude/skills/finishing-a-feature`.
