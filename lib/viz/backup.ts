import type { Language } from "@/lib/viz/engines";
import { TEMPLATES } from "@/lib/viz/templates";

export type Drafts = Record<Language, { code: string; stdin: string }>;
export type VizBackup = { language: Language; drafts: Drafts };
type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export const vizBackupKey = (roomId: string) => `pentolive:viz:${roomId}`;

export function defaultDrafts(): Drafts {
  return { python: { code: TEMPLATES.python[0].code, stdin: "" }, cpp: { code: TEMPLATES.cpp[0].code, stdin: "" } };
}

const isDraft = (v: unknown): v is { code: string; stdin: string } =>
  !!v && typeof v === "object" && typeof (v as { code?: unknown }).code === "string" && typeof (v as { stdin?: unknown }).stdin === "string";

export function readVizBackup(storage: StorageLike | null, roomId: string): VizBackup | null {
  try {
    const raw = storage?.getItem(vizBackupKey(roomId));
    if (!raw) return null;
    const value = JSON.parse(raw) as { language?: unknown; drafts?: Record<string, unknown> };
    if ((value.language !== "python" && value.language !== "cpp") || !isDraft(value.drafts?.python) || !isDraft(value.drafts?.cpp)) return null;
    return { language: value.language, drafts: { python: value.drafts.python, cpp: value.drafts.cpp } };
  } catch {
    return null;
  }
}

export function writeVizBackup(storage: StorageLike | null, roomId: string, backup: VizBackup) {
  try {
    storage?.setItem(vizBackupKey(roomId), JSON.stringify(backup));
  } catch {
    // Storage full or blocked: the live session still works.
  }
}
