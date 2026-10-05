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
