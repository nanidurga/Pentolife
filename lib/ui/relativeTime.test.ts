import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

const now = new Date("2026-10-05T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("says just now under a minute", () => {
    expect(relativeTime(ago(30_000), now)).toBe("just now");
  });

  it("uses minutes, hours and days", () => {
    expect(relativeTime(ago(5 * MIN), now)).toBe("5 minutes ago");
    expect(relativeTime(ago(3 * HOUR), now)).toBe("3 hours ago");
    expect(relativeTime(ago(DAY), now)).toBe("yesterday");
    expect(relativeTime(ago(2 * DAY), now)).toBe("2 days ago");
  });

  it("falls back to a date after 30 days", () => {
    expect(relativeTime(new Date("2026-08-21T12:00:00Z"), now)).toBe("Aug 21, 2026");
  });

  it("treats future timestamps (clock skew) as just now", () => {
    expect(relativeTime(new Date(now.getTime() + 5 * MIN), now)).toBe("just now");
  });
});
