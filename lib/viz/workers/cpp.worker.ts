import type { Parser } from "web-tree-sitter";
import { PCH_FILE } from "@/lib/viz/cpp/prelude";
import { runCpp, type CppEngine, type RunClang, type WasiShim } from "@/lib/viz/cpp/run";
import { VIZ_COPY } from "@/lib/viz/copy";
import { ENGINE_URLS } from "@/lib/viz/engines";
import type { WorkerReply, WorkerRequest } from "@/lib/viz/runner";

const ctx = self as unknown as { postMessage(reply: WorkerReply): void; onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null };
let engine: Promise<CppEngine> | null = null;

type TreeSitter = { Parser: { init(o: { locateFile(file: string): string }): Promise<void>; new (): Parser }; Language: { load(url: string): Promise<Parameters<Parser["setLanguage"]>[0]> } };

// Shipped by scripts/build-viz-workers.mjs. Without it compiles still work, just slower.
async function loadPch(): Promise<Uint8Array | undefined> {
  try {
    const response = await fetch(`/viz/${PCH_FILE}`);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}

async function load(): Promise<CppEngine> {
  const [clang, shim, ts] = await Promise.all([
    import(/* webpackIgnore: true */ ENGINE_URLS.clang) as Promise<{ runClang: RunClang }>,
    import(/* webpackIgnore: true */ ENGINE_URLS.wasiShim) as Promise<WasiShim>,
    import(/* webpackIgnore: true */ ENGINE_URLS.treeSitter) as Promise<TreeSitter>,
  ]);
  await ts.Parser.init({ locateFile: (file) => ENGINE_URLS.treeSitterDir + file });
  const parser = new ts.Parser();
  parser.setLanguage(await ts.Language.load(ENGINE_URLS.cppGrammar));
  return { runClang: clang.runClang, shim, parser, pch: await loadPch() };
}

ctx.onmessage = async ({ data }) => {
  ctx.postMessage({ type: "phase", phase: "loading" });
  let ready: CppEngine;
  try {
    engine ??= load();
    ready = await engine;
  } catch {
    engine = null;
    ctx.postMessage({ type: "failed", message: VIZ_COPY.loadFailed.cpp });
    return;
  }
  try {
    const trace = await runCpp(ready, data.code, data.stdin, (phase) => ctx.postMessage({ type: "phase", phase }));
    ctx.postMessage({ type: "done", trace });
  } catch (error) {
    ctx.postMessage({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
};
