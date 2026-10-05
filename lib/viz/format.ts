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
