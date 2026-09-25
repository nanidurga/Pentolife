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
3. Open the SQL Editor and run [`supabase/migrations/202609250001_rooms.sql`](supabase/migrations/202609250001_rooms.sql).
4. Install the Supabase CLI, authenticate it locally, link the project, then deploy the edge function:

   ```bash
   supabase functions deploy rooms
   ```

5. Copy `.env.example` to `.env.local` and set the Project URL plus the **publishable** key from **Project Settings → API**.

## Personal dashboard sign-in

The `/login` page uses email magic links. In Supabase **Authentication → URL Configuration**, add your Vercel URL with `/auth/callback` as an allowed redirect URL, for example `https://your-app.vercel.app/auth/callback`. Add `http://localhost:3000/auth/callback` for local testing. The authenticated account that creates a board becomes its owner and sees it in `/dashboard`.

The Edge Function uses Supabase-managed `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` internally. Do not put the service-role key in Vercel or in any browser environment variable.

## Deploy to Vercel

1. Push this directory to a private GitHub repository.
2. Import the repository in Vercel.
3. Add these environment variables in Vercel for Production, Preview, and Development:

   ```text
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   ```

4. Deploy. Vercel builds the application remotely, so your laptop does not need to run the production server.

## Security model

- Editor and viewer URLs receive separate high-entropy capability tokens.
- The `rooms` Edge Function hashes capability tokens before storing them.
- Every join creates a Supabase anonymous session tied to a room role.
- Supabase Realtime policies permit receiving broadcasts only for room members and sending broadcasts only for editors.
- Viewer links are read-only in the canvas UI and are denied broadcast-write access by the Realtime policy.

For now, rooms expire after 30 days. Do not share editor links with interviewers.
