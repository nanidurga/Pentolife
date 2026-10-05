import { describe, expect, it } from "vitest";
import { listSuggestions, suggest, tagKey, tagOptions } from "@/lib/dashboard/tags";

const board = (role: string | null, company: string | null, created_at: string) => ({ role, company, created_at });

describe("tagKey", () => {
  it("folds case and spacing", () => {
    expect(tagKey("  Backend   SDE II ")).toBe("backend sde ii");
  });
});

describe("tagOptions", () => {
  const boards = [
    board("Backend SDE II", "Razorpay", "2026-09-01T10:00:00Z"),
    board("backend  sde ii", "razorpay", "2026-09-03T10:00:00Z"),
    board("Backend SDE II", "Swiggy", "2026-09-02T10:00:00Z"),
    board(null, "RAZORPAY", "2026-09-04T10:00:00Z"),
    board("  ", null, "2026-09-05T10:00:00Z"),
  ];

  it("groups by key, labels with the most common spelling, ignores empty values", () => {
    expect(tagOptions(boards, "role")).toEqual([{ key: "backend sde ii", label: "Backend SDE II", count: 3 }]);
  });

  it("breaks spelling ties by the most recently created board, and orders by count", () => {
    expect(tagOptions(boards, "company")).toEqual([
      { key: "razorpay", label: "RAZORPAY", count: 3 },
      { key: "swiggy", label: "Swiggy", count: 1 },
    ]);
  });

  it("orders equal counts alphabetically, ignoring case", () => {
    const tied = [board("b", null, "2026-09-01T00:00:00Z"), board("A", null, "2026-09-01T00:00:00Z")];
    expect(tagOptions(tied, "role").map((option) => option.label)).toEqual(["A", "b"]);
  });

  it("returns nothing for boards without tags", () => {
    expect(tagOptions([board(null, null, "2026-09-01T00:00:00Z")], "company")).toEqual([]);
  });
});

describe("suggest", () => {
  const options = [
    { key: "razorpay", label: "Razorpay", count: 6 },
    { key: "zepto", label: "Zepto", count: 3 },
    { key: "rapido", label: "Rapido", count: 1 },
    { key: "amazon", label: "Amazon", count: 1 },
  ];

  it("lists options up to the limit for empty input, with no new row", () => {
    expect(suggest(options, "")).toEqual(options.map((option) => ({ kind: "existing", option })));
    expect(suggest(options, "  ", 2)).toHaveLength(2);
  });

  it("puts prefix matches before substring matches, then offers the typed value", () => {
    expect(suggest(options, " A")).toEqual([
      { kind: "existing", option: options[3] },
      { kind: "existing", option: options[0] },
      { kind: "existing", option: options[2] },
      { kind: "new", label: "A" },
    ]);
  });

  it("offers no new row when the typed value already exists", () => {
    expect(suggest(options, "  RAZORPAY ")).toEqual([{ kind: "existing", option: options[0] }]);
  });

  it("caps existing rows at the limit but keeps the new row", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ key: `team ${index}`, label: `Team ${index}`, count: 1 }));
    const result = suggest(many, "team");
    expect(result.filter((item) => item.kind === "existing")).toHaveLength(6);
    expect(result.at(-1)).toEqual({ kind: "new", label: "team" });
  });
});

describe("listSuggestions", () => {
  const options = [{ key: "razorpay", label: "Razorpay", count: 6 }];

  it("shows nothing when the only row would repeat what was typed", () => {
    expect(listSuggestions(options, "zepto")).toEqual([]);
    expect(listSuggestions([], "anything")).toEqual([]);
  });

  it("shows matches, with the new row, when something matches", () => {
    expect(listSuggestions(options, "ra")).toEqual(suggest(options, "ra"));
  });
});
