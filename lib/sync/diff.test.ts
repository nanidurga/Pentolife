import { describe, expect, it } from "vitest";
import { collectChanged, markSent, unmarkSent } from "./diff";
import type { SyncElement } from "./types";

const el = (id: string, version: number, extra: Partial<SyncElement> = {}): SyncElement =>
  ({ id, version, versionNonce: 1, ...extra });

describe("collectChanged", () => {
  it("returns elements never sent", () => {
    expect(collectChanged([el("a", 1)], new Map())).toEqual([el("a", 1)]);
  });

  it("skips elements whose version was already sent", () => {
    expect(collectChanged([el("a", 3)], new Map([["a", 3]]))).toEqual([]);
  });

  it("returns elements whose version changed", () => {
    expect(collectChanged([el("a", 4)], new Map([["a", 3]]))).toEqual([el("a", 4)]);
  });

  it("returns deleted elements so deletions propagate", () => {
    const deleted = el("a", 5, { isDeleted: true });
    expect(collectChanged([deleted], new Map([["a", 4]]))).toEqual([deleted]);
  });
});

describe("markSent / unmarkSent", () => {
  it("records versions and never moves backwards", () => {
    const sent = new Map<string, number>([["a", 5]]);
    markSent(sent, [el("a", 3), el("b", 2)]);
    expect(sent.get("a")).toBe(5);
    expect(sent.get("b")).toBe(2);
  });

  it("remote elements marked sent are not re-collected (no echo between editor tabs)", () => {
    const sent = new Map<string, number>();
    const remote = [el("x", 7)];
    markSent(sent, remote);
    expect(collectChanged(remote, sent)).toEqual([]);
  });

  it("unmarkSent forgets only the exact version so a failed send is retried", () => {
    const sent = new Map<string, number>([["a", 2], ["b", 9]]);
    unmarkSent(sent, [el("a", 2), el("b", 3)]);
    expect(sent.has("a")).toBe(false);
    expect(sent.get("b")).toBe(9);
  });
});
