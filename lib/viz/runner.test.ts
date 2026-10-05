import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunner, type WorkerReply, type WorkerRequest } from "@/lib/viz/runner";

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: { data: WorkerReply }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;
  requests: WorkerRequest[] = [];
  terminated = false;
  constructor() { FakeWorker.all.push(this); }
  postMessage(request: WorkerRequest) { this.requests.push(request); }
  terminate() { this.terminated = true; }
  reply(data: WorkerReply) { this.onmessage?.({ data }); }
}

afterEach(() => { FakeWorker.all = []; vi.useRealTimers(); });
const trace = { language: "python" as const, steps: [], stdout: "ok" };

describe("runner", () => {
  it("forwards phases, resolves with the trace and reuses the worker", async () => {
    const runner = createRunner("python", () => new FakeWorker());
    const phases: string[] = [];
    const pending = runner.run({ code: "x", stdin: "" }, (p) => phases.push(p));
    const worker = FakeWorker.all[0];
    worker.reply({ type: "phase", phase: "loading" });
    worker.reply({ type: "phase", phase: "running" });
    worker.reply({ type: "done", trace });
    expect(await pending).toEqual({ ok: true, trace });
    expect(phases).toEqual(["loading", "running"]);
    const second = runner.run({ code: "y", stdin: "" }, () => {});
    expect(FakeWorker.all).toHaveLength(1);
    worker.reply({ type: "done", trace });
    await second;
  });

  it("refuses a second run while one is active", async () => {
    const runner = createRunner("python", () => new FakeWorker());
    void runner.run({ code: "x", stdin: "" }, () => {});
    expect(await runner.run({ code: "y", stdin: "" }, () => {})).toEqual({ ok: false, message: "A run is already in progress." });
  });

  it("kills a worker that runs past the hard timeout and replaces it next time", async () => {
    vi.useFakeTimers();
    const runner = createRunner("cpp", () => new FakeWorker(), { loadMs: 1000, runMs: 500 });
    const pending = runner.run({ code: "x", stdin: "" }, () => {});
    FakeWorker.all[0].reply({ type: "phase", phase: "running" });
    vi.advanceTimersByTime(501);
    expect(await pending).toEqual({ ok: true, trace: { language: "cpp", steps: [], stdout: "", stopped: "time" } });
    expect(FakeWorker.all[0].terminated).toBe(true);
    void runner.run({ code: "y", stdin: "" }, () => {});
    expect(FakeWorker.all).toHaveLength(2);
  });

  it("reports load failures, worker errors and load timeouts", async () => {
    vi.useFakeTimers();
    const runner = createRunner("python", () => new FakeWorker(), { loadMs: 1000, runMs: 500 });
    const failed = runner.run({ code: "x", stdin: "" }, () => {});
    FakeWorker.all[0].reply({ type: "failed", message: "boom" });
    expect(await failed).toEqual({ ok: false, message: "boom" });
    const crashed = runner.run({ code: "x", stdin: "" }, () => {});
    FakeWorker.all[0].onerror?.({ message: "worker died" });
    expect(await crashed).toEqual({ ok: false, message: "worker died" });
    const slow = runner.run({ code: "x", stdin: "" }, () => {});
    vi.advanceTimersByTime(1001);
    expect(await slow).toEqual({ ok: false, message: "Couldn't load Python. Check the connection and run again." });
  });
});
