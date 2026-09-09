import { describe, it, expect } from "vitest";
import { dateRangeArray, MAX_RANGE_DAYS } from "./monthlySummary";

describe("dateRangeArray", () => {
  it("returns every date inclusive, from and to", () => {
    expect(dateRangeArray("2026-09-05", "2026-09-08")).toEqual([
      "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08",
    ]);
  });

  it("a single-day range returns just that day", () => {
    expect(dateRangeArray("2026-09-05", "2026-09-05")).toEqual(["2026-09-05"]);
  });

  it("spans a month/year boundary correctly", () => {
    expect(dateRangeArray("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02",
    ]);
  });

  it("returns null when to is before from", () => {
    expect(dateRangeArray("2026-09-08", "2026-09-05")).toBeNull();
  });

  it("returns null for a garbage date", () => {
    expect(dateRangeArray("not-a-date", "2026-09-05")).toBeNull();
  });

  it("returns null for a range longer than MAX_RANGE_DAYS", () => {
    const from = "2026-01-01";
    const tooFarOut = new Date(`${from}T00:00:00Z`);
    tooFarOut.setUTCDate(tooFarOut.getUTCDate() + MAX_RANGE_DAYS + 5);
    expect(dateRangeArray(from, tooFarOut.toISOString().slice(0, 10))).toBeNull();
  });

  it("accepts a range exactly at the cap", () => {
    const from = "2026-01-01";
    const atCap = new Date(`${from}T00:00:00Z`);
    atCap.setUTCDate(atCap.getUTCDate() + MAX_RANGE_DAYS - 1);
    const result = dateRangeArray(from, atCap.toISOString().slice(0, 10));
    expect(result).not.toBeNull();
    expect(result).toHaveLength(MAX_RANGE_DAYS);
  });
});
