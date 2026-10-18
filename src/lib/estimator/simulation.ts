// Simulation maths (docs/estimator-architecture.md §10, §14): the schedule, the
// what-if and the Monte Carlo risk run. Pure and deterministic; nothing here
// touches the database, a clock or Math.random, so the same estimate and the
// same seed always give the same numbers. Runs in the browser.
//
// What is RECOMPUTED when a risk driver moves, and what is HELD FIXED
// (the contract the Simulation tab states to the user):
//
//   Recomputed, from the estimate's stored lines (which sum to the stored
//   `totals`, so the component breakdown reconciles):
//     - a line whose rule is priced by the driver's rate (cost.kind "rate")
//       scales by the driver's multiplier;
//     - a line whose quantity formula is directly PROPORTIONAL to the driver's
//       rate (`vol_total * labour_hours_per_m3`) scales by it too, which is how
//       a productivity range on "hours per m3" moves the labour cost;
//     - a line whose quantity formula reads group subtotals (`sub_<group>`,
//       i.e. overhead) scales with its base exactly as the engine would:
//       new cost = old cost x (new base / old base), the base being the lines
//       of those groups at their simulated cost.
//   Held fixed:
//     - quantities and geometry (piece counts, volumes, loads);
//     - the quote price, margin % and VAT of the stored estimate (the point of
//       the risk run is "what if the cost lands elsewhere while the price is
//       already promised");
//     - product-priced lines, manual lines, lines of rules no longer in the
//       template, and any rate used inside a non-proportional formula
//       (ceil, if, min ...), because their response is not a simple scaling.
//
// Rates opt in by carrying optional `low` / `high` (validated by template.ts).
// A triangular distribution (low, value, high) is sampled per driver.

import { formulaIdentifiers, parseFormula } from "./formula";
import type { FormulaAst } from "./formula";
import { DEFAULT_DENSITY_T_M3 } from "./geometry";
import { DEFAULT_LOAD_CAPACITY_T, LOAD_CAPACITY_RATE_KEY, SIM_CAPACITY_RATES } from "./simRates";
import type { SimCapacityKey } from "./simRates";
import { ESTIMATE_COMPONENTS } from "./types";
import type { EstimateComponent, EstimateLineSource, TemplateRate, TemplateRule } from "./types";

// ── Schedule ─────────────────────────────────────────────────────────────────

export type CapacityAssumption = {
  key: SimCapacityKey;
  label: string;
  unit: string;
  value: number;
  /** "template" when the template's rate was used, "default" otherwise. */
  source: "template" | "default";
};

export type GanttBar = { key: "casting" | "transport" | "erection"; label: string; start: number; end: number; days: number };

export type ScheduleSimulation = {
  /** False when there is no volume to schedule. */
  available: boolean;
  volume_m3: number;
  loads: number;
  bars: GanttBar[];
  total_days: number;
  assumptions: CapacityAssumption[];
  /** Plain-words notes (a capacity that was invalid and replaced by its default ...). */
  warnings: string[];
};

type RateLike = Pick<TemplateRate, "key" | "value">;

export function capacityAssumptions(rates: readonly RateLike[]): { assumptions: CapacityAssumption[]; warnings: string[] } {
  const byKey = new Map(rates.map((r) => [r.key, r.value]));
  const warnings: string[] = [];
  const assumptions = SIM_CAPACITY_RATES.map((spec): CapacityAssumption => {
    const v = byKey.get(spec.key);
    const valid = v !== undefined && Number.isFinite(v) && (spec.kind === "positive" ? v > 0 : v >= 0 && Number.isInteger(v));
    if (v !== undefined && !valid) warnings.push(`${spec.label} (${spec.key}) is ${v}, which cannot be used; the default ${spec.default} applies.`);
    return { key: spec.key, label: spec.label, unit: spec.unit, value: valid ? (v as number) : spec.default, source: valid ? "template" : "default" };
  });
  return { assumptions, warnings };
}

const capOf = (a: CapacityAssumption[], key: SimCapacityKey): number => a.find((x) => x.key === key)!.value;

/**
 * Casting, transport and erection windows (days, 0 = the first casting day).
 * Casting runs from day 0; transport and erection start on their template
 * start days and run for as long as their capacity needs; transport ends
 * before erection can finish and the total is whichever finishes last.
 */
export function simulateSchedule(input: { volume_m3: number; loads: number; rates: readonly RateLike[] }): ScheduleSimulation {
  const { assumptions, warnings } = capacityAssumptions(input.rates);
  const volume = Number.isFinite(input.volume_m3) && input.volume_m3 > 0 ? input.volume_m3 : 0;
  const loads = Number.isFinite(input.loads) && input.loads > 0 ? Math.ceil(input.loads) : 0;
  if (volume === 0) {
    return { available: false, volume_m3: 0, loads, bars: [], total_days: 0, assumptions, warnings };
  }
  const castDays = Math.max(1, Math.ceil(volume / capOf(assumptions, "cap_cast_m3_per_day")));
  const trDays = Math.max(1, Math.ceil(loads / capOf(assumptions, "cap_trucks_loads_per_day")));
  const erDays = Math.max(1, Math.ceil(volume / capOf(assumptions, "cap_crane_m3_per_day")));
  const trStart = capOf(assumptions, "transport_start_day");
  const erStart = capOf(assumptions, "erection_start_day");
  const trEnd = trStart + trDays;
  const erEnd = Math.max(trEnd + 1, erStart + erDays);
  const bars: GanttBar[] = [
    { key: "casting", label: "Casting in the factory", start: 0, end: castDays, days: castDays },
    { key: "transport", label: "Transport to site", start: trStart, end: trEnd, days: trDays },
    { key: "erection", label: "Crane and erection", start: erStart, end: erEnd, days: erEnd - erStart },
  ];
  return { available: true, volume_m3: volume, loads, bars, total_days: Math.max(castDays, erEnd), assumptions, warnings };
}

/**
 * The volume and the truck loads to schedule: the pieces' concrete volume, and
 * the loads the estimate already priced (lines measured in "load"), or else
 * the weight over the template's load capacity (documented default 25 t).
 */
export function scheduleQuantities(
  pieces: readonly { vol: number }[],
  lines: readonly Pick<SimLine, "uom" | "qty">[],
  rates: readonly RateLike[]
): { volume_m3: number; loads: number } {
  const volume = pieces.reduce((a, p) => a + (Number.isFinite(p.vol) ? p.vol : 0), 0);
  const priced = lines.filter((l) => (l.uom ?? "").toLowerCase() === "load").reduce((a, l) => a + l.qty, 0);
  if (priced > 0) return { volume_m3: volume, loads: Math.ceil(priced) };
  const cap = rates.find((r) => r.key === LOAD_CAPACITY_RATE_KEY)?.value;
  const capT = cap !== undefined && Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_LOAD_CAPACITY_T;
  const dens = rates.find((r) => /density_t_m3$/.test(r.key))?.value;
  const densT = dens !== undefined && Number.isFinite(dens) && dens > 0 ? dens : DEFAULT_DENSITY_T_M3;
  return { volume_m3: volume, loads: volume > 0 ? Math.ceil((volume * densT) / capT) : 0 };
}

// ── Cost model ───────────────────────────────────────────────────────────────

/** The line fields the simulation needs; estimate_lines rows fit. */
export type SimLine = {
  code: string | null;
  group_key: string | null;
  component: EstimateComponent | null;
  uom: string | null;
  qty: number;
  cost_total: number | null;
  source: EstimateLineSource;
};

export type RiskDriver = {
  key: string;
  label: string;
  unit: string;
  value: number;
  low: number;
  high: number;
  /** low / value and high / value: the multiplier range. */
  mult_low: number;
  mult_high: number;
  /** How many cost lines this driver moves. */
  lines: number;
};

type ModelLine = {
  component: EstimateComponent;
  group: string;
  base: number;
  /** Driver keys whose multiplier scales this line (a key can repeat: rate and quantity). */
  drivers: string[];
  /** Group slugs the line's quantity reads through sub_<group> (overhead). */
  baseGroups: string[] | null;
};

export type CostModel = {
  drivers: RiskDriver[];
  lines: ModelLine[];
  base_cost: number;
  base_by_component: Record<EstimateComponent, number>;
};

export type Multipliers = Readonly<Record<string, number>>;

const emptyByComponent = (): Record<EstimateComponent, number> =>
  Object.fromEntries(ESTIMATE_COMPONENTS.map((c) => [c, 0])) as Record<EstimateComponent, number>;

/** Rates that carry a usable risk range (value > 0, high above low). */
export function rangedRates(rates: readonly TemplateRate[]): TemplateRate[] {
  return rates.filter(
    (r) =>
      typeof r.low === "number" && typeof r.high === "number" &&
      Number.isFinite(r.low) && Number.isFinite(r.high) && Number.isFinite(r.value) &&
      r.value > 0 && r.low >= 0 && r.low <= r.value && r.value <= r.high && r.high > r.low
  );
}

/**
 * True when the formula's value is directly proportional to the identifier:
 * products and quotients where the identifier sits in exactly one factor.
 * Anything with ceil / if / min / comparisons answers false.
 */
export function isProportionalIn(ast: FormulaAst, name: string): boolean {
  const has = (n: FormulaAst): boolean => {
    switch (n.t) {
      case "id": return n.name === name;
      case "num": return false;
      case "unary": return has(n.arg);
      case "bin": return has(n.l) || has(n.r);
      case "call": return n.args.some(has);
    }
  };
  const walk = (n: FormulaAst): boolean => {
    switch (n.t) {
      case "id": return n.name === name;
      case "unary": return (n.op === "-" || n.op === "+") && walk(n.arg);
      case "bin":
        if (n.op === "*") return (walk(n.l) && !has(n.r)) || (walk(n.r) && !has(n.l));
        if (n.op === "/") return walk(n.l) && !has(n.r);
        if (n.op === "+" || n.op === "-") return walk(n.l) && walk(n.r);
        return false;
      default: return false;
    }
  };
  return walk(ast);
}

const SUB_PREFIX = "sub_";

/** Prepare the stored lines and the template's rates for repeated costing. */
export function buildCostModel(
  lines: readonly SimLine[],
  rules: readonly Pick<TemplateRule, "code" | "qty" | "cost">[],
  rates: readonly TemplateRate[]
): CostModel {
  const ranged = rangedRates(rates);
  const rangedKeys = new Set(ranged.map((r) => r.key));
  const ruleByCode = new Map(rules.map((r) => [r.code, r]));
  const asts = new Map<string, FormulaAst | null>();
  const astOf = (rule: Pick<TemplateRule, "code" | "qty">): FormulaAst | null => {
    if (!asts.has(rule.code)) {
      const p = parseFormula(rule.qty);
      asts.set(rule.code, p.ok ? p.ast : null);
    }
    return asts.get(rule.code) ?? null;
  };

  const out: ModelLine[] = [];
  const base_by_component = emptyByComponent();
  const touched = new Map<string, number>();
  for (const l of lines) {
    if (l.cost_total === null || !Number.isFinite(l.cost_total)) continue;
    const component = l.component ?? "other";
    base_by_component[component] += l.cost_total;
    const rule = l.source !== "manual" && l.code ? ruleByCode.get(l.code) : undefined;
    const drivers: string[] = [];
    let baseGroups: string[] | null = null;
    if (rule) {
      if (rule.cost.kind === "rate" && rangedKeys.has(rule.cost.rate)) drivers.push(rule.cost.rate);
      const ast = astOf(rule);
      if (ast) {
        // A schedule row's quantity comes from the file, not the formula.
        if (l.source !== "schedule") {
          for (const id of formulaIdentifiers(ast)) {
            if (rangedKeys.has(id.name) && isProportionalIn(ast, id.name)) drivers.push(id.name);
          }
        }
        const subs = formulaIdentifiers(ast).filter((id) => id.name.startsWith(SUB_PREFIX)).map((id) => id.name.slice(SUB_PREFIX.length));
        if (subs.length > 0) baseGroups = subs;
      }
    }
    for (const k of new Set(drivers)) touched.set(k, (touched.get(k) ?? 0) + (l.cost_total !== 0 ? 1 : 0));
    out.push({ component, group: l.group_key ?? "ungrouped", base: l.cost_total, drivers, baseGroups });
  }

  const drivers: RiskDriver[] = ranged
    .filter((r) => (touched.get(r.key) ?? 0) > 0)
    .map((r) => ({
      key: r.key, label: r.label, unit: r.unit, value: r.value,
      low: r.low as number, high: r.high as number,
      mult_low: (r.low as number) / r.value, mult_high: (r.high as number) / r.value,
      lines: touched.get(r.key) ?? 0,
    }));
  const base_cost = out.reduce((a, l) => a + l.base, 0);
  return { drivers, lines: out, base_cost, base_by_component };
}

export type CostResult = { cost: number; by_component: Record<EstimateComponent, number> };

/** The estimate's cost with each driver multiplied (missing = 1). See the header for the contract. */
export function costWithMultipliers(model: CostModel, multipliers: Multipliers = {}): CostResult {
  const scaled = new Array<number>(model.lines.length);
  const mOf = (k: string): number => {
    const m = multipliers[k];
    return typeof m === "number" && Number.isFinite(m) && m >= 0 ? m : 1;
  };
  const sumGroups = (groups: string[], use: (i: number) => number, skip: number): number => {
    let s = 0;
    model.lines.forEach((l, i) => { if (i !== skip && groups.includes(l.group)) s += use(i); });
    return s;
  };
  model.lines.forEach((l, i) => {
    if (l.baseGroups) return;
    let v = l.base;
    for (const k of l.drivers) v *= mOf(k);
    scaled[i] = v;
  });
  model.lines.forEach((l, i) => {
    if (!l.baseGroups) return;
    scaled[i] = 0; // a line never counts in its own base
    const oldBase = sumGroups(l.baseGroups, (j) => model.lines[j].base, i);
    const newBase = sumGroups(l.baseGroups, (j) => scaled[j] ?? model.lines[j].base, i);
    let v = oldBase > 0 ? l.base * (newBase / oldBase) : l.base;
    for (const k of l.drivers) v *= mOf(k);
    scaled[i] = v;
  });
  const by_component = emptyByComponent();
  let cost = 0;
  model.lines.forEach((l, i) => { by_component[l.component] += scaled[i]; cost += scaled[i]; });
  return { cost, by_component };
}

// ── What-if ──────────────────────────────────────────────────────────────────

export type WhatIfResult = {
  cost: number;
  by_component: Record<EstimateComponent, number>;
  margin_pct: number;
  price: number;
  price_incl_vat: number;
  /** Change against the stored estimate's cost / price. */
  cost_delta: number;
  price_delta: number;
};

/** The user's multipliers and margin applied: price = cost x (1 + margin %), VAT on the price. */
export function whatIf(
  model: CostModel,
  multipliers: Multipliers,
  opts: { margin_pct: number; vat_pct: number; base_price: number }
): WhatIfResult {
  const { cost, by_component } = costWithMultipliers(model, multipliers);
  const margin = Number.isFinite(opts.margin_pct) && opts.margin_pct >= 0 ? opts.margin_pct : 0;
  const price = cost * (1 + margin / 100);
  return {
    cost, by_component, margin_pct: margin, price,
    price_incl_vat: price * (1 + (Number.isFinite(opts.vat_pct) ? opts.vat_pct : 0) / 100),
    cost_delta: cost - model.base_cost,
    price_delta: price - opts.base_price,
  };
}

// ── Monte Carlo ──────────────────────────────────────────────────────────────

/** mulberry32: a small seeded generator, uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inverse-CDF sample of a triangular distribution (min a, mode b, max c) from u in [0, 1). */
export function triangular(u: number, a: number, b: number, c: number): number {
  if (!(c > a)) return b;
  const f = (b - a) / (c - a);
  return u < f ? a + Math.sqrt(u * (c - a) * (b - a)) : c - Math.sqrt((1 - u) * (c - a) * (c - b));
}

/** Value at quantile q of an ascending array (index floor(q * n), capped). */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
}

export type Histogram = { lo: number; hi: number; counts: number[] };

export function histogram(sorted: readonly number[], bins: number): Histogram {
  const n = Math.max(1, Math.floor(bins));
  const counts = new Array<number>(n).fill(0);
  if (sorted.length === 0) return { lo: 0, hi: 0, counts };
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const span = hi - lo;
  for (const x of sorted) counts[span > 0 ? Math.min(n - 1, Math.floor(((x - lo) / span) * n)) : 0]++;
  return { lo, hi, counts };
}

export type TornadoRow = { key: string; label: string; cost_low: number; cost_high: number; swing: number };

export type RiskOptions = {
  /** The quote price (before VAT) the simulated cost is compared with. */
  price: number;
  /** Markup on cost, percent, below which the margin counts as too thin. */
  target_margin_pct: number;
  /** What-if multipliers the whole distribution is shifted by. */
  multipliers?: Multipliers;
  seed?: number;
  runs?: number;
  bins?: number;
};

export type RiskResult =
  | { available: false; reason: string }
  | {
      available: true;
      seed: number;
      runs: number;
      price: number;
      target_margin_pct: number;
      /** Cost at the template values (and the what-if multipliers), no randomness. */
      likely: number;
      /** Ascending simulated costs. */
      samples: number[];
      p10: number;
      p50: number;
      p90: number;
      min: number;
      max: number;
      /** Share of runs (0 to 1) whose cost is above the quote price. */
      prob_over_price: number;
      /** Share of runs whose realised markup on cost falls under the target. */
      prob_below_target: number;
      histogram: Histogram;
      tornado: TornadoRow[];
    };

export const DEFAULT_SEED = 42;
export const DEFAULT_RUNS = 2000;
export const DEFAULT_BINS = 28;
const MAX_RUNS = 20_000;

/** Seeded Monte Carlo over the model's drivers. Same inputs and seed, same result. */
export function runRisk(model: CostModel, opts: RiskOptions): RiskResult {
  if (model.drivers.length === 0) return { available: false, reason: "No rate in this template has a risk range (low and high)." };
  if (!Number.isFinite(opts.price) || opts.price <= 0 || model.base_cost <= 0) {
    return { available: false, reason: "There is no cost or price to simulate yet." };
  }
  const seed = opts.seed ?? DEFAULT_SEED;
  const runs = Math.min(MAX_RUNS, Math.max(1, Math.floor(opts.runs ?? DEFAULT_RUNS)));
  const shift = opts.multipliers ?? {};
  const w = (k: string) => (typeof shift[k] === "number" && Number.isFinite(shift[k]) && shift[k] >= 0 ? shift[k] : 1);
  const rand = mulberry32(seed);
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const m: Record<string, number> = {};
    for (const d of model.drivers) m[d.key] = triangular(rand(), d.mult_low, 1, d.mult_high) * w(d.key);
    samples.push(costWithMultipliers(model, m).cost);
  }
  samples.sort((a, b) => a - b);

  const target = Number.isFinite(opts.target_margin_pct) && opts.target_margin_pct >= 0 ? opts.target_margin_pct : 0;
  let over = 0;
  let thin = 0;
  for (const x of samples) {
    if (x > opts.price) over++;
    if (x * (1 + target / 100) > opts.price) thin++;
  }

  const baseShift: Record<string, number> = {};
  for (const d of model.drivers) baseShift[d.key] = w(d.key);
  const tornado = model.drivers
    .map((d): TornadoRow => {
      const a = costWithMultipliers(model, { ...baseShift, [d.key]: d.mult_low * w(d.key) }).cost;
      const b = costWithMultipliers(model, { ...baseShift, [d.key]: d.mult_high * w(d.key) }).cost;
      return { key: d.key, label: d.label, cost_low: Math.min(a, b), cost_high: Math.max(a, b), swing: Math.abs(b - a) };
    })
    .sort((x, y) => y.swing - x.swing || x.key.localeCompare(y.key));

  return {
    available: true, seed, runs, price: opts.price, target_margin_pct: target,
    likely: costWithMultipliers(model, baseShift).cost,
    samples,
    p10: percentile(samples, 0.1), p50: percentile(samples, 0.5), p90: percentile(samples, 0.9),
    min: samples[0], max: samples[samples.length - 1],
    prob_over_price: over / runs, prob_below_target: thin / runs,
    histogram: histogram(samples, opts.bins ?? DEFAULT_BINS),
    tornado,
  };
}

/** The default "too thin" threshold: half of the estimate's own markup (the mock-up's rule). */
export const defaultTargetMargin = (margin_pct: number): number =>
  Number.isFinite(margin_pct) && margin_pct > 0 ? Math.round((margin_pct / 2) * 100) / 100 : 0;
