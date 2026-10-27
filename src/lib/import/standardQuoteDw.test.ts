import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({}) }));

import { FIELD_REGISTRY, isPilotObjectType, type EffectiveField } from "@/lib/fieldRegistry";
import type { FieldConfigResult, SalesConfig } from "@/lib/fieldConfig";
import { REGISTRY_OBJECT_TYPE, buildObjectSpec } from "./registrySchema";
import {
  STANDARD_QUOTE_LINES_SPEC, STANDARD_QUOTE_LINE_MONEY_KEYS, STANDARD_QUOTE_LINE_TEXT_KEYS,
} from "./standardQuoteLinesSchema";
import { recomputeStandardQuoteTotals } from "./standardQuoteLinesServer";

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function registryConfig(): FieldConfigResult {
  const def = FIELD_REGISTRY.standard_quote;
  const fields: EffectiveField[] = def.fields.map((f, i) => ({
    field_key: f.key, label: f.defaultLabel, widget: f.widget, section: f.defaultSection, position: i,
    hidden: false, required: false, locked: f.locked ?? false, editable: f.editable ?? true, exportOnly: f.exportOnly,
    kind: "standard", enumOptions: f.enumOptions,
  }));
  return { sections: def.sections.map((label) => ({ label, fields: fields.filter((f) => f.section === label) })), rules: [] };
}
const sales = { product_categories: [] } as unknown as SalesConfig;

describe("Standard Quotes on the field registry and Data Workbench specs", () => {
  it("is a pilot object type with its own custom-fields object key", () => {
    expect(isPilotObjectType("standard_quote")).toBe(true);
    expect(REGISTRY_OBJECT_TYPE.standard_quotes).toBe("standard_quote");
    expect(REGISTRY_OBJECT_TYPE.standard_quote_lines).toBeNull();
  });

  it("the registry has no duplicate key and marks every system-generated field export-only and locked", () => {
    const keys = FIELD_REGISTRY.standard_quote.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["ref", "status", "subtotal", "total", "sent_at", "closed_at"]) {
      const f = FIELD_REGISTRY.standard_quote.fields.find((x) => x.key === k)!;
      expect(f.exportOnly, k).toBe(true);
      expect(f.editable, k).toBe(false);
      expect(f.locked, k).toBe(true);
    }
  });

  it("never offers a relationship pointer, the template or the pricing state as a registry field", () => {
    const keys = FIELD_REGISTRY.standard_quote.fields.map((f) => f.key);
    for (const k of ["account_id", "contact_id", "template_id", "opportunity_id", "created_by", "print_options", "pricing_flags"]) expect(keys).not.toContain(k);
  });

  it("the header spec resolves customer and contact by name, and only the account is required", () => {
    const spec = buildObjectSpec("standard_quotes", registryConfig(), sales);
    const account = spec.fields.find((f) => f.key === "account_name")!;
    const contact = spec.fields.find((f) => f.key === "contact_name")!;
    expect(account).toMatchObject({ type: "ref", required: true });
    expect(contact).toMatchObject({ type: "ref" });
    expect(contact.required).toBeFalsy();
    expect(spec.dependsOn).toEqual(expect.arrayContaining(["accounts", "contacts"]));
    // Import/Update drop export-only columns on the client; the server must not see them as settable.
    expect(spec.fields.filter((f) => f.exportOnly).map((f) => f.key)).toEqual(expect.arrayContaining(["ref", "status", "total"]));
  });

  it("the lines spec keeps pricing structure export-only and offers the quote id as the create-time key", () => {
    const byKey = new Map(STANDARD_QUOTE_LINES_SPEC.fields.map((f) => [f.key, f]));
    expect(byKey.get("standard_quote_ref")).toMatchObject({ type: "ref", required: true });
    expect(byKey.get("description")?.required).toBe(true);
    for (const k of ["amount", "group", "selected"]) expect(byKey.get(k)?.exportOnly, k).toBe(true);
    for (const k of [...STANDARD_QUOTE_LINE_TEXT_KEYS, ...STANDARD_QUOTE_LINE_MONEY_KEYS]) {
      expect(byKey.get(k), k).toBeDefined();
      expect(byKey.get(k)?.exportOnly, k).toBeFalsy();
    }
    expect(STANDARD_QUOTE_LINES_SPEC.dependsOn).toEqual(["standard_quotes"]);
  });
});

// Source-level pins, the way objectFeatures.test.ts pins the gate: the properties that make a
// cross-tenant or wrong-record write impossible are visible in each route's text.
describe("Standard Quotes Data Workbench routes keep the proven shape", () => {
  const routes = ["export/standard_quotes", "export/standard_quote_lines", "import/standard_quotes", "import/standard_quote_lines", "update/standard_quotes", "update/standard_quote_lines"];

  it.each(routes)("%s resolves its tenant from the session, gates on the module and never uses the service role", (r) => {
    const src = read(`src/app/api/${r}/route.ts`);
    const name = r.split("/")[1];
    expect(src).toContain("requireTenantUser()");
    expect(src).toContain(`assertObjectFeature(tenantId, "${name}")`);
    expect(src).not.toContain("createAdminSupabase");
    // tenant identity is never read from the request
    expect(src).not.toMatch(/tenantId\s*=\s*(body|values|rows)/);
    expect(src.indexOf("requireTenantUser()")).toBeLessThan(src.indexOf("assertObjectFeature("));
  });

  it.each(routes.filter((r) => r.startsWith("import") || r.startsWith("update")))("%s needs the edit grant on the Standard Quotes workcenter", (r) => {
    expect(read(`src/app/api/${r}/route.ts`)).toContain('canEditWorkcenter(perms, "standard_quotes")');
  });

  it.each(routes.filter((r) => r.startsWith("export")))("%s needs the view grant", (r) => {
    expect(read(`src/app/api/${r}/route.ts`)).toContain('canViewWorkcenter(perms, "standard_quotes")');
  });

  it("the exports leave out the pricing guardrail state and the supplier-request link", () => {
    for (const r of ["export/standard_quotes", "export/standard_quote_lines"]) {
      const src = read(`src/app/api/${r}/route.ts`);
      expect(src).not.toMatch(/pricing_flags\s*[:,)]|pricing_document_id\s*[:,)]|rfq_line_id\s*[:,)]/);
    }
  });

  it("both updates match on the real id only, never the quote id", () => {
    for (const r of ["update/standard_quotes", "update/standard_quote_lines"]) {
      const src = read(`src/app/api/${r}/route.ts`);
      expect(src).toContain("values.id?.trim()");
      expect(src).toContain("Record ID is required");
      expect(src).not.toContain("standard_quote_ref");
    }
  });

  it("the lines update refuses engine-priced lines and non-draft quotes, so the margin check cannot be bypassed", () => {
    const src = read("src/app/api/update/standard_quote_lines/route.ts");
    expect(src).toContain("pricing_document_id");
    expect(src).toContain('quote.status !== "draft"');
    expect(read("src/app/api/import/standard_quote_lines/route.ts")).toContain('quote.status !== "draft"');
  });

  it("the header update recomputes the total with the shared formula and only on a draft", () => {
    const src = read("src/app/api/update/standard_quotes/route.ts");
    expect(src).toContain("computeStandardQuoteTotals");
    expect(src).toContain('before.status !== "draft"');
  });

  it("the header import generates the Quote ID itself, ignoring any id or ref in the file", () => {
    const src = read("src/app/api/import/standard_quotes/route.ts");
    expect(src).toContain("generateNextStandardQuoteRef");
    expect(src).not.toMatch(/values\.(id|ref)\b/);
    expect(src).toContain('status: "draft"');
  });
});

// A minimal PostgREST-shaped fake: select/in/eq chain, resolve to rows; update records its payload.
function fakeSupabase(db: Record<string, Record<string, unknown>[]>) {
  const updates: { table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const state: { filters: Record<string, unknown>; ins: Record<string, unknown[]>; payload?: Record<string, unknown> } = { filters: {}, ins: {} };
    const rows = () => (db[table] ?? []).filter((r) =>
      Object.entries(state.filters).every(([k, v]) => r[k] === v) && Object.entries(state.ins).every(([k, vs]) => vs.includes(r[k])));
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.in = (k: string, vs: unknown[]) => { state.ins[k] = vs; return b; };
    b.eq = (k: string, v: unknown) => { state.filters[k] = v; return b; };
    b.update = (payload: Record<string, unknown>) => { state.payload = payload; return b; };
    b.then = (resolve: (v: unknown) => unknown) => {
      if (state.payload) { updates.push({ table, payload: state.payload, filters: { ...state.filters } }); return resolve({ data: null, error: null }); }
      return resolve({ data: rows(), error: null });
    };
    return b;
  };
  return { client: { from } as never, updates };
}

describe("recomputeStandardQuoteTotals", () => {
  const quote = (id: string, extra: Record<string, unknown> = {}) => ({ id, tenant_id: "t1", header_discount_pct: 10, tax_pct: 18, shipping_amount: 50, ...extra });

  it("sums only the lines that count and applies the quote's discount, tax and shipping", async () => {
    const { client, updates } = fakeSupabase({
      standard_quotes: [quote("q1")],
      standard_quote_lines: [
        { id: "l1", tenant_id: "t1", standard_quote_id: "q1", amount: 600, is_selected: true },
        { id: "l2", tenant_id: "t1", standard_quote_id: "q1", amount: 400, is_selected: true },
        // two alternative options: only the chosen one counts; a quantity break never counts
        { id: "l3", tenant_id: "t1", standard_quote_id: "q1", amount: 200, group_id: "gA", group_type: "alternative", is_selected: true },
        { id: "l5", tenant_id: "t1", standard_quote_id: "q1", amount: 900, group_id: "gB", group_type: "alternative", is_selected: false },
        { id: "l4", tenant_id: "t1", standard_quote_id: "q1", amount: 700, break_of: "l1", is_selected: true },
      ],
    });
    await recomputeStandardQuoteTotals(client, "t1", ["q1"]);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.subtotal).toBe(1200);
    // (1200 - 10%) * 1.18 + 50
    expect(updates[0].payload.total).toBeCloseTo(1080 * 1.18 + 50, 6);
    expect(updates[0].filters).toMatchObject({ id: "q1", tenant_id: "t1" });
  });

  it("does not touch a quote of another tenant", async () => {
    const { client, updates } = fakeSupabase({
      standard_quotes: [quote("q9", { tenant_id: "other" })],
      standard_quote_lines: [{ id: "l9", tenant_id: "other", standard_quote_id: "q9", amount: 5 }],
    });
    await recomputeStandardQuoteTotals(client, "t1", ["q9"]);
    expect(updates).toHaveLength(0);
  });

  it("a quote whose lines were all removed totals to its shipping", async () => {
    const { client, updates } = fakeSupabase({ standard_quotes: [quote("q2", { header_discount_pct: 0, tax_pct: 0, shipping_amount: 25 })], standard_quote_lines: [] });
    await recomputeStandardQuoteTotals(client, "t1", ["q2"]);
    expect(updates[0].payload).toMatchObject({ subtotal: 0, total: 25 });
  });
});
