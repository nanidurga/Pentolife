// Builds the visualizer's static assets into public/viz/ (runs before `next dev` and `next build`):
// - the run workers. Turbopack copies `new Worker(new URL(...))` targets as raw assets instead of bundling them.
// - the C++ prelude precompiled with the in-browser clang, so a compile in the browser skips re-parsing it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = path.join(root, "public/viz");
mkdirSync(out, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: {
    "python.worker": "lib/viz/workers/python.worker.ts",
    "cpp.worker": "lib/viz/workers/cpp.worker.ts",
  },
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  logLevel: "warning",
});

const { outputFiles } = await build({
  stdin: { contents: 'export { CLANG_FLAGS, PCH_FILE, PRELUDE } from "./lib/viz/cpp/prelude";', resolveDir: root, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { CLANG_FLAGS, PCH_FILE, PRELUDE } = await import(`data:text/javascript,${encodeURIComponent(outputFiles[0].text)}`);
const clangVersion = JSON.parse(readFileSync(path.join(root, "node_modules/@yowasp/clang/package.json"), "utf8")).version;
const stamp = createHash("sha256").update(`${clangVersion}\n${CLANG_FLAGS.join(" ")}\n${PRELUDE}`).digest("hex");
const pchPath = path.join(out, PCH_FILE);
const stampPath = `${pchPath}.stamp`;

if (existsSync(pchPath) && existsSync(stampPath) && readFileSync(stampPath, "utf8") === stamp) {
  console.log("viz: precompiled prelude is up to date");
} else {
  const started = Date.now();
  const { runClang } = await import("@yowasp/clang");
  const files = await runClang(["clang++", ...CLANG_FLAGS, "-x", "c++-header", "__pl.h", "-o", PCH_FILE], { "__pl.h": PRELUDE });
  writeFileSync(pchPath, files[PCH_FILE]);
  writeFileSync(stampPath, stamp);
  console.log(`viz: precompiled the C++ prelude in ${Math.round((Date.now() - started) / 1000)} s`);
}
