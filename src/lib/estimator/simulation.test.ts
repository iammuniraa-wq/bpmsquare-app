import { describe, expect, it } from "vitest";
import { computeEstimate } from "./compute";
import type { ComputeSuccess } from "./compute";
import { PRECAST_VILLA_STARTER } from "./starterTemplates";
import {
  buildCostModel, capacityAssumptions, costWithMultipliers, defaultTargetMargin, histogram, isProportionalIn,
  mulberry32, percentile, rangedRates, runRisk, scheduleQuantities, simulateSchedule, triangular, whatIf,
} from "./simulation";
import type { CostModel, SimLine } from "./simulation";
import { parseFormula } from "./formula";
import type { EstimateTemplateBody } from "./types";

const compute = (tpl: EstimateTemplateBody = PRECAST_VILLA_STARTER) => {
  const r = computeEstimate(tpl, null, { margin_pct: 18, vat_pct: 15 });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r as ComputeSuccess;
};

const toSim = (r: ComputeSuccess): SimLine[] =>
  r.lines.map((l) => ({ code: l.code, group_key: l.group_key, component: l.component, uom: l.uom, qty: l.qty, cost_total: l.cost_total, source: l.source }));

const base = compute();
const lines = toSim(base);
const model: CostModel = buildCostModel(lines, PRECAST_VILLA_STARTER.rules, PRECAST_VILLA_STARTER.rates);

const withRate = (key: string, factor: number): EstimateTemplateBody => ({
  ...PRECAST_VILLA_STARTER,
  rates: PRECAST_VILLA_STARTER.rates.map((r) => (r.key === key ? { ...r, value: r.value * factor } : r)),
});

describe("rangedRates", () => {
  it("keeps only rates with a usable low <= value <= high", () => {
    const keys = rangedRates(PRECAST_VILLA_STARTER.rates).map((r) => r.key);
    expect(keys).toEqual([
      "concrete_cost_m3", "rebar_cost_kg", "insulation_cost_m2", "fixing_cost_nr",
      "labour_hours_per_m3", "labour_rate_hr", "transport_cost_load", "erection_cost_m3",
    ]);
    const odd = [
      { key: "a", label: "a", unit: "", value: 10, low: 12, high: 20 },
      { key: "b", label: "b", unit: "", value: 10, low: 5, high: 10, },
      { key: "c", label: "c", unit: "", value: 10 },
      { key: "d", label: "d", unit: "", value: 0, low: 0, high: 2 },
      { key: "e", label: "e", unit: "", value: 10, low: 10, high: 10 },
    ];
    expect(rangedRates(odd).map((r) => r.key)).toEqual(["b"]);
  });
});

describe("isProportionalIn", () => {
  const p = (src: string, name: string) => {
    const r = parseFormula(src);
    if (!r.ok) throw new Error(src);
    return isProportionalIn(r.ast, name);
  };
  it("accepts products, quotients and sums of proportional terms", () => {
    expect(p("vol_total * hours", "hours")).toBe(true);
    expect(p("hours * 2 * vol_total", "hours")).toBe(true);
    expect(p("vol / speed", "vol")).toBe(true);
    expect(p("a * k + b * k", "k")).toBe(true);
    expect(p("-(k * 3)", "k")).toBe(true);
  });
  it("rejects ceil, if, a divisor, a constant offset and the same name twice", () => {
    expect(p("ceil(vol / k)", "k")).toBe(false);
    expect(p("vol / k", "k")).toBe(false);
    expect(p("if(k > 1, 2, 3) * vol", "k")).toBe(false);
    expect(p("vol * k + 5", "k")).toBe(false);
    expect(p("k * k", "k")).toBe(false);
    expect(p("vol * 2", "k")).toBe(false);
  });
});

describe("cost model reconciles with the stored totals", () => {
  it("at multiplier 1 it equals the engine's cost and component breakdown", () => {
    const r = costWithMultipliers(model, {});
    expect(r.cost).toBeCloseTo(base.summary.cost_total, 2);
    for (const [k, v] of Object.entries(base.summary.by_component)) expect(r.by_component[k as keyof typeof r.by_component]).toBeCloseTo(v, 2);
    expect(model.base_cost).toBeCloseTo(base.summary.cost_total, 2);
  });

  it("finds the eight drivers of the starter, each moving at least one line", () => {
    expect(model.drivers.map((d) => d.key).sort()).toEqual([
      "concrete_cost_m3", "erection_cost_m3", "fixing_cost_nr", "insulation_cost_m2",
      "labour_hours_per_m3", "labour_rate_hr", "rebar_cost_kg", "transport_cost_load",
    ]);
    const conc = model.drivers.find((d) => d.key === "concrete_cost_m3")!;
    expect(conc.mult_low).toBeCloseTo(0.9, 6);
    expect(conc.mult_high).toBeCloseTo(1.25, 6);
    expect(conc.lines).toBeGreaterThan(3);
  });

  // The strongest check: moving a rate in the template and re-running the real
  // engine gives the same cost as scaling the stored lines (to rounding).
  it.each([
    ["concrete_cost_m3", 1.25],
    ["rebar_cost_kg", 0.85],
    ["labour_rate_hr", 1.2],
    ["labour_hours_per_m3", 1.25],
    ["insulation_cost_m2", 1.15],
    ["fixing_cost_nr", 0.9],
    ["transport_cost_load", 1.3],
    ["erection_cost_m3", 1.25],
  ])("matches the engine when %s is x%s (overhead follows its base)", (key, f) => {
    const engine = compute(withRate(key, f)).summary.cost_total;
    const sim = costWithMultipliers(model, { [key]: f }).cost;
    expect(Math.abs(sim - engine)).toBeLessThan(1);
  });

  it("matches the engine with several drivers moved together", () => {
    let tpl = withRate("concrete_cost_m3", 1.1);
    tpl = { ...tpl, rates: tpl.rates.map((r) => (r.key === "labour_rate_hr" ? { ...r, value: r.value * 1.2 } : r.key === "rebar_cost_kg" ? { ...r, value: r.value * 0.9 } : r)) };
    const engine = compute(tpl).summary.cost_total;
    const sim = costWithMultipliers(model, { concrete_cost_m3: 1.1, labour_rate_hr: 1.2, rebar_cost_kg: 0.9 }).cost;
    expect(Math.abs(sim - engine)).toBeLessThan(1);
  });

  it("overhead is not moved by insulation or transport (outside its base)", () => {
    const a = costWithMultipliers(model, {}).by_component.overhead;
    expect(costWithMultipliers(model, { insulation_cost_m2: 1.15, transport_cost_load: 1.3 }).by_component.overhead).toBeCloseTo(a, 6);
    expect(costWithMultipliers(model, { concrete_cost_m3: 1.25 }).by_component.overhead).toBeGreaterThan(a);
  });

  it("holds manual lines, product lines and unknown codes fixed", () => {
    const extra: SimLine[] = [
      ...lines,
      { code: "ma_1", group_key: "extras", component: "other", uom: "nr", qty: 1, cost_total: 500, source: "manual" },
      { code: "gone", group_key: "extras", component: "other", uom: "nr", qty: 1, cost_total: 250, source: "rule" },
    ];
    const m = buildCostModel(extra, PRECAST_VILLA_STARTER.rules, PRECAST_VILLA_STARTER.rates);
    const everything = Object.fromEntries(m.drivers.map((d) => [d.key, 1.5]));
    const scaledOnly = costWithMultipliers(model, everything).cost;
    expect(costWithMultipliers(m, everything).cost).toBeCloseTo(scaledOnly + 750, 6);
  });

  it("ignores a lines-less estimate and unranged templates", () => {
    const empty = buildCostModel([], PRECAST_VILLA_STARTER.rules, PRECAST_VILLA_STARTER.rates);
    expect(empty.drivers).toEqual([]);
    expect(costWithMultipliers(empty, { concrete_cost_m3: 2 }).cost).toBe(0);
    const unranged = buildCostModel(lines, PRECAST_VILLA_STARTER.rules, PRECAST_VILLA_STARTER.rates.map(({ key, label, unit, value }) => ({ key, label, unit, value })));
    expect(unranged.drivers).toEqual([]);
  });

  it("a schedule row's quantity is not driven by a quantity-formula rate", () => {
    const sched = lines.map((l) => (l.code === "lab" ? { ...l, source: "schedule" as const } : l));
    const m = buildCostModel(sched, PRECAST_VILLA_STARTER.rules, PRECAST_VILLA_STARTER.rates);
    const labHours = costWithMultipliers(m, { labour_hours_per_m3: 1.25 }).cost;
    expect(labHours).toBeCloseTo(m.base_cost, 6);
  });
});

describe("what-if", () => {
  it("applies multipliers and margin, price = cost x (1 + margin)", () => {
    const w = whatIf(model, { concrete_cost_m3: 1.1 }, { margin_pct: 20, vat_pct: 15, base_price: base.summary.price });
    expect(w.cost).toBeGreaterThan(model.base_cost);
    expect(w.price).toBeCloseTo(w.cost * 1.2, 6);
    expect(w.price_incl_vat).toBeCloseTo(w.price * 1.15, 6);
    expect(w.cost_delta).toBeCloseTo(w.cost - model.base_cost, 6);
    expect(w.price_delta).toBeCloseTo(w.price - base.summary.price, 6);
  });
  it("no change gives zero cost delta", () => {
    expect(whatIf(model, {}, { margin_pct: 18, vat_pct: 15, base_price: base.summary.price }).cost_delta).toBeCloseTo(0, 6);
  });
  it("ignores nonsense multipliers", () => {
    const w = whatIf(model, { concrete_cost_m3: Number.NaN, rebar_cost_kg: -1 }, { margin_pct: -5, vat_pct: 0, base_price: 0 });
    expect(w.cost).toBeCloseTo(model.base_cost, 6);
    expect(w.margin_pct).toBe(0);
  });
});

describe("random numbers", () => {
  it("mulberry32 is deterministic and in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });
  it("triangular stays in range, is the mode at the mode's quantile, and degenerates safely", () => {
    for (const u of [0, 0.01, 0.3, 0.5, 0.99, 0.999999]) {
      const x = triangular(u, 0.9, 1, 1.25);
      expect(x).toBeGreaterThanOrEqual(0.9);
      expect(x).toBeLessThanOrEqual(1.25);
    }
    expect(triangular((1 - 0.9) / (1.25 - 0.9), 0.9, 1, 1.25)).toBeCloseTo(1, 6);
    expect(triangular(0.4, 1, 1, 1)).toBe(1);
  });
  it("percentile and histogram handle empty and flat inputs", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
    expect(histogram([], 5).counts).toEqual([0, 0, 0, 0, 0]);
    expect(histogram([7, 7, 7], 4).counts).toEqual([3, 0, 0, 0]);
    const h = histogram([0, 1, 2, 3, 4, 10], 5);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(6);
    expect(h.lo).toBe(0);
    expect(h.hi).toBe(10);
  });
});

describe("runRisk", () => {
  const opts = { price: base.summary.price, target_margin_pct: defaultTargetMargin(18) };

  it("is deterministic for a seed and different for another", () => {
    const a = runRisk(model, opts);
    const b = runRisk(model, opts);
    expect(a).toEqual(b);
    const c = runRisk(model, { ...opts, seed: 7 });
    expect(c.available && a.available && c.p50 !== a.p50).toBe(true);
  });

  it("orders its percentiles and brackets the likely cost", () => {
    const r = runRisk(model, opts);
    if (!r.available) throw new Error("expected a result");
    expect(r.runs).toBe(2000);
    expect(r.samples).toHaveLength(2000);
    expect(r.min).toBeLessThanOrEqual(r.p10);
    expect(r.p10).toBeLessThanOrEqual(r.p50);
    expect(r.p50).toBeLessThanOrEqual(r.p90);
    expect(r.p90).toBeLessThanOrEqual(r.max);
    expect(r.likely).toBeCloseTo(model.base_cost, 6);
    expect(r.samples[0]).toBeLessThan(r.likely);
    expect(r.samples[1999]).toBeGreaterThan(r.likely);
    expect(r.samples.every((x, i) => i === 0 || x >= r.samples[i - 1])).toBe(true);
  });

  it("probabilities are in [0, 1] and thin-margin >= over-price", () => {
    const r = runRisk(model, opts);
    if (!r.available) throw new Error("expected a result");
    expect(r.prob_over_price).toBeGreaterThanOrEqual(0);
    expect(r.prob_over_price).toBeLessThan(0.5);
    expect(r.prob_below_target).toBeGreaterThanOrEqual(r.prob_over_price);
    expect(r.prob_below_target).toBeLessThanOrEqual(1);
  });

  it("a target of zero equals the chance of cost above price; a huge target is certain", () => {
    const zero = runRisk(model, { ...opts, target_margin_pct: 0 });
    const huge = runRisk(model, { ...opts, target_margin_pct: 500 });
    if (!zero.available || !huge.available) throw new Error("expected results");
    expect(zero.prob_below_target).toBeCloseTo(zero.prob_over_price, 12);
    expect(huge.prob_below_target).toBe(1);
  });

  it("a price far above the cost can never be exceeded, far below always is", () => {
    const high = runRisk(model, { ...opts, price: model.base_cost * 10 });
    const low = runRisk(model, { ...opts, price: model.base_cost * 0.1 });
    if (!high.available || !low.available) throw new Error("expected results");
    expect(high.prob_over_price).toBe(0);
    expect(low.prob_over_price).toBe(1);
  });

  it("the histogram counts every run", () => {
    const r = runRisk(model, { ...opts, bins: 12 });
    if (!r.available) throw new Error("expected a result");
    expect(r.histogram.counts).toHaveLength(12);
    expect(r.histogram.counts.reduce((a, b) => a + b, 0)).toBe(r.runs);
  });

  it("the tornado lists every driver, widest swing first, and each swing is real", () => {
    const r = runRisk(model, opts);
    if (!r.available) throw new Error("expected a result");
    expect(r.tornado).toHaveLength(model.drivers.length);
    const swings = r.tornado.map((t) => t.swing);
    expect([...swings].sort((a, b) => b - a)).toEqual(swings);
    expect(swings.every((s) => s > 0)).toBe(true);
    for (const t of r.tornado) {
      expect(t.cost_low).toBeLessThan(model.base_cost);
      expect(t.cost_high).toBeGreaterThan(model.base_cost);
    }
    expect(["concrete_cost_m3", "rebar_cost_kg"]).toContain(r.tornado[0].key);
  });

  it("what-if multipliers shift the whole distribution", () => {
    const a = runRisk(model, opts);
    const b = runRisk(model, { ...opts, multipliers: { concrete_cost_m3: 1.2 } });
    if (!a.available || !b.available) throw new Error("expected results");
    expect(b.p50).toBeGreaterThan(a.p50);
    expect(b.likely).toBeGreaterThan(a.likely);
    expect(b.prob_over_price).toBeGreaterThanOrEqual(a.prob_over_price);
  });

  it("no ranges means no risk section", () => {
    const unranged = buildCostModel(lines, PRECAST_VILLA_STARTER.rules, PRECAST_VILLA_STARTER.rates.map(({ key, label, unit, value }) => ({ key, label, unit, value })));
    const r = runRisk(unranged, opts);
    expect(r.available).toBe(false);
  });

  it("no price or no cost means nothing to simulate; runs are capped and floored", () => {
    expect(runRisk(model, { ...opts, price: 0 }).available).toBe(false);
    expect(runRisk(buildCostModel([], PRECAST_VILLA_STARTER.rules, PRECAST_VILLA_STARTER.rates), opts).available).toBe(false);
    const few = runRisk(model, { ...opts, runs: 0 });
    expect(few.available && few.runs).toBe(1);
    const many = runRisk(model, { ...opts, runs: 1e9 });
    expect(many.available && many.runs).toBe(20000);
  });
});

describe("defaultTargetMargin", () => {
  it("is half the markup, zero when there is none", () => {
    expect(defaultTargetMargin(18)).toBe(9);
    expect(defaultTargetMargin(0)).toBe(0);
    expect(defaultTargetMargin(Number.NaN)).toBe(0);
  });
});

describe("simulateSchedule", () => {
  const rates = PRECAST_VILLA_STARTER.rates;
  const q = scheduleQuantities(base.model!.pieces, lines, rates);

  it("reads the villa's volume and its priced truck loads", () => {
    expect(q.volume_m3).toBeCloseTo(base.model!.pieces.reduce((a, p) => a + p.vol, 0), 9);
    expect(q.loads).toBe(Math.ceil(lines.find((l) => l.code === "trl")!.qty));
  });

  it("builds casting, transport and erection windows from the template capacities", () => {
    const s = simulateSchedule({ ...q, rates });
    expect(s.available).toBe(true);
    const [cast, tr, er] = s.bars;
    expect(cast.start).toBe(0);
    expect(cast.days).toBe(Math.max(1, Math.ceil(q.volume_m3 / 18)));
    expect(tr.start).toBe(5);
    expect(tr.days).toBe(Math.max(1, Math.ceil(q.loads / 4)));
    expect(er.start).toBe(6);
    expect(er.end).toBe(Math.max(tr.end + 1, 6 + Math.max(1, Math.ceil(q.volume_m3 / 24))));
    expect(s.total_days).toBe(Math.max(cast.end, er.end));
    expect(s.assumptions.every((a) => a.source === "template")).toBe(true);
    expect(s.warnings).toEqual([]);
  });

  it("uses documented defaults when the template has no capacity rates", () => {
    const bare = rates.filter((r) => !r.key.startsWith("cap_") && !r.key.endsWith("_start_day"));
    const s = simulateSchedule({ ...q, rates: bare });
    expect(s.assumptions.map((a) => [a.key, a.value, a.source])).toEqual([
      ["cap_cast_m3_per_day", 18, "default"], ["cap_trucks_loads_per_day", 4, "default"],
      ["cap_crane_m3_per_day", 24, "default"], ["transport_start_day", 5, "default"], ["erection_start_day", 6, "default"],
    ]);
    expect(s.total_days).toBe(simulateSchedule({ ...q, rates }).total_days);
  });

  it("more capacity shortens, less lengthens", () => {
    const bump = (f: number) => rates.map((r) => (r.key.startsWith("cap_") ? { ...r, value: r.value * f } : r));
    expect(simulateSchedule({ ...q, rates: bump(4) }).bars[0].days).toBeLessThan(simulateSchedule({ ...q, rates }).bars[0].days);
    expect(simulateSchedule({ ...q, rates: bump(0.25) }).bars[0].days).toBeGreaterThan(simulateSchedule({ ...q, rates }).bars[0].days);
  });

  it("replaces an unusable capacity with its default and says so", () => {
    const a = capacityAssumptions([{ key: "cap_cast_m3_per_day", value: 0 }, { key: "erection_start_day", value: 2.5 }]);
    expect(a.assumptions[0].value).toBe(18);
    expect(a.assumptions[0].source).toBe("default");
    expect(a.assumptions[4].value).toBe(6);
    expect(a.warnings).toHaveLength(2);
  });

  it("zero volume is not available and has no bars", () => {
    const s = simulateSchedule({ volume_m3: 0, loads: 0, rates });
    expect(s.available).toBe(false);
    expect(s.bars).toEqual([]);
    expect(s.total_days).toBe(0);
    expect(simulateSchedule({ volume_m3: Number.NaN, loads: 3, rates }).available).toBe(false);
  });

  it("falls back to weight over load capacity when no line is priced per load", () => {
    const noLoads = lines.filter((l) => l.uom !== "load");
    const s = scheduleQuantities(base.model!.pieces, noLoads, rates);
    expect(s.loads).toBe(Math.ceil((s.volume_m3 * 2.4) / 25));
    expect(scheduleQuantities([], [], []).loads).toBe(0);
  });
});
