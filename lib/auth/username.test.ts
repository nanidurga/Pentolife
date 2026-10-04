import { describe, expect, it } from "vitest";
import { RESERVED_USERNAMES, normalizeUsername, resolveIdentifier, validateUsername } from "./username";

describe("normalizeUsername", () => {
  it("trims, lowercases and drops one leading @", () => {
    expect(normalizeUsername("  @Prajay_01 ")).toBe("prajay_01");
  });
});

describe("validateUsername", () => {
  it("accepts 3-20 lowercase letters, digits and underscores", () => {
    expect(validateUsername("abc")).toBeNull();
    expect(validateUsername("a_very_long_name_20c")).toBeNull();
  });

  it("rejects short, long, bad characters and reserved names", () => {
    expect(validateUsername("ab")).toBe("too_short");
    expect(validateUsername("a".repeat(21))).toBe("too_long");
    expect(validateUsername("pra jay")).toBe("invalid_chars");
    expect(validateUsername("prajay!")).toBe("invalid_chars");
    expect(validateUsername("Prajay")).toBe("invalid_chars");
    expect(validateUsername("admin")).toBe("reserved");
    expect(validateUsername("signin")).toBe("reserved");
  });

  it("reserves every top-level route name", () => {
    for (const route of ["api", "auth", "dashboard", "login", "room", "signin", "signup"]) {
      expect(RESERVED_USERNAMES).toContain(route);
    }
  });
});

describe("resolveIdentifier", () => {
  it("treats input containing @ as a lowercased email", () => {
    expect(resolveIdentifier("  Me@Example.com ")).toEqual({ kind: "email", email: "me@example.com" });
  });

  it("treats other input as a normalized username", () => {
    expect(resolveIdentifier(" Prajay ")).toEqual({ kind: "username", username: "prajay" });
  });

  it("accepts a leading @ on a username", () => {
    expect(resolveIdentifier("@prajay")).toEqual({ kind: "username", username: "prajay" });
  });

  it("rejects input that is neither", () => {
    expect(resolveIdentifier("no spaces allowed")).toEqual({ kind: "invalid" });
    expect(resolveIdentifier("")).toEqual({ kind: "invalid" });
  });
});
