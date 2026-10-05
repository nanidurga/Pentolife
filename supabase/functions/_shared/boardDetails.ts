// Shared by the Next.js app (via lib/rooms/details.ts) and the `rooms` Edge Function.
export const DEFAULT_TITLE = "Untitled whiteboard";
export const DETAIL_LIMITS = { title: 80, role: 60, company: 60 } as const;

export type DetailField = keyof typeof DETAIL_LIMITS;
export type BoardDetails = { title: string; role: string | null; company: string | null };
export type DetailsResult = { ok: true; details: BoardDetails } | { ok: false; field: DetailField; message: string };

const LABELS: Record<DetailField, string> = { title: "Name", role: "Role", company: "Company" };
// Tabs and newlines are already collapsed to spaces by cleanText, so anything left here is rejected.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeDetails(input: Partial<Record<DetailField, unknown>>): DetailsResult {
  const cleaned: Record<DetailField, string> = { title: "", role: "", company: "" };
  for (const field of ["title", "role", "company"] as const) {
    const raw = input[field] ?? "";
    if (typeof raw !== "string") return { ok: false, field, message: `${LABELS[field]} must be text.` };
    const value = cleanText(raw);
    if (CONTROL_CHARS.test(value)) return { ok: false, field, message: `${LABELS[field]} contains characters that aren't allowed.` };
    if ([...value].length > DETAIL_LIMITS[field]) {
      return { ok: false, field, message: `${LABELS[field]} can be at most ${DETAIL_LIMITS[field]} characters.` };
    }
    cleaned[field] = value;
  }
  return { ok: true, details: { title: cleaned.title || DEFAULT_TITLE, role: cleaned.role || null, company: cleaned.company || null } };
}
