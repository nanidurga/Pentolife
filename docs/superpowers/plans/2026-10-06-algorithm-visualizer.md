# Live Algorithm Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live, step-by-step Python and C++ visualizer at `/room/<id>/visualize`. The editor (laptop) writes and runs code; viewers follow the code as it is typed, and then the trace, in real time.

**Architecture:**
- **Shared trace format.** Both engines produce one JSON format (`lib/viz/trace.ts`).
- **Python.** Pyodide runs a `sys.settrace` tracer in a Web Worker.
- **C++.** The source is parsed with tree-sitter, step-recording calls are inserted, and the result is compiled with in-browser clang (`@yowasp/clang`). The program runs through a WASI shim and writes trace records to file descriptor 3.
- **Engine loading.** Engines are loaded from jsDelivr inside the workers and never bundled into the app.
- **Live sync.** A new `room:<id>:viz` Realtime topic carries code, the chunked trace and step messages. Viewers only render.

**Tech Stack:**
- Next.js 16 App Router (client components, `new Worker(new URL(...))`)
- CodeMirror 6
- Pyodide 314.0.7 (Python 3.14)
- `@yowasp/clang` 22.0.0-git20542-10
- `@bjorn3/browser_wasi_shim` 0.4.2
- `web-tree-sitter` 0.27.0 + `tree-sitter-cpp` 0.23.4
- Supabase Realtime
- vitest

**Spec:** `docs/superpowers/specs/2026-10-06-algorithm-visualizer-design.md`

**Spike results:** the spec's gate was run on 2026-10-06 in headless Chrome on the user's laptop, and passed.
- Cold compile, including the ~23 MB brotli download, took 6.0 s. A warm compile took 2.1 s.
- The compiled program ran with stdin.
- File descriptor 3 works as a separate trace channel.
- tree-sitter parsed C++ in a worker.
- Pyodide loaded in 1.5–2.5 s, and `sys.settrace` worked.
- jsDelivr serves `llvm.core.wasm` (75 MB raw, 19.4 MB brotli) with CORS.
- clang's `stderr` callback receives one byte at a time, so the code must buffer it.

## Global Constraints

- Excalidraw stays pinned at `0.18.1`; the board page and its sync are unchanged apart from the top-bar switch.
- Viewers send only on `room:<id>:interact`. Only editors send on `room:<id>:viz`. Membership checks go through the existing `public.is_room_member` policies. **No migration.**
- Every broadcast payload stays at or below `MAX_CHUNK_BYTES` (200,000). Trace pieces are cut at `TRACE_PIECE_BYTES = 99_500` bytes of raw JSON, so that JSON escaping (at most 2×) still fits.
- A failed send is never retried on a timer. Catch-up via `viz-sync-request` covers it.
- Limits (`lib/viz/engines.ts` `LIMITS`):
  - steps 1000
  - run timeout 10 s
  - code 50,000 characters
  - stdin 10,000 characters
  - trace 1,000,000 bytes
  - value depth 4
  - items 100
  - string 200 characters
  - stdout 20,000 characters
- Engine versions in `ENGINE_VERSIONS` must equal the devDependency versions (checked by a test).
- Copy comes from the spec §6 table, in `lib/viz/copy.ts`.
- Light theme only, Marker Board tokens from `app/globals.css`. Touch targets at least 44 px.
- Never stage `next-env.d.ts`. Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Gates: `npm test`, `npm run test:engines` (for engine changes), `npx tsc --noEmit`, `npm run build`.

## Review Focus

1. **Instrumentation that breaks compilable code:**
   - variable-length arrays
   - variables used inside lambdas
   - `constexpr` functions
   - preprocessor lines inside a function
   - single-statement bodies next to `else`
   - non-ASCII text before code

   The rewritten program must still compile, and line numbers must still match. Pinned by `instrument.test.ts` fixtures (Task 6) and the C++ engine tests (Task 7).
2. **An infinite loop in either language.** It must stop with "Stopped after 1,000 steps" and must not freeze the tab. Pinned by engine tests in Tasks 5 and 7, plus the runner's hard timeout test in Task 8.
3. **A viewer joining mid-run or reloading.** They must catch up to the current code, trace and step. Pinned by the assembler tests (Task 9) and the Task 13 browser check.
4. **Two editors (laptop and tablet) both on the visualizer.** They must not overwrite each other while typing. Pinned by the 2 s grace rule in `Visualizer.tsx` (Task 12) and the Task 13 browser check.
5. **A trace too large for one broadcast.** It must arrive complete, and malformed or oversized payloads from a peer must be ignored. Pinned by the `splitByBytes`/assembler/`parseTrace` tests in Task 9.

---

### Task 1: Dependencies, engine constants and test configs

**Files:**
- Modify: `package.json` (dependencies and the `test:engines` script)
- Create: `vitest.engines.config.ts`
- Modify: `vitest.config.ts` (exclude engine tests)
- Create: `lib/viz/engines.ts`
- Test: `lib/viz/engines.test.ts`

**Interfaces:**
- Produces: `ENGINE_VERSIONS`, `ENGINE_URLS`, `LIMITS`, `type Language = "python" | "cpp"` from `@/lib/viz/engines`.

- [ ] **Step 1: Install packages**

```bash
npm install codemirror@6.0.2 @codemirror/state @codemirror/view @codemirror/lang-python @codemirror/lang-cpp
npm install --save-dev @yowasp/clang@22.0.0-git20542-10 @bjorn3/browser_wasi_shim@0.4.2 web-tree-sitter@0.27.0 tree-sitter-cpp@0.23.4 pyodide@314.0.7
```

Expected: both succeed. `tree-sitter-cpp` uses its `win32-x64`/`linux-x64` prebuilds, so nothing is compiled.

- [ ] **Step 2: Add the engine test script and configs**

In `package.json` `scripts`, add `"test:engines": "vitest run --config vitest.engines.config.ts"`.

Replace `vitest.config.ts` with:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Engine tests download nothing but take minutes; run them with `npm run test:engines`.
    exclude: ["node_modules/**", ".next/**", "supabase/functions/**", "**/*.engine.test.ts"],
  },
});
```

Create `vitest.engines.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs the real Python (Pyodide) and C++ (clang) engines in Node.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["**/*.engine.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
```

- [ ] **Step 3: Write the failing test** `lib/viz/engines.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENGINE_URLS, ENGINE_VERSIONS, LIMITS } from "@/lib/viz/engines";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { devDependencies: Record<string, string> };

describe("engine pins", () => {
  it("match the devDependencies the engine tests run against", () => {
    for (const [name, version] of Object.entries(ENGINE_VERSIONS)) expect(pkg.devDependencies[name]).toBe(version);
  });

  it("load every engine from jsDelivr at the pinned version", () => {
    expect(ENGINE_URLS.clang).toBe("https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/gen/bundle.js");
    expect(ENGINE_URLS.pyodideDir).toBe("https://cdn.jsdelivr.net/npm/pyodide@314.0.7/");
    expect(ENGINE_URLS.cppGrammar).toBe("https://cdn.jsdelivr.net/npm/tree-sitter-cpp@0.23.4/tree-sitter-cpp.wasm");
  });

  it("uses the limits from the spec", () => {
    expect(LIMITS).toMatchObject({ maxSteps: 1000, runTimeoutMs: 10_000, maxCodeChars: 50_000, maxStdinChars: 10_000, maxTraceBytes: 1_000_000 });
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run lib/viz/engines.test.ts`
Expected: FAIL, cannot resolve `@/lib/viz/engines`.

- [ ] **Step 5: Implement** `lib/viz/engines.ts`

```ts
export type Language = "python" | "cpp";

// Engine builds are loaded from jsDelivr inside the run workers, never bundled into the app.
// Keep these identical to the devDependencies the engine tests use (engines.test.ts checks).
export const ENGINE_VERSIONS = {
  "@yowasp/clang": "22.0.0-git20542-10",
  "@bjorn3/browser_wasi_shim": "0.4.2",
  "web-tree-sitter": "0.27.0",
  "tree-sitter-cpp": "0.23.4",
  pyodide: "314.0.7",
} as const;

const cdn = (pkg: keyof typeof ENGINE_VERSIONS, path: string) => `https://cdn.jsdelivr.net/npm/${pkg}@${ENGINE_VERSIONS[pkg]}/${path}`;

export const ENGINE_URLS = {
  clang: cdn("@yowasp/clang", "gen/bundle.js"),
  wasiShim: cdn("@bjorn3/browser_wasi_shim", "dist/index.js"),
  treeSitter: cdn("web-tree-sitter", "web-tree-sitter.js"),
  treeSitterDir: cdn("web-tree-sitter", ""),
  cppGrammar: cdn("tree-sitter-cpp", "tree-sitter-cpp.wasm"),
  pyodide: cdn("pyodide", "pyodide.mjs"),
  pyodideDir: cdn("pyodide", ""),
};

export const LIMITS = {
  maxSteps: 1000,
  runTimeoutMs: 10_000,
  maxCodeChars: 50_000,
  maxStdinChars: 10_000,
  maxTraceBytes: 1_000_000,
  maxDepth: 4,
  maxItems: 100,
  maxStringChars: 200,
  maxStdoutChars: 20_000,
} as const;
```

- [ ] **Step 6: Run it to see it pass, then commit**

Run: `npx vitest run lib/viz/engines.test.ts` (Expected: 3 pass). Then `npm test` (Expected: all existing tests still pass).

```bash
git add package.json package-lock.json vitest.config.ts vitest.engines.config.ts lib/viz/engines.ts lib/viz/engines.test.ts
git commit -m "chore(viz): engine pins, limits and engine test config

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Trace format and helpers

**Files:**
- Create: `lib/viz/trace.ts`
- Test: `lib/viz/trace.test.ts`

**Interfaces:**
- Consumes: `LIMITS`, `Language` (Task 1).
- Produces:
  - **Types:** `Value`, `ObjValue`, `ListValue`, `Frame`, `Step`, `TraceError`, `Trace` (with `notice?: string`)
  - `traceBytes(trace)`
  - `capTrace(trace, maxBytes?)`
  - `changedVariables(prev: Step | undefined, next: Step): Set<string>`
  - `collectObjects(step: Step): Map<string, ObjValue>`
  - `resolveObj(value, objects): ObjValue | null`

- [ ] **Step 1: Write the failing test** `lib/viz/trace.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { capTrace, changedVariables, collectObjects, resolveObj, traceBytes, type Step, type Trace } from "@/lib/viz/trace";

const num = (v: number) => ({ t: "num", v }) as const;
const step = (line: number, locals: Step["stack"][number]["locals"], fn = "main", out = 0): Step => ({ line, out, stack: [{ fn, line, locals }] });

describe("capTrace", () => {
  const trace: Trace = { language: "python", stdout: "abcdef", steps: [step(1, { a: num(1) }, "main", 2), step(2, { a: num(2) }, "main", 4), step(3, { a: num(3) }, "main", 6)] };

  it("returns the trace unchanged when it fits", () => {
    expect(capTrace(trace, traceBytes(trace))).toBe(trace);
  });

  it("keeps the longest prefix of steps that fits and trims stdout to it", () => {
    const capped = capTrace(trace, traceBytes(trace) - 1);
    expect(capped.steps).toHaveLength(2);
    expect(capped.stdout).toBe("abcd");
    expect(capped.stopped).toBe("size");
    expect(traceBytes(capped)).toBeLessThanOrEqual(traceBytes(trace) - 1);
  });
});

describe("changedVariables", () => {
  it("marks new and changed locals in the same frame", () => {
    expect([...changedVariables(step(1, { a: num(1), b: num(2) }), step(2, { a: num(1), b: num(3), c: num(0) }))].sort()).toEqual(["b", "c"]);
  });

  it("marks every local when the frame changes or there is no previous step", () => {
    expect([...changedVariables(undefined, step(1, { a: num(1) }))]).toEqual(["a"]);
    expect([...changedVariables(step(1, { a: num(1) }, "main"), step(2, { a: num(1) }, "f"))]).toEqual(["a"]);
  });
});

describe("collectObjects and resolveObj", () => {
  it("finds objects anywhere in the step and resolves refs", () => {
    const node = { t: "obj", id: "7", cls: "Node", fields: { val: num(1), next: { t: "none" } } } as const;
    const s: Step = { line: 1, out: 0, stack: [{ fn: "main", line: 1, locals: { head: { t: "list", kind: "list", items: [node] }, again: { t: "ref", id: "7" } } }] };
    const objects = collectObjects(s);
    expect(objects.get("7")).toEqual(node);
    expect(resolveObj({ t: "ref", id: "7" }, objects)).toEqual(node);
    expect(resolveObj(num(1), objects)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/viz/trace.test.ts`
Expected: FAIL, cannot resolve `@/lib/viz/trace`.

- [ ] **Step 3: Implement** `lib/viz/trace.ts`

```ts
import { LIMITS, type Language } from "@/lib/viz/engines";

export type ListValue = { t: "list"; kind: "list" | "tuple" | "vector" | "array" | "deque" | "stack" | "queue"; items: Value[]; more?: number };
export type ObjValue = { t: "obj"; id: string; cls: string; fields: Record<string, Value> };
export type Value =
  | { t: "num"; v: number | string }
  | { t: "str"; v: string; cut?: true }
  | { t: "bool"; v: boolean }
  | { t: "none" }
  | ListValue
  | { t: "set"; items: Value[]; more?: number }
  | { t: "map"; entries: [Value, Value][]; more?: number }
  | ObjValue
  | { t: "ref"; id: string }
  | { t: "unsupported"; type: string }
  | { t: "cut" };

export type Frame = { fn: string; line: number; locals: Record<string, Value> };
/** `stack` is outermost first; `out` is how many characters of stdout existed at this step. */
export type Step = { line: number; stack: Frame[]; out: number };
export type TraceError = { kind: "compile" | "runtime"; message: string; line?: number };
export type Trace = {
  language: Language;
  steps: Step[];
  stdout: string;
  error?: TraceError;
  stopped?: "steps" | "time" | "size";
  /** Shown above the trace, e.g. when C++ could only be run, not traced. */
  notice?: string;
};

const encoder = new TextEncoder();

export function traceBytes(trace: Trace) {
  return encoder.encode(JSON.stringify(trace)).length;
}

// Drops trailing steps until the trace fits, so a broadcast never exceeds the limit.
export function capTrace(trace: Trace, maxBytes: number = LIMITS.maxTraceBytes): Trace {
  if (traceBytes(trace) <= maxBytes) return trace;
  const withSteps = (count: number): Trace => {
    const steps = trace.steps.slice(0, count);
    const out = steps.length > 0 ? steps[steps.length - 1].out : 0;
    return { ...trace, steps, stdout: trace.stdout.slice(0, out), stopped: "size" };
  };
  let lo = 0;
  let hi = trace.steps.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (traceBytes(withSteps(mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return withSteps(lo);
}

export function changedVariables(prev: Step | undefined, next: Step): Set<string> {
  const now = next.stack[next.stack.length - 1];
  const before = prev?.stack[prev.stack.length - 1];
  const changed = new Set<string>();
  if (!now) return changed;
  const sameFrame = !!before && before.fn === now.fn && prev!.stack.length === next.stack.length;
  for (const [name, value] of Object.entries(now.locals)) {
    if (!sameFrame || JSON.stringify(before!.locals[name]) !== JSON.stringify(value)) changed.add(name);
  }
  return changed;
}

export function collectObjects(step: Step): Map<string, ObjValue> {
  const objects = new Map<string, ObjValue>();
  const walk = (value: Value | undefined) => {
    if (!value || typeof value !== "object") return;
    if (value.t === "obj") {
      if (objects.has(value.id)) return;
      objects.set(value.id, value);
      Object.values(value.fields ?? {}).forEach(walk);
    } else if (value.t === "list" || value.t === "set") (value.items ?? []).forEach(walk);
    else if (value.t === "map") (value.entries ?? []).forEach(([k, v]) => { walk(k); walk(v); });
  };
  for (const frame of step.stack) Object.values(frame.locals ?? {}).forEach(walk);
  return objects;
}

export function resolveObj(value: Value | undefined, objects: Map<string, ObjValue>): ObjValue | null {
  if (!value) return null;
  if (value.t === "obj") return value;
  if (value.t === "ref") return objects.get(value.id) ?? null;
  return null;
}
```

- [ ] **Step 4: Run it to see it pass, then commit**

Run: `npx vitest run lib/viz/trace.test.ts`
Expected: PASS (5 tests).

```bash
git add lib/viz/trace.ts lib/viz/trace.test.ts
git commit -m "feat(viz): shared trace format, size cap and step helpers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Pointers, structures and value formatting

**Files:**
- Create: `lib/viz/pointers.ts`, `lib/viz/structures.ts`, `lib/viz/format.ts`
- Test: `lib/viz/pointers.test.ts`, `lib/viz/structures.test.ts`, `lib/viz/format.test.ts`

**Interfaces:**
- Consumes: the `Value`, `ObjValue`, `ListValue` types and `resolveObj` (Task 2).
- Produces:
  - `type Pointer = { name: string; index: number; end: boolean }`
  - `pointersFor(length, locals, exclude?): Pointer[]`
  - `gridPointers(rows, cols, locals, exclude?): { rows: Pointer[]; cols: Pointer[] }`
  - `type Structure` (union of `array | grid | map | set | linked | tree`)
  - `structuresOf(locals, objects): Structure[]`
  - `nodeLabel(obj): string`
  - `formatValue(value, language, objects?, max?): string`

- [ ] **Step 1: Write the failing tests**

`lib/viz/pointers.test.ts`:

```ts
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
```

`lib/viz/structures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nodeLabel, structuresOf } from "@/lib/viz/structures";
import { collectObjects, type ObjValue, type Step, type Value } from "@/lib/viz/trace";

const n = (v: number) => ({ t: "num", v }) as const;
const node = (id: string, val: number, next: Value): ObjValue => ({ t: "obj", id, cls: "Node", fields: { val: n(val), next } });
const objectsOf = (locals: Record<string, Value>) => collectObjects({ line: 1, out: 0, stack: [{ fn: "f", line: 1, locals }] } as Step);

describe("structuresOf", () => {
  it("classifies arrays, grids, maps and sets and ignores scalars", () => {
    const locals: Record<string, Value> = {
      a: { t: "list", kind: "list", items: [n(1), n(2)] },
      g: { t: "list", kind: "list", items: [{ t: "list", kind: "list", items: [n(0)] }] },
      m: { t: "map", entries: [[n(1), n(2)]] },
      s: { t: "set", items: [n(1)] },
      x: n(3),
    };
    expect(structuresOf(locals, objectsOf(locals)).map((s) => [s.kind, s.name])).toEqual([["array", "a"], ["grid", "g"], ["map", "m"], ["set", "s"]]);
  });

  it("draws linked lists once from their roots and labels every local pointing into them", () => {
    const n4 = node("4", 4, { t: "none" });
    const n3 = node("3", 3, n4);
    const n2 = node("2", 2, { t: "none" });
    const n1 = node("1", 1, n2);
    const locals: Record<string, Value> = { head: { t: "ref", id: "1" }, prev: n1, curr: n3, nxt: { t: "ref", id: "4" } };
    const structures = structuresOf(locals, objectsOf(locals));
    // head and prev point at the same node: the first local draws it, both label it.
    expect(structures.map((s) => s.name)).toEqual(["head", "curr"]);
    const first = structures[0];
    if (first.kind !== "linked") throw new Error("expected linked");
    expect(first.nodes.map((o) => o.id)).toEqual(["1", "2"]);
    expect(first.labels.get("1")).toEqual(["head", "prev"]);
    const curr = structures[1];
    if (curr.kind !== "linked") throw new Error("expected linked");
    expect(curr.labels.get("4")).toEqual(["nxt"]);
  });

  it("finds tree roots and stops at cycles", () => {
    const leaf: ObjValue = { t: "obj", id: "2", cls: "T", fields: { val: n(2), left: { t: "none" }, right: { t: "none" } } };
    const root: ObjValue = { t: "obj", id: "1", cls: "T", fields: { val: n(1), left: leaf, right: { t: "ref", id: "1" } } };
    const locals: Record<string, Value> = { root, child: { t: "ref", id: "2" } };
    expect(structuresOf(locals, objectsOf(locals)).map((s) => [s.kind, s.name])).toEqual([["tree", "root"]]);
  });

  it("labels a node by val, value, data or key", () => {
    expect(nodeLabel(node("1", 7, { t: "none" }), "python")).toBe("7");
    expect(nodeLabel({ t: "obj", id: "1", cls: "X", fields: { key: { t: "str", v: "k" } } }, "python")).toBe("'k'");
  });
});
```

`lib/viz/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatValue } from "@/lib/viz/format";

describe("formatValue", () => {
  it("formats scalars per language", () => {
    expect(formatValue({ t: "bool", v: true }, "python")).toBe("True");
    expect(formatValue({ t: "bool", v: true }, "cpp")).toBe("true");
    expect(formatValue({ t: "none" }, "python")).toBe("None");
    expect(formatValue({ t: "str", v: "hi" }, "python")).toBe("'hi'");
    expect(formatValue({ t: "str", v: "hi", cut: true }, "cpp")).toBe('"hi…"');
    expect(formatValue({ t: "num", v: "123456789012345678901" }, "cpp")).toBe("123456789012345678901");
  });

  it("formats containers compactly and truncates", () => {
    expect(formatValue({ t: "list", kind: "list", items: [{ t: "num", v: 1 }, { t: "num", v: 2 }], more: 3 }, "python")).toBe("[1, 2, …+3]");
    expect(formatValue({ t: "list", kind: "tuple", items: [{ t: "num", v: 1 }] }, "python")).toBe("(1,)");
    expect(formatValue({ t: "map", entries: [[{ t: "str", v: "a" }, { t: "num", v: 1 }]] }, "python")).toBe("{'a': 1}");
    expect(formatValue({ t: "set", items: [] }, "python")).toBe("set()");
    expect(formatValue({ t: "list", kind: "vector", items: Array.from({ length: 40 }, (_, v) => ({ t: "num", v })) }, "cpp", undefined, 20)).toMatch(/^\{0, 1, .*…$/);
  });

  it("formats objects, refs and placeholders", () => {
    expect(formatValue({ t: "obj", id: "1", cls: "Node", fields: { val: { t: "num", v: 3 } } }, "python")).toBe("Node(val=3)");
    expect(formatValue({ t: "ref", id: "1" }, "python")).toBe("→ object");
    expect(formatValue({ t: "unsupported", type: "int *" }, "cpp")).toBe("‹int *›");
    expect(formatValue({ t: "cut" }, "cpp")).toBe("…");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/viz/pointers.test.ts lib/viz/structures.test.ts lib/viz/format.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement**

`lib/viz/pointers.ts`:

```ts
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
```

`lib/viz/format.ts`:

```ts
import type { Language } from "@/lib/viz/engines";
import type { ObjValue, Value } from "@/lib/viz/trace";

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);

export function formatValue(value: Value | undefined, language: Language, objects?: Map<string, ObjValue>, max = 60): string {
  return cut(render(value, language, objects, 0), max);
}

function render(value: Value | undefined, language: Language, objects: Map<string, ObjValue> | undefined, depth: number): string {
  const py = language === "python";
  const inner = (v: Value) => render(v, language, objects, depth + 1);
  const more = (n?: number) => (n ? [`…+${n}`] : []);
  if (!value || typeof value !== "object") return "?";
  switch (value.t) {
    case "num": return String(value.v);
    case "bool": return py ? (value.v ? "True" : "False") : String(value.v);
    case "none": return py ? "None" : "null";
    case "str": {
      const quote = py ? "'" : '"';
      return `${quote}${value.v}${value.cut ? "…" : ""}${quote}`;
    }
    case "list": {
      const parts = [...(value.items ?? []).map(inner), ...more(value.more)];
      if (value.kind === "tuple") return parts.length === 1 ? `(${parts[0]},)` : `(${parts.join(", ")})`;
      return py ? `[${parts.join(", ")}]` : `{${parts.join(", ")}}`;
    }
    case "set": {
      const parts = [...(value.items ?? []).map(inner), ...more(value.more)];
      return parts.length === 0 && py ? "set()" : `{${parts.join(", ")}}`;
    }
    case "map": {
      const parts = [...(value.entries ?? []).map(([k, v]) => `${inner(k)}: ${inner(v)}`), ...more(value.more)];
      return `{${parts.join(", ")}}`;
    }
    case "obj": {
      if (depth > 1) return `${value.cls}(…)`;
      const fields = Object.entries(value.fields ?? {}).map(([k, v]) => `${k}=${inner(v)}`);
      return `${value.cls}(${fields.join(", ")})`;
    }
    case "ref": {
      const target = objects?.get(value.id);
      return target ? `→ ${target.cls}` : "→ object";
    }
    case "unsupported": return `‹${value.type}›`;
    case "cut": return "…";
    default: return "?";
  }
}
```

`lib/viz/structures.ts`:

```ts
import type { Language } from "@/lib/viz/engines";
import { formatValue } from "@/lib/viz/format";
import { resolveObj, type ListValue, type ObjValue, type Value } from "@/lib/viz/trace";

export type Structure =
  | { kind: "array"; name: string; value: ListValue }
  | { kind: "grid"; name: string; value: ListValue }
  | { kind: "map"; name: string; value: Extract<Value, { t: "map" }> }
  | { kind: "set"; name: string; value: Extract<Value, { t: "set" }> }
  | { kind: "linked"; name: string; nodes: ObjValue[]; labels: Map<string, string[]> }
  | { kind: "tree"; name: string; root: ObjValue; labels: Map<string, string[]> };

const MAX_NODES = 100;
const isLinkedNode = (o: ObjValue) => "next" in (o.fields ?? {});
const isTreeNode = (o: ObjValue) => "left" in (o.fields ?? {}) || "right" in (o.fields ?? {});

function chain(start: ObjValue, objects: Map<string, ObjValue>): ObjValue[] {
  const nodes: ObjValue[] = [];
  const seen = new Set<string>();
  let current: ObjValue | null = start;
  while (current && !seen.has(current.id) && nodes.length < MAX_NODES) {
    seen.add(current.id);
    nodes.push(current);
    current = resolveObj(current.fields.next, objects);
  }
  return nodes;
}

function treeIds(root: ObjValue, objects: Map<string, ObjValue>): Set<string> {
  const ids = new Set<string>();
  const stack = [root];
  while (stack.length > 0 && ids.size < MAX_NODES) {
    const node = stack.pop()!;
    if (ids.has(node.id)) continue;
    ids.add(node.id);
    for (const side of ["left", "right"]) {
      const child = resolveObj(node.fields[side], objects);
      if (child) stack.push(child);
    }
  }
  return ids;
}

/** The structures worth drawing for one frame, in local order. Linked lists and trees appear once, from their roots. */
export function structuresOf(locals: Record<string, Value>, objects: Map<string, ObjValue>): Structure[] {
  const entries = Object.entries(locals);
  const nodesOf = (test: (o: ObjValue) => boolean) =>
    entries.flatMap(([name, value]) => {
      const obj = resolveObj(value, objects);
      return obj && test(obj) ? [{ name, obj }] : [];
    });
  const linked = nodesOf(isLinkedNode).map((l) => ({ ...l, ids: chain(l.obj, objects).map((o) => o.id) }));
  const trees = nodesOf((o) => !isLinkedNode(o) && isTreeNode(o)).map((t) => ({ ...t, ids: treeIds(t.obj, objects) }));

  const labelsFor = (ids: Iterable<string>, owners: { name: string; obj: ObjValue }[]) => {
    const wanted = new Set(ids);
    const labels = new Map<string, string[]>();
    for (const { name, obj } of owners) if (wanted.has(obj.id)) labels.set(obj.id, [...(labels.get(obj.id) ?? []), name]);
    return labels;
  };

  const structures: Structure[] = [];
  const drawn = new Set<string>();
  for (const [name, value] of entries) {
    if (!value || typeof value !== "object") continue;
    if (value.t === "list") {
      const isGrid = value.items.length > 0 && value.items.every((item) => item?.t === "list");
      structures.push({ kind: isGrid ? "grid" : "array", name, value });
    } else if (value.t === "map") structures.push({ kind: "map", name, value });
    else if (value.t === "set") structures.push({ kind: "set", name, value });
    else {
      const list = linked.find((l) => l.name === name);
      if (list) {
        const insideAnother = linked.some((other) => other.name !== name && other.ids.indexOf(list.obj.id) > 0);
        if (!insideAnother && !drawn.has(list.obj.id)) {
          drawn.add(list.obj.id);
          const nodes = chain(list.obj, objects);
          structures.push({ kind: "linked", name, nodes, labels: labelsFor(nodes.map((o) => o.id), linked) });
        }
        continue;
      }
      const tree = trees.find((t) => t.name === name);
      if (tree) {
        const insideAnother = trees.some((other) => other.name !== name && other.obj.id !== tree.obj.id && other.ids.has(tree.obj.id));
        if (!insideAnother && !drawn.has(tree.obj.id)) {
          drawn.add(tree.obj.id);
          structures.push({ kind: "tree", name, root: tree.obj, labels: labelsFor(tree.ids, trees) });
        }
      }
    }
  }
  return structures;
}

export function nodeLabel(node: ObjValue, language: Language): string {
  for (const key of ["val", "value", "data", "key"]) if (key in node.fields) return formatValue(node.fields[key], language, undefined, 12);
  const scalar = Object.values(node.fields).find((v) => v.t === "num" || v.t === "str" || v.t === "bool");
  return scalar ? formatValue(scalar, language, undefined, 12) : node.cls;
}
```

- [ ] **Step 4: Run them to see them pass, then commit**

Run: `npx vitest run lib/viz/pointers.test.ts lib/viz/structures.test.ts lib/viz/format.test.ts`
Expected: PASS (3 + 4 + 3 tests).

```bash
git add lib/viz/pointers.ts lib/viz/pointers.test.ts lib/viz/structures.ts lib/viz/structures.test.ts lib/viz/format.ts lib/viz/format.test.ts
git commit -m "feat(viz): pointer detection, structure classification and value formatting

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Templates, copy and local backup

**Files:**
- Create: `lib/viz/templates.ts`, `lib/viz/copy.ts`, `lib/viz/backup.ts`
- Test: `lib/viz/backup.test.ts`, `lib/viz/templates.test.ts`

**Interfaces:**
- Consumes: `Language`, `LIMITS` (Task 1).
- Produces:
  - `type Template = { id; name; code; stdin? }`
  - `TEMPLATES: Record<Language, Template[]>`
  - `VIZ_COPY`
  - `type Drafts`, `type VizBackup`
  - `vizBackupKey(roomId)`
  - `readVizBackup(storage, roomId)`
  - `writeVizBackup(storage, roomId, backup)`
  - `defaultDrafts()`

- [ ] **Step 1: Write the failing tests**

`lib/viz/templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/lib/viz/templates";

describe("templates", () => {
  it("has the same 8 programs in each language, with unique ids", () => {
    for (const language of ["python", "cpp"] as const) {
      expect(TEMPLATES[language]).toHaveLength(8);
      expect(new Set(TEMPLATES[language].map((t) => t.id)).size).toBe(8);
    }
    expect(TEMPLATES.python.slice(0, 7).map((t) => t.id)).toEqual(TEMPLATES.cpp.slice(0, 7).map((t) => t.id));
  });
});
```

`lib/viz/backup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultDrafts, readVizBackup, vizBackupKey, writeVizBackup } from "@/lib/viz/backup";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe("viz backup", () => {
  it("round-trips per room", () => {
    const storage = memory();
    const backup = { language: "cpp" as const, drafts: { ...defaultDrafts(), cpp: { code: "int main(){}", stdin: "1" } } };
    writeVizBackup(storage, "r1", backup);
    expect(storage.data.has(vizBackupKey("r1"))).toBe(true);
    expect(readVizBackup(storage, "r1")).toEqual(backup);
    expect(readVizBackup(storage, "r2")).toBeNull();
  });

  it("ignores broken or foreign data and storage errors", () => {
    const storage = memory();
    storage.setItem(vizBackupKey("r"), "{not json");
    expect(readVizBackup(storage, "r")).toBeNull();
    storage.setItem(vizBackupKey("r"), JSON.stringify({ language: "java", drafts: {} }));
    expect(readVizBackup(storage, "r")).toBeNull();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(readVizBackup(throwing, "r")).toBeNull();
    expect(() => writeVizBackup(throwing, "r", { language: "python", drafts: defaultDrafts() })).not.toThrow();
  });

  it("starts each language on its first template", () => {
    const drafts = defaultDrafts();
    expect(drafts.python.code).toContain("def bubble_sort");
    expect(drafts.cpp.code).toContain("int main");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/viz/templates.test.ts lib/viz/backup.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement**

`lib/viz/copy.ts`:

```ts
import type { Language } from "@/lib/viz/engines";

// Visualizer copy (spec §6). Change it here.
export const VIZ_COPY = {
  loading: { python: "Loading Python… (first run only)", cpp: "Loading the C++ compiler… (first run only, about 30 MB)" } satisfies Record<Language, string>,
  compiling: "Compiling…",
  running: "Running…",
  stoppedSteps: "Stopped after 1,000 steps. Showing the first 1,000.",
  stoppedTime: "Stopped after 10 seconds.",
  stoppedSize: (steps: number) => `Trace too large. Showing the first ${steps.toLocaleString("en-US")} steps.`,
  waitingRun: "Waiting for the candidate to run code.",
  noEditor: "The candidate isn't on the visualizer yet.",
  emptyEditor: "Run your code to see it step by step.",
  noSteps: "This run has no steps to show.",
  loadFailed: { python: "Couldn't load Python. Check the connection and run again.", cpp: "Couldn't load the C++ compiler. Check the connection and run again." } satisfies Record<Language, string>,
  untraceable: "The visualizer couldn't follow this code (it may use macros or syntax it doesn't support). Showing the program's output only.",
  busy: "A run is already in progress.",
  replaceCode: (name: string) => `Replace your code with “${name}”?`,
} as const;
```

`lib/viz/templates.ts`:

````ts
import type { Language } from "@/lib/viz/engines";

export type Template = { id: string; name: string; code: string; stdin?: string };

const py = (id: string, name: string, code: string): Template => ({ id, name, code: code.trimStart() });

export const TEMPLATES: Record<Language, Template[]> = {
  python: [
    py("bubble-sort", "Bubble sort", `
def bubble_sort(a):
    n = len(a)
    for i in range(n):
        for j in range(n - i - 1):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
    return a

print(bubble_sort([5, 1, 4, 2, 8]))
`),
    py("binary-search", "Binary search", `
def binary_search(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1

print(binary_search([1, 3, 5, 7, 9, 11, 13], 9))
`),
    py("two-sum", "Two sum (hash map)", `
def two_sum(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        need = target - x
        if need in seen:
            return [seen[need], i]
        seen[x] = i
    return []

print(two_sum([2, 7, 11, 15], 9))
`),
    py("two-pointers", "Two pointers: most water", `
def max_area(height):
    left, right = 0, len(height) - 1
    best = 0
    while left < right:
        area = min(height[left], height[right]) * (right - left)
        best = max(best, area)
        if height[left] < height[right]:
            left += 1
        else:
            right -= 1
    return best

print(max_area([1, 8, 6, 2, 5, 4, 8, 3, 7]))
`),
    py("recursion", "Recursion: fibonacci", `
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print(fib(5))
`),
    py("bfs-grid", "BFS on a grid", `
from collections import deque

def shortest_path(grid):
    rows, cols = len(grid), len(grid[0])
    dist = [[-1] * cols for _ in range(rows)]
    dist[0][0] = 0
    queue = deque([(0, 0)])
    while queue:
        r, c = queue.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 0 and dist[nr][nc] == -1:
                dist[nr][nc] = dist[r][c] + 1
                queue.append((nr, nc))
    return dist[rows - 1][cols - 1]

print(shortest_path([[0, 0, 1], [1, 0, 0], [0, 0, 0]]))
`),
    py("merge-sort", "Merge sort", `
def merge_sort(a):
    if len(a) <= 1:
        return a
    mid = len(a) // 2
    left = merge_sort(a[:mid])
    right = merge_sort(a[mid:])
    merged = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i])
            i += 1
        else:
            merged.append(right[j])
            j += 1
    merged.extend(left[i:])
    merged.extend(right[j:])
    return merged

print(merge_sort([38, 27, 43, 3, 9, 82, 10]))
`),
    py("linked-list", "Reverse a linked list", `
class Node:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next

def reverse(head):
    prev = None
    curr = head
    while curr:
        nxt = curr.next
        curr.next = prev
        prev = curr
        curr = nxt
    return prev

head = reverse(Node(1, Node(2, Node(3, Node(4)))))
values = []
while head:
    values.append(head.val)
    head = head.next
print(values)
`),
  ],
  cpp: [
    py("bubble-sort", "Bubble sort", `
#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> a = {5, 1, 4, 2, 8};
    int n = a.size();
    for (int i = 0; i < n; i++)
        for (int j = 0; j + 1 < n - i; j++)
            if (a[j] > a[j + 1]) swap(a[j], a[j + 1]);
    for (int x : a) cout << x << ' ';
    cout << endl;
}
`),
    py("binary-search", "Binary search", `
#include <iostream>
#include <vector>
using namespace std;

int binarySearch(const vector<int>& nums, int target) {
    int lo = 0, hi = nums.size() - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (nums[mid] == target) return mid;
        if (nums[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

int main() {
    vector<int> nums = {1, 3, 5, 7, 9, 11, 13};
    cout << binarySearch(nums, 9) << endl;
}
`),
    py("two-sum", "Two sum (hash map)", `
#include <iostream>
#include <unordered_map>
#include <vector>
using namespace std;

vector<int> twoSum(const vector<int>& nums, int target) {
    unordered_map<int, int> seen;
    for (int i = 0; i < (int)nums.size(); i++) {
        int need = target - nums[i];
        if (seen.count(need)) return {seen[need], i};
        seen[nums[i]] = i;
    }
    return {};
}

int main() {
    vector<int> ans = twoSum({2, 7, 11, 15}, 9);
    cout << ans[0] << ' ' << ans[1] << endl;
}
`),
    py("two-pointers", "Two pointers: most water", `
#include <algorithm>
#include <iostream>
#include <vector>
using namespace std;

int maxArea(const vector<int>& height) {
    int left = 0, right = height.size() - 1, best = 0;
    while (left < right) {
        int area = min(height[left], height[right]) * (right - left);
        best = max(best, area);
        if (height[left] < height[right]) left++;
        else right--;
    }
    return best;
}

int main() {
    cout << maxArea({1, 8, 6, 2, 5, 4, 8, 3, 7}) << endl;
}
`),
    py("recursion", "Recursion: fibonacci", `
#include <iostream>
using namespace std;

int fib(int n) {
    if (n < 2) return n;
    return fib(n - 1) + fib(n - 2);
}

int main() {
    cout << fib(5) << endl;
}
`),
    py("bfs-grid", "BFS on a grid", `
#include <iostream>
#include <queue>
#include <utility>
#include <vector>
using namespace std;

int shortestPath(const vector<vector<int>>& grid) {
    int rows = grid.size(), cols = grid[0].size();
    vector<vector<int>> dist(rows, vector<int>(cols, -1));
    queue<pair<int, int>> q;
    dist[0][0] = 0;
    q.push({0, 0});
    int dr[] = {1, -1, 0, 0}, dc[] = {0, 0, 1, -1};
    while (!q.empty()) {
        auto [r, c] = q.front();
        q.pop();
        for (int d = 0; d < 4; d++) {
            int nr = r + dr[d], nc = c + dc[d];
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] == 0 && dist[nr][nc] == -1) {
                dist[nr][nc] = dist[r][c] + 1;
                q.push({nr, nc});
            }
        }
    }
    return dist[rows - 1][cols - 1];
}

int main() {
    vector<vector<int>> grid = {{0, 0, 1}, {1, 0, 0}, {0, 0, 0}};
    cout << shortestPath(grid) << endl;
}
`),
    py("merge-sort", "Merge sort", `
#include <iostream>
#include <vector>
using namespace std;

void mergeSort(vector<int>& a, int lo, int hi) {
    if (hi - lo <= 1) return;
    int mid = (lo + hi) / 2;
    mergeSort(a, lo, mid);
    mergeSort(a, mid, hi);
    vector<int> merged;
    int i = lo, j = mid;
    while (i < mid && j < hi) {
        if (a[i] <= a[j]) merged.push_back(a[i++]);
        else merged.push_back(a[j++]);
    }
    while (i < mid) merged.push_back(a[i++]);
    while (j < hi) merged.push_back(a[j++]);
    for (int k = 0; k < (int)merged.size(); k++) a[lo + k] = merged[k];
}

int main() {
    vector<int> a = {38, 27, 43, 3, 9, 82, 10};
    mergeSort(a, 0, a.size());
    for (int x : a) cout << x << ' ';
    cout << endl;
}
`),
    py("balanced-brackets", "Stack: balanced brackets", `
#include <iostream>
#include <stack>
#include <string>
using namespace std;

bool isValid(const string& s) {
    stack<char> st;
    for (char ch : s) {
        if (ch == '(' || ch == '[' || ch == '{') {
            st.push(ch);
        } else {
            if (st.empty()) return false;
            char open = st.top();
            st.pop();
            if ((ch == ')' && open != '(') || (ch == ']' && open != '[') || (ch == '}' && open != '{')) return false;
        }
    }
    return st.empty();
}

int main() {
    cout << boolalpha << isValid("{[()()]}") << endl;
}
`),
  ],
};
````

`lib/viz/backup.ts`:

```ts
import type { Language } from "@/lib/viz/engines";
import { TEMPLATES } from "@/lib/viz/templates";

export type Drafts = Record<Language, { code: string; stdin: string }>;
export type VizBackup = { language: Language; drafts: Drafts };
type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export const vizBackupKey = (roomId: string) => `pentolive:viz:${roomId}`;

export function defaultDrafts(): Drafts {
  return { python: { code: TEMPLATES.python[0].code, stdin: "" }, cpp: { code: TEMPLATES.cpp[0].code, stdin: "" } };
}

const isDraft = (v: unknown): v is { code: string; stdin: string } =>
  !!v && typeof v === "object" && typeof (v as { code?: unknown }).code === "string" && typeof (v as { stdin?: unknown }).stdin === "string";

export function readVizBackup(storage: StorageLike | null, roomId: string): VizBackup | null {
  try {
    const raw = storage?.getItem(vizBackupKey(roomId));
    if (!raw) return null;
    const value = JSON.parse(raw) as { language?: unknown; drafts?: Record<string, unknown> };
    if ((value.language !== "python" && value.language !== "cpp") || !isDraft(value.drafts?.python) || !isDraft(value.drafts?.cpp)) return null;
    return { language: value.language, drafts: { python: value.drafts.python, cpp: value.drafts.cpp } };
  } catch {
    return null;
  }
}

export function writeVizBackup(storage: StorageLike | null, roomId: string, backup: VizBackup) {
  try {
    storage?.setItem(vizBackupKey(roomId), JSON.stringify(backup));
  } catch {
    // Storage full or blocked: the live session still works.
  }
}
```

- [ ] **Step 4: Run them to see them pass, then commit**

Run: `npx vitest run lib/viz/templates.test.ts lib/viz/backup.test.ts`
Expected: PASS (1 + 3 tests).

```bash
git add lib/viz/templates.ts lib/viz/templates.test.ts lib/viz/copy.ts lib/viz/backup.ts lib/viz/backup.test.ts
git commit -m "feat(viz): starter templates, copy and per-room code backup

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Python tracer

**Files:**
- Create: `lib/viz/python/tracer.ts` (the tracer as a Python source string)
- Create: `lib/viz/python/run.ts`
- Test: `lib/viz/python/python.engine.test.ts`

**Interfaces:**
- Consumes: `Trace` (Task 2), `LIMITS` (Task 1), `TEMPLATES` (Task 4).
- Produces:
  - `TRACER_SOURCE: string`
  - `type PyodideLike = { runPython(code: string): unknown; globals: { get(name: string): unknown } }`
  - `runPython(py: PyodideLike, code: string, stdin: string): Trace`

- [ ] **Step 1: Write the failing engine test** `lib/viz/python/python.engine.test.ts`

```ts
import { loadPyodide } from "pyodide";
import { beforeAll, describe, expect, it } from "vitest";
import { runPython, type PyodideLike } from "@/lib/viz/python/run";
import { TEMPLATES } from "@/lib/viz/templates";

let py: PyodideLike;
beforeAll(async () => { py = (await loadPyodide()) as unknown as PyodideLike; });

const run = (code: string, stdin = "") => runPython(py, code, stdin);

describe("python tracer", () => {
  it("records lines, locals and stdout progress", () => {
    const trace = run("a = [3, 1]\na[0], a[1] = a[1], a[0]\nprint(a)\n");
    expect(trace.language).toBe("python");
    expect(trace.steps.map((s) => s.line)).toEqual([1, 2, 3]);
    expect(trace.steps[1].stack[0].locals.a).toEqual({ t: "list", kind: "list", items: [{ t: "num", v: 3 }, { t: "num", v: 1 }] });
    expect(trace.steps[0].stack[0].fn).toBe("main");
    expect(trace.stdout).toBe("[1, 3]\n");
    expect(trace.steps[2].out).toBe(0);
  });

  it("records the call stack through recursion", () => {
    const trace = run("def f(n):\n    if n == 0:\n        return 0\n    return f(n - 1)\nf(2)\n");
    const deepest = Math.max(...trace.steps.map((s) => s.stack.length));
    expect(deepest).toBe(4);
    const top = trace.steps.find((s) => s.stack.length === 4)!;
    expect(top.stack.map((f) => f.fn)).toEqual(["main", "f", "f", "f"]);
    expect(top.stack[3].locals.n).toEqual({ t: "num", v: 0 });
  });

  it("stops infinite loops after 1,000 steps", () => {
    const trace = run("i = 0\nwhile True:\n    i += 1\n");
    expect(trace.steps).toHaveLength(1000);
    expect(trace.stopped).toBe("steps");
  });

  it("reports syntax errors and runtime errors with their line", () => {
    expect(run("x = (\n").error).toMatchObject({ kind: "compile", line: 1 });
    const trace = run("a = [1]\nb = a[5]\n");
    expect(trace.error).toMatchObject({ kind: "runtime", line: 2 });
    expect(trace.error?.message).toContain("IndexError");
    expect(trace.steps.length).toBe(2);
  });

  it("reads input() from stdin and serializes objects, deques and big ints", () => {
    const trace = run("from collections import deque\nclass N:\n    def __init__(self, v):\n        self.val = v\n        self.next = None\nn = N(int(input()))\nq = deque([1])\nbig = 2 ** 70\nprint(n.val)\n", "41\n");
    const last = trace.steps[trace.steps.length - 1].stack[0].locals;
    expect(last.n).toMatchObject({ t: "obj", cls: "N", fields: { val: { t: "num", v: 41 }, next: { t: "none" } } });
    expect(last.q).toMatchObject({ t: "list", kind: "deque" });
    expect(last.big).toEqual({ t: "num", v: "1180591620717411303424" });
    expect(last.N).toBeUndefined();
    expect(trace.stdout).toBe("41\n");
  });

  it("runs every Python template without errors or stopping", () => {
    for (const template of TEMPLATES.python) {
      const trace = run(template.code, template.stdin ?? "");
      expect(trace.error, template.id).toBeUndefined();
      expect(trace.stopped, template.id).toBeUndefined();
      expect(trace.steps.length, template.id).toBeGreaterThan(3);
      expect(trace.stdout.length, template.id).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:engines -- lib/viz/python`
Expected: FAIL, cannot resolve `@/lib/viz/python/run`.

- [ ] **Step 3: Implement**

`lib/viz/python/tracer.ts`. `String.raw` keeps the Python escapes intact.

```ts
// Runs the user's code under sys.settrace and returns the trace as JSON (see lib/viz/trace.ts).
export const TRACER_SOURCE = String.raw`
import sys, io, json, time, types, collections

class _PlStop(BaseException):
    pass

_PL_SKIP = (types.FunctionType, types.BuiltinFunctionType, types.MethodType, types.ModuleType, type)
_PL_CONTAINERS = (list, tuple, dict, set, frozenset, collections.deque)

def __pl_run(code_text, stdin_text, max_steps, max_depth, max_items, max_str, max_stdout, max_seconds):
    steps = []
    out = io.StringIO()
    feed = io.StringIO(stdin_text)
    stopped = [None]
    deadline = time.monotonic() + max_seconds

    def item(x, depth, seen):
        s = ser(x, depth, seen)
        return s if s is not None else {"t": "unsupported", "type": type(x).__name__}

    def ser(v, depth, seen):
        if v is None:
            return {"t": "none"}
        if isinstance(v, bool):
            return {"t": "bool", "v": v}
        if isinstance(v, int):
            return {"t": "num", "v": v if -(2 ** 53) < v < 2 ** 53 else str(v)}
        if isinstance(v, float):
            return {"t": "num", "v": v if v == v and v not in (float("inf"), float("-inf")) else str(v)}
        if isinstance(v, str):
            r = {"t": "str", "v": v[:max_str]}
            if len(v) > max_str:
                r["cut"] = True
            return r
        if isinstance(v, _PL_SKIP):
            return None
        if hasattr(v, "__dict__") and not isinstance(v, _PL_CONTAINERS):
            oid = str(id(v))
            if oid in seen:
                return {"t": "ref", "id": oid}
            if len(seen) >= max_items:
                return {"t": "cut"}
            seen.add(oid)
            fields = {}
            for k, x in list(vars(v).items())[:max_items]:
                if k.startswith("__"):
                    continue
                s = ser(x, depth, seen)
                if s is not None:
                    fields[k] = s
            return {"t": "obj", "id": oid, "cls": type(v).__name__, "fields": fields}
        if depth >= max_depth:
            return {"t": "cut"}
        if isinstance(v, (list, tuple, collections.deque)):
            kind = "tuple" if isinstance(v, tuple) else "deque" if isinstance(v, collections.deque) else "list"
            values = list(v)
            r = {"t": "list", "kind": kind, "items": [item(x, depth + 1, seen) for x in values[:max_items]]}
            if len(values) > max_items:
                r["more"] = len(values) - max_items
            return r
        if isinstance(v, (set, frozenset)):
            values = list(v)
            try:
                values.sort()
            except TypeError:
                pass
            r = {"t": "set", "items": [item(x, depth + 1, seen) for x in values[:max_items]]}
            if len(values) > max_items:
                r["more"] = len(values) - max_items
            return r
        if isinstance(v, dict):
            entries = list(v.items())
            r = {"t": "map", "entries": [[item(k, depth + 1, seen), item(x, depth + 1, seen)] for k, x in entries[:max_items]]}
            if len(entries) > max_items:
                r["more"] = len(entries) - max_items
            return r
        return {"t": "unsupported", "type": type(v).__name__}

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != "<user>":
            return None
        if event != "line":
            return tracer
        if len(steps) >= max_steps:
            stopped[0] = "steps"
            raise _PlStop()
        if time.monotonic() > deadline:
            stopped[0] = "time"
            raise _PlStop()
        chain = []
        f = frame
        while f is not None and f.f_code.co_filename == "<user>":
            chain.append(f)
            f = f.f_back
        chain.reverse()
        seen = set()
        stack = []
        for f in chain:
            local_vars = {}
            for name, value in list(f.f_locals.items()):
                if name.startswith("__"):
                    continue
                s = ser(value, 0, seen)
                if s is not None:
                    local_vars[name] = s
            fn = "main" if f.f_code.co_name == "<module>" else f.f_code.co_name
            stack.append({"fn": fn, "line": f.f_lineno, "locals": local_vars})
        steps.append({"line": frame.f_lineno, "stack": stack, "out": min(out.tell(), max_stdout)})
        return tracer

    def read_input(prompt=""):
        out.write(str(prompt))
        line = feed.readline()
        if not line:
            raise EOFError("EOF when reading a line")
        return line[:-1] if line.endswith("\n") else line

    try:
        code = compile(code_text, "<user>", "exec")
    except SyntaxError as e:
        error = {"message": f"{type(e).__name__}: {e.msg}", "kind": "compile"}
        if e.lineno:
            error["line"] = e.lineno
        return json.dumps({"language": "python", "steps": [], "stdout": "", "error": error})

    scope = {"__name__": "__main__", "input": read_input}
    error = None
    saved = (sys.stdout, sys.stderr, sys.stdin)
    sys.stdout, sys.stderr, sys.stdin = out, out, feed
    sys.settrace(tracer)
    try:
        exec(code, scope)
    except _PlStop:
        pass
    except SystemExit as e:
        if e.code not in (None, 0):
            error = {"message": f"SystemExit: {e.code}", "kind": "runtime"}
    except BaseException as e:
        error = {"message": f"{type(e).__name__}: {e}", "kind": "runtime"}
        tb = e.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == "<user>":
                error["line"] = tb.tb_lineno
            tb = tb.tb_next
    finally:
        sys.settrace(None)
        sys.stdout, sys.stderr, sys.stdin = saved
    result = {"language": "python", "steps": steps, "stdout": out.getvalue()[:max_stdout]}
    if error is not None:
        result["error"] = error
    if stopped[0]:
        result["stopped"] = stopped[0]
    return json.dumps(result)
`;
```

`lib/viz/python/run.ts`:

```ts
import { LIMITS } from "@/lib/viz/engines";
import { TRACER_SOURCE } from "@/lib/viz/python/tracer";
import type { Trace } from "@/lib/viz/trace";

export type PyodideLike = { runPython(code: string): unknown; globals: { get(name: string): unknown } };

const installed = new WeakSet<object>();

export function runPython(py: PyodideLike, code: string, stdin: string): Trace {
  if (!installed.has(py)) {
    py.runPython(TRACER_SOURCE);
    installed.add(py);
  }
  const run = py.globals.get("__pl_run") as (...args: unknown[]) => string;
  const json = run(code, stdin, LIMITS.maxSteps, LIMITS.maxDepth, LIMITS.maxItems, LIMITS.maxStringChars, LIMITS.maxStdoutChars, LIMITS.runTimeoutMs / 1000);
  return JSON.parse(json) as Trace;
}
```

- [ ] **Step 4: Run it to see it pass, then commit**

Run: `npm run test:engines -- lib/viz/python`
Expected: PASS (6 tests). If a line expectation differs because of Python 3.14 line-event rules, re-check it against the documented `sys.settrace` behaviour, fix the expectation, and ledger it as a ruling.

```bash
git add lib/viz/python
git commit -m "feat(viz): Python tracer on Pyodide with steps, frames and limits

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: C++ prelude and instrumentation

**Files:**
- Create: `lib/viz/cpp/prelude.ts`, `lib/viz/cpp/instrument.ts`, `lib/viz/cpp/testParser.ts`
- Test: `lib/viz/cpp/instrument.test.ts`

**Interfaces:**
- Consumes: `Node` type from `web-tree-sitter`.
- Produces:
  - `PRELUDE` (the C++ header text)
  - `CLANG_FLAGS: string[]`
  - `PRELUDE_INCLUDE` (`#include "__pl.h"\n#line 1 "main.cc"\n`)
  - `instrument(root: Node, source: string): string`
  - `cppParser(): Promise<Parser>` (Node tests only)

- [ ] **Step 1: Write the test helper and the failing test**

`lib/viz/cpp/testParser.ts`. This is test-only; the app loads the grammar from the CDN.

```ts
import path from "node:path";
import { Language, Parser } from "web-tree-sitter";

let parser: Promise<Parser> | null = null;

export function cppParser() {
  parser ??= (async () => {
    await Parser.init();
    const instance = new Parser();
    instance.setLanguage(await Language.load(path.join(process.cwd(), "node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm")));
    return instance;
  })();
  return parser;
}
```

`lib/viz/cpp/instrument.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { instrument } from "@/lib/viz/cpp/instrument";
import { cppParser } from "@/lib/viz/cpp/testParser";

const rewrite = async (source: string) => {
  const tree = (await cppParser()).parse(source)!;
  expect(tree.rootNode.hasError).toBe(false);
  return instrument(tree.rootNode, source);
};
const step = (line: number, vars: string[]) =>
  `__pl::step(${line}, [&](__pl::Vars& __pl_v) { ${vars.map((v) => `__pl_v.var("${v}", ${v});`).join(" ")} });`;

describe("instrument", () => {
  it("adds a frame guard and a step before each statement, with the variables in scope", async () => {
    const out = await rewrite("int f(int n) {\n  int a = 1;\n  return a + n;\n}\n");
    expect(out).toBe(`int f(int n) { __pl::FrameGuard __pl_g("f", 1);\n  ${step(2, ["n"])} int a = 1;\n  ${step(3, ["n", "a"])} return a + n;\n}\n`);
  });

  it("keeps every insertion on the statement's own line", async () => {
    const source = "int main() {\n  int x = 0;\n  for (int i = 0; i < 3; i++)\n    if (i % 2) x += i;\n    else x -= i;\n  return x;\n}\n";
    const out = await rewrite(source);
    expect(out.split("\n")).toHaveLength(source.split("\n").length);
    expect(out).toContain(`{ ${step(4, ["x", "i"])} if (i % 2) { ${step(4, ["x", "i"])} x += i; }`);
    expect(out).toContain(`else { ${step(5, ["x", "i"])} x -= i; }`);
  });

  it("sees range-for variables and structured bindings only inside their scope", async () => {
    const out = await rewrite("void g(std::vector<int> v) {\n  for (auto& x : v) {\n    auto [a, b] = std::pair<int,int>(x, x);\n    a++;\n  }\n  v.clear();\n}\n");
    expect(out).toContain(`${step(3, ["v", "x"])} auto [a, b]`);
    expect(out).toContain(`${step(4, ["v", "x", "a", "b"])} a++;`);
    expect(out).toContain(`${step(6, ["v"])} v.clear();`);
  });

  it("skips lambda bodies, constexpr functions, preprocessor lines and variable-length arrays", async () => {
    const source = [
      "constexpr int sq(int x) { return x * x; }",
      "int main() {",
      "  int n = 3;",
      "  int vla[n];",
      "  int fixed[4] = {0};",
      "  auto add = [&](int y) { return n + y; };",
      "#ifdef DEBUG",
      "  n++;",
      "#endif",
      "  return add(1);",
      "}",
      "",
    ].join("\n");
    const out = await rewrite(source);
    expect(out).toContain("constexpr int sq(int x) { return x * x; }");
    expect(out).toContain("{ return n + y; }");
    expect(out).toContain(`${step(10, ["n", "fixed", "add"])} return add(1);`);
    expect(out).toContain("\n#ifdef DEBUG");
  });

  it("uses character offsets, so non-ASCII text before the code is safe", async () => {
    const out = await rewrite("// héllo ✓ 😀\nint main() {\n  return 0;\n}\n");
    expect(out).toContain(`int main() { __pl::FrameGuard __pl_g("main", 2);\n  ${step(3, [])} return 0;`);
  });

  it("names methods and qualified functions, and wraps do-while and while bodies", async () => {
    const out = await rewrite("struct S { int m(int k) { while (k) k--; do k++; while (k < 2); return k; } };\n");
    expect(out).toContain('__pl::FrameGuard __pl_g("m", 1);');
    expect(out).toContain(`while (k) { ${step(1, ["k"])} k--; }`);
    expect(out).toContain(`do { ${step(1, ["k"])} k++; } while (k < 2);`);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/viz/cpp/instrument.test.ts`
Expected: FAIL, cannot resolve `@/lib/viz/cpp/instrument`.

- [ ] **Step 3: Implement**

`lib/viz/cpp/prelude.ts`:

```ts
// Compiled in front of the user's program. Every recorded step goes to file descriptor 3 as one JSON line.
export const CLANG_FLAGS = ["-std=c++20", "-O1", "-fno-exceptions", "-w"];

// `#line` makes clang report the user's own line numbers for main.cc.
export const PRELUDE_INCLUDE = '#include "__pl.h"\n#line 1 "main.cc"\n';

export const PRELUDE = String.raw`#pragma once
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <iostream>
#include <map>
#include <queue>
#include <set>
#include <stack>
#include <string>
#include <string_view>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
#include <unistd.h>

namespace __pl {
constexpr int kMaxDepth = 4;
constexpr std::size_t kMaxItems = 100;
constexpr std::size_t kMaxString = 200;
constexpr long kMaxSteps = 1000;
constexpr double kMaxSeconds = 10.0;

// Overload priority: High beats Low by exact match, so the catch-all only wins when nothing else fits.
struct Low {};
struct High : Low {};

inline void quote(std::string& o, std::string_view s, std::size_t max = kMaxString) {
  o += '"';
  std::size_t n = 0;
  for (char ch : s) {
    if (n++ == max) break;
    unsigned char c = static_cast<unsigned char>(ch);
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if (c < 0x20) { char buf[8]; std::snprintf(buf, sizeof buf, "\\u%04x", c); o += buf; }
        else o += ch;
    }
  }
  o += '"';
}

inline void str(std::string& o, std::string_view s) {
  o += "{\"t\":\"str\",\"v\":";
  quote(o, s);
  if (s.size() > kMaxString) o += ",\"cut\":true";
  o += '}';
}

template <class T> std::string_view type_name() {
  std::string_view p = __PRETTY_FUNCTION__;
  std::size_t start = p.find("T = ");
  if (start == std::string_view::npos) return "unknown";
  start += 4;
  std::size_t end = p.find_first_of(";]", start);
  return p.substr(start, end - start);
}

template <class T> void dump(std::string& o, int, const T&, Low) {
  o += "{\"t\":\"unsupported\",\"type\":";
  quote(o, type_name<T>());
  o += '}';
}

template <class T, std::enable_if_t<std::is_same_v<T, bool>, int> = 0>
void dump(std::string& o, int, const T& v, High) { o += v ? "{\"t\":\"bool\",\"v\":true}" : "{\"t\":\"bool\",\"v\":false}"; }

template <class T, std::enable_if_t<std::is_same_v<T, char>, int> = 0>
void dump(std::string& o, int, const T& v, High) { str(o, std::string_view(&v, 1)); }

template <class T, std::enable_if_t<std::is_integral_v<T> && !std::is_same_v<T, bool> && !std::is_same_v<T, char>, int> = 0>
void dump(std::string& o, int, const T& v, High) {
  constexpr long double kSafe = 9007199254740991.0L;
  const bool safe = static_cast<long double>(v) <= kSafe && static_cast<long double>(v) >= -kSafe;
  o += "{\"t\":\"num\",\"v\":";
  if (safe) o += std::to_string(v);
  else { o += '"'; o += std::to_string(v); o += '"'; }
  o += '}';
}

template <class T, std::enable_if_t<std::is_floating_point_v<T>, int> = 0>
void dump(std::string& o, int, const T& v, High) {
  o += "{\"t\":\"num\",\"v\":";
  if (!std::isfinite(v)) quote(o, std::isnan(v) ? "nan" : (v > 0 ? "inf" : "-inf"));
  else { char buf[32]; std::snprintf(buf, sizeof buf, "%.10g", static_cast<double>(v)); o += buf; }
  o += '}';
}

template <class T, std::enable_if_t<std::is_same_v<T, const char*> || std::is_same_v<T, char*>, int> = 0>
void dump(std::string& o, int, const T& v, High) {
  if (!v) { o += "{\"t\":\"none\"}"; return; }
  str(o, std::string_view(v));
}

template <class Tr, class A> void dump(std::string& o, int, const std::basic_string<char, Tr, A>& s, High) { str(o, s); }

template <class It> void seq(std::string& o, int depth, const char* kind, It first, It last, std::size_t size) {
  if (depth >= kMaxDepth) { o += "{\"t\":\"cut\"}"; return; }
  o += "{\"t\":\"list\",\"kind\":\"";
  o += kind;
  o += "\",\"items\":[";
  std::size_t i = 0;
  for (; first != last && i < kMaxItems; ++first, ++i) {
    if (i) o += ',';
    dump(o, depth + 1, *first, High{});
  }
  o += ']';
  if (size > kMaxItems) { o += ",\"more\":"; o += std::to_string(size - kMaxItems); }
  o += '}';
}

template <class It> void setlike(std::string& o, int depth, It first, It last, std::size_t size) {
  if (depth >= kMaxDepth) { o += "{\"t\":\"cut\"}"; return; }
  o += "{\"t\":\"set\",\"items\":[";
  std::size_t i = 0;
  for (; first != last && i < kMaxItems; ++first, ++i) {
    if (i) o += ',';
    dump(o, depth + 1, *first, High{});
  }
  o += ']';
  if (size > kMaxItems) { o += ",\"more\":"; o += std::to_string(size - kMaxItems); }
  o += '}';
}

template <class It> void maplike(std::string& o, int depth, It first, It last, std::size_t size) {
  if (depth >= kMaxDepth) { o += "{\"t\":\"cut\"}"; return; }
  o += "{\"t\":\"map\",\"entries\":[";
  std::size_t i = 0;
  for (; first != last && i < kMaxItems; ++first, ++i) {
    if (i) o += ',';
    o += '[';
    dump(o, depth + 1, first->first, High{});
    o += ',';
    dump(o, depth + 1, first->second, High{});
    o += ']';
  }
  o += ']';
  if (size > kMaxItems) { o += ",\"more\":"; o += std::to_string(size - kMaxItems); }
  o += '}';
}

template <class T, class A> void dump(std::string& o, int d, const std::vector<T, A>& v, High) { seq(o, d, "vector", v.begin(), v.end(), v.size()); }
template <class A> void dump(std::string& o, int d, const std::vector<bool, A>& v, High) {
  std::vector<int> bits;
  if (d >= kMaxDepth) { o += "{\"t\":\"cut\"}"; return; }
  o += "{\"t\":\"list\",\"kind\":\"vector\",\"items\":[";
  std::size_t i = 0;
  for (auto it = v.begin(); it != v.end() && i < kMaxItems; ++it, ++i) {
    if (i) o += ',';
    const bool bit = *it;
    dump(o, d + 1, bit, High{});
  }
  o += ']';
  if (v.size() > kMaxItems) { o += ",\"more\":"; o += std::to_string(v.size() - kMaxItems); }
  o += '}';
}
template <class T, std::size_t N> void dump(std::string& o, int d, const std::array<T, N>& v, High) { seq(o, d, "array", v.begin(), v.end(), N); }
template <class T, std::size_t N> void dump(std::string& o, int d, const T (&v)[N], High) { seq(o, d, "array", v, v + N, N); }
template <class T, class A> void dump(std::string& o, int d, const std::deque<T, A>& v, High) { seq(o, d, "deque", v.begin(), v.end(), v.size()); }
template <class K, class V, class C, class A> void dump(std::string& o, int d, const std::map<K, V, C, A>& m, High) { maplike(o, d, m.begin(), m.end(), m.size()); }
template <class K, class V, class H, class E, class A> void dump(std::string& o, int d, const std::unordered_map<K, V, H, E, A>& m, High) { maplike(o, d, m.begin(), m.end(), m.size()); }
template <class T, class C, class A> void dump(std::string& o, int d, const std::set<T, C, A>& s, High) { setlike(o, d, s.begin(), s.end(), s.size()); }
template <class T, class H, class E, class A> void dump(std::string& o, int d, const std::unordered_set<T, H, E, A>& s, High) { setlike(o, d, s.begin(), s.end(), s.size()); }
template <class A, class B> void dump(std::string& o, int d, const std::pair<A, B>& p, High) {
  if (d >= kMaxDepth) { o += "{\"t\":\"cut\"}"; return; }
  o += "{\"t\":\"list\",\"kind\":\"tuple\",\"items\":[";
  dump(o, d + 1, p.first, High{});
  o += ',';
  dump(o, d + 1, p.second, High{});
  o += "]}";
}
// stack and queue keep their container in the protected member c; read it without copying.
template <class T, class C> struct StackAccess : std::stack<T, C> { static const C& of(const std::stack<T, C>& s) { return s.*(&StackAccess::c); } };
template <class T, class C> struct QueueAccess : std::queue<T, C> { static const C& of(const std::queue<T, C>& q) { return q.*(&QueueAccess::c); } };
template <class T, class C> void dump(std::string& o, int d, const std::stack<T, C>& s, High) { const C& c = StackAccess<T, C>::of(s); seq(o, d, "stack", c.begin(), c.end(), c.size()); }
template <class T, class C> void dump(std::string& o, int d, const std::queue<T, C>& q, High) { const C& c = QueueAccess<T, C>::of(q); seq(o, d, "queue", c.begin(), c.end(), c.size()); }

struct Vars {
  std::string json = "{";
  bool empty = true;
  template <class T> void var(const char* name, const T& value) {
    if (!empty) json += ',';
    empty = false;
    quote(json, name);
    json += ':';
    dump(json, 0, value, High{});
  }
};

struct Frame { const char* fn; int line; std::string locals; };
inline std::vector<Frame>& frames() { static std::vector<Frame> stack; return stack; }
inline long& step_count() { static long count = 0; return count; }
inline std::chrono::steady_clock::time_point started() { static const auto at = std::chrono::steady_clock::now(); return at; }

inline void emit(const std::string& text) {
  std::size_t off = 0;
  while (off < text.size()) {
    const ssize_t n = ::write(3, text.data() + off, text.size() - off);
    if (n <= 0) return;
    off += static_cast<std::size_t>(n);
  }
}
inline void flush_output() { std::cout.flush(); std::cerr.flush(); std::fflush(stdout); std::fflush(stderr); }
[[noreturn]] inline void finish(const char* reason) {
  flush_output();
  std::string line = "{\"end\":\"";
  line += reason;
  line += "\"}\n";
  emit(line);
  std::_Exit(0);
}

struct FrameGuard {
  FrameGuard(const char* fn, int line) { started(); frames().push_back(Frame{fn, line, "{}"}); }
  ~FrameGuard() { frames().pop_back(); }
  FrameGuard(const FrameGuard&) = delete;
  FrameGuard& operator=(const FrameGuard&) = delete;
};

template <class F> void step(int line, F&& collect) {
  if (frames().empty()) return;
  if (++step_count() > kMaxSteps) finish("steps");
  if (std::chrono::duration<double>(std::chrono::steady_clock::now() - started()).count() > kMaxSeconds) finish("time");
  Vars vars;
  collect(vars);
  vars.json += '}';
  Frame& top = frames().back();
  top.line = line;
  top.locals = std::move(vars.json);
  flush_output();
  std::string record = "{\"line\":";
  record += std::to_string(line);
  record += ",\"stack\":[";
  for (std::size_t i = 0; i < frames().size(); ++i) {
    const Frame& f = frames()[i];
    if (i) record += ',';
    record += "{\"fn\":";
    quote(record, f.fn);
    record += ",\"line\":";
    record += std::to_string(f.line);
    record += ",\"locals\":";
    record += f.locals;
    record += '}';
  }
  record += "]}\n";
  emit(record);
}
}  // namespace __pl
`;
```

`lib/viz/cpp/instrument.ts`:

```ts
import type { Node } from "web-tree-sitter";

type Insert = { at: number; text: string; close: boolean };

const LOOPS = new Set(["for_statement", "for_range_loop", "while_statement", "do_statement"]);
const NOT_A_STATEMENT = /^(comment|preproc_|case_statement$)/;

/** Rewrites C++ so each statement inside a function records a step. Never adds or removes lines. */
export function instrument(root: Node, source: string): string {
  const inserts: Insert[] = [];
  for (const fn of root.descendantsOfType("function_definition")) {
    if (!fn || insideLambda(fn) || isConstexpr(fn)) continue;
    const body = fn.childForFieldName("body");
    if (!body || body.type !== "compound_statement") continue;
    inserts.push({ at: body.startIndex + 1, text: ` __pl::FrameGuard __pl_g(${JSON.stringify(functionName(fn))}, ${fn.startPosition.row + 1});`, close: false });
    visit(body, fn, inserts);
  }
  return apply(source, inserts);
}

function visit(node: Node, fn: Node, inserts: Insert[]) {
  if (node.type === "lambda_expression" || (node.type === "function_definition" && node.id !== fn.id)) return;
  if (node.type === "compound_statement" || node.type === "case_statement") {
    const value = node.type === "case_statement" ? node.childForFieldName("value") : null;
    for (const child of node.namedChildren) {
      if (!child || NOT_A_STATEMENT.test(child.type) || (value && child.id === value.id)) continue;
      inserts.push({ at: child.startIndex, text: `${stepCall(child, fn)} `, close: false });
    }
  }
  for (const body of singleStatementBodies(node)) {
    inserts.push({ at: body.startIndex, text: `{ ${stepCall(body, fn)} `, close: false });
    inserts.push({ at: body.endIndex, text: " }", close: true });
  }
  for (const child of node.namedChildren) if (child) visit(child, fn, inserts);
}

function singleStatementBodies(node: Node): Node[] {
  const bodies: (Node | null)[] = [];
  if (node.type === "if_statement") {
    bodies.push(node.childForFieldName("consequence"));
    const alternative = node.childForFieldName("alternative");
    if (alternative) bodies.push(alternative.type === "else_clause" ? alternative.namedChildren[0] ?? null : alternative);
  } else if (LOOPS.has(node.type)) {
    bodies.push(node.childForFieldName("body"));
  }
  return bodies.filter((b): b is Node => !!b && b.type !== "compound_statement" && !NOT_A_STATEMENT.test(b.type));
}

function stepCall(statement: Node, fn: Node) {
  const vars = visibleVars(statement, fn).map((name) => `__pl_v.var("${name}", ${name});`).join(" ");
  return `__pl::step(${statement.startPosition.row + 1}, [&](__pl::Vars& __pl_v) { ${vars} });`;
}

function visibleVars(statement: Node, fn: Node): string[] {
  const found = new Map<string, number>();
  const add = (pairs: Array<[string, number]>) => { for (const [name, at] of pairs) if (!found.has(name)) found.set(name, at); };
  let child = statement;
  let node = statement.parent;
  while (node && node.id !== fn.id) {
    if (node.type === "compound_statement" || node.type === "case_statement") {
      for (const sibling of node.namedChildren) {
        if (!sibling || sibling.startIndex >= child.startIndex) break;
        if (sibling.type === "declaration") add(declaredNames(sibling));
      }
    } else if (node.type === "for_statement") {
      const init = node.childForFieldName("initializer");
      if (init && init.id !== child.id && init.type === "declaration") add(declaredNames(init));
    } else if (node.type === "for_range_loop") {
      const body = node.childForFieldName("body");
      const declarator = node.childForFieldName("declarator");
      if (body && declarator && body.id === child.id) add(declaratorNames(declarator));
    }
    child = node;
    node = node.parent;
  }
  add(parameterNames(fn));
  return [...found].sort((a, b) => a[1] - b[1]).map(([name]) => name);
}

function declaredNames(declaration: Node): Array<[string, number]> {
  return declaration.childrenForFieldName("declarator").flatMap((d) => {
    if (!d) return [];
    const target = d.type === "init_declarator" ? d.childForFieldName("declarator") : d;
    return target ? declaratorNames(target) : [];
  });
}

function declaratorNames(d: Node): Array<[string, number]> {
  switch (d.type) {
    case "identifier":
      return [[d.text, d.startIndex]];
    case "structured_binding_declarator":
      return d.namedChildren.filter((c): c is Node => c?.type === "identifier").map((c) => [c.text, c.startIndex]);
    case "array_declarator": {
      // A lambda cannot capture a variable-length array, so only fixed-size arrays are listed.
      const size = d.childForFieldName("size");
      if (size && size.type !== "number_literal") return [];
      const inner = d.childForFieldName("declarator");
      return inner ? declaratorNames(inner) : [];
    }
    case "pointer_declarator":
    case "reference_declarator":
    case "parenthesized_declarator": {
      const inner = d.childForFieldName("declarator") ?? d.namedChildren.find((c) => !!c && (c.type === "identifier" || c.type.endsWith("_declarator"))) ?? null;
      return inner ? declaratorNames(inner) : [];
    }
    default:
      return [];
  }
}

function functionDeclarator(fn: Node): Node | null {
  let d = fn.childForFieldName("declarator");
  while (d && d.type !== "function_declarator") d = d.childForFieldName("declarator") ?? d.namedChildren.find((c) => !!c && c.type.endsWith("declarator")) ?? null;
  return d;
}

function parameterNames(fn: Node): Array<[string, number]> {
  const params = functionDeclarator(fn)?.childForFieldName("parameters");
  if (!params) return [];
  return params.namedChildren.flatMap((p) => {
    const declarator = p?.childForFieldName("declarator");
    return declarator ? declaratorNames(declarator) : [];
  });
}

function functionName(fn: Node) {
  return functionDeclarator(fn)?.childForFieldName("declarator")?.text ?? "function";
}

function insideLambda(node: Node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === "lambda_expression") return true;
  return false;
}

function isConstexpr(fn: Node) {
  return fn.children.some((c) => !!c && (c.text === "constexpr" || c.text === "consteval"));
}

function apply(source: string, inserts: Insert[]) {
  const ordered = inserts
    .map((insert, index) => ({ ...insert, index }))
    .sort((a, b) => a.at - b.at || Number(b.close) - Number(a.close) || a.index - b.index);
  let out = "";
  let last = 0;
  for (const insert of ordered) {
    out += source.slice(last, insert.at) + insert.text;
    last = insert.at;
  }
  return out + source.slice(last);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run lib/viz/cpp/instrument.test.ts`
Expected: PASS (6 tests). A failure about a tree-sitter field name means the grammar uses a different field. Fix the code to the grammar (check with `node.toString()` on the fixture), keep the test's expected output, and ledger it as a ruling. The same goes for `startIndex` units: if the non-ASCII test fails, map rows and columns to offsets instead.

- [ ] **Step 5: Commit**

```bash
git add lib/viz/cpp/prelude.ts lib/viz/cpp/instrument.ts lib/viz/cpp/testParser.ts lib/viz/cpp/instrument.test.ts
git commit -m "feat(viz): C++ step instrumentation and runtime prelude

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: C++ compile and run pipeline

**Files:**
- Create: `lib/viz/cpp/run.ts`
- Test: `lib/viz/cpp/compileError.test.ts`, `lib/viz/cpp/cpp.engine.test.ts`

**Interfaces:**
- Consumes: `instrument`, `PRELUDE`, `PRELUDE_INCLUDE`, `CLANG_FLAGS` (Task 6); `Trace`, `Step`, `TraceError` (Task 2); `LIMITS`; `VIZ_COPY`.
- Produces:
  - `type RunClang`
  - `type WasiShim`
  - `type CppEngine = { runClang: RunClang; shim: WasiShim; parser: Parser }`
  - `compileError(stderr: string): TraceError`
  - `runCpp(engine, code, stdin, onPhase?): Promise<Trace>`

- [ ] **Step 1: Write the failing tests**

`lib/viz/cpp/compileError.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compileError } from "@/lib/viz/cpp/run";

describe("compileError", () => {
  it("reports the first error on the user's line with a count of the rest", () => {
    const stderr = "main.cc:4:5: error: use of undeclared identifier 'x'\n    4 |     x++;\n      |     ^\nmain.cc:9:1: error: expected '}'\n2 errors generated.\n";
    expect(compileError(stderr)).toEqual({ kind: "compile", line: 4, message: "Line 4: use of undeclared identifier 'x' (and 1 more error)" });
  });

  it("falls back to the raw message", () => {
    expect(compileError("clang++: error: unknown argument\n")).toEqual({ kind: "compile", message: "clang++: error: unknown argument" });
    expect(compileError("")).toEqual({ kind: "compile", message: "Compile failed." });
  });
});
```

`lib/viz/cpp/cpp.engine.test.ts`:

```ts
import * as shim from "@bjorn3/browser_wasi_shim";
import { runClang } from "@yowasp/clang";
import { beforeAll, describe, expect, it } from "vitest";
import { runCpp, type CppEngine, type RunClang } from "@/lib/viz/cpp/run";
import { cppParser } from "@/lib/viz/cpp/testParser";
import { TEMPLATES } from "@/lib/viz/templates";

let engine: CppEngine;
beforeAll(async () => { engine = { runClang: runClang as unknown as RunClang, shim, parser: await cppParser() }; });

describe("C++ pipeline", () => {
  it("records lines, locals, frames and stdout", async () => {
    const trace = await runCpp(engine, "#include <iostream>\n#include <vector>\nint main() {\n  std::vector<int> a = {3, 1};\n  std::swap(a[0], a[1]);\n  std::cout << a[0] << std::endl;\n}\n", "");
    expect(trace.error).toBeUndefined();
    expect(trace.steps.map((s) => s.line)).toEqual([4, 5, 6]);
    expect(trace.steps[2].stack[0]).toMatchObject({ fn: "main", line: 6, locals: { a: { t: "list", kind: "vector", items: [{ t: "num", v: 1 }, { t: "num", v: 3 }] } } });
    expect(trace.stdout).toBe("1\n");
    expect(trace.steps[2].out).toBe(0);
  });

  it("builds the call stack through recursion", async () => {
    const trace = await runCpp(engine, "int f(int n) {\n  if (n == 0) return 0;\n  return f(n - 1);\n}\nint main() {\n  return f(2);\n}\n", "");
    const deepest = trace.steps.reduce((a, s) => (s.stack.length > a.stack.length ? s : a));
    expect(deepest.stack.map((f) => f.fn)).toEqual(["main", "f", "f", "f"]);
    expect(deepest.stack[3].locals).toEqual({ n: { t: "num", v: 0 } });
  });

  it("stops infinite loops after 1,000 steps", async () => {
    const trace = await runCpp(engine, "int main() {\n  long i = 0;\n  while (true) i++;\n}\n", "");
    expect(trace.steps).toHaveLength(1000);
    expect(trace.stopped).toBe("steps");
  });

  it("maps compile errors to the user's line", async () => {
    const trace = await runCpp(engine, "int main() {\n  int a = 1;\n  b = a;\n}\n", "");
    expect(trace.error).toMatchObject({ kind: "compile", line: 3 });
    expect(trace.steps).toHaveLength(0);
  });

  it("reports a crash as a runtime error at the last step and reads stdin", async () => {
    const trace = await runCpp(engine, "#include <cstdlib>\n#include <iostream>\nint main() {\n  int n; std::cin >> n;\n  std::cout << n * 2 << std::endl;\n  std::abort();\n}\n", "21\n");
    expect(trace.stdout).toBe("42\n");
    expect(trace.error).toMatchObject({ kind: "runtime", line: 6 });
  });

  it("runs code it cannot trace and says so", async () => {
    const trace = await runCpp(engine, "#include <cstdio>\n#define LOOP(i, n) for (int i = 0; i < n; i++)\nint main() { LOOP(i, 2) { std::printf(\"%d\", i); } }\n", "");
    expect(trace.stdout).toBe("01");
    expect(trace.steps.length === 0 ? trace.notice : "traced").toBeTruthy();
  });

  it("runs every C++ template without errors or stopping", async () => {
    for (const template of TEMPLATES.cpp) {
      const trace = await runCpp(engine, template.code, template.stdin ?? "");
      expect(trace.error, template.id).toBeUndefined();
      expect(trace.stopped, template.id).toBeUndefined();
      expect(trace.steps.length, template.id).toBeGreaterThan(3);
      expect(trace.stdout.length, template.id).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/viz/cpp/compileError.test.ts` and `npm run test:engines -- lib/viz/cpp`
Expected: FAIL, cannot resolve `@/lib/viz/cpp/run`.

- [ ] **Step 3: Implement** `lib/viz/cpp/run.ts`

```ts
import type { Parser } from "web-tree-sitter";
import { CLANG_FLAGS, PRELUDE, PRELUDE_INCLUDE } from "@/lib/viz/cpp/prelude";
import { instrument } from "@/lib/viz/cpp/instrument";
import { VIZ_COPY } from "@/lib/viz/copy";
import { LIMITS } from "@/lib/viz/engines";
import type { Step, Trace, TraceError } from "@/lib/viz/trace";

export type RunClang = (args: string[], files: Record<string, string | Uint8Array>, options?: { stderr?: (bytes: Uint8Array | null) => void }) => Promise<Record<string, unknown>>;
export type WasiShim = typeof import("@bjorn3/browser_wasi_shim");
export type CppEngine = { runClang: RunClang; shim: WasiShim; parser: Parser };
export type CppPhase = "compiling" | "running";

const ERROR_LINE = /main\.cc:(\d+):\d+: (?:fatal )?error: (.*)/;

export function compileError(stderr: string): TraceError {
  const errors = stderr.split("\n").filter((line) => /\berror:/.test(line));
  const first = errors[0]?.match(ERROR_LINE);
  if (first) {
    const more = errors.length - 1;
    const suffix = more > 0 ? ` (and ${more} more error${more === 1 ? "" : "s"})` : "";
    return { kind: "compile", line: Number(first[1]), message: `Line ${first[1]}: ${first[2]}${suffix}` };
  }
  const message = (errors[0] ?? stderr).trim().slice(0, 500);
  return { kind: "compile", message: message || "Compile failed." };
}

export async function runCpp(engine: CppEngine, code: string, stdin: string, onPhase?: (phase: CppPhase) => void): Promise<Trace> {
  const tree = engine.parser.parse(code);
  const traceable = !!tree && !tree.rootNode.hasError;
  const source = traceable ? PRELUDE_INCLUDE + instrument(tree!.rootNode, code) : code;
  onPhase?.("compiling");
  let stderr = "";
  const decoder = new TextDecoder();
  let wasm: Uint8Array;
  try {
    const files = await engine.runClang(["clang++", ...CLANG_FLAGS, "main.cc", "-o", "prog.wasm"], { "main.cc": source, "__pl.h": PRELUDE }, {
      // clang writes stderr a byte at a time.
      stderr: (bytes) => { if (bytes) stderr += decoder.decode(bytes, { stream: true }); },
    });
    wasm = files["prog.wasm"] as Uint8Array;
  } catch {
    return { language: "cpp", steps: [], stdout: "", error: compileError(stderr) };
  }
  onPhase?.("running");
  const trace = await execute(engine.shim, wasm, stdin);
  return traceable ? trace : { ...trace, steps: [], notice: VIZ_COPY.untraceable };
}

async function execute(shim: WasiShim, wasm: Uint8Array, stdin: string): Promise<Trace> {
  const outDecoder = new TextDecoder();
  let stdout = "";
  const appendOut = (bytes: Uint8Array) => {
    if (stdout.length >= LIMITS.maxStdoutChars) return;
    stdout = (stdout + outDecoder.decode(bytes, { stream: true })).slice(0, LIMITS.maxStdoutChars);
  };
  const steps: Step[] = [];
  let stopped: Trace["stopped"];
  const traceDecoder = new TextDecoder();
  let pending = "";
  const onTrace = (bytes: Uint8Array) => {
    pending += traceDecoder.decode(bytes, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      try {
        const record = JSON.parse(line) as { end?: "steps" | "time"; line: number; stack: Step["stack"] };
        if (record.end) stopped = record.end;
        else steps.push({ line: record.line, stack: record.stack, out: stdout.length });
      } catch {
        // A partial record at a crash: ignore it.
      }
    }
  };
  const fds = [
    new shim.OpenFile(new shim.File(new TextEncoder().encode(stdin))),
    new shim.ConsoleStdout(appendOut),
    new shim.ConsoleStdout(appendOut),
    new shim.ConsoleStdout(onTrace),
  ];
  const wasi = new shim.WASI([], [], fds);
  let error: TraceError | undefined;
  try {
    const instance = await WebAssembly.instantiate(await WebAssembly.compile(wasm as BufferSource), { wasi_snapshot_preview1: wasi.wasiImport });
    wasi.start(instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } });
  } catch (e) {
    const last = steps[steps.length - 1];
    error = { kind: "runtime", message: `The program crashed: ${e instanceof Error ? e.message : String(e)}`, ...(last ? { line: last.line } : {}) };
  }
  return { language: "cpp", steps, stdout, ...(error ? { error } : {}), ...(stopped ? { stopped } : {}) };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run lib/viz/cpp/compileError.test.ts`
Expected: PASS (2 tests).

Run: `npm run test:engines -- lib/viz/cpp`
Expected: PASS (7 tests). The first run reads the 105 MB compiler from `node_modules`. A template that fails to compile is a prelude or instrumentation bug: fix it there, add a fixture for the case to `instrument.test.ts` that failed first, and ledger it.

- [ ] **Step 5: Commit**

```bash
git add lib/viz/cpp/run.ts lib/viz/cpp/compileError.test.ts lib/viz/cpp/cpp.engine.test.ts
git commit -m "feat(viz): compile and run instrumented C++ with clang and WASI

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 8: Workers and the runner host

**Files:**
- Create: `lib/viz/runner.ts`, `lib/viz/workers/python.worker.ts`, `lib/viz/workers/cpp.worker.ts`, `lib/viz/workers/index.ts`
- Test: `lib/viz/runner.test.ts`

**Interfaces:**
- Consumes: `runPython` (Task 5); `runCpp` and `CppEngine` (Task 7); `ENGINE_URLS`; `LIMITS`; `capTrace`; `VIZ_COPY`.
- Produces:
  - `type RunPhase = "loading" | "compiling" | "running"`
  - `type WorkerRequest`
  - `type WorkerReply`
  - `type RunResult = { ok: true; trace } | { ok: false; message }`
  - `type Runner`
  - `createRunner(language, factory, timing?)`
  - `pythonWorker()`
  - `cppWorker()`

- [ ] **Step 1: Write the failing test** `lib/viz/runner.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunner, type WorkerReply, type WorkerRequest } from "@/lib/viz/runner";

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: { data: WorkerReply }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;
  requests: WorkerRequest[] = [];
  terminated = false;
  constructor() { FakeWorker.all.push(this); }
  postMessage(request: WorkerRequest) { this.requests.push(request); }
  terminate() { this.terminated = true; }
  reply(data: WorkerReply) { this.onmessage?.({ data }); }
}

afterEach(() => { FakeWorker.all = []; vi.useRealTimers(); });
const trace = { language: "python" as const, steps: [], stdout: "ok" };

describe("runner", () => {
  it("forwards phases, resolves with the trace and reuses the worker", async () => {
    const runner = createRunner("python", () => new FakeWorker());
    const phases: string[] = [];
    const pending = runner.run({ code: "x", stdin: "" }, (p) => phases.push(p));
    const worker = FakeWorker.all[0];
    worker.reply({ type: "phase", phase: "loading" });
    worker.reply({ type: "phase", phase: "running" });
    worker.reply({ type: "done", trace });
    expect(await pending).toEqual({ ok: true, trace });
    expect(phases).toEqual(["loading", "running"]);
    const second = runner.run({ code: "y", stdin: "" }, () => {});
    expect(FakeWorker.all).toHaveLength(1);
    worker.reply({ type: "done", trace });
    await second;
  });

  it("refuses a second run while one is active", async () => {
    const runner = createRunner("python", () => new FakeWorker());
    void runner.run({ code: "x", stdin: "" }, () => {});
    expect(await runner.run({ code: "y", stdin: "" }, () => {})).toEqual({ ok: false, message: "A run is already in progress." });
  });

  it("kills a worker that runs past the hard timeout and replaces it next time", async () => {
    vi.useFakeTimers();
    const runner = createRunner("cpp", () => new FakeWorker(), { loadMs: 1000, runMs: 500 });
    const pending = runner.run({ code: "x", stdin: "" }, () => {});
    FakeWorker.all[0].reply({ type: "phase", phase: "running" });
    vi.advanceTimersByTime(501);
    expect(await pending).toEqual({ ok: true, trace: { language: "cpp", steps: [], stdout: "", stopped: "time" } });
    expect(FakeWorker.all[0].terminated).toBe(true);
    void runner.run({ code: "y", stdin: "" }, () => {});
    expect(FakeWorker.all).toHaveLength(2);
  });

  it("reports load failures, worker errors and load timeouts", async () => {
    vi.useFakeTimers();
    const runner = createRunner("python", () => new FakeWorker(), { loadMs: 1000, runMs: 500 });
    const failed = runner.run({ code: "x", stdin: "" }, () => {});
    FakeWorker.all[0].reply({ type: "failed", message: "boom" });
    expect(await failed).toEqual({ ok: false, message: "boom" });
    const crashed = runner.run({ code: "x", stdin: "" }, () => {});
    FakeWorker.all[0].onerror?.({ message: "worker died" });
    expect(await crashed).toEqual({ ok: false, message: "worker died" });
    const slow = runner.run({ code: "x", stdin: "" }, () => {});
    vi.advanceTimersByTime(1001);
    expect(await slow).toEqual({ ok: false, message: "Couldn't load Python. Check the connection and run again." });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/viz/runner.test.ts`
Expected: FAIL, cannot resolve `@/lib/viz/runner`.

- [ ] **Step 3: Implement**

`lib/viz/runner.ts`:

```ts
import { VIZ_COPY } from "@/lib/viz/copy";
import { LIMITS, type Language } from "@/lib/viz/engines";
import { capTrace, type Trace } from "@/lib/viz/trace";

export type RunPhase = "loading" | "compiling" | "running";
export type WorkerRequest = { code: string; stdin: string };
export type WorkerReply = { type: "phase"; phase: RunPhase } | { type: "done"; trace: Trace } | { type: "failed"; message: string };
export type RunResult = { ok: true; trace: Trace } | { ok: false; message: string };
export type WorkerLike = {
  postMessage(request: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerReply }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
};
export type Runner = { run(request: WorkerRequest, onPhase: (phase: RunPhase) => void): Promise<RunResult>; dispose(): void };

// The engines stop themselves at LIMITS.runTimeoutMs; this hard limit only catches code the engines can't interrupt.
const DEFAULT_TIMING = { loadMs: 180_000, runMs: LIMITS.runTimeoutMs + 5_000 };

export function createRunner(language: Language, factory: () => WorkerLike, timing = DEFAULT_TIMING): Runner {
  let worker: WorkerLike | null = null;
  let active: ((result: RunResult) => void) | null = null;
  const kill = () => { worker?.terminate(); worker = null; };

  return {
    run(request, onPhase) {
      if (active) return Promise.resolve({ ok: false, message: VIZ_COPY.busy });
      const current = (worker ??= factory());
      return new Promise<RunResult>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const finish = (result: RunResult) => {
          clearTimeout(timer);
          active = null;
          current.onmessage = null;
          current.onerror = null;
          resolve(result);
        };
        timer = setTimeout(() => { kill(); finish({ ok: false, message: VIZ_COPY.loadFailed[language] }); }, timing.loadMs);
        active = finish;
        current.onmessage = ({ data }) => {
          if (data.type === "phase") {
            onPhase(data.phase);
            if (data.phase === "running") {
              clearTimeout(timer);
              timer = setTimeout(() => { kill(); finish({ ok: true, trace: { language, steps: [], stdout: "", stopped: "time" } }); }, timing.runMs);
            }
          } else if (data.type === "done") finish({ ok: true, trace: capTrace(data.trace) });
          else finish({ ok: false, message: data.message });
        };
        current.onerror = (event) => { kill(); finish({ ok: false, message: event.message || VIZ_COPY.loadFailed[language] }); };
        current.postMessage(request);
      });
    },
    dispose() {
      kill();
      active?.({ ok: false, message: VIZ_COPY.busy });
    },
  };
}
```

`lib/viz/workers/python.worker.ts`:

```ts
import { VIZ_COPY } from "@/lib/viz/copy";
import { ENGINE_URLS } from "@/lib/viz/engines";
import { runPython, type PyodideLike } from "@/lib/viz/python/run";
import type { WorkerReply, WorkerRequest } from "@/lib/viz/runner";

const ctx = self as unknown as { postMessage(reply: WorkerReply): void; onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null };
let pyodide: Promise<PyodideLike> | null = null;

ctx.onmessage = async ({ data }) => {
  ctx.postMessage({ type: "phase", phase: "loading" });
  let py: PyodideLike;
  try {
    pyodide ??= import(/* webpackIgnore: true */ ENGINE_URLS.pyodide).then((m: { loadPyodide(o: { indexURL: string }): Promise<PyodideLike> }) => m.loadPyodide({ indexURL: ENGINE_URLS.pyodideDir }));
    py = await pyodide;
  } catch {
    pyodide = null;
    ctx.postMessage({ type: "failed", message: VIZ_COPY.loadFailed.python });
    return;
  }
  ctx.postMessage({ type: "phase", phase: "running" });
  try {
    ctx.postMessage({ type: "done", trace: runPython(py, data.code, data.stdin) });
  } catch (error) {
    ctx.postMessage({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
};
```

`lib/viz/workers/cpp.worker.ts`:

```ts
import type { Parser } from "web-tree-sitter";
import { runCpp, type CppEngine, type RunClang, type WasiShim } from "@/lib/viz/cpp/run";
import { VIZ_COPY } from "@/lib/viz/copy";
import { ENGINE_URLS } from "@/lib/viz/engines";
import type { WorkerReply, WorkerRequest } from "@/lib/viz/runner";

const ctx = self as unknown as { postMessage(reply: WorkerReply): void; onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null };
let engine: Promise<CppEngine> | null = null;

type TreeSitter = { Parser: { init(o: { locateFile(file: string): string }): Promise<void>; new (): Parser }; Language: { load(url: string): Promise<Parameters<Parser["setLanguage"]>[0]> } };

async function load(): Promise<CppEngine> {
  const [clang, shim, ts] = await Promise.all([
    import(/* webpackIgnore: true */ ENGINE_URLS.clang) as Promise<{ runClang: RunClang }>,
    import(/* webpackIgnore: true */ ENGINE_URLS.wasiShim) as Promise<WasiShim>,
    import(/* webpackIgnore: true */ ENGINE_URLS.treeSitter) as Promise<TreeSitter>,
  ]);
  await ts.Parser.init({ locateFile: (file) => ENGINE_URLS.treeSitterDir + file });
  const parser = new ts.Parser();
  parser.setLanguage(await ts.Language.load(ENGINE_URLS.cppGrammar));
  return { runClang: clang.runClang, shim, parser };
}

ctx.onmessage = async ({ data }) => {
  ctx.postMessage({ type: "phase", phase: "loading" });
  let ready: CppEngine;
  try {
    engine ??= load();
    ready = await engine;
  } catch {
    engine = null;
    ctx.postMessage({ type: "failed", message: VIZ_COPY.loadFailed.cpp });
    return;
  }
  try {
    const trace = await runCpp(ready, data.code, data.stdin, (phase) => ctx.postMessage({ type: "phase", phase }));
    ctx.postMessage({ type: "done", trace });
  } catch (error) {
    ctx.postMessage({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
};
```

`lib/viz/workers/index.ts`. The literal `new URL(...)` is what lets Next bundle each worker.

```ts
import type { WorkerLike } from "@/lib/viz/runner";

export const pythonWorker = () => new Worker(new URL("./python.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
export const cppWorker = () => new Worker(new URL("./cpp.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
```

- [ ] **Step 4: Run the tests and the build**

Run: `npx vitest run lib/viz/runner.test.ts`
Expected: PASS (4 tests).

Run: `npx tsc --noEmit && npm run build`
Expected: both pass. Nothing imports the workers yet, so the bundling itself is checked in Task 12.

- [ ] **Step 5: Commit**

```bash
git add lib/viz/runner.ts lib/viz/runner.test.ts lib/viz/workers
git commit -m "feat(viz): run workers for Python and C++ with a host-side hard timeout

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 9: Messages, trace chunking and validation

**Files:**
- Create: `lib/viz/messages.ts`
- Test: `lib/viz/messages.test.ts`

**Interfaces:**
- Consumes: `Trace` (Task 2), `LIMITS`, `Language`, `MAX_CHUNK_BYTES` (from `lib/sync/messages.ts`).
- Produces:
  - `VIZ_EVENTS`
  - `vizTopic(roomId)`
  - `TRACE_PIECE_BYTES`
  - Payload types `CodePayload`, `TraceChunk`, `StepPayload`
  - `parseCode`, `parseChunk`, `parseStep`, `parseTrace`
  - `splitByBytes(text, maxBytes)`
  - `createTraceAssembler()`

- [ ] **Step 1: Write the failing test** `lib/viz/messages.test.ts`

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/viz/messages.test.ts`
Expected: FAIL, cannot resolve `@/lib/viz/messages`.

- [ ] **Step 3: Implement** `lib/viz/messages.ts`

```ts
import { MAX_CHUNK_BYTES } from "@/lib/sync/messages";
import { LIMITS, type Language } from "@/lib/viz/engines";
import type { Trace } from "@/lib/viz/trace";

export const VIZ_EVENTS = { code: "viz-code", trace: "viz-trace", step: "viz-step", syncRequest: "viz-sync-request" } as const;
export const vizTopic = (roomId: string) => `room:${roomId}:viz`;

// JSON escaping inside the broadcast can at most double a piece; 1,000 bytes cover the envelope.
export const TRACE_PIECE_BYTES = Math.floor((MAX_CHUNK_BYTES - 1000) / 2);
const MAX_PIECES = Math.ceil(LIMITS.maxTraceBytes / TRACE_PIECE_BYTES) + 1;

export type CodePayload = { from: string; language: Language; code: string; stdin: string; cursorLine: number; rev: number };
export type TraceChunk = { from: string; runId: string; index: number; total: number; data: string };
export type StepPayload = { from: string; runId: string; step: number; playing: boolean };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export function parseCode(p: unknown): CodePayload | null {
  if (!isRecord(p)) return null;
  const { from, language, code, stdin, cursorLine, rev } = p;
  if (typeof from !== "string" || (language !== "python" && language !== "cpp")) return null;
  if (typeof code !== "string" || code.length > LIMITS.maxCodeChars || typeof stdin !== "string" || stdin.length > LIMITS.maxStdinChars) return null;
  if (!isCount(cursorLine) || !isCount(rev)) return null;
  return { from, language, code, stdin, cursorLine, rev };
}

export function parseChunk(p: unknown): TraceChunk | null {
  if (!isRecord(p)) return null;
  const { from, runId, index, total, data } = p;
  if (typeof from !== "string" || typeof runId !== "string" || typeof data !== "string") return null;
  if (!isCount(index) || !isCount(total) || total < 1 || total > MAX_PIECES || index >= total) return null;
  return { from, runId, index, total, data };
}

export function parseStep(p: unknown): StepPayload | null {
  if (!isRecord(p)) return null;
  const { from, runId, step, playing } = p;
  if (typeof from !== "string" || typeof runId !== "string" || !isCount(step) || typeof playing !== "boolean") return null;
  return { from, runId, step, playing };
}

const isFrame = (f: unknown) => isRecord(f) && typeof f.fn === "string" && Number.isInteger(f.line) && isRecord(f.locals);

export function parseTrace(text: string): Trace | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!isRecord(value) || (value.language !== "python" && value.language !== "cpp") || typeof value.stdout !== "string" || !Array.isArray(value.steps)) return null;
  if (value.steps.length > LIMITS.maxSteps) return null;
  for (const step of value.steps) {
    if (!isRecord(step) || !Number.isInteger(step.line) || typeof step.out !== "number" || !Array.isArray(step.stack) || !step.stack.every(isFrame)) return null;
  }
  return value as Trace;
}

/** Splits text into pieces of at most maxBytes UTF-8 bytes, never inside a character. */
export function splitByBytes(text: string, maxBytes: number): string[] {
  const pieces: string[] = [];
  let piece = "";
  let size = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const charBytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (size + charBytes > maxBytes && piece) {
      pieces.push(piece);
      piece = "";
      size = 0;
    }
    piece += char;
    size += charBytes;
  }
  pieces.push(piece);
  return pieces;
}

export function createTraceAssembler() {
  let runId: string | null = null;
  let parts: (string | undefined)[] = [];
  let received = 0;
  return {
    add(chunk: TraceChunk): { runId: string; trace: Trace } | null {
      if (chunk.runId !== runId) {
        runId = chunk.runId;
        parts = new Array(chunk.total);
        received = 0;
      }
      if (chunk.total !== parts.length || parts[chunk.index] !== undefined) return null;
      parts[chunk.index] = chunk.data;
      received += 1;
      if (received < parts.length) return null;
      const trace = parseTrace(parts.join(""));
      return trace ? { runId: chunk.runId, trace } : null;
    },
  };
}
```

- [ ] **Step 4: Run it to see it pass, then commit**

Run: `npx vitest run lib/viz/messages.test.ts`
Expected: PASS (7 tests).

```bash
git add lib/viz/messages.ts lib/viz/messages.test.ts
git commit -m "feat(viz): viz topic payloads, byte-safe trace chunking and validation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 10: Realtime connection for the visualizer

**Files:**
- Create: `lib/viz/channel.ts`

**Interfaces:**
- Consumes: Task 9; `interactTopic` (`lib/sync/messages.ts`); `countPresence` and `PresenceCounts`; `ConnectionStatus` and `RoomRole`.
- Produces:
  - `type VizHandlers`
  - `type VizConnection = { sendCode(p); sendTrace(runId, trace): Promise<boolean>; sendStep(p); requestSync(); close() }`
  - `openVizConnection(supabase, { roomId, clientId, role }, handlers)`

There's no unit test: this file is a thin Supabase wiring layer like `roomChannel.ts`, which has none either. Its parsing and chunking logic is covered by Task 9, and its behaviour by the Task 13 browser check.

- [ ] **Step 1: Implement** `lib/viz/channel.ts`

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { countPresence, type PresenceCounts } from "@/lib/realtime/presence";
import type { ConnectionStatus, RoomRole } from "@/lib/realtime/roomChannel";
import { interactTopic } from "@/lib/sync/messages";
import { createTraceAssembler, parseChunk, parseCode, parseStep, splitByBytes, TRACE_PIECE_BYTES, VIZ_EVENTS, vizTopic, type CodePayload, type StepPayload } from "@/lib/viz/messages";
import type { Trace } from "@/lib/viz/trace";

export type VizHandlers = {
  onCode(payload: CodePayload): void;
  onTrace(runId: string, trace: Trace): void;
  onStep(payload: StepPayload): void;
  onSyncRequest(): void;
  onStatus(status: ConnectionStatus): void;
  onPresence(counts: PresenceCounts): void;
  onSubscribed(): void;
};

export type VizConnection = {
  sendCode(payload: Omit<CodePayload, "from">): void;
  sendTrace(runId: string, trace: Trace): Promise<boolean>;
  sendStep(payload: Omit<StepPayload, "from">): void;
  requestSync(): void;
  close(): void;
};

export function openVizConnection(
  supabase: SupabaseClient,
  { roomId, clientId, role }: { roomId: string; clientId: string; role: RoomRole },
  handlers: VizHandlers,
): VizConnection {
  let closed = false;
  let online = navigator.onLine;
  let channelStatus: Exclude<ConnectionStatus, "offline"> = "connecting";
  const emitStatus = () => handlers.onStatus(online ? channelStatus : "offline");
  const assembler = createTraceAssembler();

  const viz = supabase.channel(vizTopic(roomId), { config: { private: true, broadcast: { self: false } } });
  const interact = supabase.channel(interactTopic(roomId), { config: { private: true, broadcast: { self: false }, presence: { key: clientId } } });

  viz
    .on("broadcast", { event: VIZ_EVENTS.code }, ({ payload }) => {
      const code = parseCode(payload);
      if (!closed && code && code.from !== clientId) handlers.onCode(code);
    })
    .on("broadcast", { event: VIZ_EVENTS.trace }, ({ payload }) => {
      const chunk = parseChunk(payload);
      if (closed || !chunk || chunk.from === clientId) return;
      const done = assembler.add(chunk);
      if (done) handlers.onTrace(done.runId, done.trace);
    })
    .on("broadcast", { event: VIZ_EVENTS.step }, ({ payload }) => {
      const step = parseStep(payload);
      if (!closed && step && step.from !== clientId) handlers.onStep(step);
    })
    .subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        channelStatus = "live";
        emitStatus();
        handlers.onSubscribed();
      } else {
        channelStatus = "reconnecting";
        emitStatus();
      }
    });

  interact
    .on("broadcast", { event: VIZ_EVENTS.syncRequest }, ({ payload }) => {
      if (!closed && (payload as { from?: string } | undefined)?.from !== clientId) handlers.onSyncRequest();
    })
    .on("presence", { event: "sync" }, () => {
      if (!closed) handlers.onPresence(countPresence(interact.presenceState(), clientId));
    })
    .subscribe((status) => {
      if (!closed && status === "SUBSCRIBED") void interact.track({ role });
    });

  const onOnline = () => { online = true; emitStatus(); };
  const onOffline = () => { online = false; emitStatus(); };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  emitStatus();

  const broadcast = (event: string, payload: unknown) => viz.send({ type: "broadcast", event, payload });

  return {
    sendCode(payload) {
      void broadcast(VIZ_EVENTS.code, { ...payload, from: clientId });
    },
    async sendTrace(runId, trace) {
      const pieces = splitByBytes(JSON.stringify(trace), TRACE_PIECE_BYTES);
      let ok = true;
      for (let index = 0; index < pieces.length; index++) {
        const result = await broadcast(VIZ_EVENTS.trace, { from: clientId, runId, index, total: pieces.length, data: pieces[index] });
        if (result !== "ok") ok = false;
      }
      return ok;
    },
    sendStep(payload) {
      void broadcast(VIZ_EVENTS.step, { ...payload, from: clientId });
    },
    requestSync() {
      void interact.send({ type: "broadcast", event: VIZ_EVENTS.syncRequest, payload: { from: clientId } });
    },
    close() {
      closed = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      void supabase.removeChannel(viz);
      void supabase.removeChannel(interact);
    },
  };
}
```

- [ ] **Step 2: Type check and commit**

Run: `npx tsc --noEmit`
Expected: pass.

```bash
git add lib/viz/channel.ts
git commit -m "feat(viz): realtime connection for live code, traces and steps

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 11: Views: code editor, trace view and timeline

**Files:**
- Create: `components/viz/CodeEditor.tsx`, `components/viz/TraceView.tsx`, `components/viz/Timeline.tsx`, `components/viz/views.tsx`
- Modify: `app/globals.css` (append the visualizer styles before the `@media (max-width: 640px)` block)

**Interfaces:**
- Consumes: Tasks 2–4 (`Trace`, `structuresOf`, `pointersFor`, `gridPointers`, `formatValue`, `nodeLabel`, `changedVariables`, `collectObjects`, `VIZ_COPY`).
- Produces:
  - `CodeEditor({ value, language, readOnly, currentLine, errorLine, followLine, onChange })`
  - `TraceView({ trace, step })`
  - `Timeline({ count, step, playing, speed, readOnly, onStep, onPlay, onSpeed })`

- [ ] **Step 1: Create** `components/viz/CodeEditor.tsx`

```tsx
"use client";

import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { Annotation, Compartment, EditorState, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { LIMITS, type Language } from "@/lib/viz/engines";

type Marks = { current: number | null; error: number | null };
type CodeEditorProps = {
  value: string;
  language: Language;
  readOnly: boolean;
  currentLine?: number | null;
  errorLine?: number | null;
  /** Viewers scroll to the line the editor is typing on. */
  followLine?: number | null;
  onChange?: (code: string, cursorLine: number) => void;
};

const remote = Annotation.define<boolean>();
const setMarks = StateEffect.define<Marks>();

function buildMarks(doc: Text, marks: Marks): DecorationSet {
  const ranges = [];
  if (marks.error && marks.error <= doc.lines) ranges.push(Decoration.line({ class: "cm-pl-error" }).range(doc.line(marks.error).from));
  if (marks.current && marks.current <= doc.lines) ranges.push(Decoration.line({ class: "cm-pl-current" }).range(doc.line(marks.current).from));
  return Decoration.set(ranges, true);
}

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = marks.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setMarks)) next = buildMarks(tr.state.doc, effect.value);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const languageOf = (language: Language) => (language === "python" ? python() : cpp());
const readOnlyOf = (readOnly: boolean) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
const maxLength = EditorState.changeFilter.of((tr) => tr.newDoc.length <= LIMITS.maxCodeChars);

export default function CodeEditor({ value, language, readOnly, currentLine, errorLine, followLine, onChange }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const readOnlySlot = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initial = useRef({ value, language, readOnly });

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          basicSetup,
          maxLength,
          languageSlot.current.of(languageOf(initial.current.language)),
          readOnlySlot.current.of(readOnlyOf(initial.current.readOnly)),
          marksField,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged && !update.selectionSet) return;
            if (update.transactions.some((tr) => tr.annotation(remote))) return;
            const state = update.state;
            onChangeRef.current?.(state.doc.toString(), state.doc.lineAt(state.selection.main.head).number);
          }),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current !== value) editor.dispatch({ changes: { from: 0, to: current.length, insert: value }, annotations: remote.of(true) });
  }, [value]);

  useEffect(() => { view.current?.dispatch({ effects: languageSlot.current.reconfigure(languageOf(language)) }); }, [language]);
  useEffect(() => { view.current?.dispatch({ effects: readOnlySlot.current.reconfigure(readOnlyOf(readOnly)) }); }, [readOnly]);
  useEffect(() => { view.current?.dispatch({ effects: setMarks.of({ current: currentLine ?? null, error: errorLine ?? null }) }); }, [currentLine, errorLine, value]);

  useEffect(() => {
    const editor = view.current;
    const line = currentLine ?? followLine;
    if (!editor || !line || line > editor.state.doc.lines) return;
    editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.doc.line(line).from, { y: "nearest" }) });
  }, [currentLine, followLine]);

  return <div className="code-editor" ref={host} />;
}
```

- [ ] **Step 2: Create** `components/viz/views.tsx`

```tsx
import type { Language } from "@/lib/viz/engines";
import { formatValue } from "@/lib/viz/format";
import { gridPointers, pointersFor, type Pointer } from "@/lib/viz/pointers";
import { nodeLabel, type Structure } from "@/lib/viz/structures";
import { resolveObj, type Frame, type ObjValue, type Value } from "@/lib/viz/trace";

type Ctx = { language: Language; objects: Map<string, ObjValue>; locals: Record<string, Value>; changed: Set<string> };

const labelsAt = (pointers: Pointer[], index: number) => pointers.filter((p) => p.index === index).map((p) => p.name).join(", ");

export function StructureView({ structure, ctx }: { structure: Structure; ctx: Ctx }) {
  const changed = ctx.changed.has(structure.name) ? " changed" : "";
  const caption = (detail: string) => <figcaption><strong>{structure.name}</strong> <span className="muted mono">{detail}</span></figcaption>;
  switch (structure.kind) {
    case "array": {
      const { items, more } = structure.value;
      const numbers = items.map((item) => (item.t === "num" ? Number(item.v) : NaN));
      const bars = items.length > 0 && numbers.every(Number.isFinite);
      const peak = Math.max(1, ...numbers.map((n) => Math.abs(n)).filter(Number.isFinite));
      const pointers = pointersFor(items.length + (more ?? 0), ctx.locals, structure.name);
      const end = pointers.filter((p) => p.end);
      return <figure className={`viz-struct${changed}`}>
        {caption(`${structure.value.kind}[${items.length + (more ?? 0)}]`)}
        <div className={bars ? "arr arr-bars" : "arr arr-cells"}>
          {items.map((item, i) => {
            const label = labelsAt(pointers, i);
            return <div key={i} className={`arr-item${label ? " pointed" : ""}`}>
              {bars && <span className={`bar${numbers[i] < 0 ? " neg" : ""}`} style={{ height: `${Math.max(4, (Math.abs(numbers[i]) / peak) * 96)}px` }} />}
              <span className="cell">{formatValue(item, ctx.language, ctx.objects, 14)}</span>
              <span className="idx mono">{i}</span>
              <span className="ptr mono">{label}</span>
            </div>;
          })}
          {more ? <div className="arr-item more mono">+{more}</div> : null}
          {end.length > 0 && <div className="arr-item end"><span className="cell muted">end</span><span className="idx mono">{items.length}</span><span className="ptr mono">{end.map((p) => p.name).join(", ")}</span></div>}
        </div>
      </figure>;
    }
    case "grid": {
      const rows = structure.value.items.map((row) => (row.t === "list" ? row.items : []));
      const cols = Math.max(0, ...rows.map((r) => r.length));
      const { rows: rowPtrs, cols: colPtrs } = gridPointers(rows.length, cols, ctx.locals, structure.name);
      return <figure className={`viz-struct${changed}`}>
        {caption(`${rows.length}×${cols}`)}
        <div className="grid-wrap"><table className="grid">
          <thead><tr><th />{Array.from({ length: cols }, (_, c) => <th key={c} className="mono">{c}<span className="ptr">{labelsAt(colPtrs, c)}</span></th>)}</tr></thead>
          <tbody>{rows.map((row, r) => <tr key={r}>
            <th className="mono">{r}<span className="ptr">{labelsAt(rowPtrs, r)}</span></th>
            {row.map((cell, c) => {
              const hit = rowPtrs.some((p) => p.index === r) && colPtrs.some((p) => p.index === c);
              return <td key={c} className={hit ? "pointed" : undefined}>{formatValue(cell, ctx.language, ctx.objects, 8)}</td>;
            })}
          </tr>)}</tbody>
        </table></div>
      </figure>;
    }
    case "map":
      return <figure className={`viz-struct${changed}`}>
        {caption(`${structure.value.entries.length + (structure.value.more ?? 0)} entries`)}
        <table className="map"><tbody>{structure.value.entries.map(([k, v], i) => <tr key={i}><th>{formatValue(k, ctx.language, ctx.objects, 24)}</th><td>{formatValue(v, ctx.language, ctx.objects, 40)}</td></tr>)}</tbody></table>
      </figure>;
    case "set":
      return <figure className={`viz-struct${changed}`}>
        {caption(`${structure.value.items.length + (structure.value.more ?? 0)} items`)}
        <div className="chips">{structure.value.items.map((item, i) => <span key={i} className="chip">{formatValue(item, ctx.language, ctx.objects, 20)}</span>)}</div>
      </figure>;
    case "linked":
      return <figure className={`viz-struct${changed}`}>
        {caption("linked list")}
        <div className="linked">{structure.nodes.map((node, i) => <div key={node.id} className="ll-node">
          <span className="ptr mono">{(structure.labels.get(node.id) ?? []).join(", ")}</span>
          <span className="ll-box">{nodeLabel(node, ctx.language)}</span>
          {i < structure.nodes.length - 1 && <span className="ll-arrow" aria-hidden="true">→</span>}
        </div>)}</div>
      </figure>;
    case "tree":
      return <figure className={`viz-struct${changed}`}>{caption("tree")}<div className="tree"><TreeNode node={structure.root} ctx={ctx} labels={structure.labels} seen={new Set()} /></div></figure>;
  }
}

function TreeNode({ node, ctx, labels, seen }: { node: ObjValue; ctx: Ctx; labels: Map<string, string[]>; seen: Set<string> }) {
  if (seen.has(node.id) || seen.size > 100) return <span className="tree-leaf muted">…</span>;
  seen.add(node.id);
  const children = (["left", "right"] as const).map((side) => resolveObj(node.fields[side], ctx.objects));
  return <div className="tree-node">
    <span className="ptr mono">{(labels.get(node.id) ?? []).join(", ")}</span>
    <span className="tree-box">{nodeLabel(node, ctx.language)}</span>
    {children.some(Boolean) && <div className="tree-children">{children.map((child, i) => <div key={i} className="tree-slot">{child ? <TreeNode node={child} ctx={ctx} labels={labels} seen={seen} /> : <span className="tree-leaf muted">·</span>}</div>)}</div>}
  </div>;
}

export function VariablesView({ frame, ctx }: { frame: Frame; ctx: Ctx }) {
  const names = Object.keys(frame.locals);
  return <section className="viz-panel">
    <h3>Variables</h3>
    {names.length === 0 ? <p className="muted small">None yet.</p> : <dl className="vars">{names.map((name) => <div key={name} className={ctx.changed.has(name) ? "changed" : undefined}>
      <dt className="mono">{name}</dt><dd className="mono">{formatValue(frame.locals[name], ctx.language, ctx.objects, 48)}</dd>
    </div>)}</dl>}
  </section>;
}

export function CallStackView({ stack }: { stack: Frame[] }) {
  return <section className="viz-panel">
    <h3>Call stack</h3>
    <ol className="stack">{[...stack].reverse().map((frame, i) => <li key={i} className={i === 0 ? "top" : undefined}><span className="mono">{frame.fn}</span> <span className="muted small">line {frame.line}</span></li>)}</ol>
  </section>;
}

export function OutputView({ text }: { text: string }) {
  return <section className="viz-panel">
    <h3>Output</h3>
    <pre className="output mono">{text || <span className="muted">No output yet.</span>}</pre>
  </section>;
}
```

- [ ] **Step 3: Create** `components/viz/TraceView.tsx`

```tsx
import { CallStackView, OutputView, StructureView, VariablesView } from "@/components/viz/views";
import { VIZ_COPY } from "@/lib/viz/copy";
import { structuresOf } from "@/lib/viz/structures";
import { changedVariables, collectObjects, type Trace } from "@/lib/viz/trace";

export default function TraceView({ trace, step }: { trace: Trace; step: number }) {
  const current = trace.steps[step];
  if (!current) {
    return <div className="trace-view">
      <p className="muted">{VIZ_COPY.noSteps}</p>
      <OutputView text={trace.stdout} />
    </div>;
  }
  const frame = current.stack[current.stack.length - 1] ?? { fn: "main", line: current.line, locals: {} };
  const objects = collectObjects(current);
  const ctx = { language: trace.language, objects, locals: frame.locals, changed: changedVariables(trace.steps[step - 1], current) };
  const structures = structuresOf(frame.locals, objects);
  return <div className="trace-view">
    <section className="trace-data">
      {structures.length > 0
        ? structures.map((structure) => <StructureView key={structure.name} structure={structure} ctx={ctx} />)
        : <p className="muted small">No arrays, maps or linked structures in <span className="mono">{frame.fn}</span> at this step.</p>}
    </section>
    <div className="trace-side">
      <VariablesView frame={frame} ctx={ctx} />
      <CallStackView stack={current.stack} />
      <OutputView text={trace.stdout.slice(0, current.out)} />
    </div>
  </div>;
}
```

- [ ] **Step 4: Create** `components/viz/Timeline.tsx`

```tsx
type TimelineProps = {
  count: number;
  step: number;
  playing: boolean;
  speed: number;
  readOnly: boolean;
  onStep: (step: number) => void;
  onPlay: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
};

const SPEEDS = [0.5, 1, 2];

export default function Timeline({ count, step, playing, speed, readOnly, onStep, onPlay, onSpeed }: TimelineProps) {
  const last = Math.max(0, count - 1);
  const disabled = readOnly || count === 0;
  return <footer className="timeline" aria-label="Step through the run">
    <div className="timeline-buttons">
      <button className="icon-button" aria-label="First step" disabled={disabled || step === 0} onClick={() => onStep(0)}>⏮</button>
      <button className="icon-button" aria-label="Previous step" disabled={disabled || step === 0} onClick={() => onStep(step - 1)}>◀</button>
      <button className="primary play" aria-label={playing ? "Pause" : "Play"} disabled={disabled} onClick={() => onPlay(!playing)}>{playing ? "❚❚" : "▶"}</button>
      <button className="icon-button" aria-label="Next step" disabled={disabled || step >= last} onClick={() => onStep(step + 1)}>▶</button>
      <button className="icon-button" aria-label="Last step" disabled={disabled || step >= last} onClick={() => onStep(last)}>⏭</button>
    </div>
    <input className="timeline-track" type="range" min={0} max={last} value={Math.min(step, last)} disabled={disabled} aria-label="Step"
      onChange={(event) => onStep(Number(event.target.value))} />
    <span className="mono step-count">{count === 0 ? "no steps" : `step ${step + 1} / ${count}`}</span>
    <label className="speed"><span className="visually-hidden">Speed</span>
      <select value={speed} disabled={readOnly} onChange={(event) => onSpeed(Number(event.target.value))}>
        {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
    </label>
  </footer>;
}
```

- [ ] **Step 5: Append the visualizer styles to `app/globals.css`**

Insert directly **before** the `@media (max-width: 640px)` block:

```css
/* Visualizer */
.visually-hidden { clip: rect(0 0 0 0); height: 1px; overflow: hidden; position: absolute; white-space: nowrap; width: 1px; }
.view-switch { border: var(--border-w) solid var(--ink); border-radius: var(--radius); display: inline-flex; overflow: hidden; }
.view-switch a { align-items: center; color: var(--ink); display: inline-flex; font-weight: 700; min-height: 40px; padding: 0 12px; text-decoration: none; }
.view-switch a.on { background: var(--accent); }
.view-switch a:not(.on):hover { background: var(--accent-soft); }
.viz-page { display: grid; grid-template-rows: auto 1fr auto; height: 100vh; }
.viz { display: grid; gap: 14px; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); min-height: 0; padding: 14px; }
.viz-code, .viz-trace { background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius-card); box-shadow: var(--shadow); display: grid; min-height: 0; overflow: hidden; }
.viz-code { grid-template-rows: auto auto 1fr auto auto; }
.viz-trace { align-content: start; overflow: auto; padding: 14px; }
.viz-toolbar { align-items: center; border-bottom: var(--border-w) solid var(--ink); display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 10px; }
.lang-switch { border: var(--border-w) solid var(--ink); border-radius: var(--radius); display: inline-flex; overflow: hidden; }
.lang-switch button { background: var(--surface); border: 0; color: var(--ink); font-weight: 700; min-height: 40px; padding: 0 12px; }
.lang-switch button.on { background: var(--accent); }
.lang-switch button:disabled { cursor: default; }
.viz-toolbar select { background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius); font: inherit; font-weight: 600; min-height: 40px; padding: 0 8px; }
.viz-banner { align-items: center; background: var(--accent-soft); border-bottom: var(--border-w) solid var(--ink); display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 12px; }
.code-editor { min-height: 0; overflow: auto; }
.code-editor .cm-editor { font-family: var(--font-mono), ui-monospace, monospace; font-size: 14px; height: 100%; }
.code-editor .cm-pl-current { background: rgba(255, 207, 63, .35); box-shadow: inset 4px 0 0 var(--ink); }
.code-editor .cm-pl-error { background: rgba(194, 65, 12, .14); box-shadow: inset 4px 0 0 var(--danger); }
.code-loading { color: var(--muted); padding: 16px; }
.viz-stdin { border-top: var(--border-w) solid var(--ink); padding: 8px 12px; }
.viz-stdin summary { cursor: pointer; font-weight: 700; min-height: 32px; }
.viz-stdin textarea { border: var(--border-w) solid var(--ink); border-radius: var(--radius); font-family: var(--font-mono), ui-monospace, monospace; font-size: 13px; margin-top: 6px; min-height: 64px; padding: 8px; width: 100%; }
.viz-status { border-top: var(--border-w) solid var(--ink); font-size: 14px; min-height: 40px; padding: 8px 12px; }
.viz-status.error { color: var(--danger); font-weight: 600; white-space: pre-wrap; }
.viz-empty { align-content: center; color: var(--muted); display: grid; font-family: var(--font-display), cursive; font-size: 22px; justify-items: center; min-height: 240px; text-align: center; }
.trace-view { display: grid; gap: 14px; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); }
.trace-data { display: grid; gap: 14px; align-content: start; min-width: 0; }
.trace-side { display: grid; gap: 12px; align-content: start; min-width: 0; }
.viz-struct { border: 2px solid var(--line); border-radius: var(--radius); margin: 0; min-width: 0; padding: 10px; }
.viz-struct.changed { border-color: var(--ink); }
.viz-struct figcaption { margin-bottom: 8px; }
.arr { align-items: flex-end; display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
.arr-item { align-items: center; display: grid; flex: 0 0 auto; gap: 2px; justify-items: center; min-width: 34px; }
.arr-bars .bar { background: #c9c2ff; border: 2px solid var(--ink); border-radius: 6px 6px 2px 2px; width: 26px; }
.arr-bars .bar.neg { background: #ffd2c2; }
.arr-item.pointed .bar { background: var(--accent); }
.arr-cells .cell { border: 2px solid var(--ink); border-radius: 6px; min-width: 34px; padding: 4px 6px; text-align: center; }
.arr-item.pointed .cell { background: var(--accent-soft); }
.arr-bars .cell { font-size: 12px; }
.arr-item .idx { color: var(--muted); font-size: 11px; }
.arr-item .ptr, .ptr { color: var(--accent-text); font-size: 11px; font-weight: 700; min-height: 14px; }
.arr-item.end .cell { border-style: dashed; }
.grid-wrap { overflow-x: auto; }
.grid { border-collapse: collapse; font-size: 13px; }
.grid th { color: var(--muted); font-size: 11px; font-weight: 600; padding: 2px 6px; }
.grid th .ptr { display: block; }
.grid td { border: 2px solid var(--ink); min-width: 32px; padding: 4px 6px; text-align: center; }
.grid td.pointed { background: var(--accent); }
.map { border-collapse: collapse; font-size: 14px; }
.map th, .map td { border: 2px solid var(--ink); padding: 4px 8px; text-align: left; }
.map th { background: var(--lilac-bg); font-weight: 700; }
.linked { align-items: flex-end; display: flex; flex-wrap: wrap; gap: 4px; }
.ll-node { align-items: center; display: grid; grid-template-columns: auto auto; grid-template-rows: auto auto; }
.ll-node .ptr { grid-column: 1; }
.ll-box, .tree-box { background: var(--mint-bg); border: 2px solid var(--ink); border-radius: 8px; font-weight: 700; padding: 4px 10px; }
.ll-arrow { font-size: 18px; grid-row: 2; padding: 0 4px; }
.tree { overflow-x: auto; }
.tree-node { align-items: center; display: grid; justify-items: center; }
.tree-children { display: flex; gap: 10px; margin-top: 6px; }
.tree-slot { border-top: 2px solid var(--line); padding-top: 6px; }
.viz-panel { border: 2px solid var(--line); border-radius: var(--radius); padding: 10px; }
.viz-panel h3 { font-family: var(--font-display), cursive; font-size: 18px; margin: 0 0 6px; }
.vars { display: grid; gap: 2px; margin: 0; }
.vars div { border-radius: 6px; display: grid; gap: 8px; grid-template-columns: minmax(0, auto) minmax(0, 1fr); padding: 2px 6px; }
.vars div.changed { background: var(--accent-soft); }
.vars dt { font-weight: 700; }
.vars dd { margin: 0; overflow-wrap: anywhere; }
.stack { display: grid; gap: 4px; list-style: none; margin: 0; padding: 0; }
.stack li { border-left: 4px solid var(--line); padding: 2px 8px; }
.stack li.top { background: var(--accent-soft); border-left-color: var(--ink); }
.output { background: var(--paper); border-radius: 6px; font-size: 13px; margin: 0; max-height: 160px; overflow: auto; padding: 8px; white-space: pre-wrap; }
.timeline { align-items: center; background: var(--surface); border-top: var(--border-w) solid var(--ink); display: flex; flex-wrap: wrap; gap: 10px; padding: 8px 14px; }
.timeline-buttons { display: flex; gap: 4px; }
.timeline .play { min-width: 56px; }
.timeline-track { accent-color: var(--ink); flex: 1 1 200px; min-height: var(--tap); }
.step-count { color: var(--muted); font-size: 13px; }
.speed select { background: var(--surface); border: var(--border-w) solid var(--ink); border-radius: var(--radius); font: inherit; font-weight: 600; min-height: 40px; padding: 0 8px; }
@media (max-width: 900px) {
  .viz-page { height: auto; min-height: 100vh; }
  .viz { grid-template-columns: minmax(0, 1fr); }
  .viz-code { min-height: 60vh; }
  .trace-view { grid-template-columns: minmax(0, 1fr); }
}
```

- [ ] **Step 6: Type check and commit**

Run: `npx tsc --noEmit`
Expected: pass.

```bash
git add components/viz app/globals.css
git commit -m "feat(viz): code editor, trace views and timeline

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 12: Route, Board/Visualizer switch and the integration component

**Files:**
- Modify: `lib/room.ts` (add `roomQuery`)
- Test: `lib/room.test.ts`
- Modify: `components/StatusBar.tsx` (switch), `components/Board.tsx` (pass the switch props)
- Create: `app/room/[roomId]/visualize/page.tsx`, `components/viz/Visualizer.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: `roomQuery({ role, token, viewerToken, local }): string`; `StatusBar` prop `views?: { roomId: string; query: string; current: "board" | "viz" }`.

- [ ] **Step 1: Write the failing test** `lib/room.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { roomQuery } from "@/lib/room";

describe("roomQuery", () => {
  it("keeps the access a page was opened with", () => {
    expect(roomQuery({ role: "editor", token: "e", viewerToken: "v", local: false })).toBe("role=editor&token=e&viewer=v");
    expect(roomQuery({ role: "viewer", token: "v", viewerToken: "", local: true })).toBe("role=viewer&token=v&local=1");
  });
});
```

Run: `npx vitest run lib/room.test.ts`
Expected: FAIL, because `roomQuery` is not exported.

- [ ] **Step 2: Add `roomQuery` to `lib/room.ts`**

Append:

```ts
// Query string for switching between the board and the visualizer without changing access.
export function roomQuery({ role, token, viewerToken, local }: { role: "editor" | "viewer"; token: string; viewerToken: string; local: boolean }) {
  const params = new URLSearchParams({ role, token });
  if (viewerToken) params.set("viewer", viewerToken);
  if (local) params.set("local", "1");
  return params.toString();
}
```

Run: `npx vitest run lib/room.test.ts`
Expected: PASS.

- [ ] **Step 3: Add the switch to `components/StatusBar.tsx`**

Change the props type and the header markup:

```tsx
type StatusBarProps = {
  role: RoomRole;
  status: ConnectionStatus | "local";
  presence: PresenceCounts;
  saveState: SaveState | null;
  onShare?: () => void;
  views?: { roomId: string; query: string; current: "board" | "viz" };
};

export default function StatusBar({ role, status, presence, saveState, onShare, views }: StatusBarProps) {
  const warn = status === "offline" || status === "reconnecting";
  return <header className="topbar">
    <Link href="/" className="brand" aria-label="Back to your boards" title="Back to your boards"><LogoMark size={20} /><span className="brand-name">PentoLive</span></Link>
    {views && <nav className="view-switch" aria-label="Switch view">
      <Link className={views.current === "board" ? "on" : undefined} aria-current={views.current === "board" ? "page" : undefined} href={`/room/${views.roomId}?${views.query}`}>Board</Link>
      <Link className={views.current === "viz" ? "on" : undefined} aria-current={views.current === "viz" ? "page" : undefined} href={`/room/${views.roomId}/visualize?${views.query}`}>Visualizer</Link>
    </nav>}
    <span className={`status ${warn ? "offline" : ""}`} role="status">{status === "live" && <span className="live-dot pulse" />}{connectionLabel(status)}</span>
    {status !== "local" && <span className="presence">{presenceLabel(role, presence)}</span>}
    {saveState && <span className={`save ${saveState === "retrying" || saveState === "failed" || saveState === "replaced" ? "warn" : ""}`}>{saveLabel(saveState)}</span>}
    {onShare && <button className="copy" onClick={onShare}>Share</button>}
  </header>;
}
```

In `components/Board.tsx`:
- add `roomQuery` to the `@/lib/room` import;
- pass `views={{ roomId, query: roomQuery({ role, token, viewerToken, local }), current: "board" }}` to `<StatusBar …>`.

- [ ] **Step 4: Create** `app/room/[roomId]/visualize/page.tsx`

```tsx
import Visualizer from "@/components/viz/Visualizer";

export default async function VisualizePage({ params, searchParams }: { params: Promise<{ roomId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { roomId } = await params;
  const query = await searchParams;
  const role = query.role === "viewer" ? "viewer" : "editor";
  const token = typeof query.token === "string" ? query.token : "";
  const viewerToken = typeof query.viewer === "string" ? query.viewer : "";
  const local = query.local === "1";
  return <Visualizer roomId={roomId} role={role} token={token} viewerToken={viewerToken} local={local} />;
}
```

- [ ] **Step 5: Create** `components/viz/Visualizer.tsx`

```tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import StatusBar from "@/components/StatusBar";
import Timeline from "@/components/viz/Timeline";
import TraceView from "@/components/viz/TraceView";
import type { PresenceCounts } from "@/lib/realtime/presence";
import type { ConnectionStatus } from "@/lib/realtime/roomChannel";
import { makeCapability, roomQuery } from "@/lib/room";
import { joinRoom } from "@/lib/rooms/api";
import { createJoinRetry, type JoinRetry } from "@/lib/rooms/joinRetry";
import { ensureAnonymousSession } from "@/lib/supabase";
import { SYNC_REPLY_MIN_GAP_MS } from "@/lib/sync/messages";
import { defaultDrafts, readVizBackup, writeVizBackup, type Drafts } from "@/lib/viz/backup";
import { openVizConnection, type VizConnection } from "@/lib/viz/channel";
import { VIZ_COPY } from "@/lib/viz/copy";
import { LIMITS, type Language } from "@/lib/viz/engines";
import { createRunner, type RunPhase, type Runner } from "@/lib/viz/runner";
import { TEMPLATES } from "@/lib/viz/templates";
import type { Trace } from "@/lib/viz/trace";
import { cppWorker, pythonWorker } from "@/lib/viz/workers";

const CodeEditor = dynamic(() => import("@/components/viz/CodeEditor"), { ssr: false, loading: () => <div className="code-loading">Loading editor…</div> });

type VisualizerProps = { roomId: string; role: "editor" | "viewer"; token: string; viewerToken: string; local: boolean };
type Run = { runId: string; trace: Trace };

const CODE_SEND_MS = 300;
const STEP_SEND_MS = 100;
const REMOTE_EDIT_GRACE_MS = 2000;
const NO_EDITOR_AFTER_MS = 3000;
const BACKUP_MS = 1000;
const PLAY_BASE_MS = 700;
const LANGUAGES: { id: Language; label: string }[] = [{ id: "python", label: "Python" }, { id: "cpp", label: "C++" }];

const storage = () => { try { return window.localStorage; } catch { return null; } };

function statusLine(phase: RunPhase | null, language: Language, failure: string | null, trace: Trace | undefined) {
  if (phase === "loading") return { text: VIZ_COPY.loading[language], error: false };
  if (phase === "compiling") return { text: VIZ_COPY.compiling, error: false };
  if (phase === "running") return { text: VIZ_COPY.running, error: false };
  if (failure) return { text: failure, error: true };
  if (!trace) return null;
  if (trace.error) return { text: trace.error.message, error: true };
  if (trace.notice) return { text: trace.notice, error: false };
  if (trace.stopped === "steps") return { text: VIZ_COPY.stoppedSteps, error: false };
  if (trace.stopped === "time") return { text: VIZ_COPY.stoppedTime, error: false };
  if (trace.stopped === "size") return { text: VIZ_COPY.stoppedSize(trace.steps.length), error: false };
  return null;
}

export default function Visualizer({ roomId, role, token, viewerToken, local }: VisualizerProps) {
  const editor = role === "editor";
  const clientId = useMemo(() => makeCapability(), []);
  const query = useMemo(() => roomQuery({ role, token, viewerToken, local }), [role, token, viewerToken, local]);
  const [language, setLanguage] = useState<Language>("python");
  const [drafts, setDrafts] = useState<Drafts>(defaultDrafts);
  const [cursorLine, setCursorLine] = useState(1);
  const [run, setRun] = useState<Run | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [phase, setPhase] = useState<RunPhase | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | "local">(local ? "local" : "connecting");
  const [presence, setPresence] = useState<PresenceCounts>({ editors: 0, viewers: 0 });
  const [linkError, setLinkError] = useState(false);
  const [heardEditor, setHeardEditor] = useState(false);
  const [noEditor, setNoEditor] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const [restored, setRestored] = useState(!editor);

  const connection = useRef<VizConnection | null>(null);
  const runners = useRef<Partial<Record<Language, Runner>>>({});
  const latest = useRef({ language, drafts, cursorLine, run, step, playing });
  latest.current = { language, drafts, cursorLine, run, step, playing };
  const rev = useRef(0);
  const lastKeystroke = useRef(0);
  const remoteRevs = useRef(new Map<string, number>());
  const driving = useRef(false);
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncReply = useRef(0);
  const heardRef = useRef(heardEditor);
  heardRef.current = heardEditor;

  const sendCodeNow = () => {
    const { language: lang, drafts: d, cursorLine: line } = latest.current;
    rev.current += 1;
    connection.current?.sendCode({ language: lang, code: d[lang].code, stdin: d[lang].stdin, cursorLine: line, rev: rev.current });
  };
  const scheduleCode = () => {
    if (!editor || codeTimer.current) return;
    codeTimer.current = setTimeout(() => { codeTimer.current = null; sendCodeNow(); }, CODE_SEND_MS);
  };
  const scheduleStep = () => {
    if (!editor || stepTimer.current) return;
    stepTimer.current = setTimeout(() => {
      stepTimer.current = null;
      const { run: r, step: s, playing: p } = latest.current;
      if (r) connection.current?.sendStep({ runId: r.runId, step: s, playing: p });
    }, STEP_SEND_MS);
  };

  // Restore this room's code on the editor's device.
  useEffect(() => {
    if (!editor) return;
    const backup = readVizBackup(storage(), roomId);
    if (backup) { setLanguage(backup.language); setDrafts(backup.drafts); }
    setRestored(true);
  }, [editor, roomId]);

  useEffect(() => {
    if (!editor || !restored) return;
    const timer = setTimeout(() => writeVizBackup(storage(), roomId, { language, drafts }), BACKUP_MS);
    return () => clearTimeout(timer);
  }, [drafts, editor, language, restored, roomId]);

  // Join the room, then follow the viz topic.
  useEffect(() => {
    if (local) return;
    let cancelled = false;
    let joinRetry: JoinRetry | null = null;
    let open: VizConnection | null = null;
    let waitTimer: ReturnType<typeof setTimeout> | null = null;

    async function start() {
      const supabase = await ensureAnonymousSession().catch(() => null);
      if (cancelled) return;
      if (!supabase) { setStatus("offline"); return; }
      joinRetry = createJoinRetry({
        join: () => joinRoom(supabase, { roomId, token, role }),
        onInvalid: () => setLinkError(true),
        onOffline: () => setStatus("offline"),
        onJoined: () => {
          open = openVizConnection(supabase, { roomId, clientId, role }, {
            onCode: (payload) => {
              if (editor && Date.now() - lastKeystroke.current < REMOTE_EDIT_GRACE_MS) return;
              if ((remoteRevs.current.get(payload.from) ?? -1) >= payload.rev) return;
              remoteRevs.current.set(payload.from, payload.rev);
              setHeardEditor(true);
              setNoEditor(false);
              setLanguage(payload.language);
              setDrafts((d) => ({ ...d, [payload.language]: { code: payload.code, stdin: payload.stdin } }));
              setCursorLine(payload.cursorLine);
            },
            onTrace: (runId, trace) => {
              setHeardEditor(true);
              setNoEditor(false);
              driving.current = false;
              setRun({ runId, trace });
              setStep(0);
              setPlaying(false);
            },
            onStep: (payload) => {
              if (latest.current.run?.runId !== payload.runId) return;
              driving.current = false;
              setStep(Math.min(payload.step, Math.max(0, latest.current.run.trace.steps.length - 1)));
              setPlaying(payload.playing);
            },
            onSyncRequest: () => {
              if (!editor) return;
              const now = Date.now();
              if (now - lastSyncReply.current < SYNC_REPLY_MIN_GAP_MS) return;
              lastSyncReply.current = now;
              sendCodeNow();
              const { run: r, step: s, playing: p } = latest.current;
              if (r) void open?.sendTrace(r.runId, r.trace).then(() => open?.sendStep({ runId: r.runId, step: s, playing: p }));
            },
            onStatus: setStatus,
            onPresence: setPresence,
            onSubscribed: () => {
              if (editor) { sendCodeNow(); return; }
              open?.requestSync();
              waitTimer = setTimeout(() => setNoEditor((none) => none || !heardRef.current), NO_EDITOR_AFTER_MS);
            },
          });
          connection.current = open;
        },
      });
      joinRetry.start();
    }

    const onOnline = () => joinRetry?.retryNow();
    window.addEventListener("online", onOnline);
    void start();
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      if (waitTimer) clearTimeout(waitTimer);
      joinRetry?.dispose();
      open?.close();
      connection.current = null;
    };
    // The handlers read live state through refs; reconnect only when access changes.
  }, [clientId, editor, local, role, roomId, token]);

  // Playback runs only on the editor who pressed play; everyone else follows viz-step.
  useEffect(() => {
    if (!playing || !driving.current || !run) return;
    const timer = setInterval(() => {
      const { step: s, run: r } = latest.current;
      if (!r || s >= r.trace.steps.length - 1) {
        setPlaying(false);
        driving.current = false;
        scheduleStep();
        return;
      }
      setStep(s + 1);
      scheduleStep();
    }, PLAY_BASE_MS / speed);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, run, speed]);

  useEffect(() => () => { Object.values(runners.current).forEach((r) => r?.dispose()); }, []);

  const changeStep = (next: number) => {
    if (!editor || !run) return;
    setStep(Math.max(0, Math.min(next, run.trace.steps.length - 1)));
    scheduleStep();
  };
  const changePlaying = (next: boolean) => {
    if (!editor || !run) return;
    driving.current = next;
    if (next && step >= run.trace.steps.length - 1) setStep(0);
    setPlaying(next);
    scheduleStep();
  };

  const onEditorChange = (code: string, line: number) => {
    if (!editor) return;
    lastKeystroke.current = Date.now();
    setDrafts((d) => (d[language].code === code ? d : { ...d, [language]: { ...d[language], code } }));
    setCursorLine(line);
    scheduleCode();
  };

  const changeLanguage = (next: Language) => {
    if (!editor || next === language || phase) return;
    setLanguage(next);
    setRun(null);
    setFailure(null);
    setPlaying(false);
    lastKeystroke.current = Date.now();
    scheduleCode();
  };

  const applyTemplate = (id: string) => {
    const template = TEMPLATES[language].find((t) => t.id === id);
    if (!template) return;
    setPendingTemplate(null);
    setDrafts((d) => ({ ...d, [language]: { code: template.code, stdin: template.stdin ?? "" } }));
    setRun(null);
    lastKeystroke.current = Date.now();
    scheduleCode();
  };
  const chooseTemplate = (id: string) => {
    const code = drafts[language].code.trim();
    const isTemplate = TEMPLATES[language].some((t) => t.code.trim() === code);
    if (code && !isTemplate) setPendingTemplate(id);
    else applyTemplate(id);
  };

  const runCode = async () => {
    if (!editor || phase) return;
    const lang = language;
    const { code, stdin } = drafts[lang];
    setFailure(null);
    setPlaying(false);
    driving.current = false;
    const runner = (runners.current[lang] ??= createRunner(lang, lang === "python" ? pythonWorker : cppWorker));
    setPhase("loading");
    const result = await runner.run({ code, stdin }, setPhase);
    setPhase(null);
    if (!result.ok) { setFailure(result.message); return; }
    const runId = makeCapability();
    setRun({ runId, trace: result.trace });
    setStep(0);
    const open = connection.current;
    if (open) void open.sendTrace(runId, result.trace).then(() => open.sendStep({ runId, step: 0, playing: false }));
  };

  if (linkError) {
    return <main className="link-error paper">
      <section className="auth-card">
        <h1>This board link is invalid or expired</h1>
        <p className="muted">Ask for a fresh link, or create a new board.</p>
        <Link className="primary" href="/">Go home</Link>
      </section>
    </main>;
  }

  const trace = run?.trace;
  const current = trace?.steps[step];
  const line = statusLine(phase, language, failure, trace);
  const draft = drafts[language];
  const traceMatchesLanguage = trace?.language === language;

  return <main className="viz-page">
    <StatusBar role={role} status={status} presence={presence} saveState={null} views={{ roomId, query, current: "viz" }} />
    <div className="viz">
      <section className="viz-code" aria-label="Code">
        <div className="viz-toolbar">
          <div className="lang-switch" role="group" aria-label="Language">
            {LANGUAGES.map((l) => <button key={l.id} className={language === l.id ? "on" : undefined} aria-pressed={language === l.id}
              disabled={!editor} onClick={() => changeLanguage(l.id)}>{l.label}</button>)}
          </div>
          {editor && <select aria-label="Templates" value="" onChange={(event) => chooseTemplate(event.target.value)}>
            <option value="">Templates</option>
            {TEMPLATES[language].map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>}
          <span className="spacer" />
          {editor && <button className="primary" onClick={() => void runCode()} disabled={!!phase}>{phase ? VIZ_COPY.running : "▶ Run"}</button>}
        </div>
        {pendingTemplate ? <div className="viz-banner" role="alert">
          <span>{VIZ_COPY.replaceCode(TEMPLATES[language].find((t) => t.id === pendingTemplate)?.name ?? "")}</span>
          <button className="primary" onClick={() => applyTemplate(pendingTemplate)}>Replace</button>
          <button className="button" onClick={() => setPendingTemplate(null)}>Cancel</button>
        </div> : <div />}
        <CodeEditor value={draft.code} language={language} readOnly={!editor} onChange={onEditorChange}
          currentLine={traceMatchesLanguage ? current?.line ?? null : null}
          errorLine={traceMatchesLanguage ? trace?.error?.line ?? null : null}
          followLine={editor ? null : cursorLine} />
        <details className="viz-stdin">
          <summary>Input (stdin)</summary>
          <textarea aria-label="Program input" value={draft.stdin} readOnly={!editor} maxLength={LIMITS.maxStdinChars}
            onChange={(event) => {
              const stdin = event.target.value;
              lastKeystroke.current = Date.now();
              setDrafts((d) => ({ ...d, [language]: { ...d[language], stdin } }));
              scheduleCode();
            }} />
        </details>
        <p className={`viz-status${line?.error ? " error" : ""}`} role="status">{line?.text ?? ""}</p>
      </section>
      <section className="viz-trace" aria-label="Visualization">
        {trace ? <TraceView trace={trace} step={step} />
          : <div className="viz-empty">{editor ? VIZ_COPY.emptyEditor : noEditor ? VIZ_COPY.noEditor : VIZ_COPY.waitingRun}</div>}
      </section>
    </div>
    <Timeline count={trace?.steps.length ?? 0} step={step} playing={playing} speed={speed} readOnly={!editor}
      onStep={changeStep} onPlay={changePlaying} onSpeed={setSpeed} />
  </main>;
}
```

- [ ] **Step 6: Gates**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass. The build output lists `ƒ /room/[roomId]/visualize`. Turbopack must emit the two worker chunks without errors. If it can't resolve a `webpackIgnore`d URL import, switch that import to `/* turbopackIgnore: true */` (docs: `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md`) and ledger it.

- [ ] **Step 7: Commit**

```bash
git add lib/room.ts lib/room.test.ts components/StatusBar.tsx components/Board.tsx "app/room/[roomId]/visualize/page.tsx" components/viz/Visualizer.tsx
git commit -m "feat(viz): visualizer page with live code, run, playback and catch-up

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 13: Browser verification

**Files:** none new. Fixes go into the files above, each with a test that failed first when it is unit-testable.

- [ ] **Step 1: Prepare**

Start `npm run dev`. Create a temporary pre-confirmed test user (AGENTS.md "Gotchas"), sign in on a laptop-sized window (1280×800) in headless Chrome over CDP, or in Claude in Chrome if it is connected, and create a board.

- [ ] **Step 2: Editor checks** (editor link, `/room/<id>/visualize`)
1. The Board | Visualizer switch moves between the pages with the same access, and the board still draws.
2. **Python:** run each template. The trace shows bars with pointers (bubble sort, binary search), a map (two sum), a grid with an `r, c` highlight (BFS), a call stack 4+ deep (fibonacci) and a linked list with `prev`/`curr`/`nxt` labels (reverse). Output fills in as you step.
3. **C++:**
   - The first run shows "Loading the C++ compiler…".
   - Every template runs.
   - A compile error marks its line.
   - `while (true) {}` with a statement inside shows "Stopped after 1,000 steps".
4. Templates ask before replacing edited code. Reloading the page restores the code.
5. Play, pause, speed and dragging the timeline all work. Arrow keys work on the slider.

- [ ] **Step 3: Viewer checks** (a second CDP session on the viewer link)
1. It shows "Waiting for the candidate to run code" before the first run.
2. Typing on the editor appears on the viewer within about 1 s, and the editor is read-only there.
3. After a run, the viewer shows the same step and follows scrub and play.
4. When the viewer reloads mid-trace, it catches up to the current code, trace and step.
5. With the editor closed and the viewer reloaded, it shows "The candidate isn't on the visualizer yet."

- [ ] **Step 4: Narrow screen and board regression**

At 820×1180 the panes stack, with nothing scrolling sideways. On the board page, re-run the pen check (the stroke lands under the pen).

- [ ] **Step 5: Clean up and gates**

Delete the test user and its boards. Stop the dev server and check the ports. Run `npm test`, `npm run test:engines`, `npx tsc --noEmit` and `npm run build`, and commit any fixes:

```bash
git commit -am "fix(viz): issues found in browser verification

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 14: Docs and PR

- [ ] **Step 1: Document the visualizer in AGENTS.md**
  - Under Layout, add `components/viz/*` and `lib/viz/*` (engines, trace, cpp, python, workers, channel).
  - Under Commands, add `npm run test:engines`.
  - Under Invariants, add "viz: only editors send on `room:<id>:viz`; payloads ≤ `MAX_CHUNK_BYTES`; engines load from jsDelivr at `ENGINE_VERSIONS`".
  - Under Gotchas, add the spike facts (clang stderr arrives a byte at a time; the 1,000-step cap; `#line` keeps user line numbers).
- [ ] **Step 2: Commit and open the PR**

Commit with `docs:`. Use the project skill `finishing-a-feature` and open a PR into `main`. The base is `feat/board-details` if PR #7 isn't merged yet. In the PR body, note: no migration, no function deploy, no env vars.
