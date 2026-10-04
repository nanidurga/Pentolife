import { describe, expect, it } from "vitest";
import { initialAppState } from "./penTool";

describe("initialAppState", () => {
  it("opens the pen tool for an editor on a touch device", () => {
    expect(initialAppState("editor", true)?.activeTool).toMatchObject({ type: "freedraw", locked: false });
  });

  it("leaves Excalidraw's default tool for mouse users and viewers", () => {
    expect(initialAppState("editor", false)).toBeUndefined();
    expect(initialAppState("viewer", true)).toBeUndefined();
  });
});
