import type { Value } from "@/lib/viz/trace";

export type Pointer = { name: string; index: number; end: boolean };

const prefixed = (names: string[]) => new RegExp(`^(?:${names.join("|")})(?:[_\\d].*)?$`);
const POINTER = prefixed(["i", "j", "k", "l", "r", "lo", "hi", "low", "high", "mid", "left", "right", "start", "end", "begin", "p", "q", "slow", "fast", "idx", "index", "pos", "curr", "cur"]);
const ROW = prefixed(["i", "r", "row", "x"]);
const COL = prefixed(["j", "c", "col", "y"]);

function collect(length: number, locals: Record<string, Value>, pattern: RegExp, exclude?: string): Pointer[] {
  const found: Pointer[] = [];
  for (const [name, value] of Object.entries(locals)) {
    if (name === exclude || value?.t !== "num" || typeof value.v !== "number" || !pattern.test(name)) continue;
    const index = value.v;
    if (!Number.isInteger(index) || index < 0 || index > length) continue;
    found.push({ name, index, end: index === length });
  }
  return found.sort((a, b) => a.index - b.index || a.name.localeCompare(b.name));
}

/** Integer locals named like pointers (i, j, lo, mid, …) whose value indexes a sequence of `length`. */
export function pointersFor(length: number, locals: Record<string, Value>, exclude?: string) {
  return collect(length, locals, POINTER, exclude);
}

export function gridPointers(rows: number, cols: number, locals: Record<string, Value>, exclude?: string) {
  return {
    rows: collect(rows, locals, ROW, exclude).filter((p) => !p.end),
    cols: collect(cols, locals, COL, exclude).filter((p) => !p.end),
  };
}
