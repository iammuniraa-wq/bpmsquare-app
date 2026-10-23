import { describe, expect, it } from "vitest";
import { isWorkableCaseStatus, normaliseScheduledFor, resolveWorkOrderAuth } from "./workOrderFromCase";

describe("resolveWorkOrderAuth", () => {
  it("uses the quote for an ordinary case", () => {
    expect(resolveWorkOrderAuth({ type: "adhoc", quote_id: "q1", contract_id: "c1" })).toEqual({ kind: "quote", id: "q1" });
  });
  it("prefers the contract for an AMC case", () => {
    expect(resolveWorkOrderAuth({ type: "amc", quote_id: "q1", contract_id: "c1" })).toEqual({ kind: "contract", id: "c1" });
  });
  it("falls back to whichever one exists", () => {
    expect(resolveWorkOrderAuth({ type: "amc", quote_id: "q1", contract_id: null })).toEqual({ kind: "quote", id: "q1" });
    expect(resolveWorkOrderAuth({ type: "direct", quote_id: null, contract_id: "c1" })).toEqual({ kind: "contract", id: "c1" });
  });
  it("returns null when the case has neither (auth_id is NOT NULL, so nothing may be invented)", () => {
    expect(resolveWorkOrderAuth({ type: "adhoc", quote_id: null, contract_id: null })).toBeNull();
    expect(resolveWorkOrderAuth({})).toBeNull();
  });
});

describe("isWorkableCaseStatus", () => {
  it("rejects finished cases only", () => {
    for (const s of ["closed", "scrapped", "buyback"]) expect(isWorkableCaseStatus(s)).toBe(false);
    for (const s of ["intake", "inspection", "quote_approved", "in_repair", "qa", "ready"]) expect(isWorkableCaseStatus(s)).toBe(true);
  });
});

describe("normaliseScheduledFor", () => {
  const now = new Date("2026-10-23T03:00:00Z");
  it("defaults to today at noon UTC", () => {
    expect(normaliseScheduledFor(undefined, now)).toBe("2026-10-23T12:00:00.000Z");
    expect(normaliseScheduledFor("", now)).toBe("2026-10-23T12:00:00.000Z");
  });
  it("keeps a picked day on that day", () => {
    expect(normaliseScheduledFor("2026-11-02")).toBe("2026-11-02T12:00:00.000Z");
  });
  it("rejects dates that do not exist or are not dates", () => {
    expect(normaliseScheduledFor("2026-02-31")).toBeNull();
    expect(normaliseScheduledFor("not a date")).toBeNull();
    expect(normaliseScheduledFor(42)).toBeNull();
  });
  it("accepts a full timestamp", () => {
    expect(normaliseScheduledFor("2026-11-02T08:30:00Z")).toBe("2026-11-02T08:30:00.000Z");
  });
});
