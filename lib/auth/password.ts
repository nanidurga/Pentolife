export const MIN_PASSWORD_LENGTH = 8;

export type PasswordError = "too_short" | "mismatch";

export function validatePassword(password: string, confirm: string): PasswordError | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password !== confirm) return "mismatch";
  return null;
}
