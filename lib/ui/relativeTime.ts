const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(date: Date, now: Date) {
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return formatter.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return formatter.format(-Math.floor(elapsed / HOUR), "hour");
  if (elapsed < 30 * DAY) return formatter.format(-Math.floor(elapsed / DAY), "day");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
