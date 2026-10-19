import { describe, it, expect } from "vitest";
import {
  computeLeadScore, DEFAULT_RUBRIC, isNotableScoreChange, rubricChanged, rubricOf, sanitizeRubric, stageForScore,
  type ScoringEvent, type ScoringRubric,
} from "./scoring";

const NOW = new Date("2026-10-19T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const ev = (name: string, d: number, payload?: Record<string, unknown>): ScoringEvent => ({ name, occurred_at: daysAgo(d), payload });
const score = (events: ScoringEvent[], profile: Record<string, unknown> = {}, stage: string | null = null, rubric: ScoringRubric = DEFAULT_RUBRIC) =>
  computeLeadScore(rubric, events, profile, stage, NOW);

describe("computeLeadScore -- shape", () => {
  it("returns the Account 360 shape: score, label, factors of {label, points, detail}", () => {
    const r = score([ev("email.clicked", 0)]);
    expect(typeof r.score).toBe("number");
    expect(typeof r.label).toBe("string");
    for (const f of r.factors) {
      expect(typeof f.label).toBe("string");
      expect(typeof f.points).toBe("number");
      expect(typeof f.detail).toBe("string");
    }
    expect(r.rubric_version).toBe(DEFAULT_RUBRIC.version);
  });

  it("an empty lead scores 0 and is New", () => {
    const r = score([]);
    expect(r.score).toBe(0);
    expect(r.label).toBe("New");
    expect(r.stage).toBe("new");
    expect(r.factors).toEqual([]);
  });

  it("is deterministic: same inputs, identical output", () => {
    const events = [ev("email.clicked", 3), ev("quote.opened", 1), ev("web.page_viewed", 2, { buying_interest: true })];
    expect(score(events, { type: "oem" })).toEqual(score(events, { type: "oem" }));
  });

  it("the visible factors add up to the score (below the clamp)", () => {
    const r = score([ev("email.clicked", 0), ev("quote.opened", 0)], { type: "oem" });
    expect(r.factors.reduce((t, f) => t + f.points, 0)).toBe(r.score);
    expect(r.score).toBe(40);
  });
});

describe("computeLeadScore -- behaviour and decay", () => {
  it("a fresh click is worth its full points", () => {
    expect(score([ev("email.clicked", 0)]).score).toBe(10);
  });

  it("points halve every half-life", () => {
    expect(score([ev("email.clicked", 14)]).score).toBe(5); // 14-day half-life
    expect(score([ev("quote.opened", 14)]).score).toBe(10); // 20 -> 10
    expect(score([ev("event.attended", 60)]).score).toBe(20); // 40 -> 20 at a 60-day half-life
  });

  it("an event with no half-life never decays", () => {
    const r = score([ev("email.unsubscribed", 80)], {}, null);
    expect(r.factors[0].points).toBe(-40);
  });

  it("ignores events outside the window and events from the future", () => {
    expect(score([ev("form.submitted", 91)]).score).toBe(0);
    expect(score([ev("form.submitted", -1)]).score).toBe(0);
  });

  it("ignores events the rubric has no rule for, and rules worth zero", () => {
    expect(score([ev("case.created", 0), ev("email.bounced", 0)]).factors).toEqual([]);
  });

  it("the first matching rule claims the event: a buying-interest page view is not also a plain visit", () => {
    const hot = score([ev("web.page_viewed", 0, { buying_interest: true })]);
    expect(hot.score).toBe(15);
    const plain = score([ev("web.page_viewed", 0, { buying_interest: false })]);
    expect(plain.score).toBe(2);
  });

  it("caps how many of one rule's events count in a week", () => {
    const rubric: ScoringRubric = { ...DEFAULT_RUBRIC, behaviour: [{ event: "email.clicked", label: "Clicked", points: 10, max_per_week: 3 }] };
    const burst = Array.from({ length: 10 }, () => ev("email.clicked", 1));
    expect(score(burst, {}, null, rubric).score).toBe(30);
    const spread = [ev("email.clicked", 1), ev("email.clicked", 9), ev("email.clicked", 16)]; // three different weeks
    expect(score(spread, {}, null, rubric).score).toBe(30);
  });

  it("one factor per rule, counting the events", () => {
    const r = score([ev("email.clicked", 0), ev("email.clicked", 1), ev("email.clicked", 2)]);
    expect(r.factors.filter((f) => f.label === "Clicked a link in an email")).toHaveLength(1);
    expect(r.factors[0].detail).toMatch(/^3 times/);
  });

  it("a negative factor is listed first, and the score never goes below 0", () => {
    const r = score([ev("email.clicked", 0), ev("email.unsubscribed", 0)]);
    expect(r.factors[0].label).toBe("Unsubscribed");
    expect(r.score).toBe(0);
  });

  it("the score never exceeds 100", () => {
    const events = [ev("event.attended", 0), ev("form.submitted", 0), ev("email.interest", 0), ev("quote.opened", 0), ev("whatsapp.replied", 0)];
    expect(score(events).score).toBe(100);
  });
});

describe("computeLeadScore -- profile and market", () => {
  it("adds profile points from the account", () => {
    const r = score([], { type: "oem", country: "Qatar", has_active_amc: true });
    expect(r.factors.map((f) => f.label).sort()).toEqual(["Based in the Gulf", "Has an active service contract", "OEM account"]);
    expect(r.score).toBe(20);
    expect(r.stage).toBe("engaged");
  });

  it("matches the contact's role", () => {
    expect(score([], { contact_role: "Purchasing Manager" }).score).toBe(10);
    expect(score([], { contact_role: "Driver" }).score).toBe(0);
  });

  it("profile points do not decay with time", () => {
    expect(score([], { type: "oem" }).score).toBe(10);
  });

  it("adds the company's buying stage once, capped at 15, and nothing for an unknown stage", () => {
    const rubric: ScoringRubric = { ...DEFAULT_RUBRIC, buying_stage_points: { comparing: 12, deciding: 99 } };
    expect(score([], {}, "comparing", rubric).score).toBe(12);
    expect(score([], {}, "deciding", rubric).score).toBe(15);
    expect(score([], {}, "browsing", rubric).score).toBe(0);
    expect(score([], {}, null, rubric).score).toBe(0);
    expect(score([], {}, "comparing", rubric).factors[0].kind).toBe("market");
  });
});

describe("stages and thresholds", () => {
  it("New under 20, Engaged 20-59, Ready for sales from 60", () => {
    const t = DEFAULT_RUBRIC.thresholds;
    expect(stageForScore(19, t)).toBe("new");
    expect(stageForScore(20, t)).toBe("engaged");
    expect(stageForScore(59, t)).toBe("engaged");
    expect(stageForScore(60, t)).toBe("ready");
  });

  it("an interest plus a form submit is Ready for sales", () => {
    const r = score([ev("email.interest", 0), ev("form.submitted", 0)]);
    expect(r.score).toBe(60);
    expect(r.label).toBe("Ready for sales");
  });

  it("lead.scored is announced only when the stage changes or the score moves 10", () => {
    expect(isNotableScoreChange(null, { score: 5, stage: "new" })).toBe(true);
    expect(isNotableScoreChange({ score: 30, stage: "engaged" }, { score: 35, stage: "engaged" })).toBe(false);
    expect(isNotableScoreChange({ score: 30, stage: "engaged" }, { score: 40, stage: "engaged" })).toBe(true);
    expect(isNotableScoreChange({ score: 58, stage: "engaged" }, { score: 61, stage: "ready" })).toBe(true);
  });
});

describe("sanitizeRubric", () => {
  it("drops events that are not in the catalogue and clamps numbers", () => {
    const r = sanitizeRubric({
      behaviour: [
        { event: "made.up", points: 5 },
        { event: "email.clicked", label: "Click", points: 5000, half_life_days: -3, max_per_week: 9999 },
      ],
    }, 4);
    expect(r.behaviour).toHaveLength(1);
    expect(r.behaviour[0].points).toBe(100);
    expect(r.behaviour[0].half_life_days).toBeUndefined();
    expect(r.behaviour[0].max_per_week).toBe(100);
  });

  it("takes the version from the caller, never from the input", () => {
    expect(sanitizeRubric({ version: 99 }, 7).version).toBe(7);
  });

  it("drops profile rules on unknown fields and keeps known ones", () => {
    const r = sanitizeRubric({
      profile: [
        { label: "Bad", filters: [{ id: "x", field: "password", operator: "equals", value: "x" }], points: 5 },
        { label: "Good", filters: [{ id: "y", field: "contact_role", operator: "contains", value: "buyer" }], points: 5 },
      ],
    }, 2);
    expect(r.profile.map((p) => p.label)).toEqual(["Good"]);
  });

  it("falls back to the default thresholds when ready is not above engaged", () => {
    const r = sanitizeRubric({ thresholds: { engaged: 70, ready: 40 } }, 1);
    expect(r.thresholds).toEqual(DEFAULT_RUBRIC.thresholds);
  });

  it("survives garbage", () => {
    expect(() => sanitizeRubric(null, 1)).not.toThrow();
    expect(() => sanitizeRubric("x", 1)).not.toThrow();
    expect(sanitizeRubric(42, 1).behaviour).toEqual([]);
  });

  it("round-trips the default rubric unchanged", () => {
    const r = sanitizeRubric(DEFAULT_RUBRIC, DEFAULT_RUBRIC.version);
    expect(rubricChanged(r, DEFAULT_RUBRIC)).toBe(false);
  });

  it("rubricChanged notices a real edit but not a version bump", () => {
    const edited = { ...DEFAULT_RUBRIC, thresholds: { engaged: 25, ready: 60 } };
    expect(rubricChanged(edited, DEFAULT_RUBRIC)).toBe(true);
    expect(rubricChanged({ ...DEFAULT_RUBRIC, version: 9 }, DEFAULT_RUBRIC)).toBe(false);
  });

  it("rubricOf falls back to the default when nothing is saved", () => {
    expect(rubricOf(null)).toBe(DEFAULT_RUBRIC);
    expect(rubricOf(undefined)).toBe(DEFAULT_RUBRIC);
  });
});
