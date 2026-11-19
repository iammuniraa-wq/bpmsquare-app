import { describe, it, expect } from "vitest";
import { ageWords } from "./ageWords";

const at = (iso: string) => Date.parse(iso);

describe("ageWords", () => {
  it("a record saved a minute ago is never a day old, even when the UTC date is still yesterday", () => {
    // Doha, 01:31 on 19 Nov: the workspace's today is the 19th, the timestamp's UTC date is the 18th.
    const now = at("2026-11-18T22:31:00Z");
    expect(ageWords("2026-11-18T22:30:00Z", "2026-11-19", now)).toBe("just now");
  });

  it("west of UTC, a record saved a minute ago is not in the future", () => {
    // Los Angeles, 17:01 on 18 Nov: UTC is already the 19th.
    const now = at("2026-11-19T01:01:00Z");
    expect(ageWords("2026-11-19T01:00:00Z", "2026-11-18", now)).toBe("just now");
  });

  it("reads hours under a day, then whole elapsed days", () => {
    const now = at("2026-11-19T12:00:00Z");
    expect(ageWords("2026-11-19T11:30:00Z", "2026-11-19", now)).toBe("just now");
    expect(ageWords("2026-11-19T09:10:00Z", "2026-11-19", now)).toBe("2 h ago");
    expect(ageWords("2026-11-18T13:00:00Z", "2026-11-19", now)).toBe("23 h ago");
    expect(ageWords("2026-11-18T11:00:00Z", "2026-11-19", now)).toBe("1 d ago");
    expect(ageWords("2026-11-16T12:00:00Z", "2026-11-19", now)).toBe("3 d ago");
    expect(ageWords("2026-10-22T12:00:00Z", "2026-11-19", now)).toBe("4 wk ago");
    expect(ageWords("2026-04-19T12:00:00Z", "2026-11-19", now)).toBe("7 mo ago");
  });

  it("a clock slightly behind the timestamp reads just now", () => {
    expect(ageWords("2026-11-19T12:00:05Z", "2026-11-19", at("2026-11-19T12:00:00Z"))).toBe("just now");
  });

  it("a date key has no time: it is compared by calendar day", () => {
    const now = at("2026-11-19T12:00:00Z");
    expect(ageWords("2026-11-19", "2026-11-19", now)).toBe("today");
    expect(ageWords("2026-11-18", "2026-11-19", now)).toBe("1 d ago");
    expect(ageWords("2026-11-25", "2026-11-19", now)).toBe("today");
  });

  it("a fixed day that is not today falls back to calendar days", () => {
    const now = at("2027-03-01T00:00:00Z");
    expect(ageWords("2026-10-27T05:00:00Z", "2026-10-27", now)).toBe("today");
    expect(ageWords("2026-10-24T05:00:00Z", "2026-10-27", now)).toBe("3 d ago");
  });

  it("nothing to say without a date", () => {
    expect(ageWords(null, "2026-11-19")).toBe("");
    expect(ageWords("not a date", "2026-11-19")).toBe("");
    expect(ageWords("2026-11-19", "")).toBe("");
  });
});
