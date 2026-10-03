import { describe, expect, it } from "vitest";
import { createPendingSet } from "./pending";
import type { SyncElement } from "./types";

const el = (id: string, version: number): SyncElement => ({ id, version, versionNonce: 1 });

describe("createPendingSet", () => {
  it("keeps only the latest version per id", () => {
    const pending = createPendingSet<SyncElement>();
    pending.add([el("a", 1), el("a", 3), el("a", 2)]);
    expect(pending.take()).toEqual([el("a", 3)]);
  });

  it("take empties the set", () => {
    const pending = createPendingSet<SyncElement>();
    pending.add([el("a", 1)]);
    pending.take();
    expect(pending.size).toBe(0);
    expect(pending.take()).toEqual([]);
  });

  it("restore puts back a failed batch without overwriting newer pending versions", () => {
    const pending = createPendingSet<SyncElement>();
    pending.add([el("a", 1), el("b", 1)]);
    const batch = pending.take();
    pending.add([el("a", 2)]);
    pending.restore(batch);
    expect(pending.take().sort((x, y) => x.id.localeCompare(y.id))).toEqual([el("a", 2), el("b", 1)]);
  });
});
