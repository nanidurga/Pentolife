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
