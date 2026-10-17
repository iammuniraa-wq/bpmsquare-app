import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({}) }));

import { shapeEstimateRow, ESTIMATE_API_SELECT } from "./apiRows";

describe("estimate rows on the v1 API", () => {
  it("never selects a cost, margin, parameter, model or whole-totals column", () => {
    const cols = ESTIMATE_API_SELECT.split(/[,()]/).map((s) => s.trim()).filter(Boolean);
    for (const banned of ["unit_cost", "cost_total", "margin_pct", "margin_amount", "params", "model", "by_group", "by_component", "totals", "notes", "created_by"]) {
      expect(cols, banned).not.toContain(banned);
    }
    // The price is read through two json paths only.
    expect(ESTIMATE_API_SELECT).toContain("quoted_total:totals->price");
    expect(ESTIMATE_API_SELECT).toContain("quoted_total_incl_vat:totals->price_incl_vat");
    expect(ESTIMATE_API_SELECT).not.toMatch(/totals->(cost|margin|by_)/);
  });

  it("shapes a row and drops anything unexpected", () => {
    const row = shapeEstimateRow({
      id: "e1", ref: "EST-0001", name: "Villa", status: "draft", currency: "SAR", quoted_total: 1000, quoted_total_incl_vat: "1150",
      accounts: { id: "a1", ref: "ACC-1", name: "Acme" }, contacts: [{ id: "c1", ref: "CON-1", name: "Sam" }], estimate_templates: { name: "Precast" },
      custom_data: { cf_x: 1 }, created_at: "t0", updated_at: "t1",
      unit_cost: 5, cost_total: 99, margin_pct: 18, totals: { cost_total: 1 }, params: { floors: 2 }, model: {},
    });
    expect(row).toMatchObject({
      id: "e1", ref: "EST-0001", quoted_total: 1000, quoted_total_incl_vat: null,
      account: { id: "a1", ref: "ACC-1", name: "Acme" }, contact: { id: "c1", name: "Sam" }, template: { name: "Precast" },
      _links: { self: "/api/v1/estimates/e1" },
    });
    for (const k of ["unit_cost", "cost_total", "margin_pct", "totals", "params", "model"]) expect(row).not.toHaveProperty(k);
  });

  it("tolerates missing relations", () => {
    expect(shapeEstimateRow({ id: "e2", name: "x", status: "draft" })).toMatchObject({ account: null, contact: null, template: null, quoted_total: null });
  });
});
