import { VIZ_COPY } from "@/lib/viz/copy";
import { LIMITS, type Language } from "@/lib/viz/engines";
import { capTrace, type Trace } from "@/lib/viz/trace";

export type RunPhase = "loading" | "compiling" | "running";
export type WorkerRequest = { code: string; stdin: string };
export type WorkerReply = { type: "phase"; phase: RunPhase } | { type: "done"; trace: Trace } | { type: "failed"; message: string };
export type RunResult = { ok: true; trace: Trace } | { ok: false; message: string };
export type WorkerLike = {
  postMessage(request: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerReply }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
};
export type Runner = { run(request: WorkerRequest, onPhase: (phase: RunPhase) => void): Promise<RunResult>; dispose(): void };

// The engines stop themselves at LIMITS.runTimeoutMs; this hard limit only catches code the engines can't interrupt.
const DEFAULT_TIMING = { loadMs: 180_000, runMs: LIMITS.runTimeoutMs + 5_000 };

export function createRunner(language: Language, factory: () => WorkerLike, timing = DEFAULT_TIMING): Runner {
  let worker: WorkerLike | null = null;
  let active: ((result: RunResult) => void) | null = null;
  const kill = () => { worker?.terminate(); worker = null; };

  return {
    run(request, onPhase) {
      if (active) return Promise.resolve({ ok: false, message: VIZ_COPY.busy });
      const current = (worker ??= factory());
      return new Promise<RunResult>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const finish = (result: RunResult) => {
          clearTimeout(timer);
          active = null;
          current.onmessage = null;
          current.onerror = null;
          resolve(result);
        };
        timer = setTimeout(() => { kill(); finish({ ok: false, message: VIZ_COPY.loadFailed[language] }); }, timing.loadMs);
        active = finish;
        current.onmessage = ({ data }) => {
          if (data.type === "phase") {
            onPhase(data.phase);
            if (data.phase === "running") {
              clearTimeout(timer);
              timer = setTimeout(() => { kill(); finish({ ok: true, trace: { language, steps: [], stdout: "", stopped: "time" } }); }, timing.runMs);
            }
          } else if (data.type === "done") finish({ ok: true, trace: capTrace(data.trace) });
          else finish({ ok: false, message: data.message });
        };
        current.onerror = (event) => { kill(); finish({ ok: false, message: event.message || VIZ_COPY.loadFailed[language] }); };
        current.postMessage(request);
      });
    },
    dispose() {
      kill();
      active?.({ ok: false, message: VIZ_COPY.busy });
    },
  };
}
