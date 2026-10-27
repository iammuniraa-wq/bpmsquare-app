import { describe, expect, it } from "vitest";
import { summariseProjects, type SummaryInput } from "./summary";

const p = (o: Partial<SummaryInput>): SummaryInput => ({ status: "active", contract_value: 1000, currency: "SAR", budget_total: 800, margin_pct: 20, ...o });

describe("summariseProjects", () => {
  it("counts and totals only active projects", () => {
    const s = summariseProjects([p({}), p({ contract_value: 500, budget_total: 450, margin_pct: 10 }), p({ status: "draft", contract_value: 9000 }), p({ status: "closed" })]);
    expect(s).toMatchObject({ active: 2, currency: "SAR", contractValue: 1500, budget: 1250, lowMargin: 0, negativeMargin: 0 });
  });

  it("counts thin and negative margins, ignoring projects with no margin yet", () => {
    const s = summariseProjects([p({ margin_pct: 4 }), p({ margin_pct: -3 }), p({ margin_pct: null, budget_total: null }), p({ margin_pct: 10 })]);
    expect(s.lowMargin).toBe(2);
    expect(s.negativeMargin).toBe(1);
    expect(s.budget).toBe(2400);
  });

  it("does not claim one currency when the active projects differ, and has none when there are none", () => {
    expect(summariseProjects([p({}), p({ currency: "QAR" })]).currency).toBe("");
    expect(summariseProjects([p({ status: "draft" })]).currency).toBeNull();
    expect(summariseProjects([]).active).toBe(0);
  });
});
