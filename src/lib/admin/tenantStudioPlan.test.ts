import { describe, expect, it } from "vitest";
import { tenantPlan } from "./tenantStudio";

describe("tenantPlan (tenants_plan_check accepts personal, small_business, enterprise only)", () => {
  it("keeps an allowed value without a warning", () => {
    for (const p of ["personal", "small_business", "enterprise"]) {
      const w: string[] = [];
      expect(tenantPlan(p, w)).toBe(p);
      expect(w).toEqual([]);
    }
  });
  it("maps the words the model writes and says so", () => {
    for (const [raw, want] of [["professional", "small_business"], ["starter", "personal"], ["custom", "enterprise"], ["Small Business", "small_business"]] as const) {
      const w: string[] = [];
      expect(tenantPlan(raw, w)).toBe(want);
      if (raw !== "Small Business") expect(w).toHaveLength(1);
    }
  });
  it("falls back to small_business for anything unknown or missing", () => {
    const w: string[] = [];
    expect(tenantPlan(undefined, w)).toBe("small_business");
    expect(tenantPlan("gold-plus", w)).toBe("small_business");
    expect(w).toHaveLength(2);
  });
});
