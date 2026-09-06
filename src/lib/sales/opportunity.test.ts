import { describe, it, expect } from "vitest";
import { opportunityStages, initialStage, isClosedStage, outcomeForStage, probabilityFor, opportunityAmount, weightedValue, daysBetween, parseTeam } from "./opportunity";
import { DEFAULT_OPPORTUNITY_STAGES } from "@/lib/constants";

describe("opportunity stages", () => {
  it("falls back to the defaults for missing or malformed config", () => {
    expect(opportunityStages(null)).toBe(DEFAULT_OPPORTUNITY_STAGES);
    expect(opportunityStages({ opportunity_stages: [] })).toBe(DEFAULT_OPPORTUNITY_STAGES);
    expect(opportunityStages({ opportunity_stages: [{ value: "", label: "x", color: "#000" }] })).toBe(DEFAULT_OPPORTUNITY_STAGES);
  });

  it("defaults: Qualify is initial, Won and Lost are closed with their outcomes", () => {
    const s = DEFAULT_OPPORTUNITY_STAGES;
    expect(initialStage(s).value).toBe("qualify");
    expect(isClosedStage(s, "won")).toBe(true);
    expect(isClosedStage(s, "propose")).toBe(false);
    expect(outcomeForStage(s, "won")).toBe("won");
    expect(outcomeForStage(s, "lost")).toBe("lost");
    expect(outcomeForStage(s, "negotiate")).toBe("open");
  });
});

describe("probabilityFor", () => {
  const s = DEFAULT_OPPORTUNITY_STAGES;
  it("uses the stage hint, 100 for won, 0 for lost", () => {
    expect(probabilityFor(s, "qualify", null)).toBe(20);
    expect(probabilityFor(s, "negotiate", undefined)).toBe(75);
    expect(probabilityFor(s, "won", null)).toBe(100);
    expect(probabilityFor(s, "lost", null)).toBe(0);
  });
  it("the rep's override always wins, clamped", () => {
    expect(probabilityFor(s, "qualify", 65)).toBe(65);
    expect(probabilityFor(s, "won", 40)).toBe(40);
    expect(probabilityFor(s, "qualify", 140)).toBe(100);
  });
});

describe("opportunityAmount", () => {
  it("prefers the LATEST linked quote's subtotal, else the lines", () => {
    const lines = [{ id: "a", amount: 1000 }, { id: "b", amount: 500 }];
    expect(opportunityAmount([], lines)).toBe(1500);
    expect(opportunityAmount([{ created_at: "2026-09-01", subtotal: 900 }, { created_at: "2026-09-05", subtotal: 1200 }], lines)).toBe(1200);
  });
  it("weighted value and days", () => {
    expect(weightedValue(1200, 75)).toBe(900);
    expect(daysBetween("2026-09-01T10:00:00Z", "2026-09-06")).toBe(5);
    expect(daysBetween(null, "2026-09-06")).toBe(0);
  });
});

describe("parseTeam", () => {
  it("keeps known roles, one entry per user", () => {
    expect(parseTeam([{ user_id: "u1", role: "sales" }, { user_id: "u1", role: "owner" }, { user_id: "u2", role: "boss" }, null]))
      .toEqual([{ user_id: "u1", role: "sales" }]);
  });
});
