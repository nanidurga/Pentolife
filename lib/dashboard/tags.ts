import { cleanText } from "@/lib/rooms/details";

export type TagField = "role" | "company";
export type TaggedBoard = { role: string | null; company: string | null; created_at: string };
export type TagOption = { key: string; label: string; count: number };
export type Suggestion = { kind: "existing"; option: TagOption } | { kind: "new"; label: string };

type Spelling = { count: number; latest: number };

// Values that differ only in case or spacing are the same tag.
export function tagKey(value: string) {
  return cleanText(value).toLowerCase();
}

export function tagOptions(boards: TaggedBoard[], field: TagField): TagOption[] {
  const groups = new Map<string, Map<string, Spelling>>();
  for (const board of boards) {
    const label = cleanText(board[field] ?? "");
    if (!label) continue;
    const key = label.toLowerCase();
    const spellings = groups.get(key) ?? new Map<string, Spelling>();
    groups.set(key, spellings);
    const seen = spellings.get(label) ?? { count: 0, latest: -Infinity };
    spellings.set(label, { count: seen.count + 1, latest: Math.max(seen.latest, Date.parse(board.created_at)) });
  }
  const options = [...groups].map(([key, spellings]) => {
    let best: [string, Spelling] | null = null;
    let count = 0;
    for (const entry of spellings) {
      count += entry[1].count;
      const better = !best || entry[1].count > best[1].count || (entry[1].count === best[1].count && entry[1].latest > best[1].latest);
      if (better) best = entry;
    }
    return { key, label: best ? best[0] : key, count };
  });
  return options.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

export function suggest(options: TagOption[], typed: string, limit = 6): Suggestion[] {
  const key = tagKey(typed);
  const prefix = options.filter((option) => option.key.startsWith(key));
  const contains = key ? options.filter((option) => !option.key.startsWith(key) && option.key.includes(key)) : [];
  const items: Suggestion[] = [...prefix, ...contains].slice(0, limit).map((option) => ({ kind: "existing", option }));
  if (key && !options.some((option) => option.key === key)) items.push({ kind: "new", label: cleanText(typed) });
  return items;
}

// The list opens only when something matches: a lone "Use …" row would just cover the dialog's buttons.
export function listSuggestions(options: TagOption[], typed: string, limit = 6): Suggestion[] {
  const items = suggest(options, typed, limit);
  return items.some((item) => item.kind === "existing") ? items : [];
}
