import { describe, expect, it } from "vitest";
import { byteSize, chunkBySize } from "./chunk";

const item = (n: number, pad: number) => ({ id: String(n), data: "x".repeat(pad) });

describe("chunkBySize", () => {
  it("returns a single chunk when everything fits", () => {
    const items = [item(1, 10), item(2, 10)];
    expect(chunkBySize(items, 1000)).toEqual([items]);
  });

  it("splits into chunks that each serialize within the limit", () => {
    const items = Array.from({ length: 50 }, (_, i) => item(i, 100));
    const chunks = chunkBySize(items, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(byteSize(chunk)).toBeLessThanOrEqual(1000);
    expect(chunks.flat()).toEqual(items);
  });

  it("puts an oversized single item in its own chunk", () => {
    const big = item(1, 5000);
    const chunks = chunkBySize([item(0, 10), big, item(2, 10)], 1000);
    expect(chunks).toContainEqual([big]);
    expect(chunks.flat()).toHaveLength(3);
  });

  it("returns no chunks for no items", () => {
    expect(chunkBySize([], 1000)).toEqual([]);
  });

  it("measures UTF-8 bytes, not string length", () => {
    expect(byteSize("é")).toBe(4); // quotes + 2-byte char
  });
});
