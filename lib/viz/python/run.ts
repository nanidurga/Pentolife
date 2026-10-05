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
