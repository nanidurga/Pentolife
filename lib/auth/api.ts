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
  if (!error || error.message === "username_already_set") return OK;
  return fail(authErrorMessage(error));
}

export type LinkEvidence = { kind: "token"; accessToken: string } | { kind: "code"; code: string };

// What the email link itself carried. Without this, a session that already existed in the
// browser would be mistaken for one the link created.
export function emailLinkEvidence(search: string, hash: string): LinkEvidence | null {
  const accessToken = new URLSearchParams(hash.replace(/^#/, "")).get("access_token");
  if (accessToken) return { kind: "token", accessToken };
  const code = new URLSearchParams(search).get("code");
  return code ? { kind: "code", code } : null;
}

export function linkSessionMatches(
  evidence: LinkEvidence,
  session: { access_token: string; user: { is_anonymous?: boolean } } | null,
) {
  if (!session || session.user.is_anonymous) return false;
  return evidence.kind === "code" || session.access_token === evidence.accessToken;
}

let linkCheck: { href: string; result: Promise<AuthResult> } | null = null;

// Confirmation and reset emails land here. The URL is read before the Supabase client exists,
// because the client clears the token from the hash while it initializes. React may run the
// calling effect twice, so both runs share one check.
export function finishEmailLink(): Promise<AuthResult> {
  const { href, search, hash } = window.location;
  if (linkCheck?.href !== href) linkCheck = { href, result: completeEmailLink(search, hash).catch(() => fail(EXPIRED_LINK_MESSAGE)) };
  return linkCheck.result;
}

async function completeEmailLink(search: string, hash: string): Promise<AuthResult> {
  const linkError = emailLinkError(search, hash);
  if (linkError) return fail(linkError);
  const evidence = emailLinkEvidence(search, hash);
  if (!evidence) return fail(EXPIRED_LINK_MESSAGE);
  const supabase = getSupabase();
  if (!supabase) return NOT_CONFIGURED;
  if (evidence.kind === "code") {
    const { error } = await supabase.auth.exchangeCodeForSession(evidence.code);
    if (error) return fail(EXPIRED_LINK_MESSAGE);
  }
  const { data: { session } } = await supabase.auth.getSession();
  return linkSessionMatches(evidence, session) ? OK : fail(EXPIRED_LINK_MESSAGE);
}

export async function signOut() {
  await getSupabase()?.auth.signOut();
}
