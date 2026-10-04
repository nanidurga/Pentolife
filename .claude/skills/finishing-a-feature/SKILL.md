---
name: finishing-a-feature
description: Use when a feature or fix in this repo is implemented and you are about to say "done", wrap up, hand off, open a PR, or deploy — especially under time pressure ("wrap it up", "I have to leave") or when the work touched migrations, the Edge Function, env vars, or left background processes running.
---

# Finishing a Feature

## Overview

"Done" means four things are true:
1. The feature is **verified**.
2. It is **shipped**, or the hand-off is exact.
3. The **workspace is clean**.
4. The **next session knows what this one learned**.

Skipping any of these hands a hidden cost to whoever comes next.

**Time pressure shortens the final message. It does not remove any step.** Every step takes seconds to a few minutes.

## Checklist

Make one todo per step, and run them in order. The commands assume Git Bash at the repo root.

1. **Clean up processes first.**
   - Stop every background process you started.
   - **Prove** the ports are free: `netstat -ano | grep -E ":(3000|3123) .*LISTENING"` must print nothing. Stopping the task can leave an orphaned `node` process; kill it with `taskkill //PID <pid> //T //F` and check again.
   - Stopping these first means a live `next dev` cannot collide with the build, and a stale env var cannot fake a result.
2. **Verify fresh.**
   - Run `npm test`, `npx tsc --noEmit` and `npm run build` on the final tree.
   - Skip `npm run lint`: it fails on a known missing config.
   - Report the real output. Re-run this step after any later commit that touches code or SQL.
3. **Review the whole branch diff.**
   - Run `git fetch origin`. The base is `origin/basic-features`; there is no `main`.
   - Run these checks:

   | Check | Command / criterion |
   |---|---|
   | Size | `git diff --stat origin/basic-features...HEAD \| tail -1` |
   | Secrets | `git diff origin/basic-features...HEAD \| grep -nE "sbp_[A-Za-z0-9]{8,}\|sb_secret_[A-Za-z0-9]\|eyJhbGciOi"` prints nothing. Names such as `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` are fine; literal values are not. |
   | Invariants | Every item in AGENTS.md "Invariants" still holds. |
   | Requirements | Each requirement maps to code or a test. Take them from the spec in `docs/superpowers/specs/`, With no spec, use the plan or the user's request, and say "no spec" in the PR. |
   | Leftovers | No `console.log`, `TODO`, debug flags, or commented-out code that you added. |

   - Request an independent review (superpowers:requesting-code-review) when the diff is over 300 changed lines, **or** touches a migration, RLS, auth or `supabase/functions/`. Fix its Critical and Important findings before you ship.
   - **Minor findings:**
     - If the fix is one line, fix it now and re-run step 2.
     - Otherwise, record it in step 6.
4. **Ship the backend in dependency order.** Load the credentials with `set -a && . ./.env.local && set +a`, and never echo their values.
   1. **Migration.** Write it so it can be re-run. Create Storage buckets inside it with `insert into storage.buckets ... on conflict do nothing`. Apply it with the Management API recipe in AGENTS.md, writing the JSON body to a scratch directory, not `/tmp`.
      - **Never run plain `supabase db push`.** The CLI's history is empty, so it would re-run the old migrations.
      - **If the migration errors:** stop. Do not deploy the function. Fix the SQL, which is safe to re-run, apply it again, and tell the user what failed.
   2. **Edge Function env vars:** `supabase secrets set NAME=value --project-ref "$SUPABASE_PROJECT_REF"`. Take the value from the plan or the code default; if neither gives one, ask the user.
   3. **Edge Function.** Note the current version from `supabase functions list`, then deploy immediately: `supabase functions deploy rooms --project-ref "$SUPABASE_PROJECT_REF" --use-api`.
   4. **Verify the live project:**
      - query for each new table, column, policy, function and bucket
      - call new RPCs with the publishable key
      - confirm `supabase functions list` shows a higher function version
      - **If any check fails:** roll back by deploying the base version of the function (`git checkout origin/basic-features -- supabase/functions/rooms`, deploy, then `git checkout HEAD -- supabase/functions/rooms`), and tell the user.

   **Who runs these:** if `.claude/settings.local.json` allows a command, run it yourself. Otherwise give the user that exact command, in order.

   **Next.js env vars:** add the variable to `.env.example` with a one-line comment, and to the README "Deploy to Vercel" list. Then ask the user to set it in Vercel, since the Vercel CLI is not installed here.
5. **Remove scratch files.**
   - Delete scratch files and test fixtures you created outside the commits.
   - Never write to `.env.local`. Pass test values through the process env instead.
6. **Record what the next session needs.**
   - **Unfixed findings:** list each unfixed finding under "Known follow-ups" in the PR body. A finding mentioned only in chat is lost.
   - **AGENTS.md:** add one line per new invariant, command, gotcha or architecture fact, in its section.
   - **README:** update it if setup or behaviour changed for humans.
   - **Commit the docs** as a separate `docs:` commit. Never stage `next-env.d.ts`, which flips between dev and build.
7. **Integrate.**
   - Use superpowers:finishing-a-development-branch. PRs target `basic-features`.
   - PR body sections:
     - **Summary**
     - **Deployment status:** what is live, how you verified it, and the function version.
     - **Test plan:** checkboxes, with manual device checks left unticked.
     - **Known follow-ups**
8. **Final message.** Keep it short:
   - verification results
   - the PR link
   - what is live
   - exact actions left for the user

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Tests passed earlier this session." | Earlier tests ran on an earlier tree. Re-run them. |
| "I'll list the Minors in my message." | The message scrolls away. Put them in the PR body. |
| "`supabase db push` is the standard way." | Not here. The migration history is empty, so it re-runs old migrations. |
| "I stopped the dev server task." | Check the port. An orphaned `next dev` kept a stale env var alive. |
| "Deploying isn't my call." | Check the allow rules. If they are present, the user already decided. |
| "The migration half-failed, but the function will probably work." | The function and the schema depend on each other. Stop and fix the migration first. |
| "Docs can wait." | The next session starts from AGENTS.md. Undocumented lessons get relearned at full cost. |

## Red Flags

Stop and go back to the checklist if you are about to:
- say "done" without fresh output from step 2
- run `git log main..`, or skip `git fetch`
- deploy the function before a successful migration
- leave a background process without checking its port
- open a PR without a "Known follow-ups" section
