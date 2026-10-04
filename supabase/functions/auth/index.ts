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
