import { describe, expect, it } from "vitest";
import { computeIntent, fade, reachableMax, stageFor, thresholds } from "./rubric";
import type { RawSignal } from "./types";

const NOW = new Date("2026-10-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const sig = (kind: RawSignal["kind"], key: string, days: number, extra: Partial<RawSignal> = {}): RawSignal => ({
  kind, source: "quotes", key, occurredAt: daysAgo(days), headline: `${kind} ${key}`, ...extra,
});
const sum = (r: ReturnType<typeof computeIntent>) => r.factors.reduce((t, f) => t + f.points, 0);

describe("fade", () => {
  it("holds for two weeks, then halves, quarters, eighths, and is gone after 60 days", () => {
    expect([0, 14, 15, 28, 29, 42, 43, 60, 61].map((d) => fade(d, false))).toEqual([1, 1, 0.5, 0.5, 0.25, 0.25, 0.125, 0.125, 0]);
  });
  it("holds a negative signal at full weight for 90 days", () => {
    expect(fade(80, true, 90)).toBe(1);
    expect(fade(91, true, 90)).toBe(0);
  });
});

describe("computeIntent", () => {
  it("scores nothing as Quiet 0", () => {
    const r = computeIntent([], { now: NOW });
    expect(r).toMatchObject({ score: 0, stage: "quiet", factors: [], signalCount: 0 });
  });

  it("names every point: the factors add up to the score exactly", () => {
    const r = computeIntent([sig("inquiry", "a", 2), sig("link_click", "b", 3), sig("link_click_topic", "c", 20, { topic: "Precast" })], { now: NOW });
    expect(r.score).toBe(25 + 3 + 3);
    expect(sum(r)).toBe(r.score);
    expect(r.topics).toEqual(["Precast"]);
  });

  it("caps a group and shows the cap as its own line", () => {
    const r = computeIntent([sig("inquiry", "a", 1), sig("inquiry", "b", 1), sig("deal_opened", "c", 1)], { now: NOW });
    // 25 + 25 + 20 = 70 in the group "They asked us", which counts for at most 40.
    expect(r.score).toBe(40);
    expect(sum(r)).toBe(40);
    expect(r.factors.some((f) => f.label.startsWith("Limit for"))).toBe(true);
  });

  it("limits how many signals of one kind count", () => {
    const many = Array.from({ length: 6 }, (_, i) => sig("link_click", `k${i}`, 1));
    const r = computeIntent(many, { now: NOW });
    expect(r.score).toBe(9); // maxItems 3 x 3 points
  });

  it("fades with age and says so in words", () => {
    const r = computeIntent([sig("inquiry", "a", 20)], { now: NOW });
    expect(r.score).toBe(13); // 25 x 0.5 = 12.5, rounded
    expect(r.factors[0].detail).toContain("half, 20 days old");
  });

  it("drops a signal older than 60 days", () => {
    expect(computeIntent([sig("inquiry", "a", 61)], { now: NOW }).score).toBe(0);
  });

  it("never counts the same occurrence twice", () => {
    const r = computeIntent([sig("inquiry", "same", 1), sig("inquiry", "same", 1)], { now: NOW });
    expect(r.score).toBe(25);
  });

  it("lets a negative signal cancel what the group earned, never below zero", () => {
    const r = computeIntent([sig("unsubscribed", "u", 5, { source: "campaigns" }), sig("link_click", "c", 1)], { now: NOW });
    expect(r.score).toBe(0);
    expect(sum(r)).toBe(0);
  });

  it("holds an account marked not in market at Quiet 0 for 30 days, then releases it", () => {
    const signals = [sig("inquiry", "a", 1)];
    const held = computeIntent(signals, { now: NOW, notInMarketAt: daysAgo(10) });
    expect(held).toMatchObject({ score: 0, stage: "quiet" });
    expect(held.factors[0].label).toBe("Marked not in market");
    const released = computeIntent(signals, { now: NOW, notInMarketAt: daysAgo(31) });
    expect(released.score).toBe(25);
  });

  it("is identical on every call", () => {
    const signals = [sig("inquiry", "a", 4), sig("link_click", "b", 9)];
    expect(computeIntent(signals, { now: NOW })).toEqual(computeIntent([...signals].reverse(), { now: NOW }));
  });

  it("keeps the newest signals for the timeline, newest first", () => {
    const r = computeIntent([sig("link_click", "old", 30), sig("inquiry", "new", 1)], { now: NOW });
    expect(r.topSignals.map((s) => s.headline)).toEqual(["inquiry new", "link_click old"]);
  });
});

describe("stages", () => {
  const t = thresholds();
  it("scales the design's 65 / 40 / 15 to what the live sources can reach", () => {
    expect(reachableMax()).toBe(65);
    expect(t).toEqual({ deciding: 42, comparing: 26, looking: 10 });
    expect(thresholds(100)).toEqual({ deciding: 65, comparing: 40, looking: 15 });
  });
  it("applies the rules in order", () => {
    expect(stageFor(t.deciding, true)).toBe("deciding");
    expect(stageFor(t.deciding, false)).toBe("comparing");
    expect(stageFor(0, true)).toBe("comparing");
    expect(stageFor(t.comparing, false)).toBe("comparing");
    expect(stageFor(t.looking, false)).toBe("looking");
    expect(stageFor(t.looking - 1, false)).toBe("quiet");
  });
  it("reaches Deciding with an ask and strong engagement", () => {
    const r = computeIntent([sig("inquiry", "a", 2), sig("interested", "b", 2), sig("link_click_topic", "c", 2)], { now: NOW });
    expect(r.score).toBe(25 + 15 + 6);
    expect(r.stage).toBe("deciding");
  });
});
