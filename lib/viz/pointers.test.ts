import { describe, expect, it } from "vitest";
import { gridPointers, pointersFor } from "@/lib/viz/pointers";

const n = (v: number | string) => ({ t: "num", v }) as const;

describe("pointersFor", () => {
  it("labels integer locals with pointer names that index the sequence", () => {
    const locals = { i: n(0), j: n(2), mid: n(4), lo_2: n(1), count: n(1), list: n(1), a: { t: "list", kind: "list", items: [] } as const };
    expect(pointersFor(5, locals)).toEqual([
      { name: "i", index: 0, end: false },
      { name: "lo_2", index: 1, end: false },
      { name: "j", index: 2, end: false },
      { name: "mid", index: 4, end: false },
    ]);
  });

  it("shows a past-the-end pointer and skips out-of-range, fractional and excluded values", () => {
    expect(pointersFor(3, { end: n(3), i: n(4), j: n(-1), k: n(1.5), left: n("2") }, "left")).toEqual([{ name: "end", index: 3, end: true }]);
  });
});

describe("gridPointers", () => {
  it("splits row-style and column-style names", () => {
    expect(gridPointers(3, 4, { r: n(1), c: n(3), i: n(2), y: n(0), mid: n(1) })).toEqual({
      rows: [{ name: "r", index: 1, end: false }, { name: "i", index: 2, end: false }],
      cols: [{ name: "y", index: 0, end: false }, { name: "c", index: 3, end: false }],
    });
  });
});
