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
