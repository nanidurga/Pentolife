import { describe, expect, it } from "vitest";
import {
  applyFilters, DEFAULT_FILTERS, filtersToParams, hasActiveFilters, parseFilters,
  type DashboardBoard, type Filters,
} from "@/lib/dashboard/filter";

// Builds timestamps in the test machine's local time zone, so day edges are tested in local time.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const board = (id: string, overrides: Partial<DashboardBoard> = {}): DashboardBoard => ({
  id, title: id, role: null, company: null, created_at: at(2026, 9, 15), updated_at: at(2026, 9, 15), ...overrides,
});
const ids = (list: DashboardBoard[]) => list.map((item) => item.id);

describe("parseFilters and filtersToParams", () => {
  it("parses a full query and folds tags to keys", () => {
    expect(parseFilters(new URLSearchParams("sort=name&from=2026-09-01&to=2026-09-30&role=Backend%20%20SDE%20II&company=razorpay")))
      .toEqual({ sort: "name", from: "2026-09-01", to: "2026-09-30", role: "backend sde ii", company: "razorpay" });
  });

  it("ignores malformed values", () => {
    expect(parseFilters(new URLSearchParams("sort=random&from=2026-02-30&to=yesterday&role=%20%20"))).toEqual(DEFAULT_FILTERS);
  });

  it("swaps a reversed date range", () => {
    expect(parseFilters(new URLSearchParams("from=2026-10-05&to=2026-09-15"))).toMatchObject({ from: "2026-09-15", to: "2026-10-05" });
  });

  it("omits defaults and round-trips", () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("");
    const filters: Filters = { sort: "oldest", from: "2026-09-01", to: null, role: "backend sde ii", company: null };
    expect(parseFilters(filtersToParams(filters))).toEqual(filters);
  });

  it("does not count the sort as a filter", () => {
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, sort: "name" })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, company: "zepto" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, to: "2026-09-01" })).toBe(true);
  });
});

describe("applyFilters", () => {
  const boards = [
    board("a", { title: "beta", created_at: at(2026, 9, 1), updated_at: at(2026, 10, 4) }),
    board("b", { title: "Alpha", created_at: at(2026, 9, 20), updated_at: at(2026, 9, 21), role: "Backend SDE II", company: "Razorpay" }),
    board("c", { title: "gamma", created_at: at(2026, 10, 3), updated_at: at(2026, 10, 3), role: "backend  sde ii", company: "Zepto" }),
  ];

  it("sorts by each option", () => {
    expect(ids(applyFilters(boards, DEFAULT_FILTERS))).toEqual(["c", "b", "a"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, sort: "oldest" }))).toEqual(["a", "b", "c"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, sort: "edited" }))).toEqual(["a", "c", "b"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, sort: "name" }))).toEqual(["b", "a", "c"]);
  });

  it("includes whole local days at both ends of the range", () => {
    const edge = [
      board("start", { created_at: at(2026, 9, 20, 0, 0) }),
      board("end", { created_at: at(2026, 9, 21, 23, 59) }),
      board("before", { created_at: at(2026, 9, 19, 23, 59) }),
      board("after", { created_at: at(2026, 9, 22, 0, 0) }),
    ];
    expect(ids(applyFilters(edge, { ...DEFAULT_FILTERS, from: "2026-09-20", to: "2026-09-21" })).sort()).toEqual(["end", "start"]);
  });

  it("supports open-ended and reversed ranges", () => {
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, from: "2026-09-20" }))).toEqual(["c", "b"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, to: "2026-09-20" }))).toEqual(["b", "a"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, from: "2026-10-31", to: "2026-09-20" }))).toEqual(["c", "b"]);
  });

  it("matches role and company by key and leaves out untagged boards", () => {
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, role: "backend sde ii" }))).toEqual(["c", "b"]);
    expect(ids(applyFilters(boards, { ...DEFAULT_FILTERS, role: "backend sde ii", company: "razorpay" }))).toEqual(["b"]);
    expect(applyFilters(boards, { ...DEFAULT_FILTERS, company: "swiggy" })).toEqual([]);
  });

  it("does not reorder its input", () => {
    const before = ids(boards);
    applyFilters(boards, { ...DEFAULT_FILTERS, sort: "name" });
    expect(ids(boards)).toEqual(before);
  });
});
