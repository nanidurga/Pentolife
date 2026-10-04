import type { SyncElement } from "./types";

export function collectChanged<T extends SyncElement>(elements: readonly T[], sent: ReadonlyMap<string, number>): T[] {
  return elements.filter((element) => sent.get(element.id) !== element.version);
}

export function markSent(sent: Map<string, number>, elements: readonly SyncElement[]) {
  for (const element of elements) {
    const previous = sent.get(element.id);
    if (previous === undefined || element.version > previous) sent.set(element.id, element.version);
  }
}

export function unmarkSent(sent: Map<string, number>, elements: readonly SyncElement[]) {
  for (const element of elements) {
    if (sent.get(element.id) === element.version) sent.delete(element.id);
  }
}
