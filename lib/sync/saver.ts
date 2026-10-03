export type SaveState = "saved" | "saving" | "retrying" | "failed";

export class PermanentSaveError extends Error {
  readonly permanent = true;
}

export const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export type Saver = { notifyChange(): void; flushNow(): Promise<void>; dispose(): void };

type Timer = ReturnType<typeof setTimeout> | null;

export function createSaver(options: {
  idleMs: number;
  maxWaitMs: number;
  save: () => Promise<void>;
  onState?: (state: SaveState) => void;
  backoffMs?: number[];
}): Saver {
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  let idleTimer: Timer = null;
  let maxTimer: Timer = null;
  let retryTimer: Timer = null;
  let dirty = false;
  let disposed = false;
  let attempt = 0;
  let inFlight: Promise<void> | null = null;
  let backingOff = false;
  let lastSucceeded = true;

  const emit = (state: SaveState) => {
    if (!disposed) options.onState?.(state);
  };

  const clearTimers = () => {
    for (const timer of [idleTimer, maxTimer, retryTimer]) if (timer !== null) clearTimeout(timer);
    idleTimer = maxTimer = retryTimer = null;
  };

  const schedule = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void trigger(), options.idleMs);
    if (maxTimer === null) maxTimer = setTimeout(() => void trigger(), options.maxWaitMs);
  };

  function trigger(): Promise<void> {
    if (disposed) return Promise.resolve();
    clearTimers();
    if (inFlight) return inFlight.then(() => (lastSucceeded && dirty ? trigger() : undefined));
    if (!dirty) return Promise.resolve();
    dirty = false;
    emit("saving");
    let attemptPromise: Promise<void>;
    try {
      attemptPromise = options.save();
    } catch (error) {
      attemptPromise = Promise.reject(error);
    }
    inFlight = attemptPromise.then(
      () => {
        inFlight = null;
        attempt = 0;
        backingOff = false;
        lastSucceeded = true;
        if (!dirty) emit("saved");
        else if (!disposed) schedule();
      },
      (error: unknown) => {
        inFlight = null;
        lastSucceeded = false;
        backingOff = true;
        dirty = true;
        clearTimers();
        if ((error as { permanent?: boolean } | null)?.permanent) {
          attempt = 0;
          emit("failed");
          return;
        }
        emit("retrying");
        const delay = backoff[Math.min(attempt, backoff.length - 1)];
        attempt += 1;
        if (!disposed) retryTimer = setTimeout(() => void trigger(), delay);
      },
    );
    return inFlight;
  }

  return {
    notifyChange() {
      if (disposed) return;
      dirty = true;
      if (backingOff) {
        // Changes never shorten backoff. After a permanent failure no retry is pending,
        // so arm one at the backoff cap in case the board shrinks back under the limit.
        if (retryTimer === null && !inFlight) {
          retryTimer = setTimeout(() => void trigger(), backoff[backoff.length - 1]);
        }
        return;
      }
      schedule();
    },
    flushNow: () => trigger(),
    dispose() {
      disposed = true;
      clearTimers();
    },
  };
}
