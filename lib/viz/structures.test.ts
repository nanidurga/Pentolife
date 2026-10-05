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
