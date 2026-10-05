import type { WorkerLike } from "@/lib/viz/runner";

export const pythonWorker = () => new Worker(new URL("./python.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
export const cppWorker = () => new Worker(new URL("./cpp.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
