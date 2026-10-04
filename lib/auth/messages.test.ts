import { describe, expect, it } from "vitest";
import { EXPIRED_LINK_MESSAGE, GENERIC_ERROR_MESSAGE, authErrorMessage, emailLinkError, signInMessage } from "./messages";

describe("signInMessage", () => {
  it("never says which credential was wrong", () => {
    expect(signInMessage("invalid_credentials")).toBe("Incorrect username/email or password.");
  });

  it("explains unconfirmed email, rate limits and network failures", () => {
    expect(signInMessage("email_not_confirmed")).toBe("Confirm your email first. Check your inbox for the link.");
    expect(signInMessage("rate_limited")).toBe("Too many attempts. Wait a minute and try again.");
    expect(signInMessage("network")).toBe("Can't reach the server. Check your connection.");
  });

  it("falls back to a generic message", () => {
    expect(signInMessage(undefined)).toBe(GENERIC_ERROR_MESSAGE);
    expect(signInMessage("server_error")).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe("authErrorMessage", () => {
  it("maps a sign-up rejected by the username index or trigger", () => {
    expect(authErrorMessage({ message: "Database error saving new user" })).toBe("That username isn't available. Try another.");
    expect(authErrorMessage({ message: "username_taken" })).toBe("That username isn't available. Try another.");
  });

  it("maps the raw trigger errors that public sign-up returns", () => {
    expect(authErrorMessage({ message: "username_reserved", code: "P0001" })).toBe("That username isn't available. Try another.");
    expect(authErrorMessage({ message: "duplicate key value violates unique constraint \"profiles_username_key\"" })).toBe("That username isn't available. Try another.");
    expect(authErrorMessage({ message: "new row for relation \"profiles\" violates check constraint \"profiles_username_format\"" })).toBe("That username isn't available. Try another.");
  });

  it("maps password and rate-limit errors", () => {
    expect(authErrorMessage({ code: "weak_password" })).toBe("Use at least 8 characters.");
    expect(authErrorMessage({ code: "same_password" })).toBe("Choose a password different from your current one.");
    expect(authErrorMessage({ code: "over_email_send_rate_limit" })).toBe("Too many attempts. Wait a minute and try again.");
    expect(authErrorMessage({ status: 429 })).toBe("Too many attempts. Wait a minute and try again.");
  });

  it("falls back to a generic message", () => {
    expect(authErrorMessage({ message: "something odd" })).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe("emailLinkError", () => {
  it("detects an expired link reported in the hash", () => {
    const hash = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
    expect(emailLinkError("", hash)).toBe(EXPIRED_LINK_MESSAGE);
  });

  it("detects an error reported in the query string", () => {
    expect(emailLinkError("?error=server_error", "")).toBe(EXPIRED_LINK_MESSAGE);
  });

  it("returns null for a normal link", () => {
    expect(emailLinkError("?code=abc", "")).toBeNull();
    expect(emailLinkError("", "#access_token=x&type=signup")).toBeNull();
  });
});
