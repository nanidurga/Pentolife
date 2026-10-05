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
