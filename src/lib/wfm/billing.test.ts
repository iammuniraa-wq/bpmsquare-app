import { describe, it, expect } from "vitest";
import { resolveBillRate, resolveCostRate, buildBillingLines, periodsOverlap, previousMonth, type CostingRates } from "./billing";

const costing: CostingRates = {
  default_bill_rate: 500,
  default_cost_rate: 300,
  rates_by_employment_type: { contractor: { bill: 800, cost: 600 }, intern: { cost: 100 } },
};

describe("resolveBillRate", () => {
  it("takes the project's own rate first", () => {
    expect(resolveBillRate([1200, 900], "contractor", costing)).toEqual({ rate: 1200, source: "project" });
  });
  it("falls back to the nearest ancestor's rate", () => {
    expect(resolveBillRate([null, 900], "contractor", costing)).toEqual({ rate: 900, source: "parent" });
  });
  it("treats 0 on a project as unset, not free", () => {
    expect(resolveBillRate([0, null], "contractor", costing)).toEqual({ rate: 800, source: "employment_type" });
  });
  it("uses the employment type before the workspace default", () => {
    expect(resolveBillRate([], "contractor", costing)).toEqual({ rate: 800, source: "employment_type" });
    expect(resolveBillRate([], "full_time", costing)).toEqual({ rate: 500, source: "default" });
  });
  it("returns 0 when nothing is set anywhere", () => {
    expect(resolveBillRate([], null, { ...costing, default_bill_rate: 0 })).toEqual({ rate: 0, source: "default" });
  });
});

describe("resolveCostRate", () => {
  it("has no project rung", () => {
    expect(resolveCostRate("intern", costing)).toBe(100);
    expect(resolveCostRate("full_time", costing)).toBe(300);
    expect(resolveCostRate(null, { ...costing, default_cost_rate: 0 })).toBe(0);
  });
});

describe("buildBillingLines", () => {
  const groupOf = (id: string) => (id === "root" ? { id: "root", label: "Retrofit" } : { id, label: `Sub ${id}` });
  const chainFor = () => [null];
  const typeLabel = (c: string) => (c === "contractor" ? "Contractor" : "Full-time");

  it("folds sessions into one line per group and rate, actual minutes", () => {
    const lines = buildBillingLines({
      sessions: [
        { project_id: "root", employee_id: "a", employment_type: "full_time", minutes: 90 },
        { project_id: "root", employee_id: "b", employment_type: "full_time", minutes: 30 },
      ],
      groupOf, chainFor, costing, typeLabel,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ description: "Retrofit", minutes: 120, hours: 2, rate: 500, amount: 1000, cost: 600, people: 2 });
  });

  it("splits a group by employment type when the rates differ, and labels why", () => {
    const lines = buildBillingLines({
      sessions: [
        { project_id: "s1", employee_id: "a", employment_type: "full_time", minutes: 60 },
        { project_id: "s1", employee_id: "b", employment_type: "contractor", minutes: 60 },
      ],
      groupOf, chainFor, costing, typeLabel,
    });
    expect(lines.map((l) => [l.description, l.rate])).toEqual([
      ["Sub s1 — standard rate", 500],
      ["Sub s1 — Contractor", 800],
    ]);
  });

  it("does not split when a project override makes every rate the same", () => {
    const lines = buildBillingLines({
      sessions: [
        { project_id: "s1", employee_id: "a", employment_type: "full_time", minutes: 60 },
        { project_id: "s1", employee_id: "b", employment_type: "contractor", minutes: 60 },
      ],
      groupOf, chainFor: () => [1000], costing, typeLabel,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ description: "Sub s1", rate: 1000, source: "project", hours: 2, amount: 2000 });
  });

  it("keeps qty × rate = amount on the printed line", () => {
    const [line] = buildBillingLines({
      sessions: [{ project_id: "root", employee_id: "a", employment_type: null, minutes: 100 }],
      groupOf, chainFor: () => [333], costing, typeLabel,
    });
    expect(line.hours).toBe(1.67);
    expect(line.amount).toBe(556.11);
  });

  it("skips zero-minute sessions", () => {
    expect(buildBillingLines({
      sessions: [{ project_id: "root", employee_id: "a", employment_type: null, minutes: 0 }],
      groupOf, chainFor, costing, typeLabel,
    })).toEqual([]);
  });
});

describe("periodsOverlap", () => {
  it("is inclusive on both ends", () => {
    expect(periodsOverlap("2026-08-01", "2026-08-31", "2026-08-31", "2026-09-30")).toBe(true);
    expect(periodsOverlap("2026-08-01", "2026-08-31", "2026-09-01", "2026-09-30")).toBe(false);
    expect(periodsOverlap("2026-08-10", "2026-08-20", "2026-08-01", "2026-08-31")).toBe(true);
  });
});

describe("previousMonth", () => {
  it("handles a year boundary", () => {
    expect(previousMonth("2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(previousMonth("2026-03-01")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
