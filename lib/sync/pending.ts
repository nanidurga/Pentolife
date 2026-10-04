import type { SyncElement } from "./types";

export type PendingSet<T extends SyncElement> = {
  add(elements: readonly T[]): void;
  take(): T[];
  restore(elements: readonly T[]): void;
  readonly size: number;
};

export function createPendingSet<T extends SyncElement>(): PendingSet<T> {
  const items = new Map<string, T>();
  const put = (element: T) => {
    const current = items.get(element.id);
    if (!current || element.version >= current.version) items.set(element.id, element);
  };
  return {
    add(elements) { elements.forEach(put); },
    take() {
      const batch = [...items.values()];
      items.clear();
      return batch;
    },
    // Anything added since the batch was taken is newer, so it wins.
    restore(elements) {
      for (const element of elements) if (!items.has(element.id)) items.set(element.id, element);
    },
    get size() { return items.size; },
  };
}
