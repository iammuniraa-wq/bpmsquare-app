// The three demo Price Books (docs/pricing-engine-architecture.md, "Demo
// pricing"): a catalogue list, formula pricing and cost plus. This module is
// the single source for both the seed SQL (scripts/gen-pricing-demo-seed.ts
// renders scripts/seed-pricing-demo.sql from it) and the golden test that
// prices real quote-line shapes through the same data
// (src/lib/pricing/demoSeed.test.ts). Components and procedures come from the
// wizard's own templates, so a demo book opens in Pricing as an ordinary
// Price list / Catalog + Formula / Cost-based book.
//
// Pure data and string building. No database, no framework imports.

import {
  getMethodTemplate, COST_BASED_SOURCES, type PricingMethodKey, type MethodTemplate,
} from "../src/lib/pricing/wizard";
import type { CostInputKind } from "../src/lib/pricing-core";

export type DemoRule = {
  component: string;
  match: Record<string, string>;
  value?: number | null;
  scale?: { from: number; value: number }[];
  formula?: string;
  valid_from?: string;
};

export type DemoCostInput = { model: string; path: string; kind: CostInputKind; value: number; uom?: string };

export type DemoBook = {
  area: string;
  label: string;
  method: PricingMethodKey;
  /** One sentence for the version note, after the "Demo seed:" marker. */
  note: string;
  rules: DemoRule[];
  /** Cost models to create for this book (code, display name, source ladder). */
  costModel?: { code: string; name: string; sources: unknown[] };
};

/** The demo products the books are keyed on. Names and list prices are the
 *  ones scripts/seed-products-demo.sql inserts; the panel is added by the
 *  pricing seed itself (it is the only product with an area to price by). */
export const DEMO_PRODUCTS = [
  { ref: "PRD-0001", name: "Passenger Elevator 8P (630 kg)", category: "ELEVATORS", sub: "PASSENGER", uom: "Nos", list: 1850000, cost: 1425000 },
  { ref: "PRD-0002", name: "Passenger Elevator 13P (1000 kg)", category: "ELEVATORS", sub: "PASSENGER", uom: "Nos", list: 2650000, cost: 2080000 },
  { ref: "PRD-0003", name: "Hydraulic Goods Lift 2T", category: "GOODS_LIFTS", sub: "HYDRAULIC", uom: "Nos", list: 1150000, cost: 880000 },
  { ref: "PRD-0004", name: "Home Lift 4P Compact", category: "ELEVATORS", sub: "HOME_LIFTS", uom: "Nos", list: 1275000, cost: 960000 },
  { ref: "PRD-0005", name: "Elevator AMC — Comprehensive", category: "SERVICE_PLANS", sub: "COMPREHENSIVE", uom: "Yr", list: 96000, cost: 52000 },
  { ref: "PRD-0006", name: "Elevator AMC — Non-comprehensive", category: "SERVICE_PLANS", sub: "NON_COMPREHENSIVE", uom: "Yr", list: 54000, cost: 28000 },
  { ref: "PRD-0007", name: "Motor Rewinding 45 kW", category: "SERVICES", sub: "REPAIRS", uom: "Job", list: 68000, cost: 41000 },
  { ref: "PRD-0008", name: "Controller Retrofit Kit V3", category: "MODERNISATION", sub: "CONTROLLERS", uom: "Nos", list: 385000, cost: 265000 },
  { ref: "PRD-0009", name: "Door Operator Assembly", category: "SPARES", sub: "DOORS", uom: "Nos", list: 118000, cost: 82000 },
  { ref: "PRD-0010", name: "Wire Rope 13mm (per metre)", category: "SPARES", sub: "ROPES", uom: "Mtr", list: 420, cost: 290 },
] as const;

/** The price-list scales a demo product carries on itself (products.qty_breaks, 0118),
 *  keyed by ref. scripts/seed-products-demo.sql sets them; the demo test prices them
 *  through the engine's own product price-list rule. */
export const DEMO_QTY_BREAKS: Record<string, { from: number; rate: number | null }[]> = {
  "PRD-0010": [{ from: 100, rate: 390 }, { from: 500, rate: 360 }],
};

/** Added by the pricing seed. Quantity on a line is the area in m². */
export const PANEL_PRODUCT = {
  name: "Cabin Wall Panel — Stainless Steel (per m²)", sku: "CAB-SS-M2",
  category: "MODERNISATION", sub: "CABINS", uom: "Sqm", list: 6200, cost: 4100, tax: 18,
  description: "Brushed stainless steel cabin wall panel, priced by area (quantity = m²)",
} as const;

/** Dimensions the books use. Inserted with ON CONFLICT DO NOTHING: the
 *  tenant-wide vocabulary is never re-weighted by a seed. */
export const DEMO_DIMENSIONS = [
  { attribute: "customer.tier", weight: 30, label: "Customer tier" },
  { attribute: "region", weight: 20, label: "Region" },
  { attribute: "document_type", weight: 15, label: "Document type" },
  { attribute: "product.base_model", weight: 60, label: "Product" },
  { attribute: "product.sub_category", weight: 40, label: "Product sub-category" },
  { attribute: "product.category", weight: 30, label: "Product category" },
];

/** First match wins; sub-category rules sit before the category rules so a
 *  formula-priced sub-category is not swallowed by its category's book. Wire
 *  rope (ROPES, a SPARES sub-category) goes to the catalogue: its price list
 *  and quantity breaks live on the product itself. */
export const DEMO_ROUTING_RULES = [
  { attribute: "product.sub_category", value: "ROPES", area: "catalogue_2026", document_types: ["standard_quote", "opportunity"] },
  { attribute: "product.sub_category", value: "CABINS", area: "formula_pricing", document_types: ["standard_quote", "opportunity"] },
  { attribute: "product.category", value: "ELEVATORS", area: "catalogue_2026", document_types: ["standard_quote", "opportunity"] },
  { attribute: "product.category", value: "GOODS_LIFTS", area: "catalogue_2026", document_types: ["standard_quote", "opportunity"] },
  { attribute: "product.category", value: "SERVICE_PLANS", area: "catalogue_2026", document_types: ["standard_quote", "opportunity"] },
  { attribute: "product.category", value: "MODERNISATION", area: "cost_plus", document_types: ["standard_quote", "opportunity"] },
  { attribute: "product.category", value: "SERVICES", area: "cost_plus", document_types: ["standard_quote", "opportunity"] },
  { attribute: "product.category", value: "SPARES", area: "cost_plus", document_types: ["standard_quote", "opportunity"] },
];

// ── 1. Catalogue 2026 (list) ────────────────────────────────────────────────
// An explicit list price per product, with volume bands where a buyer would
// expect them: a project discount on units, a multi-year discount on AMC.

const r2 = (n: number) => Math.round(n * 100) / 100;
const FROM_2026 = "2026-01-01";

function catalogueListRules(): DemoRule[] {
  const rules: DemoRule[] = [];
  for (const p of DEMO_PRODUCTS.slice(0, 6)) {
    const scale = p.uom === "Yr"
      ? [{ from: 0, value: p.list }, { from: 3, value: r2(p.list * 0.95) }, { from: 5, value: r2(p.list * 0.9) }]
      : [{ from: 0, value: p.list }, { from: 3, value: r2(p.list * 0.98) }];
    rules.push({ component: "LIST_PRICE", match: { "product.base_model": p.name }, scale, valid_from: FROM_2026 });
  }
  return rules;
}

const CATALOGUE: DemoBook = {
  area: "catalogue_2026",
  label: "Catalogue 2026 (list)",
  method: "price_list",
  note: "list prices for elevators, goods lifts and AMC plans, and wire rope from the product's own price list and quantity breaks; OEM and direct customers get a tier discount.",
  rules: [
    ...catalogueListRules(),
    { component: "CUST_DISC", match: { "customer.tier": "oem" }, value: 8 },
    { component: "CUST_DISC", match: { "customer.tier": "direct" }, value: 5 },
    { component: "CUST_DISC", match: {}, value: 0 },
    { component: "FREIGHT", match: {}, value: 0 },
    { component: "TAX", match: {}, value: 18 },
  ],
};

// ── 2. Formula pricing ──────────────────────────────────────────────────────
// Prices written as formulas in the engine's DSL. Home market is Karnataka;
// another state pays 4% more, and a line with no state on its account is not
// uplifted (a missing state is not a reason to charge more).

const REGION = `(ctx.region == null ? 1 : (ctx.region == "Karnataka" ? 1 : 1.04))`;

export const FORMULAS = {
  // Price per m² times area (quantity = m²), 8% off from 50 m², never below a 18,000 job minimum.
  panel: `round(max(ctx.line.quantity * ctx.cost.material.ss_panel_per_m2 * (ctx.line.quantity >= 50 ? 0.92 : 1) * ${REGION}, 18000), 2)`,
  // Anything else routed here prices from the catalogue price on the product.
  fallback: `ctx.line.product.list_price * ctx.line.quantity`,
};

const FORMULA: DemoBook = {
  area: "formula_pricing",
  label: "Formula pricing",
  method: "catalog_formula",
  note: "cabin panels by area with a regional uplift; anything else falls back to the catalogue price.",
  costModel: { code: "CATALOG_FALLBACK_COST", name: "Fallback cost inputs", sources: [] },
  rules: [
    { component: "MATERIAL_RATE", match: { "product.sub_category": "CABINS" }, formula: FORMULAS.panel },
    { component: "MATERIAL_RATE", match: {}, formula: FORMULAS.fallback },
    // The formula IS the selling price, so margin and floor are 0 here.
    { component: "FREIGHT", match: {}, value: 0 },
    { component: "MARGIN_MARKUP", match: {}, value: 0 },
    { component: "MARGIN_FLOOR", match: {}, value: 0 },
    { component: "CUST_DISC", match: { "customer.tier": "oem" }, value: 5 },
    { component: "CUST_DISC", match: {}, value: 0 },
    { component: "TAX", match: {}, value: 18 },
  ],
};

// ── 3. Cost plus ────────────────────────────────────────────────────────────
// Cost from the product (its ERP cost price, or its cost sheet), plus a
// markup on landed cost: 25% by default, a different markup for spares and
// services. The ladder accepts a product cost up to a year old so the demo
// does not go stale; the in-app cost-based walk keeps its stricter 30 days.

const COST_PLUS_SOURCES = COST_BASED_SOURCES.map((s) => (s.code === "PRODUCT_COST" ? { ...s, max_age_days: 365 } : s));

const COST_PLUS: DemoBook = {
  area: "cost_plus",
  label: "Cost plus",
  method: "cost_based",
  note: "product cost plus 25% (spares 35%, services 40%); a floor flags anything under 15%.",
  costModel: { code: "STANDARD_COST", name: "Standard cost", sources: COST_PLUS_SOURCES },
  rules: [
    { component: "FREIGHT", match: {}, value: 0 },
    { component: "HANDLING", match: {}, value: 0 },
    { component: "MARGIN_MARKUP", match: {}, value: 25 },
    { component: "MARGIN_MARKUP", match: { "product.category": "SPARES" }, value: 35 },
    { component: "MARGIN_MARKUP", match: { "product.category": "SERVICES" }, value: 40 },
    { component: "CUST_DISC", match: { "customer.tier": "oem" }, value: 3 },
    { component: "CUST_DISC", match: {}, value: 0 },
    { component: "MARGIN_FLOOR", match: {}, value: 15 },
    { component: "TAX", match: {}, value: 18 },
  ],
};

export const DEMO_BOOKS: DemoBook[] = [CATALOGUE, FORMULA, COST_PLUS];

/** Tenant-wide cost rates the books read. Inserted only when the tenant has
 *  no rate for that model and path, so a number someone set in the app wins. */
export const DEMO_COST_INPUTS: DemoCostInput[] = [
  // Cost plus: the cost sheet on Motor Rewinding (copper kg, labour hours, salvage kg).
  { model: "STANDARD_COST", path: "material.rate_per_unit", kind: "MATERIAL", value: 1250 },
  { model: "STANDARD_COST", path: "labour.rate_per_hour", kind: "LABOUR", value: 1800 },
  { model: "STANDARD_COST", path: "salvage.credit_per_unit", kind: "SALVAGE_CREDIT", value: 1200 },
  // Formula pricing: the template's own fallback rate, and the panel's price per m².
  { model: "CATALOG_FALLBACK_COST", path: "material.rate_per_unit", kind: "MATERIAL", value: 10 },
  { model: "CATALOG_FALLBACK_COST", path: "material.ss_panel_per_m2", kind: "MATERIAL", value: 5200 },
];

export const DEMO_AREAS = DEMO_BOOKS.map((b) => b.area);

// ── SQL rendering ───────────────────────────────────────────────────────────

function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** A dollar-quoted literal whose tag cannot appear in the value. */
function dq(tag: string, value: string, cast = ""): string {
  if (value.includes(`$${tag}$`)) throw new Error(`The value contains the quote tag $${tag}$`);
  return `$${tag}$${value}$${tag}$${cast}`;
}

const jsonb = (tag: string, v: unknown) => dq(tag, JSON.stringify(v), "::jsonb");
const num = (v: number | null | undefined, cast = "numeric") => (v === null || v === undefined ? `null::${cast}` : `${v}::${cast}`);

function ruleRow(r: DemoRule): string {
  return "      (" + [
    lit(r.component),
    jsonb("j", r.match),
    num(r.value ?? null),
    r.scale ? jsonb("j", { entries: r.scale }) : "null::jsonb",
    r.formula ? dq("f", r.formula, "::text") : "null::text",
    r.valid_from ? `date ${lit(r.valid_from)}` : "null::date",
  ].join(", ") + ")";
}

function bookBlock(book: DemoBook): string {
  const t: MethodTemplate = getMethodTemplate(book.method);
  const area = lit(book.area);
  const note = `Demo seed: ${book.label} — ${book.note}`;
  const componentRows = t.components.map((c) => "      (" + [
    lit(c.code), lit(c.name), lit(c.class), lit(c.calc_type), lit(c.calc_basis), lit(c.sign),
    c.rounding_rule ? jsonb("j", c.rounding_rule) : "null::jsonb",
    lit(c.manual_override), String(c.is_statistical), lit(c.resolution_strategy ?? "MOST_SPECIFIC"),
  ].join(", ") + ")").join(",\n");

  const parts: string[] = [];
  parts.push(`    -- ${book.label}  (area ${book.area}, shaped like the "${t.label}" template)`);
  parts.push(`    select count(*) into v_other from pricing_config_versions
     where tenant_id = v_t and pricing_area = ${area}
       and not (version = 1 and coalesce(notes, '') like 'Demo seed:%');
    if v_other > 0 then
      raise notice 'Price Book % already has versions this seed did not make; left untouched.', ${area};
    else
      delete from pricing_rules       where tenant_id = v_t and pricing_area = ${area} and config_version = 1;
      delete from pricing_components  where tenant_id = v_t and pricing_area = ${area} and config_version = 1;
      delete from pricing_procedures  where tenant_id = v_t and pricing_area = ${area} and config_version = 1;
      delete from pricing_cost_models where tenant_id = v_t and pricing_area = ${area} and config_version = 1;
      delete from pricing_config_versions where tenant_id = v_t and pricing_area = ${area} and version = 1;

      insert into pricing_config_versions (tenant_id, pricing_area, version, status, dsl_version, notes, published_at)
      values (v_t, ${area}, 1, 'PUBLISHED', 1, ${dq("n", note)}, now());
`);
  parts.push(`      insert into pricing_components (tenant_id, pricing_area, config_version, code, name, class, calc_type, calc_basis, sign, rounding_rule, manual_override, is_statistical, resolution_strategy)
      select v_t, ${area}, 1, c.* from (values
${componentRows}
      ) as c(code, name, class, calc_type, calc_basis, sign, rounding_rule, manual_override, is_statistical, resolution_strategy);
`);
  parts.push(`      insert into pricing_procedures (tenant_id, pricing_area, config_version, code, name, entry_mode, steps)
      values (v_t, ${area}, 1, ${lit(t.procedure.procedure_id)}, ${lit(t.label)}, ${lit(t.procedure.entry_mode)}, ${jsonb("j", t.procedure.steps)});
`);
  if (book.costModel) {
    parts.push(`      insert into pricing_cost_models (tenant_id, pricing_area, config_version, code, name, sources)
      values (v_t, ${area}, 1, ${lit(book.costModel.code)}, ${lit(book.costModel.name)}, ${jsonb("j", book.costModel.sources)});
`);
  }
  parts.push(`      insert into pricing_rules (tenant_id, pricing_area, config_version, component_code, match_attributes, value, scale, formula, valid_from, origin)
      select v_t, ${area}, 1, r.component, r.match, r.value, r.scale, r.formula, r.valid_from, 'MANUAL' from (values
${book.rules.map(ruleRow).join(",\n")}
      ) as r(component, match, value, scale, formula, valid_from);
    end if;
`);
  return parts.join("\n");
}

export function renderSeedSql(): string {
  const dims = DEMO_DIMENSIONS.map((d) => `      (${lit(d.attribute)}, ${d.weight}, ${lit(d.label)})`).join(",\n");
  const costRows = DEMO_COST_INPUTS.map((c) =>
    `      (${lit(c.model)}, ${lit(c.path)}, ${lit(c.kind)}, ${c.value}, ${c.uom ? lit(c.uom) : "null::text"})`).join(",\n");
  const routing = JSON.stringify(DEMO_ROUTING_RULES);
  const areaList = DEMO_AREAS.map(lit).join(", ");
  const p = PANEL_PRODUCT;

  return `-- Demo Price Books for BPMSquare Pricing: a catalogue list, formula pricing and
-- cost plus. Targets the is_demo tenant only. Idempotent. GENERATED by
-- scripts/gen-pricing-demo-seed.ts from scripts/pricing-demo-books.ts -- edit
-- those and re-run \`npx jiti scripts/gen-pricing-demo-seed.ts\`, not this file.
--
-- RUN FIRST (in this order):
--   migrations  0083, 0098, 0099, 0100, 0111, 0113, 0114, 0115, 0121
--   seeds       scripts/seed-products-demo.sql   (this script keys on its products)
-- Optional, compatible: scripts/seed-pricing-cost-based-demo.sql (the cost-based walk).
--
-- What it does, per demo tenant that has the demo products:
--   1. Turns on pricing_engine, pricing_engine_quotes, products and standard_quotes.
--   2. Adds one product: ${p.name}, so there is something priced by area.
--   3. Registers the dimensions the books match on (never re-weights existing ones).
--   4. Creates three PUBLISHED Price Books, each at version 1:
--        catalogue_2026   "Catalogue 2026 (list)"  list prices + volume bands + tier discount;
--                                                  wire rope uses the product's own price list (qty_breaks)
--        formula_pricing  "Formula pricing"        formulas: price per m2 x area, regional uplift
--        cost_plus        "Cost plus"              product cost + 25% (spares 35%, services 40%)
--      Re-running refreshes a book only while it is still the untouched version 1
--      this script made; a book someone edited or re-published in the app is left alone.
--   5. Seeds the cost rates the books read (only where the tenant has none).
--   6. Routes products to the books in tenants.config.pricing.routing (this script's
--      rules go first; other routing rules and default_area are kept as they are).
-- The "default" Price Book (made in the app by the cost-based walk) is not touched.
-- Quotations are left alone: every routing rule here is fenced to Standard Quotes and
-- opportunities (document_types), so a Quotation line never reaches these books.

do $seed$
declare
  v_t uuid;
  v_other int;
begin
  for v_t in select id from tenants where is_demo = true loop
    if not exists (select 1 from products where tenant_id = v_t and ref = 'PRD-0001') then
      raise notice 'Demo tenant % has no demo products. Run scripts/seed-products-demo.sql first; skipped.', v_t;
      continue;
    end if;

    -- 1. Flags
    update tenants
       set features = coalesce(features, '{}'::jsonb)
         || '{"pricing_engine": true, "pricing_engine_quotes": true, "products": true, "standard_quotes": true}'::jsonb
     where id = v_t;

    -- 2. The area-priced product (ref = next free PRD number)
    insert into products (tenant_id, ref, name, sku, category, sub_category, uom, description, list_price, cost_price, tax_percent, status)
    select v_t,
           'PRD-' || lpad((coalesce((select max(substring(ref from '^PRD-([0-9]+)$')::int) from products where tenant_id = v_t), 0) + 1)::text, 4, '0'),
           ${lit(p.name)}, ${lit(p.sku)}, ${lit(p.category)}, ${lit(p.sub)}, ${lit(p.uom)}, ${lit(p.description)}, ${p.list}, ${p.cost}, ${p.tax}, 'active'
     where not exists (select 1 from products where tenant_id = v_t and sku = ${lit(p.sku)});

    -- 3. Dimensions (tenant-wide vocabulary; existing weights win)
    insert into pricing_dimensions (tenant_id, attribute, weight, label)
    select v_t, d.attribute, d.weight, d.label from (values
${dims}
    ) as d(attribute, weight, label)
    on conflict (tenant_id, attribute) do nothing;

    -- 5. Cost rates (a rate already on file for the model and path wins)
    insert into pricing_cost_inputs (tenant_id, cost_model_code, path, kind, value, uom, source, source_code, quality, as_of)
    select v_t, c.model, c.path, c.kind, c.value, c.uom, 'MANUAL', 'MANUAL', 'estimate', current_date from (values
${costRows}
    ) as c(model, path, kind, value, uom)
    where not exists (
      select 1 from pricing_cost_inputs i
       where i.tenant_id = v_t and i.cost_model_code = c.model and i.path = c.path and i.product_id is null
    );

    -- 4. The Price Books
${DEMO_BOOKS.map(bookBlock).join("\n")}
    -- 6. Routing: this script's rules first, everyone else's kept, default_area untouched
    update tenants
       set config = jsonb_set(
         coalesce(config, '{}'::jsonb), '{pricing}',
         coalesce(config->'pricing', '{}'::jsonb) || jsonb_build_object('routing',
           coalesce(config#>'{pricing,routing}', '{}'::jsonb) || jsonb_build_object('rules',
             ${dq("r", routing, "::jsonb")}
             || coalesce((
               select jsonb_agg(x)
                 from jsonb_array_elements(coalesce(config#>'{pricing,routing,rules}', '[]'::jsonb)) x
                where x->>'area' not in (${areaList})
             ), '[]'::jsonb)
           )
         )
       )
     where id = v_t;
  end loop;
end
$seed$;

-- Check: three published books per demo tenant, with their rule counts.
select t.slug, v.pricing_area, v.version, v.status,
       (select count(*) from pricing_rules r where r.tenant_id = v.tenant_id and r.pricing_area = v.pricing_area and r.config_version = v.version) as rules
  from pricing_config_versions v
  join tenants t on t.id = v.tenant_id
 where t.is_demo = true and v.pricing_area in (${areaList})
 order by t.slug, v.pricing_area;
`;
}
