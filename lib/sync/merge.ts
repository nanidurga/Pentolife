import type { SyncElement } from "./types";

// Excalidraw's rule: higher version wins; on a tie, the lower versionNonce wins.
export function isNewer(candidate: SyncElement, current: SyncElement) {
  return candidate.version > current.version
    || (candidate.version === current.version && candidate.versionNonce < current.versionNonce);
}

export function mergeByVersion<T extends SyncElement>(
  local: readonly T[],
  remote: readonly T[],
  protectedIds: ReadonlySet<string> = new Set(),
): T[] {
  const byId = new Map<string, T>();
  const order: string[] = [];
  for (const element of local) {
    if (!byId.has(element.id)) order.push(element.id);
    byId.set(element.id, element);
  }
  for (const incoming of remote) {
    const current = byId.get(incoming.id);
    if (!current) {
      byId.set(incoming.id, incoming);
      order.push(incoming.id);
    } else if (!protectedIds.has(incoming.id) && isNewer(incoming, current)) {
      byId.set(incoming.id, incoming);
    }
  }
  return sortByIndex(order.map((id) => byId.get(id)!));
}

// Excalidraw 0.18 gives every element a fractional `index` string that sorts lexicographically.
// Elements without one keep their relative position.
function sortByIndex<T extends SyncElement>(elements: T[]): T[] {
  return elements
    .map((element, position) => ({ element, position }))
    .sort((a, b) => {
      const ai = a.element.index;
      const bi = b.element.index;
      if (ai && bi && ai !== bi) return ai < bi ? -1 : 1;
      return a.position - b.position;
    })
    .map(({ element }) => element);
}
