import { describe, expect, it } from "vitest";
import { defaultDrafts, readVizBackup, vizBackupKey, writeVizBackup } from "@/lib/viz/backup";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe("viz backup", () => {
  it("round-trips per room", () => {
    const storage = memory();
    const backup = { language: "cpp" as const, drafts: { ...defaultDrafts(), cpp: { code: "int main(){}", stdin: "1" } } };
    writeVizBackup(storage, "r1", backup);
    expect(storage.data.has(vizBackupKey("r1"))).toBe(true);
    expect(readVizBackup(storage, "r1")).toEqual(backup);
    expect(readVizBackup(storage, "r2")).toBeNull();
  });

  it("ignores broken or foreign data and storage errors", () => {
    const storage = memory();
    storage.setItem(vizBackupKey("r"), "{not json");
    expect(readVizBackup(storage, "r")).toBeNull();
    storage.setItem(vizBackupKey("r"), JSON.stringify({ language: "java", drafts: {} }));
    expect(readVizBackup(storage, "r")).toBeNull();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(readVizBackup(throwing, "r")).toBeNull();
    expect(() => writeVizBackup(throwing, "r", { language: "python", drafts: defaultDrafts() })).not.toThrow();
  });

  it("starts each language on its first template", () => {
    const drafts = defaultDrafts();
    expect(drafts.python.code).toContain("def bubble_sort");
    expect(drafts.cpp.code).toContain("int main");
  });
});
