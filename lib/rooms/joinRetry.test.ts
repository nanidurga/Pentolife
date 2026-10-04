import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JoinResult } from "./api";
import { createJoinRetry } from "./joinRetry";

const ok: JoinResult = { ok: true, snapshot: { elements: [] } };
const offline: JoinResult = { ok: false, reason: "offline" };
const invalid: JoinResult = { ok: false, reason: "invalid" };

describe("createJoinRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (join: () => Promise<JoinResult>) => {
    const onJoined = vi.fn();
    const onInvalid = vi.fn();
    const onOffline = vi.fn();
    const retry = createJoinRetry({ join, onJoined, onInvalid, onOffline });
    return { retry, join, onJoined, onInvalid, onOffline };
  };

  it("is not joined until a join succeeds (saving stays gated)", async () => {
    const { retry, onJoined } = setup(vi.fn(async () => ok));
    expect(retry.joined).toBe(false);
    retry.start();
    expect(retry.joined).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(retry.joined).toBe(true);
    expect(onJoined).toHaveBeenCalledWith(ok, { firstAttempt: true });
  });

  it("does not retry an invalid link", async () => {
    const { retry, join, onInvalid, onJoined } = setup(vi.fn(async () => invalid));
    retry.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(join).toHaveBeenCalledTimes(1);
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(onJoined).not.toHaveBeenCalled();
    expect(retry.joined).toBe(false);
  });

  it("retries an offline failure with the save backoff schedule", async () => {
    const join = vi.fn<() => Promise<JoinResult>>(async () => offline);
    const { retry, onOffline } = setup(join);
    retry.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(join).toHaveBeenCalledTimes(1);
    expect(onOffline).toHaveBeenCalledWith({ firstAttempt: true });
    const calls: number[] = [];
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      calls.push(join.mock.calls.length);
      await vi.advanceTimersByTimeAsync(1);
      calls.push(join.mock.calls.length);
    }
    expect(calls).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8]);
    expect(onOffline).toHaveBeenLastCalledWith({ firstAttempt: false });
    expect(retry.joined).toBe(false);
  });

  it("stops retrying once a retry succeeds", async () => {
    const join = vi.fn<() => Promise<JoinResult>>().mockResolvedValueOnce(offline).mockResolvedValue(ok);
    const { retry, onJoined } = setup(join);
    retry.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(join).toHaveBeenCalledTimes(2);
    expect(onJoined).toHaveBeenCalledWith(ok, { firstAttempt: false });
    expect(retry.joined).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(join).toHaveBeenCalledTimes(2);
  });

  it("an invalid result on a retry stops retrying", async () => {
    const join = vi.fn<() => Promise<JoinResult>>().mockResolvedValueOnce(offline).mockResolvedValue(invalid);
    const { retry, onInvalid } = setup(join);
    retry.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onInvalid).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(join).toHaveBeenCalledTimes(2);
  });

  it("treats a thrown join as offline", async () => {
    const join = vi.fn<() => Promise<JoinResult>>().mockRejectedValueOnce(new Error("net")).mockResolvedValue(ok);
    const { retry, onOffline } = setup(join);
    retry.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onOffline).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(retry.joined).toBe(true);
  });

  it("retryNow (window online) skips the wait and resets the backoff", async () => {
    const join = vi.fn<() => Promise<JoinResult>>(async () => offline);
    const { retry } = setup(join);
    retry.start();
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    expect(join).toHaveBeenCalledTimes(4);
    retry.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(join).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(999);
    expect(join).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(join).toHaveBeenCalledTimes(6);
  });

  it("retryNow does nothing while a join is in flight, after joining, or before start", async () => {
    let resolve!: (result: JoinResult) => void;
    const join = vi.fn(() => new Promise<JoinResult>((r) => { resolve = r; }));
    const { retry } = setup(join);
    retry.retryNow();
    expect(join).not.toHaveBeenCalled();
    retry.start();
    retry.retryNow();
    expect(join).toHaveBeenCalledTimes(1);
    resolve(ok);
    await vi.advanceTimersByTimeAsync(0);
    retry.retryNow();
    expect(join).toHaveBeenCalledTimes(1);
  });

  it("dispose stops retries and ignores an in-flight result", async () => {
    let resolve!: (result: JoinResult) => void;
    const join = vi.fn<() => Promise<JoinResult>>()
      .mockResolvedValueOnce(offline)
      .mockImplementationOnce(() => new Promise<JoinResult>((r) => { resolve = r; }));
    const { retry, onJoined } = setup(join);
    retry.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(join).toHaveBeenCalledTimes(2);
    retry.dispose();
    resolve(ok);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onJoined).not.toHaveBeenCalled();
    expect(retry.joined).toBe(false);
    retry.retryNow();
    expect(join).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels a scheduled retry", async () => {
    const join = vi.fn<() => Promise<JoinResult>>(async () => offline);
    const { retry } = setup(join);
    retry.start();
    await vi.advanceTimersByTimeAsync(0);
    retry.dispose();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(join).toHaveBeenCalledTimes(1);
  });
});
