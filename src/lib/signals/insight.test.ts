import { describe, expect, it } from "vitest";
import { isHeld, movement, reasonLine, weeklySeries } from "./insight";
import type { TopSignal } from "./types";

const NOW = new Date("2026-10-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const top = (headline: string, points: number, days = 1): TopSignal => ({ kind: "inquiry", group: "asked", source: "quotes", headline, occurred_at: daysAgo(days), points });

describe("reasonLine", () => {
  it("is built from the two strongest signals' own words", () => {
    expect(reasonLine("comparing", [top("Clicked a link", 3), top("Asked for a quote (QT-0042)", 25), top("Opened an email", 1)]))
      .toBe("Comparing: asked for a quote (QT-0042) and clicked a link");
  });
  it("says so when there is nothing to go on", () => {
    expect(reasonLine("quiet", [])).toBe("Quiet: nothing recent to go on");
  });
  it("says why an account is held", () => {
    expect(reasonLine("quiet", [top("Asked for a quote", 25)], true)).toContain("not in market");
  });
  it("ignores negative signals as a reason", () => {
    expect(reasonLine("looking", [top("Unsubscribed", -15), top("Clicked a link", 3)])).toBe("Looking: clicked a link");
  });
});

describe("weeklySeries", () => {
  it("gives eight weekly samples, oldest first, zero before the first stored day", () => {
    const s = weeklySeries([{ day: "2026-10-01", score: 20 }, { day: "2026-10-15", score: 40 }, { day: "2026-10-20", score: 45 }], NOW);
    expect(s).toHaveLength(8);
    expect(s.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(s[7]).toBe(45);
    expect(s[5]).toBe(20);
    expect(s[6]).toBe(20); // 13 Oct: the latest stored day at or before it is 1 Oct
  });
});

describe("movement", () => {
  const base = { stage: "comparing" as const, previous_stage: "looking" as const, score: 40 };
  it("highlights a recent upward move with text and an arrow", () => {
    const m = movement({ ...base, stage_changed_at: daysAgo(2) }, [0, 0, 0, 0, 0, 0, 20, 40], NOW);
    expect(m).toMatchObject({ direction: "warming", arrow: "▲", movedText: "Moved to Comparing 2 days ago", fresh: true, daysInStage: 2 });
    expect(m.label).toContain("Warming");
  });
  it("reads a downward move as cooling and does not highlight it", () => {
    const m = movement({ stage: "looking", previous_stage: "comparing", score: 20, stage_changed_at: daysAgo(1) }, [0, 0, 0, 0, 0, 0, 40, 20], NOW);
    expect(m).toMatchObject({ direction: "cooling", arrow: "▼", fresh: false, movedText: "Moved to Looking 1 day ago" });
  });
  it("falls back to the week's score change when the stage has been still", () => {
    expect(movement({ ...base, stage_changed_at: daysAgo(40) }, [0, 0, 0, 0, 0, 0, 30, 40], NOW)).toMatchObject({ direction: "warming", movedText: null, daysInStage: 40, scoreDelta: 10 });
    expect(movement({ ...base, stage_changed_at: daysAgo(40) }, [0, 0, 0, 0, 0, 0, 42, 40], NOW).direction).toBe("steady");
  });
});

describe("isHeld", () => {
  it("holds for 30 days", () => {
    expect(isHeld(daysAgo(29), NOW)).toBe(true);
    expect(isHeld(daysAgo(31), NOW)).toBe(false);
    expect(isHeld(null, NOW)).toBe(false);
  });
});
