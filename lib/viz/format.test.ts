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
