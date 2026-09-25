import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key);
  return client;
}

export async function ensureAnonymousSession() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return supabase;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return supabase;
}
