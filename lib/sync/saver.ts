export type SaveState = "saved" | "saving" | "retrying" | "failed" | "replaced";
export type PermanentSaveState = Extract<SaveState, "failed" | "replaced">;

// A failure that retrying cannot fix. `state` picks the status copy: "failed" = too large, "replaced" = editor link rotated.
export class PermanentSaveError extends Error {
  readonly permanent = true;
  constructor(message: string, readonly state: PermanentSaveState = "failed") {
    super(message);
  }
}

export const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export type FlushOptions = { keepalive?: boolean };
export type Saver = { notifyChange(): void; flushNow(options?: FlushOptions): Promise<void>; dispose(): void };

type Timer = ReturnType<typeof setTimeout> | null;

export function createSaver(options: {
  idleMs: number;
  maxWaitMs: number;
  // `keepalive` is true only for saves triggered while the page is being hidden or unloaded.
  save: (keepalive: boolean) => Promise<void>;
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
  let generation = 0;

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

  // Each save is a full scene, so a newer attempt supersedes an older one; a superseded attempt's outcome is ignored.
  function run(keepalive: boolean): Promise<void> {
    dirty = false;
    emit("saving");
    const id = ++generation;
    let attemptPromise: Promise<void>;
    try {
      attemptPromise = options.save(keepalive);
    } catch (error) {
      attemptPromise = Promise.reject(error);
    }
    const tracked: Promise<void> = attemptPromise.then(
      () => {
        if (id !== generation) return;
        inFlight = null;
        attempt = 0;
        backingOff = false;
        lastSucceeded = true;
        if (!dirty) emit("saved");
        else if (!disposed) schedule();
      },
      (error: unknown) => {
        if (id !== generation) return;
        inFlight = null;
        lastSucceeded = false;
        backingOff = true;
        dirty = true;
        clearTimers();
        const permanent = error as { permanent?: boolean; state?: PermanentSaveState } | null;
        if (permanent?.permanent) {
          attempt = 0;
          emit(permanent.state ?? "failed");
          return;
        }
        emit("retrying");
        const delay = backoff[Math.min(attempt, backoff.length - 1)];
        attempt += 1;
        if (!disposed) retryTimer = setTimeout(() => void trigger(), delay);
      },
    );
    inFlight = tracked;
    return tracked;
  }

  function trigger(keepalive = false): Promise<void> {
    if (disposed) return Promise.resolve();
    clearTimers();
    if (inFlight) {
      // Page is going away: do not wait for the in-flight request (it may be aborted);
      // send the newest full scene now with keepalive so it lands last.
      if (keepalive) return run(true);
      return inFlight.then(() => (lastSucceeded && dirty ? trigger() : undefined));
    }
    if (!dirty) return Promise.resolve();
    return run(keepalive);
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
    flushNow: (flushOptions) => trigger(flushOptions?.keepalive ?? false),
    dispose() {
      disposed = true;
      clearTimers();
    },
  };
}
