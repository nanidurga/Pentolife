import { tagKey } from "@/lib/dashboard/tags";

export const SORTS = ["newest", "oldest", "edited", "name"] as const;
export type Sort = (typeof SORTS)[number];
// role and company hold tag keys (see tagKey), not display labels.
export type Filters = { sort: Sort; from: string | null; to: string | null; role: string | null; company: string | null };
export type DashboardBoard = { id: string; title: string; role: string | null; company: string | null; created_at: string; updated_at: string };

export const DEFAULT_FILTERS: Filters = { sort: "newest", from: null, to: null, role: null, company: null };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// Start of a YYYY-MM-DD day (plus offsetDays) in the viewer's time zone, or null when the date is not real.
function localDay(value: string | null, offsetDays = 0): number | null {
  const match = value ? DAY.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
  return new Date(year, month - 1, day + offsetDays).getTime();
}

const validDay = (value: string | null) => (localDay(value) === null ? null : value);
const ordered = (from: string | null, to: string | null): [string | null, string | null] => (from && to && from > to ? [to, from] : [from, to]);
const tagParam = (value: string | null) => (value ? tagKey(value) : "") || null;

export function parseFilters(params: URLSearchParams): Filters {
  const sort = params.get("sort") ?? "";
  const [from, to] = ordered(validDay(params.get("from")), validDay(params.get("to")));
  return {
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as Sort) : DEFAULT_FILTERS.sort,
    from,
    to,
    role: tagParam(params.get("role")),
    company: tagParam(params.get("company")),
  };
}

export function filtersToParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);
  for (const name of ["from", "to", "role", "company"] as const) {
    const value = filters[name];
    if (value) params.set(name, value);
  }
  return params;
}

export function hasActiveFilters(filters: Filters) {
  return Boolean(filters.from || filters.to || filters.role || filters.company);
}

const newestFirst = (field: "created_at" | "updated_at") => (a: DashboardBoard, b: DashboardBoard) => Date.parse(b[field]) - Date.parse(a[field]);

const COMPARE: Record<Sort, (a: DashboardBoard, b: DashboardBoard) => number> = {
  newest: newestFirst("created_at"),
  oldest: (a, b) => newestFirst("created_at")(b, a),
  edited: newestFirst("updated_at"),
  name: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
};

export function applyFilters(boards: DashboardBoard[], filters: Filters): DashboardBoard[] {
  const [from, to] = ordered(filters.from, filters.to);
  const start = localDay(from) ?? -Infinity;
  const end = localDay(to, 1) ?? Infinity;
  const matches = (value: string | null, key: string | null) => !key || (value !== null && tagKey(value) === key);
  return boards
    .filter((board) => {
      const created = Date.parse(board.created_at);
      return created >= start && created < end && matches(board.role, filters.role) && matches(board.company, filters.company);
    })
    .sort(COMPARE[filters.sort]);
}
