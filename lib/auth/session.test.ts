import { describe, expect, it } from "vitest";
import { latestOnly, profileFrom } from "./session";

describe("profileFrom", () => {
  it("reads the username", () => {
    expect(profileFrom({ data: { username: "prajay" }, error: null })).toEqual({ username: "prajay" });
  });

  it("reports a missing username as null", () => {
    expect(profileFrom({ data: { username: null }, error: null })).toEqual({ username: null });
    expect(profileFrom({ data: null, error: null })).toEqual({ username: null });
  });

  it("reports a failed fetch as unknown, not as 'no username'", () => {
    expect(profileFrom({ data: null, error: { message: "network" } })).toEqual({ username: undefined });
  });
});

describe("latestOnly", () => {
  it("lets only the most recently started load apply its result", () => {
    const begin = latestOnly();
    const first = begin();
    const second = begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });
});
