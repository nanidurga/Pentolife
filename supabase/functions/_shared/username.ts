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
