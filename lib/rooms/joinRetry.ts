import type { JoinResult } from "./api";
import { DEFAULT_BACKOFF_MS } from "@/lib/sync/saver";

type Joined = Extract<JoinResult, { ok: true }>;
type AttemptInfo = { firstAttempt: boolean };

export type JoinRetry = {
  /** True only after a join succeeded. Saving must stay gated on this. */
  readonly joined: boolean;
  start(): void;
  /** Retry immediately (e.g. on window `online`); resets the backoff. No-op while joining, joined or stopped. */
  retryNow(): void;
  dispose(): void;
};

// Joins a room, retrying "offline" failures with the save backoff schedule.
// "invalid" is permanent (bad or expired link) and is never retried.
export function createJoinRetry(options: {
  join: () => Promise<JoinResult>;
  onJoined: (result: Joined, info: AttemptInfo) => void;
  onInvalid: () => void;
  onOffline?: (info: AttemptInfo) => void;
  backoffMs?: number[];
}): JoinRetry {
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  let started = false;
  let stopped = false;
  let joined = false;
  let inFlight = false;
  let attempts = 0;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const attempt = () => {
    if (stopped || joined || inFlight) return;
    clearTimer();
    inFlight = true;
    const info = { firstAttempt: attempts === 0 };
    attempts += 1;
    let pending: Promise<JoinResult>;
    try {
      pending = options.join();
    } catch (error) {
      pending = Promise.reject(error);
    }
    void pending
      .catch((): JoinResult => ({ ok: false, reason: "offline" }))
      .then((result) => {
        inFlight = false;
        if (stopped) return;
        if (result.ok) {
          joined = true;
          options.onJoined(result, info);
          return;
        }
        if (result.reason === "invalid") {
          stopped = true;
          options.onInvalid();
          return;
        }
        options.onOffline?.(info);
        if (stopped) return;
        const delay = backoff[Math.min(failures, backoff.length - 1)];
        failures += 1;
        timer = setTimeout(attempt, delay);
      });
  };

  return {
    get joined() { return joined; },
    start() {
      if (started) return;
      started = true;
      attempt();
    },
    retryNow() {
      if (!started || stopped || joined || inFlight) return;
      failures = 0;
      attempt();
    },
    dispose() {
      stopped = true;
      clearTimer();
    },
  };
}
