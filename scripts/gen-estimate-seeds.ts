// Generates the two estimate seed scripts from the REAL engine, so the sample estimates'
// lines, totals and layout model are what "Calculate" would produce, not hand-typed numbers:
//
//   scripts/seed-estimate-templates-starter.sql   the starter templates and the illustrative catalogue items the GCC starters price from
//   scripts/seed-estimates-demo.sql                demo tenants: estimator on, the fence template, two sample fence estimates
//
//   npx jiti scripts/gen-estimate-seeds.ts
//
// The fence products themselves are NOT repeated here: they live in
// scripts/seed-fence-materials-demo.sql (run it first). This generator READS that file to
// find each product's tags and cost, so the sample estimates are priced from the same rows
// and nothing is duplicated. Re-run it (and commit the SQL) when the starter template, the
// engine or that products script changes.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHAINLINK_FENCE_STARTER } from "../src/lib/estimator/starterTemplates";
import { GUARD_0213, dq, installBlock, sqlText, starterBody, startersSql, bundle38Sql, BUNDLE_38_FILE } from "../src/lib/estimator/starterSeedSql";
import { computeEstimate } from "../src/lib/estimator/compute";
import { persistLine } from "../src/lib/estimator/lines";
import { parseMatchKey } from "../src/lib/estimator/productMatch";

const MARGIN_PCT = 18;
const VAT_PCT = 15;

// The helpers and the starters SQL live in src/lib/estimator/starterSeedSql.ts (pure, so a test can hold the committed seed to
// the source). This script writes the files and builds the demo estimates.

// ── the demo products, read from the fence materials script ──────────────────

type DemoProduct = { sku: string; cost: number; attrs: Record<string, string> };

function readDemoProducts(): DemoProduct[] {
  const text = readFileSync(join(__dirname, "seed-fence-materials-demo.sql"), "utf8");
  // One product per line: ('name', 'SKU', 'sub', [ 'uom',] list, cost, jsonb_build_object('k','v',...)),
  const re = /^\s*\('[^']*',\s*'([A-Z0-9-]+)',\s*'[^']*',\s*(?:'[^']*',\s*)?([\d.]+),\s*([\d.]+),\s*jsonb_build_object\((.*)\)\),?\s*$/;
  const out: DemoProduct[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const attrs: Record<string, string> = {};
    for (const p of m[4].matchAll(/'([^']*)'\s*,\s*'([^']*)'/g)) attrs[p[1]] = p[2];
    out.push({ sku: m[1], cost: Number(m[3]), attrs });
  }
  if (out.length < 26) throw new Error(`Expected 26 fence products in seed-fence-materials-demo.sql, read ${out.length}.`);
  return out;
}

// ── the sample estimates ─────────────────────────────────────────────────────

type Sample = { name: string; notes: string; params: Record<string, number | string | boolean> };

const SAMPLES: Sample[] = [
  {
    name: "Sample fence: logistics yard, Riyadh (illustrative)",
    notes: "Illustrative sample for demonstrations: placeholder costs, not a real price.",
    params: {
      total_length_m: 620, closed_perimeter: true, post_spacing_m: "vehicle", fabric_height_m: 2.4, mesh: "high_security", coating: "pvc",
      straining_spacing_m: 100, gates_single_n: 0, gates_single_w: 1.2, gates_double_n: 1, gates_double_w: 6, gates_sliding_n: 1, gates_sliding_w: 8,
      truss_rods: true, tension_wire: true, tie_wire: true, barbed_wire: true,
    },
  },
  {
    name: "Sample fence: bonded warehouse, Dammam (illustrative)",
    notes: "Illustrative sample for demonstrations: placeholder costs, not a real price.",
    params: {
      total_length_m: 340, closed_perimeter: true, post_spacing_m: "bonded", fabric_height_m: 3, mesh: "mini_mesh", coating: "pvc",
      straining_spacing_m: 100, gates_single_n: 1, gates_single_w: 1.2, gates_double_n: 2, gates_double_w: 5, gates_sliding_n: 0, gates_sliding_w: 6,
      truss_rods: true, tension_wire: true, tie_wire: true, barbed_wire: true,
    },
  },
];

function buildSample(sample: Sample, products: DemoProduct[]) {
  const tpl = starterBody(CHAINLINK_FENCE_STARTER);
  const first = computeEstimate(tpl, sample.params, { margin_pct: MARGIN_PCT, vat_pct: VAT_PCT });
  if (!first.ok) throw new Error(`${sample.name} does not compute: ${JSON.stringify(first.issues)}`);
  const unit: Record<string, number> = {};
  const pricing: Record<string, string> = {};
  const picked = new Map<string, DemoProduct>();
  for (const l of first.lines) {
    const attrs = parseMatchKey(l.sku ?? "");
    if (!attrs) throw new Error(`Line ${l.code} has no match key`);
    const hit = products.find((p) => Object.entries(attrs).every(([k, v]) => p.attrs[k] === v));
    if (!hit) throw new Error(`No demo product for ${l.code}: ${JSON.stringify(attrs)} (is it in seed-fence-materials-demo.sql?)`);
    unit[l.code] = hit.cost;
    pricing[l.code] = "product_cost";
    picked.set(l.code, hit);
  }
  const r = computeEstimate(tpl, sample.params, { margin_pct: MARGIN_PCT, vat_pct: VAT_PCT, unit_costs: unit });
  if (!r.ok) throw new Error(`${sample.name} does not compute: ${JSON.stringify(r.issues)}`);
  if (!r.complete) throw new Error(`${sample.name} has unpriced lines`);
  const lines = r.lines.map((l) => persistLine(l, null, null, { sku: picked.get(l.code)!.sku, ref: null }));
  const totals = { ...r.summary, unpriced: [], unresolved: [], pricing, warnings: r.warnings };
  return { sample, r, lines, totals };
}

function sampleBlock(s: ReturnType<typeof buildSample>, tplName: string): string {
  const n = sqlText(s.sample.name);
  return `
    -- ${s.sample.name}: ${s.lines.length} lines, cost ${s.r.summary.cost_total}, total incl. VAT ${s.r.summary.price_incl_vat}
    v_params := ${dq("params", s.r.params)};
    v_totals := ${dq("totals", s.totals)};
    v_model := ${dq("model", s.r.model)};
    v_lines := ${dq("lines", s.lines)};
    select id into est from estimates where tenant_id = t and name = ${n} order by created_at limit 1;
    fresh := false;
    if est is null then
      select nullif(config->>'currency', '') into cur from tenants where id = t;
      select coalesce(max(nullif(regexp_replace(ref, '\\D', '', 'g'), '')::int), 0) + 1 into next_seq
      from estimates where tenant_id = t and ref ~ '^EST-\\d+$';
      insert into estimates (tenant_id, ref, name, account_id, template_id, template_version, status, params, currency, margin_pct, totals, model, notes)
      values (
        t, 'EST-' || lpad(next_seq::text, 4, '0'), ${n}, acct, tpl, tpl_version, 'draft',
        v_params, cur, ${MARGIN_PCT},
        v_totals || jsonb_build_object('computed_at', now()),
        v_model,
        ${sqlText(s.sample.notes)}
      ) returning id into est;
      fresh := true;
    elsif exists (select 1 from estimates where id = est and tenant_id = t and standard_quote_id is null) then
      -- Refresh the existing sample (no quote yet): same figures as a new one, its own lines only.
      update estimates set
        template_id = tpl, template_version = tpl_version, params = v_params, margin_pct = ${MARGIN_PCT},
        totals = v_totals || jsonb_build_object('computed_at', now()),
        model = v_model, updated_at = now()
      where id = est and tenant_id = t;
      delete from estimate_lines where estimate_id = est and tenant_id = t;
      fresh := true;
    end if;
    if fresh then
      -- Each line links to the tenant's product with that SKU (seed-fence-materials-demo.sql).
      insert into estimate_lines (tenant_id, estimate_id, sort_order, code, group_key, description, uom, qty, waste_pct, unit_cost, cost_total, component, product_id, source, element_ref, wbs_code, custom_data)
      select t, est, (l->>'sort_order')::int, l->>'code', l->>'group_key', l->>'description', l->>'uom',
             (l->>'qty')::numeric, coalesce((l->>'waste_pct')::numeric, 0), (l->>'unit_cost')::numeric, (l->>'cost_total')::numeric,
             l->>'component',
             (select p.id from products p where p.tenant_id = t and p.sku = l->'custom_data'->>'sku' order by (p.status = 'active') desc, p.created_at limit 1),
             coalesce(l->>'source', 'rule'), l->>'element_ref', l->>'wbs_code', l->'custom_data'
      from jsonb_array_elements(v_lines) as l;
    end if;`;
}

const products = readDemoProducts();
const built = SAMPLES.map((s) => buildSample(s, products));

const demoSql = `-- Demo data for ESTIMATES (the unified Estimator), DEMO tenants only (is_demo = true).
-- Run AFTER, in this order:
--   1. supabase/migrations/0131_estimator.sql and 0213_estimate_template_catalogue.sql
--   2. scripts/seed-fence-materials-demo.sql   (the fence products and security profiles; NOT repeated here)
-- Idempotent. GENERATED by scripts/gen-estimate-seeds.ts from the real engine; do not edit by
-- hand, change src/lib/estimator/starterTemplates.ts or the products script and regenerate.
--
-- What it does, per demo tenant:
--   1. turns the Estimates module on (tenants.features.estimator = true) and the Products module
--      (the fence materials script already turns that one on);
--   2. refuses to go on if the fence products are missing (they are the catalogue the template
--      prices from: it picks each line's product by its fence_kind, pipe class, mesh and coating tags);
--   3. adds the locked "${CHAINLINK_FENCE_STARTER.name}" template (or refreshes it);
--   4. adds ${SAMPLES.length} sample fence estimates with their lines, totals and layout model already
--      stored, so the page shows everything without pressing Calculate. Margin ${MARGIN_PCT}%, VAT ${VAT_PCT}%.
--      A sample that already has a quote is left alone; nothing else is deleted.
-- Everything is illustrative: placeholder costs, not a real price or any company's method.
-- Does NOT touch Fence projects (fence_projects) or Big Blue.

do $seed$
declare
  t uuid;
  tpl uuid;
  tpl_version int;
  acct uuid;
  cur text;
  est uuid;
  next_seq int;
  fresh boolean;
  fence_products int;
  v_params jsonb;
  v_totals jsonb;
  v_model jsonb;
  v_lines jsonb;
begin${GUARD_0213}

  for t in select id from tenants where is_demo = true loop
    update tenants set features = coalesce(features, '{}'::jsonb) || '{"estimator": true, "products": true}'::jsonb where id = t;

    select count(*) into fence_products from products where tenant_id = t and custom_data->>'fence_kind' is not null;
    if fence_products < ${products.length} then
      raise exception 'The demo tenant has % fence products, expected at least ${products.length}. Run scripts/seed-fence-materials-demo.sql first.', fence_products;
    end if;
${installBlock(CHAINLINK_FENCE_STARTER, "    ")}

    select id, version into tpl, tpl_version from estimate_templates where tenant_id = t and lower(name) = lower(${sqlText(CHAINLINK_FENCE_STARTER.name)});
    select id into acct from accounts where tenant_id = t order by name limit 1;
${built.map((b) => sampleBlock(b, CHAINLINK_FENCE_STARTER.name)).join("\n")}
  end loop;
end
$seed$;
`;

writeFileSync(join(__dirname, "seed-estimate-templates-starter.sql"), startersSql(), "utf8");
writeFileSync(join(__dirname, "seed-estimates-demo.sql"), demoSql, "utf8");
writeFileSync(join(__dirname, BUNDLE_38_FILE), bundle38Sql(), "utf8");
for (const b of built) {
  console.error(`${b.sample.name}: ${b.lines.length} lines, ${b.r.model?.pieces.length ?? 0} pieces, cost ${b.r.summary.cost_total}, total incl. VAT ${b.r.summary.price_incl_vat}`);
}
console.error(`wrote scripts/seed-estimate-templates-starter.sql, scripts/seed-estimates-demo.sql and scripts/${BUNDLE_38_FILE}`);
