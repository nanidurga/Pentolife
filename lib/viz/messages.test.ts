import { describe, expect, it } from "vitest";
import { MAX_CHUNK_BYTES } from "@/lib/sync/messages";
import { createTraceAssembler, parseChunk, parseCode, parseStep, parseTrace, splitByBytes, TRACE_PIECE_BYTES, vizTopic } from "@/lib/viz/messages";
import type { Trace } from "@/lib/viz/trace";

const bytes = (s: string) => new TextEncoder().encode(s).length;
const trace: Trace = { language: "cpp", stdout: "hi", steps: [{ line: 1, out: 0, stack: [{ fn: "main", line: 1, locals: { s: { t: "str", v: "é\"😀".repeat(2) } } }] }] };

describe("topic and limits", () => {
  it("uses the room's viz topic and keeps escaped pieces under the broadcast limit", () => {
    expect(vizTopic("r1")).toBe("room:r1:viz");
    expect(TRACE_PIECE_BYTES * 2 + 1000).toBeLessThanOrEqual(MAX_CHUNK_BYTES);
  });
});

describe("splitByBytes", () => {
  it("splits on character boundaries within the byte limit and rejoins exactly", () => {
    const text = "aé😀\"".repeat(50);
    const pieces = splitByBytes(text, 7);
    expect(pieces.join("")).toBe(text);
    for (const piece of pieces) expect(bytes(piece)).toBeLessThanOrEqual(7);
    expect(splitByBytes("", 10)).toEqual([""]);
  });
});

describe("trace assembler", () => {
  const pieces = splitByBytes(JSON.stringify(trace), 20);
  const chunk = (runId: string, index: number) => ({ from: "x", runId, index, total: pieces.length, data: pieces[index] });

  it("assembles out-of-order chunks once all have arrived", () => {
    const assembler = createTraceAssembler();
    const order = pieces.map((_, i) => i).reverse();
    const results = order.map((i) => assembler.add(chunk("run1", i)));
    expect(results.slice(0, -1).every((r) => r === null)).toBe(true);
    expect(results[results.length - 1]).toEqual({ runId: "run1", trace });
  });

  it("drops a partial run when a newer run starts, and ignores duplicates", () => {
    const assembler = createTraceAssembler();
    assembler.add(chunk("old", 0));
    let done = null;
    for (let i = 0; i < pieces.length; i++) done = assembler.add(chunk("new", i)) ?? done;
    expect(done).toEqual({ runId: "new", trace });
    expect(assembler.add(chunk("new", 0))).toBeNull();
  });
});

describe("payload validation", () => {
  it("accepts well-formed payloads", () => {
    expect(parseCode({ from: "a", language: "python", code: "x", stdin: "", cursorLine: 1, rev: 3 })).not.toBeNull();
    expect(parseStep({ from: "a", runId: "r", step: 2, playing: true })).toEqual({ from: "a", runId: "r", step: 2, playing: true });
    expect(parseChunk({ from: "a", runId: "r", index: 0, total: 1, data: "{}" })).not.toBeNull();
    expect(parseTrace(JSON.stringify(trace))).toEqual(trace);
  });

  it("rejects malformed or oversized payloads", () => {
    expect(parseCode({ from: "a", language: "java", code: "x", stdin: "", cursorLine: 1, rev: 1 })).toBeNull();
    expect(parseCode({ from: "a", language: "cpp", code: "x".repeat(50_001), stdin: "", cursorLine: 1, rev: 1 })).toBeNull();
    expect(parseStep({ from: "a", runId: "r", step: -1, playing: false })).toBeNull();
    expect(parseChunk({ from: "a", runId: "r", index: 2, total: 2, data: "" })).toBeNull();
    expect(parseChunk({ from: "a", runId: "r", index: 0, total: 99, data: "" })).toBeNull();
    expect(parseTrace("{")).toBeNull();
    expect(parseTrace(JSON.stringify({ ...trace, steps: [{ line: "1", out: 0, stack: [] }] }))).toBeNull();
    expect(parseTrace(JSON.stringify({ ...trace, steps: Array.from({ length: 1001 }, () => trace.steps[0]) }))).toBeNull();
  });
});
