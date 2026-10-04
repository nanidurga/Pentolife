import { describe, expect, it } from "vitest";
import { validatePassword } from "./password";

describe("validatePassword", () => {
  it("needs at least 8 characters", () => {
    expect(validatePassword("short", "short")).toBe("too_short");
    expect(validatePassword("12345678", "12345678")).toBeNull();
  });

  it("needs the confirmation to match", () => {
    expect(validatePassword("longenough", "different")).toBe("mismatch");
    expect(validatePassword("longenough", "longenough")).toBeNull();
  });
});
