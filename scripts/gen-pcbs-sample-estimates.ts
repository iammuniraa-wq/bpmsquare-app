// Writes the two generated regions of scripts/seed-pcbs-sample.sql from the REAL estimator engine, so the sample estimates' lines,
// totals and quote lines are what "Calculate" and "Create quote" would produce, not hand-typed numbers.
//
//   npx jiti scripts/gen-pcbs-sample-estimates.ts --write   rewrites the regions between the BEGIN/END GENERATED markers in the seed
//
// Regions (both marked in the seed, never edit by hand, change this file and run it again):
//   ESTIMATES        the sample template "SAMPLE Precast building elements" and three estimates built from it, with their cost lines.
//                    No product is read or written: every cost line is priced from the template's own rates.
//   QUOTE LINES      the Standard Quote lines of the two estimates that were turned into an accepted quote (SQ-SMP-0004 and SQ-SMP-0005)
//
// Everything is illustrative: placeholder costs, not a real price or any company's method.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dq, sqlText } from "../src/lib/estimator/starterSeedSql";
import { computeEstimate } from "../src/lib/estimator/compute";
import { persistLine } from "../src/lib/estimator/lines";
import { buildQuoteLines } from "../src/lib/estimator/quoteLines";
import { validateTemplate } from "../src/lib/estimator/template";
import { groupSlug } from "../src/lib/estimator/types";
import type { EstimateTemplateBody, TemplateRule } from "../src/lib/estimator/types";

const VAT_PCT = 15;
const SEED = join(__dirname, "seed-pcbs-sample.sql");

// ── The sample template: one group per element, named the way the client names its elements ─────────────────────────────

const G_FND = "Precast foundation 1000 x 1000 x 1200";
const G_COL = "Precast column 400 x 400 x 4000";
const G_BEM = "Precast beam 300 x 600 x 6000";
const G_HC = "Hollow-core slab 200 mm";
const G_WAL = "Precast sandwich wall panel 2500 x 3000 x 200";
const G_STA = "Precast staircase flight 1200 x 3300";
const G_FIX = "Lifting inserts and fixings";
const G_DEL = "Transport and erection";

const CAST_M3 = "(qty_cf_conc + qty_cc_conc + qty_cb_conc + qty_cp_conc + qty_cs_conc)";
const WEIGHT = `(${CAST_M3} * concrete_density_t_m3 + slab_m2 * hc_t_per_m2)`;

const cast = (p: string, group: string, name: string, volume: string, rebarKey: string): TemplateRule[] => [
  { code: `${p}_conc`, group, description: `${name}: concrete`, uom: "m3", qty: volume, waste_pct: "concrete_waste_pct", component: "materials", cost: { kind: "rate", rate: "concrete_cost_m3" } },
  { code: `${p}_reb`, group, description: `${name}: reinforcement`, uom: "kg", qty: `qty_${p}_conc * ${rebarKey}`, waste_pct: 5, component: "materials", cost: { kind: "rate", rate: "rebar_cost_kg" } },
  { code: `${p}_mld`, group, description: `${name}: moulds`, uom: "m3", qty: `qty_${p}_conc`, component: "moulds", cost: { kind: "rate", rate: "mould_cost_m3" } },
  { code: `${p}_lab`, group, description: `${name}: casting labour`, uom: "h", qty: `qty_${p}_conc * casting_h_per_m3`, component: "labour", cost: { kind: "rate", rate: "casting_rate_hr" } },
];

export const SAMPLE_TEMPLATE: EstimateTemplateBody & { name: string; description: string; trade: string; quote_granularity: "group" | "line" } = {
  name: "SAMPLE Precast building elements",
  description: "Sample template for testing: a precast building priced by element (foundations, columns, beams, hollow-core floors, wall panels, stairs), with fixings, transport and erection. Every rate is an illustrative placeholder.",
  trade: "precast",
  quote_granularity: "group",
  inputs: [
    { key: "found_n", label: "Foundations 1000 x 1000 x 1200", type: "number", default: 400, min: 0, max: 20000, unit: "Nos", section: "Elements" },
    { key: "col_n", label: "Columns 400 x 400 x 4000", type: "number", default: 100, min: 0, max: 20000, unit: "Nos", section: "Elements" },
    { key: "beam_n", label: "Beams 300 x 600 x 6000", type: "number", default: 140, min: 0, max: 20000, unit: "Nos", section: "Elements" },
    { key: "slab_m2", label: "Hollow-core floor area, 200 mm", type: "number", default: 4800, min: 0, max: 200000, unit: "m2", section: "Elements" },
    { key: "panel_n", label: "Sandwich wall panels 2500 x 3000 x 200", type: "number", default: 0, min: 0, max: 20000, unit: "Nos", section: "Elements" },
    { key: "stair_n", label: "Staircase flights 1200 x 3300", type: "number", default: 0, min: 0, max: 2000, unit: "Nos", section: "Elements" },
    { key: "haul_km", label: "Distance to site", type: "number", default: 45, min: 0, max: 3000, unit: "km", section: "Delivery" },
  ],
  rates: [
    { key: "concrete_density_t_m3", label: "Concrete density", unit: "t/m3", value: 2.4 },
    { key: "concrete_waste_pct", label: "Wastage on concrete", unit: "%", value: 2 },
    { key: "hc_t_per_m2", label: "Weight of a hollow-core plank per m2", unit: "t/m2", value: 0.3 },
    { key: "rebar_kg_m3_found", label: "Reinforcement in foundations", unit: "kg/m3", value: 85 },
    { key: "rebar_kg_m3_col", label: "Reinforcement in columns", unit: "kg/m3", value: 220 },
    { key: "rebar_kg_m3_beam", label: "Reinforcement in beams", unit: "kg/m3", value: 190 },
    { key: "rebar_kg_m3_wall", label: "Reinforcement in wall panels", unit: "kg/m3", value: 70 },
    { key: "rebar_kg_m3_stair", label: "Reinforcement in stairs", unit: "kg/m3", value: 150 },
    { key: "concrete_cost_m3", label: "Precast concrete, supplied", unit: "per m3", value: 330, low: 297, high: 412 },
    { key: "rebar_cost_kg", label: "Reinforcement steel, cut and bent", unit: "per kg", value: 3.2, low: 2.72, high: 4.32 },
    { key: "mould_cost_m3", label: "Mould usage", unit: "per m3", value: 90, low: 80, high: 115 },
    { key: "casting_h_per_m3", label: "Casting and finishing hours per m3", unit: "h/m3", value: 3.5, low: 3.1, high: 4.4 },
    { key: "casting_rate_hr", label: "Casting labour rate", unit: "per h", value: 18, low: 16, high: 22 },
    { key: "hc_cost_m2", label: "Hollow-core plank 200 mm, supplied", unit: "per m2", value: 145, low: 130, high: 170 },
    { key: "hc_stitch_cost_m2", label: "Joint grout between planks", unit: "per m2", value: 6 },
    { key: "insulation_cost_m2", label: "Insulation board", unit: "per m2", value: 38 },
    { key: "insert_cost_nr", label: "Lifting insert 2.5 t", unit: "per nr", value: 32 },
    { key: "grout_cost_bag", label: "Non-shrink grout, 25 kg bag", unit: "per bag", value: 44 },
    { key: "sealant_cost_nr", label: "Joint sealant, 600 ml", unit: "per nr", value: 23 },
    { key: "transport_load_capacity_t", label: "Transport capacity per load", unit: "t/load", value: 25 },
    { key: "transport_cost_load_km", label: "Transport cost per load and km", unit: "per load-km", value: 4.5, low: 4, high: 6 },
    { key: "handling_cost_load", label: "Loading and unloading per load", unit: "per load", value: 120 },
    { key: "erect_t_per_day", label: "Erection output of crane and crew", unit: "t/day", value: 60 },
    { key: "crane_cost_day", label: "Mobile crane with operator", unit: "per day", value: 2600, low: 2300, high: 3200 },
    { key: "erection_crew_cost_day", label: "Erection crew (four people)", unit: "per day", value: 1400, low: 1250, high: 1700 },
  ],
  rules: [
    ...cast("cf", G_FND, "Foundations", "found_n * 1 * 1 * 1.2", "rebar_kg_m3_found"),
    ...cast("cc", G_COL, "Columns", "col_n * 0.4 * 0.4 * 4", "rebar_kg_m3_col"),
    ...cast("cb", G_BEM, "Beams", "beam_n * 0.3 * 0.6 * 6", "rebar_kg_m3_beam"),
    { code: "ch_sup", group: G_HC, description: "Hollow-core planks 200 mm, supplied", uom: "m2", qty: "slab_m2", component: "materials", cost: { kind: "rate", rate: "hc_cost_m2" } },
    { code: "ch_jnt", group: G_HC, description: "Joint grout between planks", uom: "m2", qty: "slab_m2", component: "materials", cost: { kind: "rate", rate: "hc_stitch_cost_m2" } },
    ...cast("cp", G_WAL, "Wall panels", "panel_n * 2.5 * 3 * 0.2", "rebar_kg_m3_wall"),
    { code: "cp_ins", group: G_WAL, description: "Wall panels: insulation board", uom: "m2", qty: "panel_n * 2.5 * 3", component: "materials", cost: { kind: "rate", rate: "insulation_cost_m2" } },
    ...cast("cs", G_STA, "Staircase flights", "stair_n * 0.85", "rebar_kg_m3_stair"),
    { code: "fx_ins", group: G_FIX, description: "Lifting inserts 2.5 t", uom: "nr", qty: `ceil(${CAST_M3} / 1.2)`, component: "materials", cost: { kind: "rate", rate: "insert_cost_nr" } },
    { code: "fx_grt", group: G_FIX, description: "Non-shrink grout at column bases and bearings", uom: "bag", qty: "ceil(col_n * 1.5 + beam_n * 0.5)", component: "materials", cost: { kind: "rate", rate: "grout_cost_bag" } },
    { code: "fx_sea", group: G_FIX, description: "Joint sealant", uom: "nr", qty: "ceil(panel_n * 0.6 + slab_m2 / 40)", component: "materials", cost: { kind: "rate", rate: "sealant_cost_nr" } },
    { code: "hlg", group: G_DEL, description: "Transport to site (loads by weight, by distance)", uom: "load-km", qty: `ceil(${WEIGHT} / transport_load_capacity_t) * haul_km`, component: "transport", cost: { kind: "rate", rate: "transport_cost_load_km" } },
    { code: "hdl", group: G_DEL, description: "Loading and unloading", uom: "load", qty: `ceil(${WEIGHT} / transport_load_capacity_t)`, component: "transport", cost: { kind: "rate", rate: "handling_cost_load" } },
    { code: "crn", group: G_DEL, description: "Erection crane (days by weight)", uom: "day", qty: `ceil(${WEIGHT} / erect_t_per_day)`, component: "erection", cost: { kind: "rate", rate: "crane_cost_day" } },
    { code: "crw", group: G_DEL, description: "Erection crew (same days as the crane)", uom: "day", qty: "qty_crn", component: "erection", cost: { kind: "rate", rate: "erection_crew_cost_day" } },
  ],
};

const t2 = validateTemplate({ inputs: SAMPLE_TEMPLATE.inputs, rates: SAMPLE_TEMPLATE.rates, rules: SAMPLE_TEMPLATE.rules });
if (!t2.ok || !t2.template) throw new Error(`The sample template does not validate: ${JSON.stringify(t2.issues)}`);
const T2 = t2.template;

// ── The three estimates ───────────────────────────────────────────────────────────────────────────────────────────────────

type Params = Record<string, number | string | boolean>;
type Sample = { n: number; name: string; notes: string; params: Params; margin: number; account: number; contact: number; status: "quoted" | "draft"; dealNo: number | null };

const SAMPLES: Sample[] = [
  {
    n: 1, name: "SAMPLE Najd Horizon villa compound, precast package", account: 1, contact: 2, margin: 18, status: "quoted", dealNo: null,
    notes: "Sample for testing: made into the accepted quote SQ-SMP-0004, which became a contract project. Illustrative placeholder costs.",
    params: { found_n: 400, col_n: 96, beam_n: 140, slab_m2: 4800, panel_n: 220, stair_n: 16, haul_km: 40 },
  },
  {
    n: 2, name: "SAMPLE Sahab warehouse frame, precast package", account: 2, contact: 3, margin: 16, status: "quoted", dealNo: null,
    notes: "Sample for testing: made into the accepted quote SQ-SMP-0005, which has no contract project yet: press Create contract project on it. Illustrative placeholder costs.",
    params: { found_n: 180, col_n: 90, beam_n: 120, slab_m2: 6200, panel_n: 0, stair_n: 0, haul_km: 60 },
  },
  {
    n: 3, name: "SAMPLE Retail podium frame, Qasr Al Sharq", account: 5, contact: 9, margin: 15, status: "draft", dealNo: 6,
    notes: "Sample for testing: a draft estimate attached to the podium deal; no quote yet, press Create quote. Illustrative placeholder costs.",
    params: { found_n: 60, col_n: 44, beam_n: 64, slab_m2: 5000, panel_n: 0, stair_n: 8, haul_km: 90 },
  },
];


type Built = ReturnType<typeof build>;
function build(s: Sample) {
  const r = computeEstimate(T2, s.params, { margin_pct: s.margin, vat_pct: VAT_PCT });
  if (!r.ok) throw new Error(`${s.name} does not compute: ${JSON.stringify(r.issues)}`);
  if (!r.complete) throw new Error(`${s.name} has unpriced lines`);
  const lines = r.lines.map((l) => persistLine(l, null, null, null));
  const totals = { ...r.summary, unpriced: [], unresolved: [], pricing: {}, warnings: r.warnings };
  return { s, r, lines, totals };
}
const built: Built[] = SAMPLES.map(build);

// ── The quote lines of the two accepted quotes: one line per group, named as the group, in Nos / m2 like the client's own ───────

const GROUP_COUNT: Record<string, { key: string; uom: string } | null> = {
  [G_FND]: { key: "found_n", uom: "Nos" }, [G_COL]: { key: "col_n", uom: "Nos" }, [G_BEM]: { key: "beam_n", uom: "Nos" },
  [G_HC]: { key: "slab_m2", uom: "m2" }, [G_WAL]: { key: "panel_n", uom: "Nos" }, [G_STA]: { key: "stair_n", uom: "Nos" },
  [G_FIX]: null, [G_DEL]: null,
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function quoteLinesFor(b: Built) {
  const src = b.r.lines.map((l) => ({ description: l.description, uom: l.uom, qty: l.qty, waste_pct: l.waste_pct, group: l.group, group_key: l.group_key, cost_total: l.cost_total }));
  const q = buildQuoteLines(src, { granularity: "group", margin_pct: b.s.margin });
  if (!q.ok) throw new Error(`${b.s.name} cannot be quoted: ${q.problems.join(" ")}`);
  return q.lines.map((l) => {
    const count = GROUP_COUNT[l.description];
    const qty = count ? Number(b.s.params[count.key]) : 1;
    const uom = count ? count.uom : "lot";
    const rate = qty > 0 ? round2(l.amount / qty) : l.amount;
    return { description: l.description, uom, qty, rate, amount: round2(qty * rate) };
  });
}

// ── SQL ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const num = (v: number | null | undefined) => (v === null || v === undefined ? "null" : String(v));

function estimateBlock(b: Built): string {
  const s = b.s;
  const tplVar = "v_t2";
  const verVar = "v_t2_ver";
  const first = `    -- ${s.name}: ${b.lines.length} lines, cost ${b.r.summary.cost_total}, price ${b.r.summary.price}, total incl. VAT ${b.r.summary.price_incl_vat}`;
  const lineRows = b.lines.map((l, i) => {
    return `      (${s.n * 100 + i + 1}, ${i}, ${sqlText(String(l.code))}, ${sqlText(String(l.group_key))}, ${sqlText(l.description)}, ${sqlText(l.uom ?? "")}, ${l.qty}, ${l.waste_pct ?? 0}, ${num(l.unit_cost)}, ${num(l.cost_total)}, ${sqlText(String(l.component))}, ${sqlText(String(l.source ?? "rule"))}, ${sqlText(String(l.wbs_code ?? ""))}, ${dq("cd", l.custom_data ?? {})})`;
  });
  return `${first}
    if not exists (select 1 from estimates e where e.tenant_id = t and e.id = pg_temp.pcbs_id(6, ${s.n})) then
      insert into estimates (id, tenant_id, ref, name, account_id, contact_id, template_id, template_version, status, params, currency, margin_pct, totals, model, notes, opportunity_id, created_at, updated_at)
      values (
        pg_temp.pcbs_id(6, ${s.n}), t, pg_temp.pcbs_ref('estimates', t, 'EST'), ${sqlText(s.name)},
        pg_temp.pcbs_id(1, ${s.account}), pg_temp.pcbs_id(2, ${s.contact}), ${tplVar}, ${verVar}, 'draft',
        ${dq("params", b.r.params)}, v_cur, ${s.margin},
        ${dq("totals", b.totals)} || jsonb_build_object('computed_at', now()),
        ${b.r.model ? dq("model", b.r.model) : "null"},
        ${sqlText(s.notes)}, ${s.dealNo ? `pg_temp.pcbs_id(8, ${s.dealNo})` : "null"}, now() - interval '${14 + s.n * 3} days', now() - interval '${10 + s.n} days'
      );
      insert into estimate_lines (id, tenant_id, estimate_id, sort_order, code, group_key, description, uom, qty, waste_pct, unit_cost, cost_total, component, source, wbs_code, custom_data)
      select pg_temp.pcbs_id(7, el.k), t, pg_temp.pcbs_id(6, ${s.n}), el.so, el.cd, el.gk, el.ds, el.um, el.qt, el.wp, el.uc, el.ct, el.cp,
             el.src, el.wbs, el.cu
      from (values
${lineRows.join(",\n")}
      ) as el(k, so, cd, gk, ds, um, qt, wp, uc, ct, cp, src, wbs, cu);
    end if;`;
}

function templateInsert(varId: string, kind: number, name: string, description: string, trade: string, granularity: string, body: EstimateTemplateBody, extra: { keywords?: string[]; icon?: string; locked: boolean; visual?: unknown }): string {
  const kw = extra.keywords && extra.keywords.length > 0 ? `array[${extra.keywords.map(sqlText).join(", ")}]::text[]` : "null";
  return `insert into estimate_templates (id, tenant_id, name, description, trade, version, is_active, quote_granularity, inputs, rates, rules, keywords, icon, locked, customer_visible, visual)
      values (
        pg_temp.pcbs_id(${kind}, ${varId}), t, ${sqlText(name)}, ${sqlText(description)}, ${sqlText(trade)}, 1, true, ${sqlText(granularity)},
        ${dq("inputs", body.inputs)},
        ${dq("rates", body.rates)},
        ${dq("rules", body.rules)},
        ${kw}, ${extra.icon ? sqlText(extra.icon) : "null"}, ${extra.locked ? "true" : "false"}, false, ${extra.visual ? dq("visual", extra.visual) : "null"}
      );`;
}

function estimatesRegion(): string {
  return `do $est$
declare
  t uuid;
  v_cur text;
  v_t2 uuid;
  v_t2_ver int;
begin
  select id, coalesce(nullif(config->>'currency', ''), 'SAR') into t, v_cur from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No workspace with slug pcbs here. Estimates: nothing was created.';
    return;
  end if;
  if to_regclass('public.estimates') is null or to_regclass('public.estimate_lines') is null or to_regclass('public.estimate_templates') is null then
    raise notice 'The estimator tables (migration 0131) are missing: no templates and no estimates were created.';
    return;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'estimate_templates' and column_name = 'locked')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'estimates' and column_name = 'opportunity_id') then
    raise notice 'Migrations 0213 and 0227 are missing: no templates and no estimates were created. Run them and run this script again.';
    return;
  end if;

  -- The sample template: the elements named the way the client names them, every cost from the template's own rates.
  select id, version into v_t2, v_t2_ver from estimate_templates where tenant_id = t and id = pg_temp.pcbs_id(5, 2);
  if v_t2 is null then
    ${templateInsert("2", 5, SAMPLE_TEMPLATE.name, SAMPLE_TEMPLATE.description, SAMPLE_TEMPLATE.trade, SAMPLE_TEMPLATE.quote_granularity, T2, { keywords: ["precast", "foundations", "columns", "beams", "hollow core", "wall panels", "stairs"], icon: "building", locked: false })}
    select id, version into v_t2, v_t2_ver from estimate_templates where tenant_id = t and id = pg_temp.pcbs_id(5, 2);
  end if;

${built.map(estimateBlock).join("\n\n")}

  raise notice 'PCBS sample estimates are in place (3 estimates and the sample template).';
end $est$;`;
}

function quoteLinesRegion(): string {
  const rows: string[] = [];
  for (const b of built.filter((x) => x.s.status === "quoted")) {
    const quoteNo = b.s.n === 1 ? 4 : 5;
    quoteLinesFor(b).forEach((l, i) => {
      rows.push(`      (${quoteNo}, ${i + 1}, ${sqlText(l.description)}, ${sqlText(l.uom)}, ${l.qty}, ${l.rate}, 0)`);
    });
  }
  return rows.join(",\n");
}

function patch(text: string, tag: string, body: string): string {
  const re = new RegExp(`(-- BEGIN GENERATED ${tag}[^\\n]*\\n)[\\s\\S]*?(-- END GENERATED ${tag})`);
  if (!re.test(text)) throw new Error(`Markers for ${tag} not found in the seed`);
  return text.replace(re, (_m, a: string, z: string) => `${a}${body}\n${z}`);
}

/** The two generated regions of the seed, exactly as they are written between the markers (a test holds the committed seed to this). */
export function generate(): { estimates: string; quoteLines: string; summary: string[] } {
  const summary: string[] = [];
  for (const b of built) summary.push(`${b.s.name}: ${b.lines.length} lines, cost ${b.r.summary.cost_total}, price ${b.r.summary.price}, incl. VAT ${b.r.summary.price_incl_vat}`);
  for (const b of built.filter((x) => x.s.status === "quoted")) {
    const ql = quoteLinesFor(b);
    summary.push(`quote lines of ${b.s.name}: ${ql.length}, subtotal ${round2(ql.reduce((s, l) => s + l.amount, 0))}`);
  }
  return { estimates: estimatesRegion(), quoteLines: quoteLinesRegion(), summary };
}

// Only `--write` changes the seed: importing this file (the test does) has no side effect.
if (process.argv.includes("--write")) {
  const g = generate();
  const seed = readFileSync(SEED, "utf8").replaceAll("\r\n", "\n");
  let out = patch(seed, "ESTIMATES", g.estimates);
  out = patch(out, "QUOTE LINES", g.quoteLines);
  writeFileSync(SEED, out, "utf8");
  for (const line of g.summary) console.error(line);
  console.error(`wrote ${SEED}`);
}
void groupSlug;
