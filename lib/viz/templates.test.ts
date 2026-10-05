import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/lib/viz/templates";

describe("templates", () => {
  it("has the same 8 programs in each language, with unique ids", () => {
    for (const language of ["python", "cpp"] as const) {
      expect(TEMPLATES[language]).toHaveLength(8);
      expect(new Set(TEMPLATES[language].map((t) => t.id)).size).toBe(8);
    }
    expect(TEMPLATES.python.slice(0, 7).map((t) => t.id)).toEqual(TEMPLATES.cpp.slice(0, 7).map((t) => t.id));
  });
});
