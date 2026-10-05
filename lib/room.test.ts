import { describe, expect, it } from "vitest";
import { roomQuery } from "@/lib/room";

describe("roomQuery", () => {
  it("keeps the access a page was opened with", () => {
    expect(roomQuery({ role: "editor", token: "e", viewerToken: "v", local: false })).toBe("role=editor&token=e&viewer=v");
    expect(roomQuery({ role: "viewer", token: "v", viewerToken: "", local: true })).toBe("role=viewer&token=v&local=1");
  });
});
