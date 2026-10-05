export type Language = "python" | "cpp";

// Engine builds are loaded from jsDelivr inside the run workers, never bundled into the app.
// Keep these identical to the devDependencies the engine tests use (engines.test.ts checks).
export const ENGINE_VERSIONS = {
  "@yowasp/clang": "22.0.0-git20542-10",
  "@bjorn3/browser_wasi_shim": "0.4.2",
  "web-tree-sitter": "0.27.0",
  "tree-sitter-cpp": "0.23.4",
  pyodide: "314.0.7",
} as const;

const cdn = (pkg: keyof typeof ENGINE_VERSIONS, path: string) => `https://cdn.jsdelivr.net/npm/${pkg}@${ENGINE_VERSIONS[pkg]}/${path}`;

export const ENGINE_URLS = {
  clang: cdn("@yowasp/clang", "gen/bundle.js"),
  wasiShim: cdn("@bjorn3/browser_wasi_shim", "dist/index.js"),
  treeSitter: cdn("web-tree-sitter", "web-tree-sitter.js"),
  treeSitterDir: cdn("web-tree-sitter", ""),
  cppGrammar: cdn("tree-sitter-cpp", "tree-sitter-cpp.wasm"),
  pyodide: cdn("pyodide", "pyodide.mjs"),
  pyodideDir: cdn("pyodide", ""),
};

export const LIMITS = {
  maxSteps: 1000,
  runTimeoutMs: 10_000,
  maxCodeChars: 50_000,
  maxStdinChars: 10_000,
  maxTraceBytes: 1_000_000,
  maxDepth: 4,
  maxItems: 100,
  maxStringChars: 200,
  maxStdoutChars: 20_000,
} as const;
