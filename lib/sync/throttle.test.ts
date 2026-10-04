import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlusher } from "./throttle";

describe("createFlusher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flushes the first schedule right away (next tick)", () => {
    const flush = vi.fn();
    createFlusher({ intervalMs: 80, flush }).schedule();
    vi.advanceTimersByTime(0);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("collapses schedules within the interval into one trailing flush", () => {
    const flush = vi.fn();
    const flusher = createFlusher({ intervalMs: 80, flush });
    flusher.schedule();
    vi.advanceTimersByTime(0);
    for (let i = 0; i < 5; i++) { flusher.schedule(); vi.advanceTimersByTime(10); }
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(80);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("never flushes faster than the interval", () => {
    const flush = vi.fn();
    const flusher = createFlusher({ intervalMs: 80, flush });
    for (let t = 0; t < 800; t += 5) { flusher.schedule(); vi.advanceTimersByTime(5); }
    expect(flush.mock.calls.length).toBeLessThanOrEqual(11);
  });

  it("flushNow runs immediately and replaces a pending flush", () => {
    const flush = vi.fn();
    const flusher = createFlusher({ intervalMs: 80, flush });
    flusher.schedule();
    flusher.flushNow();
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("cancel drops a pending flush", () => {
    const flush = vi.fn();
    const flusher = createFlusher({ intervalMs: 80, flush });
    flusher.schedule();
    flusher.cancel();
    vi.advanceTimersByTime(200);
    expect(flush).not.toHaveBeenCalled();
  });
});
