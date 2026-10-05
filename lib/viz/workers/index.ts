import type { WorkerLike } from "@/lib/viz/runner";

// Built by scripts/build-viz-workers.mjs (runs before `next dev` and `next build`).
export const pythonWorker = () => new Worker("/viz/python.worker.js", { type: "module" }) as unknown as WorkerLike;
export const cppWorker = () => new Worker("/viz/cpp.worker.js", { type: "module" }) as unknown as WorkerLike;
