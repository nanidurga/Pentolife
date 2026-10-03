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
    clearTimers();
    if (inFlight) return inFlight.then(() => (dirty ? trigger() : undefined));
    if (!dirty || disposed) return Promise.resolve();
    dirty = false;
    options.onState?.("saving");
    inFlight = options.save().then(
      () => {
        inFlight = null;
        attempt = 0;
        if (!dirty) options.onState?.("saved");
      },
      (error: unknown) => {
        inFlight = null;
        dirty = true;
        if ((error as { permanent?: boolean } | null)?.permanent) {
          attempt = 0;
          options.onState?.("failed");
          return;
        }
        options.onState?.("retrying");
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
      schedule();
    },
    flushNow: () => trigger(),
    dispose() {
      disposed = true;
      clearTimers();
    },
  };
}
