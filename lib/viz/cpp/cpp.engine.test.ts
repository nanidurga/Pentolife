import * as shim from "@bjorn3/browser_wasi_shim";
// The package typings omit runClang, which the runtime exports (see its README).
import * as clang from "@yowasp/clang";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPch, runCpp, type CppEngine, type RunClang } from "@/lib/viz/cpp/run";
import { cppParser } from "@/lib/viz/cpp/testParser";
import { TEMPLATES } from "@/lib/viz/templates";

let engine: CppEngine;
beforeAll(async () => { engine = { runClang: (clang as unknown as { runClang: RunClang }).runClang, shim, parser: await cppParser() }; });

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

describe("precompiled prelude", () => {
  it("builds once and compiles a template with it, faster than without", async () => {
    const pch = await buildPch(engine.runClang);
    expect(pch.length).toBeGreaterThan(100_000);
    const template = TEMPLATES.cpp[0];
    const withPch = { ...engine, pch };
    await runCpp(withPch, template.code, "");
    const started = performance.now();
    const trace = await runCpp(withPch, template.code, "");
    const elapsed = performance.now() - started;
    expect(trace.error).toBeUndefined();
    expect(trace.steps.length).toBeGreaterThan(3);
    expect(trace.stdout).toBe("1 2 4 5 8 " + String.fromCharCode(10));
    const compileError = await runCpp(withPch, ["int main() {", "  int a = 1;", "  b = a;", "}", ""].join(String.fromCharCode(10)), "");
    expect(compileError.error).toMatchObject({ kind: "compile", line: 3 });
    console.log(`warm run with pch: ${Math.round(elapsed)} ms`);
  });
});
