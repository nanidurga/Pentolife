// Bundles the visualizer's run workers into public/viz/. Turbopack copies `new Worker(new URL(...))`
// targets as raw assets instead of bundling them, so the workers are built here before dev and build.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
  entryPoints: {
    "python.worker": "lib/viz/workers/python.worker.ts",
    "cpp.worker": "lib/viz/workers/cpp.worker.ts",
  },
  outdir: "public/viz",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  logLevel: "warning",
});
