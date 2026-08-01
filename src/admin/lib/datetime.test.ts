import { describe, expect, it } from "vitest";
import { formatDateTime } from "./datetime.js";

describe("formatDateTime (D433)", () => {
  it("distinguishes two same-day timestamps (keeps the time component)", () => {
    const morning = formatDateTime("2026-05-18T09:00:00Z");
    const evening = formatDateTime("2026-05-18T17:00:00Z");
    // The whole point of D433: a date-only format collapses these into one
    // string; a date+time format keeps them distinct.
    expect(morning).not.toBe(evening);
    expect(morning.length).toBeGreaterThan(0);
  });

  it("returns empty string for an unparseable value", () => {
    expect(formatDateTime("not-a-date")).toBe("");
  });
});
