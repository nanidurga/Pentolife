import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaver, PermanentSaveError, type SaveState } from "./saver";

describe("createSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (save = vi.fn(async () => {})) => {
    const states: SaveState[] = [];
    const saver = createSaver({ idleMs: 2000, maxWaitMs: 10_000, save, onState: (s) => states.push(s) });
    return { saver, save, states };
  };

  it("saves once after the idle period following rapid changes", async () => {
    const { saver, save } = setup();
    saver.notifyChange(); saver.notifyChange(); saver.notifyChange();
    await vi.advanceTimersByTimeAsync(1999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves at the max wait during continuous drawing", async () => {
    const { saver, save } = setup();
    for (let t = 0; t < 10_000; t += 500) { saver.notifyChange(); await vi.advanceTimersByTimeAsync(500); }
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flushNow saves immediately, and does nothing when clean", async () => {
    const { saver, save } = setup();
    await saver.flushNow();
    expect(save).not.toHaveBeenCalled();
    saver.notifyChange();
    await saver.flushNow();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("reports saving then saved", async () => {
    const { saver, states } = setup();
    saver.notifyChange();
    await saver.flushNow();
    expect(states).toEqual(["saving", "saved"]);
  });

  it("retries failures with backoff", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("net")).mockRejectedValueOnce(new Error("net")).mockResolvedValue(undefined);
    const { saver, states } = setup(save);
    saver.notifyChange();
    await saver.flushNow();
    expect(states.at(-1)).toBe("retrying");
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toBe("saved");
  });

  it("does not retry a permanent failure (board too large)", async () => {
    const save = vi.fn().mockRejectedValue(new PermanentSaveError("too large"));
    const { saver, states } = setup(save);
    saver.notifyChange();
    await saver.flushNow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("failed");
  });

  it("saves again when changes arrive during an in-flight save", async () => {
    let finish!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { finish = r; })).mockResolvedValue(undefined);
    const { saver } = setup(save);
    saver.notifyChange();
    const first = saver.flushNow();
    saver.notifyChange();
    finish();
    await first;
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels pending saves", async () => {
    const { saver, save } = setup();
    saver.notifyChange();
    saver.dispose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(save).not.toHaveBeenCalled();
  });

  describe("backoff and failure handling", () => {
    it("changes do not shorten backoff", async () => {
      const save = vi.fn().mockRejectedValue(new Error("net"));
      const { saver } = setup(save);
      saver.notifyChange();
      await saver.flushNow();
      const counts: number[] = [];
      for (let t = 500; t <= 5000; t += 500) {
        await vi.advanceTimersByTimeAsync(500);
        saver.notifyChange();
        counts.push(save.mock.calls.length);
      }
      expect(counts).toEqual([1, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
    });

    it("a change during an in-flight failing save does not skip the retry delay", async () => {
      let fail!: (e: Error) => void;
      const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_, r) => { fail = r; })).mockResolvedValue(undefined);
      const { saver } = setup(save);
      saver.notifyChange();
      const first = saver.flushNow();
      saver.notifyChange();
      const second = saver.flushNow();
      fail(new Error("net"));
      await first;
      await second;
      await vi.advanceTimersByTimeAsync(999);
      expect(save).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledTimes(2);
    });

    it("after a permanent failure a change arms one retry at the backoff cap", async () => {
      const save = vi.fn().mockRejectedValue(new PermanentSaveError("too large"));
      const { saver } = setup(save);
      saver.notifyChange();
      await saver.flushNow();
      saver.notifyChange();
      saver.notifyChange();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(save).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(save).toHaveBeenCalledTimes(2);
    });

    it("a permanent failure during an in-flight save with a pending change does not re-save", async () => {
      let fail!: (e: Error) => void;
      const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_, r) => { fail = r; }));
      const { saver, states } = setup(save);
      saver.notifyChange();
      const first = saver.flushNow();
      saver.notifyChange();
      fail(new PermanentSaveError("too large"));
      await first;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(save).toHaveBeenCalledTimes(1);
      expect(states.at(-1)).toBe("failed");
    });

    it("treats a synchronous throw from save like a rejection", async () => {
      const save = vi.fn().mockImplementationOnce(() => { throw new Error("sync"); }).mockResolvedValue(undefined);
      const { saver, states } = setup(save);
      saver.notifyChange();
      await saver.flushNow();
      expect(states.at(-1)).toBe("retrying");
      await vi.advanceTimersByTimeAsync(1000);
      expect(save).toHaveBeenCalledTimes(2);
      expect(states.at(-1)).toBe("saved");
    });

    it("dispose with a retry pending stops saves and state reports", async () => {
      const save = vi.fn().mockRejectedValue(new Error("net"));
      const { saver, states } = setup(save);
      saver.notifyChange();
      await saver.flushNow();
      const stateCount = states.length;
      saver.dispose();
      await vi.advanceTimersByTimeAsync(60_000);
      await saver.flushNow();
      expect(save).toHaveBeenCalledTimes(1);
      expect(states).toHaveLength(stateCount);
    });
  });
});
