export type Flusher = { schedule(): void; flushNow(): void; cancel(): void };

// Leading + trailing throttle: at most one flush per interval; the caller's
// flush reads whatever is pending at that moment, so nothing is lost.
export function createFlusher({ intervalMs, flush }: { intervalMs: number; flush: () => void }): Flusher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = -Infinity;
  const run = () => {
    timer = null;
    last = Date.now();
    flush();
  };
  return {
    schedule() {
      if (timer !== null) return;
      timer = setTimeout(run, Math.max(0, last + intervalMs - Date.now()));
    },
    flushNow() {
      if (timer !== null) clearTimeout(timer);
      run();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
