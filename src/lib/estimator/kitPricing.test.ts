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

// The BOM graph the products module would load; the roll-up itself is the real one.
const bom = vi.hoisted(() => ({ lines: [] as { id: string; parent_product_id: string; component_product_id: string; qty: number; scrap_pct: number; line_kind: "consumed" | "used" }[], products: [] as Record<string, unknown>[], unreadable: false }));
vi.mock("@/lib/products/bomServer", async () => {
  const { rollUpBom } = await import("@/lib/products/bom");
  return {
    loadBomGraph: vi.fn(async () => {
      if (bom.unreadable) throw new Error("no table");
      const byId = new Map(bom.products.map((p) => [p.id as string, p]));
      return {
        getProduct: (id: string) => byId.get(id),
        getLines: (parent: string) => bom.lines.filter((l) => l.parent_product_id === parent),
      };
    }),
    rollUpFor: (g: { getProduct: never; getLines: never }, id: string) => rollUpBom(id, g.getProduct, g.getLines),
  };
});

import { computeAndPrice, priceProductRules, resolveProducts } from "./server";
import type { EstimateTemplateBody } from "./types";

type Row = { id: string; tenant_id: string; sku: string | null; ref: string | null; name: string; item_type: string | null; uom: string | null; cost_price: number | null; status: string; created_at: string };

// Just enough PostgREST: from("products").select(cols).eq(col, v)....in(col, vals), honouring the tenant filter.
function fakeSupabase(rows: Row[], opts: { noItemType?: boolean } = {}) {
  const queries: { cols: string; eq: Record<string, string> }[] = [];
  return {
    queries,
    client: {
      from: () => {
        const q = { cols: "", eq: {} as Record<string, string> };
        const chain: Record<string, unknown> = {};
        chain.select = (cols: string) => { q.cols = cols; return chain; };
        chain.eq = (col: string, v: string) => { q.eq[col] = v; return chain; };
        chain.in = (col: string, vals: string[]) => {
          queries.push({ ...q });
          if (opts.noItemType && q.cols.includes("item_type")) return Promise.resolve({ data: null, error: { code: "42703", message: "column products.item_type does not exist" } });
          const data = rows
            .filter((r) => r.tenant_id === q.eq.tenant_id && vals.includes(String((r as Record<string, unknown>)[col])))
            .map((r) => (q.cols.includes("item_type") ? r : { ...r, item_type: undefined }));
          return Promise.resolve({ data, error: null });
        };
        return chain;
      },
    } as never,
  };
}

let n = 0;
const P = (over: Partial<Row> & { id: string }): Row => ({
  tenant_id: "t1", sku: null, ref: null, name: over.id, item_type: "finished_product", uom: "m2", cost_price: null, status: "active",
  created_at: `2026-01-0${(n++ % 9) + 1}`, ...over,
});

beforeEach(() => {
  priceDocumentLine.mockReset();
  bom.lines = []; bom.products = []; bom.unreadable = false;
});

const kitLine = (id: string, parent: string, component: string, qty: number, scrap = 0, kind: "consumed" | "used" = "consumed") =>
  ({ id, parent_product_id: parent, component_product_id: component, qty, scrap_pct: scrap, line_kind: kind });

describe("resolving a product by SKU or by reference", () => {
  it("finds a product by its reference, in any case, and prefers a SKU match", async () => {
    const rows = [P({ id: "a", sku: "SLAB-1", ref: "PRD-0010" }), P({ id: "b", sku: "PRD-0011", ref: "PRD-0099" }), P({ id: "c", sku: "X", ref: "PRD-0011" })];
    const { client } = fakeSupabase(rows);
    const r = await resolveProducts(client, "t1", ["prd-0010", "PRD-0011", "SLAB-1"]);
    expect(r.byKey.get("prd-0010")?.id).toBe("a");
    expect(r.byKey.get("PRD-0011")?.id).toBe("b"); // a SKU named PRD-0011 beats the ref PRD-0011
    expect(r.byKey.get("SLAB-1")?.id).toBe("a");
  });

  it("never returns another tenant's product, by key or by id", async () => {
    const rows = [P({ id: "mine", sku: "S1" }), P({ id: "theirs", sku: "S1", tenant_id: "t2" }), P({ id: "theirs2", sku: "S2", ref: "PRD-0001", tenant_id: "t2" })];
    const { client, queries } = fakeSupabase(rows);
    const r = await resolveProducts(client, "t1", ["S1", "S2", "PRD-0001"], ["theirs", "mine"]);
    expect([...r.byId.keys()]).toEqual(["mine"]);
    expect(r.byKey.has("S2")).toBe(false);
    expect(queries.every((q) => q.eq.tenant_id === "t1")).toBe(true);
  });

  it("reads without item_type while migration 0133 is pending", async () => {
    const { client, queries } = fakeSupabase([P({ id: "a", sku: "S1", cost_price: 5 })], { noItemType: true });
    const r = await resolveProducts(client, "t1", ["S1"]);
    expect(r.byId.get("a")).toMatchObject({ id: "a", item_type: null, cost_price: 5 });
    expect(queries.some((q) => !q.cols.includes("item_type"))).toBe(true);
  });
});

describe("a BOM / kit is costed from its rolled-up components", () => {
  // Wall panel kit: 0.2 concrete (330) + 20 kg steel (3.2, 5% scrap) + a mould set that is only used.
  const rows = () => {
    const r = [
      P({ id: "kit", sku: "KIT-WALL", ref: "PRD-0100", name: "Villa wall panel kit", item_type: "bom_kit", cost_price: 999 }),
      P({ id: "conc", sku: "RM-CONC", item_type: "raw_material", cost_price: 330, name: "Concrete" }),
      P({ id: "steel", sku: "RM-STEEL", item_type: "raw_material", cost_price: 3.2, name: "Steel" }),
      P({ id: "mould", sku: "TL-MOULD", item_type: "tool_equipment", cost_price: 48000, name: "Mould set" }),
    ];
    bom.products = r.map((x) => ({ id: x.id, name: x.name, sku: x.sku, item_type: x.item_type, cost_price: x.cost_price }));
    bom.lines = [kitLine("l1", "kit", "conc", 0.2), kitLine("l2", "kit", "steel", 20, 5), kitLine("l3", "kit", "mould", 1, 0, "used")];
    return r;
  };

  it("uses the roll-up, not the stored cost, and never calls the pricing engine", async () => {
    const { client } = fakeSupabase(rows());
    const r = await priceProductRules(client, "t1", { estimateId: "e1", accountId: null, needs: [{ code: "ew", sku: "PRD-0100", qty: 10 }] });
    // 0.2 x 330 = 66.00; 20 x 1.05 x 3.2 = 67.20; the mould is used, not costed.
    expect(r.unit_costs.ew).toBe(133.2);
    expect(r.sources.ew).toBe("kit_rollup");
    expect(r.products.ew).toMatchObject({ id: "kit", sku: "KIT-WALL", ref: "PRD-0100", item_type: "bom_kit", kit_incomplete: false });
    expect(priceDocumentLine).not.toHaveBeenCalled();
  });

  it("does not use a roll-up with a hole in it: stored cost is the fallback and the line is flagged", async () => {
    const r0 = rows();
    r0[2].cost_price = null; bom.products = bom.products.map((p) => (p.id === "steel" ? { ...p, cost_price: null } : p));
    priceDocumentLine.mockResolvedValue({ ok: false, needs_rfq: true });
    const { client } = fakeSupabase(r0);
    const r = await priceProductRules(client, "t1", { estimateId: null, accountId: null, needs: [{ code: "ew", sku: "KIT-WALL", qty: 1 }] });
    expect(r.sources.ew).toBe("product_cost");
    expect(r.unit_costs.ew).toBe(999);
    expect(r.products.ew.kit_incomplete).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/components without a cost.*Steel/);
  });

  it("an incomplete kit with no stored cost is unpriced, never zero", async () => {
    const r0 = rows();
    r0[0].cost_price = null; r0[2].cost_price = null; bom.products = bom.products.map((p) => (p.id === "steel" ? { ...p, cost_price: null } : p));
    priceDocumentLine.mockResolvedValue({ ok: false, needs_rfq: true });
    const { client } = fakeSupabase(r0);
    const r = await priceProductRules(client, "t1", { estimateId: null, accountId: null, needs: [{ code: "ew", sku: "KIT-WALL", qty: 1 }] });
    expect(r.unpriced).toEqual(["ew"]);
    expect(r.unit_costs.ew).toBeUndefined();
  });

  it("a kit with no components yet is priced like any product", async () => {
    const r0 = rows();
    bom.lines = [];
    priceDocumentLine.mockResolvedValue({ ok: true, unit_rate: 120 });
    const { client } = fakeSupabase(r0);
    const r = await priceProductRules(client, "t1", { estimateId: null, accountId: null, needs: [{ code: "ew", sku: "KIT-WALL", qty: 3 }] });
    expect(r.sources.ew).toBe("engine");
    expect(r.unit_costs.ew).toBe(120);
  });

  it("falls back to the stored cost when the BOM tables cannot be read", async () => {
    bom.unreadable = true;
    priceDocumentLine.mockResolvedValue({ ok: false, needs_rfq: true });
    const { client } = fakeSupabase(rows());
    const r = await priceProductRules(client, "t1", { estimateId: null, accountId: null, needs: [{ code: "ew", sku: "KIT-WALL", qty: 1 }] });
    expect(r.sources.ew).toBe("product_cost");
  });

  it("a preview (catalogue only) rolls the kit up too and stores nothing", async () => {
    const { client } = fakeSupabase(rows());
    const r = await priceProductRules(client, "t1", { estimateId: null, accountId: null, catalogueOnly: true, needs: [{ code: "ew", sku: "KIT-WALL", qty: 1 }] });
    expect(r.unit_costs.ew).toBe(133.2);
    expect(priceDocumentLine).not.toHaveBeenCalled();
  });

  it("a catalogue pick is priced by product id, and another tenant's id prices nothing", async () => {
    const { client } = fakeSupabase([...rows(), P({ id: "foreign", tenant_id: "t2", sku: "F", cost_price: 50 })]);
    const r = await priceProductRules(client, "t1", { estimateId: null, accountId: null, needs: [{ code: "manual", productId: "kit", qty: 2 }, { code: "bad", productId: "foreign", qty: 1 }] });
    expect(r.unit_costs.manual).toBe(133.2);
    expect(r.unresolved).toEqual(["bad"]);
  });
});

describe("template rules that name a product by reference", () => {
  const tpl: EstimateTemplateBody = {
    inputs: [{ key: "area", label: "Area", type: "number", default: 100 }],
    rates: [{ key: "crew", label: "Crew", unit: "per day", value: 3000 }],
    rules: [
      { code: "slab", group: "Floors", description: "Hollow-core slab", uom: "m2", qty: "area", component: "materials", cost: { kind: "product", ref: "PRD-0010" } },
      { code: "kit", group: "Floors", description: "Wall kit", uom: "m2", qty: "area / 2", component: "materials", cost: { kind: "product", sku: "KIT-WALL" } },
      { code: "crew", group: "Site", description: "Crew", uom: "day", qty: "3", component: "erection", cost: { kind: "rate", rate: "crew" } },
    ],
  };

  it("prices a ref rule, a kit rule and a rate rule in one calculation", async () => {
    const r0 = [
      P({ id: "slab", ref: "PRD-0010", name: "Slab", cost_price: 145 }),
      P({ id: "kit", sku: "KIT-WALL", name: "Kit", item_type: "bom_kit", cost_price: 1 }),
      P({ id: "conc", item_type: "raw_material", cost_price: 100, name: "Concrete" }),
    ];
    bom.products = r0.map((x) => ({ id: x.id, name: x.name, sku: x.sku, item_type: x.item_type, cost_price: x.cost_price }));
    bom.lines = [kitLine("l1", "kit", "conc", 2)];
    priceDocumentLine.mockResolvedValue({ ok: false, needs_rfq: true });
    const { client } = fakeSupabase(r0);
    const out = await computeAndPrice(client, { tenantId: "t1", estimateId: null, accountId: null, template: tpl, params: {}, margin_pct: 0, vat_pct: 0 });
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    const cost = Object.fromEntries(out.result.lines.map((l) => [l.code, l.cost_total]));
    expect(cost).toEqual({ slab: 14500, kit: 10000, crew: 9000 }); // 100 x 145; 50 x (2 x 100); 3 x 3000
    expect(out.pricing.sources).toEqual({ slab: "product_cost", kit: "kit_rollup" });
    expect(out.pricing.product_ids).toEqual({ slab: "slab", kit: "kit" });
    expect(out.result.complete).toBe(true);
  });

  it("reports a reference that matches nothing instead of guessing, and keeps the rate lines", async () => {
    const { client } = fakeSupabase([]);
    const out = await computeAndPrice(client, { tenantId: "t1", estimateId: null, accountId: null, template: tpl, params: {}, margin_pct: 0, vat_pct: 0 });
    if (!out.ok) throw new Error("expected ok");
    expect(out.pricing.unresolved.sort()).toEqual(["kit", "slab"]);
    expect(out.result.complete).toBe(false);
    expect(out.result.lines.find((l) => l.code === "crew")?.cost_total).toBe(9000);
  });

  it("a template with only rate rules never touches the catalogue", async () => {
    const rateOnly: EstimateTemplateBody = { ...tpl, rules: [tpl.rules[2]] };
    const { client, queries } = fakeSupabase([]);
    const out = await computeAndPrice(client, { tenantId: "t1", estimateId: null, accountId: null, template: rateOnly, params: {}, margin_pct: 0, vat_pct: 0 });
    if (!out.ok) throw new Error("expected ok");
    expect(queries).toHaveLength(0);
    expect(out.result.summary.cost_total).toBe(9000);
  });
});
