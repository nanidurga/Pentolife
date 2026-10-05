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
