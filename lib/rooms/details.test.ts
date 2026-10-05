import { describe, expect, it } from "vitest";
import { cleanText, DEFAULT_TITLE, normalizeDetails } from "@/lib/rooms/details";

describe("cleanText", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanText("  LRU   cache\n\tfollow-ups ")).toBe("LRU cache follow-ups");
  });
});

describe("normalizeDetails", () => {
  it("cleans every field", () => {
    expect(normalizeDetails({ title: "  LRU   cache ", role: " Backend\tSDE II ", company: "Razorpay " }))
      .toEqual({ ok: true, details: { title: "LRU cache", role: "Backend SDE II", company: "Razorpay" } });
  });

  it("defaults an empty title and nulls empty tags", () => {
    const empty = { ok: true, details: { title: DEFAULT_TITLE, role: null, company: null } };
    expect(normalizeDetails({ title: "   ", role: "", company: null })).toEqual(empty);
    expect(normalizeDetails({})).toEqual(empty);
  });

  it("accepts values at the limit and rejects one over", () => {
    expect(normalizeDetails({ title: "a".repeat(80), role: "r".repeat(60), company: "c".repeat(60) }).ok).toBe(true);
    expect(normalizeDetails({ title: "a".repeat(81) })).toEqual({ ok: false, field: "title", message: "Name can be at most 80 characters." });
    expect(normalizeDetails({ role: "r".repeat(61) })).toEqual({ ok: false, field: "role", message: "Role can be at most 60 characters." });
    expect(normalizeDetails({ company: "c".repeat(61) })).toEqual({ ok: false, field: "company", message: "Company can be at most 60 characters." });
  });

  it("measures length after cleaning, in characters", () => {
    expect(normalizeDetails({ title: `  ${"a".repeat(80)}  ` }).ok).toBe(true);
    expect(normalizeDetails({ company: "😀".repeat(60) }).ok).toBe(true);
  });

  it("rejects control characters and non-text values", () => {
    expect(normalizeDetails({ role: "Back\u0000end" })).toEqual({ ok: false, field: "role", message: "Role contains characters that aren't allowed." });
    expect(normalizeDetails({ title: 42 })).toEqual({ ok: false, field: "title", message: "Name must be text." });
  });
});
