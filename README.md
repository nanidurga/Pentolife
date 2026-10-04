# PentoLive

A private, tablet-first live whiteboard for technical interviews. The first slice uses an MIT-licensed Excalidraw canvas, Supabase Realtime, anonymous sessions, and capability-based editor/viewer links.

## Run locally

```bash
npm install
npm run dev
```

Without environment variables, the app is still usable as a single-browser prototype and saves scenes in browser local storage.

## Connect Supabase

1. Create a free Supabase project.
2. In **Authentication → Providers → Anonymous**, enable anonymous sign-ins.
3. Open the SQL Editor and run, in order, every file in [`supabase/migrations`](supabase/migrations).
4. Install the Supabase CLI, authenticate it locally, link the project, then deploy the edge function:

   ```bash
   supabase functions deploy rooms
   supabase functions deploy auth --no-verify-jwt
   ```

5. Copy `.env.example` to `.env.local` and set the Project URL plus the **publishable** key from **Project Settings → API**.

## Accounts

People create an account at `/signup` with an email, a username they choose, and a password. They confirm by email, then sign in at `/signin` with either their email or their username. Signed in, `/` is their dashboard.

In Supabase:
- Keep **Authentication → Providers → Email → Confirm email** on, and set the minimum password length to 8.
- In **Authentication → URL Configuration**, allow these redirect URLs for your Vercel URL and for `http://localhost:3000`:
  - `/auth/callback` (email confirmation)
  - `/reset-password` (password reset)
- Supabase's built-in email sender only delivers to your project's team members, at 2 emails per hour. Before other people sign up, set up custom SMTP in **Authentication → Emails → SMTP Settings**.

The account that creates a board becomes its owner and sees it on its dashboard. Interviewers open shared room links without an account.

The Edge Function uses Supabase-managed `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` internally. Do not put the service-role key in Vercel or in any browser environment variable.

## Deploy to Vercel

1. Push this directory to a private GitHub repository.
2. Import the repository in Vercel.
3. Add these environment variables in Vercel for Production, Preview, and Development:

   ```text
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   CRON_SECRET                            any long random string; enables the daily keep-alive that stops the free-tier Supabase project from pausing.
   ```

4. Deploy. Vercel builds the application remotely, so your laptop does not need to run the production server.

## Security model

- Editor and viewer URLs receive separate high-entropy capability tokens.
- The `rooms` Edge Function hashes capability tokens before storing them.
- Every join creates a Supabase anonymous session tied to a room role.
- Supabase Realtime policies permit receiving broadcasts only for room members and sending broadcasts only for editors.
- Viewer links are read-only in the canvas UI and are denied broadcast-write access by the Realtime policy.
- Viewers may send only on the `room:{id}:interact` channel (sync requests and presence); drawing stays editor-only.
- Boards created while signed in never expire. Anonymous boards expire after 30 days.
- Reopening a board from the dashboard rotates the editor link but keeps the viewer link, so links you already shared keep working. Rescan the QR on your tablet after reopening.

Do not share editor links with interviewers.
