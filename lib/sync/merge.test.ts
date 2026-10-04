import { describe, expect, it } from "vitest";
import { mergeByVersion } from "./merge";
import type { SyncElement } from "./types";

const el = (id: string, version: number, extra: Partial<SyncElement> = {}): SyncElement =>
  ({ id, version, versionNonce: 100, index: id, ...extra });

describe("mergeByVersion", () => {
  it("adds remote elements that are new locally", () => {
    expect(mergeByVersion([el("a", 1)], [el("b", 1)])).toEqual([el("a", 1), el("b", 1)]);
  });

  it("takes the remote element when its version is higher", () => {
    expect(mergeByVersion([el("a", 1)], [el("a", 2)])).toEqual([el("a", 2)]);
  });

  it("keeps the local element when the remote version is older", () => {
    expect(mergeByVersion([el("a", 5)], [el("a", 2)])).toEqual([el("a", 5)]);
  });

  it("breaks version ties with the lower versionNonce", () => {
    const local = el("a", 3, { versionNonce: 50 });
    const remote = el("a", 3, { versionNonce: 10 });
    expect(mergeByVersion([local], [remote])).toEqual([remote]);
    expect(mergeByVersion([remote], [local])).toEqual([remote]);
  });

  it("is idempotent", () => {
    const local = [el("a", 1)];
    const remote = [el("a", 2), el("b", 1)];
    const once = mergeByVersion(local, remote);
    expect(mergeByVersion(once, remote)).toEqual(once);
  });

  it("propagates deletions", () => {
    const deleted = el("a", 2, { isDeleted: true });
    expect(mergeByVersion([el("a", 1)], [deleted])).toEqual([deleted]);
  });

  it("does not touch elements the local user is editing", () => {
    expect(mergeByVersion([el("a", 1)], [el("a", 9)], new Set(["a"]))).toEqual([el("a", 1)]);
  });

  it("orders the result by fractional index regardless of arrival order", () => {
    const merged = mergeByVersion([el("c", 1, { index: "a2" })], [el("z", 1, { index: "a0" }), el("m", 1, { index: "a1" })]);
    expect(merged.map((e) => e.id)).toEqual(["z", "m", "c"]);
  });
});
