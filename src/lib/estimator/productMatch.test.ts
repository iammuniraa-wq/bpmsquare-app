import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMatchKey, itemKeyLabel, matchKeyOf, parseMatchKey, productHasAttrs, resolveMatchAttrs } from "./productMatch";
import { computeEstimate } from "./compute";
import { validateTemplate } from "./template";
import { resolveProducts, readProductsByAttrs } from "./server";
import type { EstimateTemplateBody, TemplateInput } from "./types";

const inputs: TemplateInput[] = [
  { key: "qty", label: "Quantity", type: "number", default: 3, min: 0 },
  { key: "pipe", label: "Pipe", type: "select", default: "a", options: [
    { key: "a", label: "A", value: 1, attrs: { pipe_class: "Schedule 40" } },
    { key: "b", label: "B", value: 2, attrs: { pipe_class: "SS20" } },
    { key: "c", label: "C", value: 3 },
  ] },
  { key: "coat", label: "Coating", type: "select", default: "pvc", options: [{ key: "pvc", label: "PVC", value: 1, attrs: { coating: "PVC coated" } }] },
];

describe("product match keys", () => {
  it("merges the fixed attributes with the chosen option's, sorted so the key is stable", () => {
    const m = { attrs: { fence_kind: "line_post" }, from: ["pipe", "coat"] };
    const a = resolveMatchAttrs(m, inputs, { pipe: "b", coat: "pvc" });
    expect(a).toEqual({ coating: "PVC coated", fence_kind: "line_post", pipe_class: "SS20" });
    expect(Object.keys(a)).toEqual(["coating", "fence_kind", "pipe_class"]);
    expect(matchKeyOf(a)).toBe(matchKeyOf({ pipe_class: "SS20", fence_kind: "line_post", coating: "PVC coated" }));
  });

  it("an option without attributes, an unknown input and a non-select input add nothing", () => {
    expect(resolveMatchAttrs({ attrs: { k: "v" }, from: ["pipe", "nope", "qty"] }, inputs, { pipe: "c", qty: 3 })).toEqual({ k: "v" });
  });

  it("round-trips, and reads a SKU as plain text", () => {
    const key = matchKeyOf({ fence_kind: "fabric", mesh_spec: "Chain-link 50x50 . 2.5mm" });
    expect(isMatchKey(key)).toBe(true);
    expect(parseMatchKey(key)).toEqual({ fence_kind: "fabric", mesh_spec: "Chain-link 50x50 . 2.5mm" });
    expect(parseMatchKey("PC-HCS-200")).toBeNull();
    expect(parseMatchKey("@match:not json")).toBeNull();
    expect(parseMatchKey("@match:[1]")).toBeNull();
    expect(parseMatchKey("@match:{}")).toBeNull();
    expect(itemKeyLabel("PC-HCS-200")).toBe("PC-HCS-200");
    expect(itemKeyLabel(matchKeyOf({ fence_kind: "line_post", pipe_class: "SS20", coating: "PVC coated" }))).toBe("line post, PVC coated, SS20");
  });

  it("checks a product's tags by exact text", () => {
    expect(productHasAttrs({ fence_kind: "line_post", pipe_class: "SS20" }, { fence_kind: "line_post" })).toBe(true);
    expect(productHasAttrs({ fence_kind: "line_post" }, { fence_kind: "line_post", pipe_class: "SS20" })).toBe(false);
    expect(productHasAttrs({ pipe_class: 20 }, { pipe_class: "20" })).toBe(false);
    expect(productHasAttrs(null, { a: "b" })).toBe(false);
  });
});

const body = (cost: unknown): EstimateTemplateBody & Record<string, unknown> => ({
  inputs,
  rates: [],
  rules: [{ code: "post", group: "Posts", description: "Post", uom: "pcs", qty: "qty", component: "materials", cost }],
} as never);

describe("a rule that names its product by attributes", () => {
  it("validates, and a bad match is refused with a precise message", () => {
    expect(validateTemplate(body({ kind: "product", match: { attrs: { fence_kind: "line_post" }, from: ["pipe"] } })).ok).toBe(true);
    expect(validateTemplate(body({ kind: "product", match: { attrs: {}, from: ["pipe"] } })).ok).toBe(true);
    const none = validateTemplate(body({ kind: "product", match: { attrs: {} } }));
    expect(none.ok).toBe(false);
    expect(none.issues[0].message).toMatch(/at least one attribute/);
    const notSelect = validateTemplate(body({ kind: "product", match: { attrs: { a: "b" }, from: ["qty"] } }));
    expect(notSelect.ok).toBe(false);
    expect(notSelect.issues[0].message).toMatch(/must be one of the template's select inputs/);
    expect(validateTemplate(body({ kind: "product", match: { attrs: { "Bad Name": "x" } } })).ok).toBe(false);
    expect(validateTemplate(body({ kind: "product", match: { attrs: { a: "" } } })).ok).toBe(false);
    expect(validateTemplate(body({ kind: "product", match: "x" })).ok).toBe(false);
    const empty = validateTemplate(body({ kind: "product" }));
    expect(empty.issues[0].message).toMatch(/SKU or its product reference/);
  });

  it("does not report the input a match reads as unused", () => {
    const v = validateTemplate(body({ kind: "product", match: { attrs: { fence_kind: "x" }, from: ["pipe", "coat"] } }));
    expect(v.warnings.map((w) => w.message).join(" ")).not.toMatch(/Input "pipe"|Input "coat"/);
  });

  it("an option's attributes are validated and kept", () => {
    const bad = validateTemplate({ ...body({ kind: "rate", rate: "r" }), rates: [{ key: "r", label: "R", unit: "u", value: 1 }], inputs: [
      { key: "pipe", label: "P", type: "select", default: "a", options: [{ key: "a", label: "A", value: 1, attrs: { Bad: "x" } }] },
    ] });
    expect(bad.ok).toBe(false);
    const good = validateTemplate(body({ kind: "product", match: { attrs: { fence_kind: "x" }, from: ["pipe"] } }));
    expect(good.template!.inputs.find((i) => i.key === "pipe")!.options![0].attrs).toEqual({ pipe_class: "Schedule 40" });
  });

  it("comes back from compute asking for a price under the match key built from the chosen options", () => {
    const tpl = validateTemplate(body({ kind: "product", match: { attrs: { fence_kind: "line_post" }, from: ["pipe", "coat"] } })).template!;
    const r = computeEstimate(tpl, { pipe: "b" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines[0].cost_kind).toBe("product");
    expect(r.lines[0].needs_price).toBe(true);
    expect(parseMatchKey(r.lines[0].sku!)).toEqual({ coating: "PVC coated", fence_kind: "line_post", pipe_class: "SS20" });
    expect(r.unpriced).toEqual(["post"]);
    // A different choice asks for a different product; same quantity.
    const other = computeEstimate(tpl, { pipe: "a" });
    expect(other.ok && parseMatchKey(other.lines[0].sku!)?.pipe_class).toBe("Schedule 40");
    // With a unit cost it is priced.
    const priced = computeEstimate(tpl, { pipe: "b" }, { unit_costs: { post: 10 } });
    expect(priced.ok && priced.summary.cost_total).toBe(30);
  });
});

// A fake products table that, like the service-role client, only filters on what the query says.
type Row = Record<string, unknown>;
function fakeProducts(rows: Row[]) {
  const log: [string, unknown][][] = [];
  const from = () => {
    const filters: [string, unknown][] = [];
    const q = {
      select() { return q; },
      eq(k: string, v: unknown) { filters.push([k, v]); return q; },
      limit() { return Promise.resolve(run()); },
      in() { return Promise.resolve({ data: [], error: null }); },
    };
    function run() {
      log.push([...filters]);
      const data = rows.filter((r) => filters.every(([k, v]) => {
        if (k.startsWith("custom_data->>")) return (r.custom_data as Row | null)?.[k.slice("custom_data->>".length)] === v;
        return r[k] === v;
      }));
      return { data, error: null };
    }
    return q;
  };
  return { client: { from } as unknown as SupabaseClient, log };
}

const prod = (id: string, tenant: string, cd: Row, extra: Row = {}): Row => ({ id, tenant_id: tenant, sku: `S-${id}`, ref: null, name: `P ${id}`, item_type: null, uom: "pcs", cost_price: 5, status: "active", created_at: "2026-01-01", custom_data: cd, ...extra });

describe("resolving a match to the tenant's product", () => {
  const rows = [
    prod("1", "A", { fence_kind: "line_post", pipe_class: "SS20", coating: "PVC coated" }),
    prod("2", "B", { fence_kind: "line_post", pipe_class: "SS20", coating: "PVC coated" }),
    prod("3", "A", { fence_kind: "line_post", pipe_class: "Schedule 40", coating: "PVC coated" }),
    prod("4", "A", { fence_kind: "line_post", pipe_class: "SS20", coating: "PVC coated" }, { status: "archived", created_at: "2025-01-01" }),
  ];

  it("finds the product with every tag, scoped to the tenant, and prefers an active one", async () => {
    const { client, log } = fakeProducts(rows);
    const key = matchKeyOf({ fence_kind: "line_post", pipe_class: "SS20", coating: "PVC coated" });
    const r = await resolveProducts(client, "A", [key]);
    expect(r.byKey.get(key)?.id).toBe("1");
    for (const f of log) expect(f).toContainEqual(["tenant_id", "A"]);
    // Tenant B's identical product is never returned for tenant A.
    const b = await resolveProducts(client, "B", [key]);
    expect(b.byKey.get(key)?.id).toBe("2");
  });

  it("finds nothing for a tag combination the catalogue does not have", async () => {
    const { client } = fakeProducts(rows);
    const key = matchKeyOf({ fence_kind: "line_post", pipe_class: "SS40", coating: "PVC coated" });
    const r = await resolveProducts(client, "A", [key]);
    expect(r.byKey.has(key)).toBe(false);
    expect((await readProductsByAttrs(client, "A", { fence_kind: "gate_post" }))).toEqual([]);
  });
});
