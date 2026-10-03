export type PresenceCounts = { editors: number; viewers: number };

// Presence is keyed by clientId; each key may hold several entries (e.g. after a rejoin).
export function countPresence(state: Record<string, Array<{ role?: unknown }>>, selfKey: string): PresenceCounts {
  const counts: PresenceCounts = { editors: 0, viewers: 0 };
  for (const [key, entries] of Object.entries(state)) {
    if (key === selfKey) continue;
    const role = entries[0]?.role;
    if (role === "editor") counts.editors += 1;
    else if (role === "viewer") counts.viewers += 1;
  }
  return counts;
}
