import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENGINE_URLS, ENGINE_VERSIONS, LIMITS } from "@/lib/viz/engines";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { devDependencies: Record<string, string> };

describe("engine pins", () => {
  it("match the devDependencies the engine tests run against", () => {
    for (const [name, version] of Object.entries(ENGINE_VERSIONS)) expect(pkg.devDependencies[name]).toBe(version);
  });

  it("load every engine from jsDelivr at the pinned version", () => {
    expect(ENGINE_URLS.clang).toBe("https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/gen/bundle.js");
    expect(ENGINE_URLS.pyodideDir).toBe("https://cdn.jsdelivr.net/npm/pyodide@314.0.7/");
    expect(ENGINE_URLS.cppGrammar).toBe("https://cdn.jsdelivr.net/npm/tree-sitter-cpp@0.23.4/tree-sitter-cpp.wasm");
  });

  it("uses the limits from the spec", () => {
    expect(LIMITS).toMatchObject({ maxSteps: 1000, runTimeoutMs: 10_000, maxCodeChars: 50_000, maxStdinChars: 10_000, maxTraceBytes: 1_000_000 });
  });
});
