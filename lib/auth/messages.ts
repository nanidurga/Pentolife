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
  // auth.signUp passes the profile trigger's raw Postgres error through (reserved name,
  // unique index or format check); claim_username raises username_taken.
  if (isUsernameRejection(error.message ?? "")) return USERNAME_UNAVAILABLE;
  if (error.code === "weak_password") return PASSWORD_MESSAGES.too_short;
  if (error.code === "same_password") return "Choose a password different from your current one.";
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") return RATE_LIMITED;
  return GENERIC_ERROR_MESSAGE;
}

function isUsernameRejection(message: string) {
  return message === "Database error saving new user"
    || message === "username_taken"
    || message === "username_reserved"
    || message.includes("profiles_username_key")
    || message.includes("profiles_username_format");
}

// Supabase reports a failed email link as `error`/`error_description` in the query or hash.
export function emailLinkError(search: string, hash: string) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  return query.has("error") || fragment.has("error") ? EXPIRED_LINK_MESSAGE : null;
}
