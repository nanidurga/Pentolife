import { describe, expect, it } from "vitest";
import { countPresence } from "./presence";

describe("countPresence", () => {
  it("counts other editors and viewers, excluding self", () => {
    const state = {
      me: [{ role: "editor" }],
      v1: [{ role: "viewer" }],
      v2: [{ role: "viewer" }],
      tab2: [{ role: "editor" }],
    };
    expect(countPresence(state, "me")).toEqual({ editors: 1, viewers: 2 });
  });

  it("counts a key once even with several presence entries", () => {
    expect(countPresence({ v1: [{ role: "viewer" }, { role: "viewer" }] }, "me")).toEqual({ editors: 0, viewers: 1 });
  });

  it("ignores entries without a known role", () => {
    expect(countPresence({ x: [{ role: "admin" }], y: [{}] }, "me")).toEqual({ editors: 0, viewers: 0 });
  });
});
