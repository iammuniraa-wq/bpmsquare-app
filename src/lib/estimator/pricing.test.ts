import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ requireTenantUser: vi.fn(), createAdminSupabase: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: vi.fn(), canViewWorkcenter: vi.fn(), canCreateWorkcenter: vi.fn(), canEditWorkcenter: vi.fn(), canDeleteWorkcenter: vi.fn(),
}));
vi.mock("@/lib/objectFeatures", () => ({ tenantOwnsObject: vi.fn() }));
vi.mock("@/lib/standardQuoteRef", () => ({ generateNextStandardQuoteRef: vi.fn() }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: vi.fn() }));
const priceDocumentLine = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pricing/quoteLine", () => ({ priceDocumentLine }));

import { computeAndPrice, priceProductRules } from "./server";
import type { EstimateTemplateBody } from "./types";

type Product = { id: string; sku: string; name: string; cost_price: number | null; status: string; created_at: string };

// A just-enough Supabase fake: from("products").select().eq().in() resolves to the rows.
function fakeSupabase(products: Product[]) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.in = (_col: string, skus: string[]) => Promise.resolve({ data: products.filter((p) => skus.includes(p.sku)), error: null });
  return { from: () => chain } as never;
}

const tpl: EstimateTemplateBody = {
  inputs: [{ key: "n", label: "N", type: "number", default: 10 }],
  rates: [{ key: "labour_rate", label: "Labour", unit: "per hr", value: 20 }],
  rules: [
    { code: "panel", group: "Walls", description: "Panel", uom: "nr", qty: "n", component: "materials", cost: { kind: "product", sku: "PNL-1" } },
    { code: "fix", group: "Walls", description: "Fixings", uom: "nr", qty: "n * 2", component: "materials", cost: { kind: "product", sku: "FIX-1" } },
    { code: "crew", group: "Labour", description: "Crew", uom: "hr", qty: "n", component: "labour", cost: { kind: "rate", rate: "labour_rate" } },
    { code: "oh", group: "Overhead", description: "Overhead", uom: "lot", qty: "sub_walls", component: "overhead", cost: { kind: "rate", rate: "labour_rate" } },
  ],
};
const P = (id: string, sku: string, cost: number | null, over: Partial<Product> = {}): Product => ({ id, sku, name: sku, cost_price: cost, status: "active", created_at: "2026-01-01", ...over });

beforeEach(() => priceDocumentLine.mockReset());

// The engine fake: answers by product id, and throws for an id it was not told about.
function engine(byProduct: Record<string, unknown>) {
  priceDocumentLine.mockImplementation((...args: unknown[]) => {
    const productId = (args[1] as { productId?: string } | undefined)?.productId;
    if (productId === undefined) return undefined; // not a pricing call
    return productId in byProduct ? Promise.resolve(byProduct[productId]) : Promise.reject(new Error("engine down"));
  });
}

describe("priceProductRules", () => {
  it("prices through the engine, falls back to product cost, and reports unresolved and unpriced", async () => {
    engine({ p1: { ok: true, unit_rate: 12.5 }, p2: { ok: false, needs_rfq: true } }); // p3: engine throws
    const sb = fakeSupabase([P("p1", "A", null), P("p2", "B", 7), P("p3", "C", null)]);
    const r = await priceProductRules(sb, "t1", {
      estimateId: "e1", accountId: "a1",
      needs: [{ code: "a", sku: "A", qty: 4 }, { code: "b", sku: "B", qty: 2 }, { code: "c", sku: "C", qty: 1 }, { code: "d", sku: "NOPE", qty: 1 }],
    });
    expect(r.unit_costs).toEqual({ a: 12.5, b: 7 });
    expect(r.sources).toEqual({ a: "engine", b: "product_cost" });
    expect(r.unpriced).toEqual(["c"]);
    expect(r.unresolved).toEqual(["d"]);
    expect(r.product_ids).toMatchObject({ a: "p1", b: "p2", c: "p3" });
    expect(priceDocumentLine).toHaveBeenCalledWith("t1", expect.objectContaining({ productId: "p1", quantity: 4, accountId: "a1", documentType: "standard_quote", sourceId: "e1" }));
  });

  it("prefers an active product when a SKU is on several", async () => {
    priceDocumentLine.mockResolvedValue({ ok: true, unit_rate: 1 });
    const sb = fakeSupabase([P("old", "A", null, { status: "inactive", created_at: "2025-01-01" }), P("new", "A", null)]);
    const r = await priceProductRules(sb, "t1", { estimateId: null, accountId: null, needs: [{ code: "a", sku: "A", qty: 1 }] });
    expect(r.product_ids.a).toBe("new");
  });
});

describe("computeAndPrice (two passes)", () => {
  it("prices product rules between the passes and lets sub_<group> see the real figures", async () => {
    engine({ p1: { ok: true, unit_rate: 10 }, p2: { ok: true, unit_rate: 2 } });
    const sb = fakeSupabase([P("p1", "PNL-1", null), P("p2", "FIX-1", null)]);
    const r = await computeAndPrice(sb, { tenantId: "t1", estimateId: "e1", accountId: null, template: tpl, params: {}, margin_pct: 10, vat_pct: 15 });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    // panel 10 x 10 = 100, fixings 20 x 2 = 40 -> Walls 140; crew 10 x 20 = 200; overhead = sub_walls (140) x 20 = 2800
    const byCode = Object.fromEntries(r.result.lines.map((l) => [l.code, l.cost_total]));
    expect(byCode).toEqual({ panel: 100, fix: 40, crew: 200, oh: 2800 });
    expect(r.result.complete).toBe(true);
    expect(r.result.summary.cost_total).toBe(3140);
    expect(r.result.summary.price).toBe(3454);
    expect(r.pricing.product_ids).toEqual({ panel: "p1", fix: "p2" });
  });

  it("leaves a rule unpriced when its SKU matches no product, and the estimate incomplete", async () => {
    priceDocumentLine.mockResolvedValue({ ok: true, unit_rate: 10 });
    const r = await computeAndPrice(fakeSupabase([P("p1", "PNL-1", null)]), { tenantId: "t1", estimateId: null, accountId: null, template: tpl, params: {}, margin_pct: 0, vat_pct: 0 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.pricing.unresolved).toEqual(["fix"]);
    expect(r.result.complete).toBe(false);
    expect(r.result.unpriced).toEqual(["fix"]);
  });

  it("reuses stored unit costs instead of pricing again", async () => {
    const r = await computeAndPrice(fakeSupabase([]), {
      tenantId: "t1", estimateId: "e1", accountId: null, template: tpl, params: {}, margin_pct: 0, vat_pct: 0,
      reuse: { panel: 10, fix: 2 }, reuseProducts: { panel: "p1", fix: "p2" },
    });
    if (!r.ok) throw new Error("expected ok");
    expect(priceDocumentLine).not.toHaveBeenCalled();
    expect(r.result.complete).toBe(true);
    expect(r.pricing.sources).toEqual({ panel: "reused", fix: "reused" });
  });

  it("returns every issue when the inputs do not compute, without pricing anything", async () => {
    const r = await computeAndPrice(fakeSupabase([]), { tenantId: "t1", estimateId: null, accountId: null, template: tpl, params: { n: "abc" }, margin_pct: 0, vat_pct: 0 });
    expect(r.ok).toBe(false);
    expect(priceDocumentLine).not.toHaveBeenCalled();
  });
});
