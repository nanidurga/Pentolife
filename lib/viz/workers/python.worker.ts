import { VIZ_COPY } from "@/lib/viz/copy";
import { ENGINE_URLS } from "@/lib/viz/engines";
import { runPython, type PyodideLike } from "@/lib/viz/python/run";
import type { WorkerReply, WorkerRequest } from "@/lib/viz/runner";

const ctx = self as unknown as { postMessage(reply: WorkerReply): void; onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null };
let pyodide: Promise<PyodideLike> | null = null;

ctx.onmessage = async ({ data }) => {
  ctx.postMessage({ type: "phase", phase: "loading" });
  let py: PyodideLike;
  try {
    pyodide ??= import(/* webpackIgnore: true */ ENGINE_URLS.pyodide).then((m: { loadPyodide(o: { indexURL: string }): Promise<PyodideLike> }) => m.loadPyodide({ indexURL: ENGINE_URLS.pyodideDir }));
    py = await pyodide;
  } catch {
    pyodide = null;
    ctx.postMessage({ type: "failed", message: VIZ_COPY.loadFailed.python });
    return;
  }
  ctx.postMessage({ type: "phase", phase: "running" });
  try {
    ctx.postMessage({ type: "done", trace: runPython(py, data.code, data.stdin) });
  } catch (error) {
    ctx.postMessage({ type: "failed", message: error instanceof Error ? error.message : String(error) });
  }
};
