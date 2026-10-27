// The estimator's compute pipeline (docs/estimator-architecture.md §4):
//   inputs -> rule lines (quantities) -> priced lines -> group subtotals ->
//   cost build-up by component -> margin -> price -> VAT.
//
// A pure, deterministic function: the same template, parameters and options
// always give the same lines, in the same order, to the cent. Nothing here
// touches the database. Lines whose cost source is a catalogue product are
// returned with `needs_price: true` and their `sku`; the DB-touching step
// (phase E2, priceDocumentLine) resolves a unit cost for each and calls
// computeEstimate again with `unit_costs`, which fills them in and lets
// `sub_<group>` formulas (overhead) see the real figures. Rate lines are fully
// priced on the first pass.
//
// Rounding rules (one place, applied the same way everywhere):
//   - quantities are rounded to 3 decimals, half away from zero. The rounded
//     net quantity is what `qty_<code>` reads in later formulas, so a stored
//     line reproduces its own downstream numbers exactly.
//   - waste is a percent, rounded to 2 decimals; gross qty = net * (1 + waste/100),
//     rounded to 3 decimals. Cost is charged on the GROSS quantity.
//   - unit costs are kept to 4 decimals; line cost = gross qty * unit cost,
//     rounded to 2 decimals. Money is 2 decimals everywhere it is stored.
//   - subtotals and totals are sums of the already-rounded line costs, rounded
//     again only to remove float noise.
//   - margin is a MARKUP on cost: margin = cost * margin_pct / 100;
//     price = cost + margin; VAT = price * vat_pct / 100.
//   - a rule whose net quantity is zero produces no line (its `qty_<code>`
//     still reads 0). A negative quantity is an error.

import { evaluateAst, formulaIdentifiers, parseFormula, roundHalfAway } from "./formula";
import type { FormulaAst } from "./formula";
import { resolveParams, validateTemplate } from "./template";
import type { EstimateParams, TemplateIssue } from "./template";
import { getGeometry, pieceScope, markRange, densityFromRates } from "./geometry";
import type { GeometryModel } from "./geometry";
import { ESTIMATE_COMPONENTS, groupSlug } from "./types";
import { matchKeyOf, resolveMatchAttrs } from "./productMatch";
import type { EstimateComponent, EstimateLineSource, EstimateTemplateBody } from "./types";

export const QTY_DP = 3;
export const MONEY_DP = 2;
export const UNIT_COST_DP = 4;

export const roundQty = (x: number): number => roundHalfAway(x, QTY_DP);
export const roundMoney = (x: number): number => roundHalfAway(x, MONEY_DP);

/** Quantity of one imported element-schedule row, already mapped to a rule. */
export type ScheduleQty = {
  rule_code: string;
  /** Net quantity in the rule's unit. */
  qty: number;
  /** The row's mark, kept as the line's element_ref. */
  element_ref: string | null;
  /** Optional extra text appended to the rule description for this row. */
  label?: string | null;
};

export type ComputeOptions = {
  /** Markup on cost, percent. Default 0. */
  margin_pct?: number;
  /** VAT on the price, percent (from the tenant's tax settings). Default 0. */
  vat_pct?: number;
  /** Resolved unit cost per product rule, keyed by rule code (phase E2). */
  unit_costs?: Readonly<Record<string, number>>;
  /** Element-schedule quantities; a rule with rows here takes its quantity
   *  from them instead of its formula. */
  schedule?: readonly ScheduleQty[];
};

export type ComputedLine = {
  sort_order: number;
  code: string;
  group: string;
  group_key: string;
  description: string;
  uom: string;
  /** Net quantity (3 dp). */
  qty: number;
  waste_pct: number;
  /** Net quantity plus waste (3 dp): what is procured and what cost is charged on. */
  qty_gross: number;
  component: EstimateComponent;
  source: EstimateLineSource;
  element_ref: string | null;
  cost_kind: "product" | "rate";
  /** The item key the rule names: its SKU, or its product reference when it names only that. */
  sku: string | null;
  rate_key: string | null;
  /** True for a product line with no unit cost yet. */
  needs_price: boolean;
  unit_cost: number | null;
  cost_total: number | null;
  /** "1.1", "1.2", "2.1" -- group number, then line number inside the group. */
  wbs_code: string;
};

export type GroupTotal = {
  key: string;
  name: string;
  /** Group number, the group's WBS code ("1", "2", ...). */
  wbs_code: string;
  line_count: number;
  cost: number;
};

export type CostSummary = {
  cost_total: number;
  by_group: GroupTotal[];
  by_component: Record<EstimateComponent, number>;
  margin_pct: number;
  margin_amount: number;
  price: number;
  vat_pct: number;
  vat: number;
  price_incl_vat: number;
};

export type ComputeSuccess = {
  ok: true;
  lines: ComputedLine[];
  summary: CostSummary;
  /** Normalised input values (what the estimate stores as `params`). */
  params: EstimateParams;
  /** The exact piece model the lines were priced from (null for a formula-only
   *  template). Stored on the estimate as `model` so an old estimate keeps
   *  showing the model it was priced with. */
  model: GeometryModel | null;
  /** False while any product line still needs a price. */
  complete: boolean;
  /** Codes of product rules with no unit cost yet. */
  unpriced: string[];
  warnings: string[];
};

export type ComputeFailure = { ok: false; issues: TemplateIssue[] };
export type ComputeResult = ComputeSuccess | ComputeFailure;

const emptyByComponent = (): Record<EstimateComponent, number> =>
  Object.fromEntries(ESTIMATE_COMPONENTS.map((c) => [c, 0])) as Record<EstimateComponent, number>;

const sum = (xs: number[]): number => roundMoney(xs.reduce((a, b) => a + b, 0));

/** The line fields a summary needs; EstimateLine rows from the database fit. */
export type SummarisableLine = {
  group: string;
  group_key: string;
  component: EstimateComponent | null;
  cost_total: number | null;
};

/**
 * Roll lines up into group and component totals, margin, price and VAT.
 * Used by computeEstimate, and again by the routes after a manual line edit,
 * so a hand-edited estimate is totalled by exactly the same rules.
 */
export function summariseLines(
  lines: readonly SummarisableLine[],
  opts: { margin_pct?: number; vat_pct?: number } = {}
): CostSummary {
  const margin_pct = roundHalfAway(opts.margin_pct ?? 0, 2);
  const vat_pct = roundHalfAway(opts.vat_pct ?? 0, 2);
  const byComponent = emptyByComponent();
  const groups = new Map<string, { name: string; costs: number[]; count: number }>();
  const all: number[] = [];
  for (const l of lines) {
    const g = groups.get(l.group_key) ?? { name: l.group, costs: [], count: 0 };
    g.count++;
    groups.set(l.group_key, g);
    if (l.cost_total === null) continue;
    g.costs.push(l.cost_total);
    all.push(l.cost_total);
    const comp = l.component ?? "other";
    byComponent[comp] = roundMoney(byComponent[comp] + l.cost_total);
  }
  const cost_total = sum(all);
  const margin_amount = roundMoney((cost_total * margin_pct) / 100);
  const price = roundMoney(cost_total + margin_amount);
  const vat = roundMoney((price * vat_pct) / 100);
  return {
    cost_total,
    by_group: [...groups].map(([key, g], i) => ({
      key, name: g.name, wbs_code: String(i + 1), line_count: g.count, cost: sum(g.costs),
    })),
    by_component: byComponent,
    margin_pct,
    margin_amount,
    price,
    vat_pct,
    vat,
    price_incl_vat: roundMoney(price + vat),
  };
}

function fail(path: string, message: string): ComputeFailure {
  return { ok: false, issues: [{ path, message }] };
}

export function computeEstimate(
  template: EstimateTemplateBody,
  rawParams: Record<string, unknown> | null | undefined,
  opts: ComputeOptions = {}
): ComputeResult {
  const margin = opts.margin_pct ?? 0;
  const vat = opts.vat_pct ?? 0;
  if (!Number.isFinite(margin) || margin < 0 || margin > 1000) return fail("margin_pct", "Margin must be between 0 and 1000 percent.");
  if (!Number.isFinite(vat) || vat < 0 || vat > 100) return fail("vat_pct", "VAT must be between 0 and 100 percent.");

  const valid = validateTemplate(template);
  if (!valid.ok || !valid.template) return { ok: false, issues: valid.issues };
  const tpl = valid.template;

  const resolved = resolveParams(tpl.inputs, rawParams);
  if (!resolved.ok) return { ok: false, issues: resolved.issues };

  const scope: Record<string, number> = { ...resolved.scope };
  const rateByKey = new Map(tpl.rates.map((r) => [r.key, r.value]));
  for (const r of tpl.rates) scope[r.key] = r.value;

  const warnings: string[] = [];

  // Geometry: build the piece model once and put its totals in the formula
  // scope (vol_<code>, n_<code>, area_<code>, vol_total, weight_total ...).
  let model: GeometryModel | null = null;
  const mod = getGeometry(tpl.geometry);
  if (mod) {
    const moduleInputs: Record<string, number> = {};
    for (const spec of mod.inputs) {
      const v = scope[spec.key] ?? spec.default;
      if (v !== undefined) moduleInputs[spec.key] = v;
    }
    const laid = mod.layout(moduleInputs);
    if (!laid.ok) return fail("geometry", laid.error);
    model = laid.model;
    warnings.push(...model.warnings);
    Object.assign(scope, pieceScope(mod, model, densityFromRates(tpl.rates)));
  }
  const scheduleByRule = new Map<string, ScheduleQty[]>();
  const ruleByCode = new Map(tpl.rules.map((r) => [r.code, r]));
  for (const s of opts.schedule ?? []) {
    const rule = ruleByCode.get(s.rule_code);
    if (!rule || !rule.element_type) {
      warnings.push(`Schedule quantity for "${s.rule_code}" ignored: no rule with an element type has that code.`);
      continue;
    }
    if (!Number.isFinite(s.qty) || s.qty < 0) {
      return fail(`schedule.${s.rule_code}`, `Schedule quantity for "${s.rule_code}" must be zero or more.`);
    }
    const list = scheduleByRule.get(s.rule_code) ?? [];
    list.push(s);
    scheduleByRule.set(s.rule_code, list);
  }

  const lines: ComputedLine[] = [];
  const groupOrder: string[] = []; // slugs in order of first appearance
  const groupNos = new Map<string, number>(); // numbered by first EMITTED line, like summariseLines
  const groupName = new Map<string, string>();
  const groupRunning = new Map<string, number>();
  const groupLineNo = new Map<string, number>();
  const unpriced: string[] = [];

  for (const rule of tpl.rules) {
    const slug = groupSlug(rule.group);
    if (!groupName.has(slug)) {
      groupName.set(slug, rule.group);
      groupOrder.push(slug);
      groupRunning.set(slug, 0);
      groupLineNo.set(slug, 0);
      scope[`sub_${slug}`] = 0;
    }

    const evalNumber = (src: string, what: string): number | ComputeFailure => {
      const parsed = parseFormula(src);
      if (!parsed.ok) return fail(`rules.${rule.code}.${what}`, `Rule "${rule.code}": ${parsed.error.message}`);
      const r = evaluateAst(parsed.ast as FormulaAst, scope);
      if (!r.ok) return fail(`rules.${rule.code}.${what}`, `Rule "${rule.code}" ${what}: ${r.error.message}`);
      return r.value;
    };

    // Piece-backed line: its element_ref lists the marks of the piece families
    // its quantity formula reads (a range per family). A formula over a total
    // (vol_total ...) is building-wide and carries no marks.
    let pieceRef: string | null = null;
    if (model && mod) {
      const parsedQty = parseFormula(rule.qty);
      if (parsedQty.ok) {
        const refs: string[] = [];
        for (const id of formulaIdentifiers(parsedQty.ast)) {
          const m = /^(?:vol|n|area)_([A-Z0-9]+)$/.exec(id.name);
          if (!m || !mod.piece_codes.some((p) => p.code === m[1])) continue;
          const range = markRange(model, m[1]);
          if (range && !refs.includes(range)) refs.push(range);
        }
        pieceRef = refs.length > 0 ? refs.join(", ") : null;
      }
    }

    // Quantity: schedule rows win over the formula.
    const rows = scheduleByRule.get(rule.code);
    let netTotal: number;
    let entries: { qty: number; element_ref: string | null; label: string | null; source: EstimateLineSource }[];
    if (rows && rows.length > 0) {
      entries = rows.map((r) => ({ qty: roundQty(r.qty), element_ref: r.element_ref, label: r.label ?? null, source: "schedule" as const }));
      netTotal = roundQty(entries.reduce((a, e) => a + e.qty, 0));
    } else {
      const q = evalNumber(rule.qty, "qty");
      if (typeof q !== "number") return q;
      if (q < 0) return fail(`rules.${rule.code}.qty`, `Rule "${rule.code}" quantity is negative (${roundQty(q)}); check the formula and the inputs.`);
      netTotal = roundQty(q);
      entries = [{ qty: netTotal, element_ref: pieceRef, label: null, source: "rule" }];
    }
    scope[`qty_${rule.code}`] = netTotal;

    let waste = 0;
    if (typeof rule.waste_pct === "number") waste = rule.waste_pct;
    else if (typeof rule.waste_pct === "string") {
      const w = evalNumber(rule.waste_pct, "waste_pct");
      if (typeof w !== "number") return w;
      waste = w;
    }
    if (waste < 0 || waste > 100) return fail(`rules.${rule.code}.waste_pct`, `Rule "${rule.code}" waste works out to ${roundHalfAway(waste, 2)}%; it must be between 0 and 100.`);
    waste = roundHalfAway(waste, 2);

    // The item key the pricing step resolves: a SKU, a product reference, or (a rule that names
    // its product by attributes) a match key built from the chosen options.
    const itemKey = rule.cost.kind !== "product" ? null
      : rule.cost.sku ?? rule.cost.ref ?? (rule.cost.match ? matchKeyOf(resolveMatchAttrs(rule.cost.match, tpl.inputs, resolved.params)) : null);

    let unitCost: number | null;
    if (rule.cost.kind === "rate") {
      unitCost = roundHalfAway(rateByKey.get(rule.cost.rate) ?? 0, UNIT_COST_DP);
    } else {
      const supplied = opts.unit_costs?.[rule.code];
      unitCost = supplied !== undefined && Number.isFinite(supplied) && supplied >= 0 ? roundHalfAway(supplied, UNIT_COST_DP) : null;
    }
    const needsPrice = unitCost === null;
    if (needsPrice && netTotal > 0) unpriced.push(rule.code);

    for (const e of entries) {
      if (e.qty <= 0) continue;
      const gross = roundQty(e.qty * (1 + waste / 100));
      const cost = unitCost === null ? null : roundMoney(gross * unitCost);
      if (!groupNos.has(slug)) groupNos.set(slug, groupNos.size + 1);
      const groupNo = groupNos.get(slug);
      const n = (groupLineNo.get(slug) ?? 0) + 1;
      groupLineNo.set(slug, n);
      lines.push({
        sort_order: lines.length + 1,
        code: rule.code,
        group: rule.group,
        group_key: slug,
        description: e.label ? `${rule.description} - ${e.label}` : rule.description,
        uom: rule.uom,
        qty: e.qty,
        waste_pct: waste,
        qty_gross: gross,
        component: rule.component,
        source: e.source,
        element_ref: e.element_ref,
        cost_kind: rule.cost.kind,
        sku: itemKey,
        rate_key: rule.cost.kind === "rate" ? rule.cost.rate : null,
        needs_price: needsPrice,
        unit_cost: unitCost,
        cost_total: cost,
        wbs_code: `${groupNo}.${n}`,
      });
      if (cost !== null) groupRunning.set(slug, roundMoney((groupRunning.get(slug) ?? 0) + cost));
    }
    scope[`sub_${slug}`] = groupRunning.get(slug) ?? 0;
  }

  const summary = summariseLines(lines, { margin_pct: margin, vat_pct: vat });
  return {
    ok: true,
    lines,
    summary,
    params: resolved.params,
    model,
    complete: unpriced.length === 0,
    unpriced,
    warnings,
  };
}
