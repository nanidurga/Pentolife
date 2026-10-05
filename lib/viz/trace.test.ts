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
