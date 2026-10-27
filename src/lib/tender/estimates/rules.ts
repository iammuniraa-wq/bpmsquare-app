import { rateFor } from "@/lib/tender/boq/price";
import { ESTIMATE_COMPONENT_LABEL, ESTIMATE_COMPONENTS, type EstimateComponent } from "@/lib/estimator/types";

// Estimates inside the tender flow (GCC tender deals, slice 3c-1, docs/design/gcc-tender-deals.md section 18). PURE: no I/O, no server
// imports, so the screens, the routes and the tests share one set of rules. Money is cost, in the workspace currency.
//
// Vocabulary. An ESTIMATE has cost lines (estimate_lines). An OUTPUT is one thing a BOQ line can be priced from: the whole estimate
// ("total"), one of its lines ("line:<id>") or one WBS item ("wbs:<code>", a group such as "2" or a line such as "2.3"). A LINK says
// "this output prices that BOQ line" with a BASIS and a SHARE:
//   basis "total"     the output's cost, times the share, is spread over the BOQ quantity     (cost per unit = cost x share / BOQ qty)
//   basis "per_unit"  the output's own cost per unit, times the share                          (cost per unit = cost / output qty x share)
// A BOQ line may have several links; their cost per unit adds up.

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export const MAX_UNIT_COST = 999_999_999;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// ── Outputs ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type OutputRef = { kind: "total" } | { kind: "line"; id: string } | { kind: "wbs"; code: string };

export function parseOutput(v: unknown): OutputRef | null {
  if (v === "total") return { kind: "total" };
  if (typeof v !== "string") return null;
  const line = /^line:([0-9a-f-]{36})$/i.exec(v);
  if (line && isUuid(line[1])) return { kind: "line", id: line[1].toLowerCase() };
  const wbs = /^wbs:([A-Za-z0-9._-]{1,30})$/.exec(v);
  if (wbs) return { kind: "wbs", code: wbs[1] };
  return null;
}

export const outputKey = (o: OutputRef): string => (o.kind === "total" ? "total" : o.kind === "line" ? `line:${o.id}` : `wbs:${o.code}`);

/** The part of a stored estimate line the rules read. */
export type EstLine = {
  id: string;
  code: string | null;
  description: string;
  uom: string | null;
  qty: number;
  waste_pct: number;
  unit_cost: number | null;
  cost_total: number | null;
  component: string | null;
  wbs_code: string | null;
  product_id: string | null;
  custom_data: Record<string, unknown> | null;
  updated_at: string | null;
};

export type OutputCost = {
  key: string;
  kind: OutputRef["kind"];
  label: string;
  /** Sum of the cost of the lines inside; lines with no cost count as 0 and are counted in `unpriced`. */
  cost: number;
  /** The output's own quantity, only for a single line (what a per-unit basis divides by). */
  qty: number | null;
  unit: string | null;
  lines: number;
  unpriced: number;
};

const lineCost = (l: Pick<EstLine, "cost_total">): number => (l.cost_total != null && Number.isFinite(Number(l.cost_total)) ? Number(l.cost_total) : 0);
const isUnpriced = (l: Pick<EstLine, "qty" | "cost_total">): boolean => Number(l.qty) > 0 && l.cost_total == null;

/** The estimate lines inside an output, in their stored order. Empty when the output names nothing that exists. */
export function linesOfOutput(o: OutputRef, lines: readonly EstLine[]): EstLine[] {
  if (o.kind === "total") return [...lines];
  if (o.kind === "line") return lines.filter((l) => l.id.toLowerCase() === o.id);
  return lines.filter((l) => !!l.wbs_code && (l.wbs_code === o.code || l.wbs_code.startsWith(`${o.code}.`)));
}

/** Null when the output does not exist in this estimate (a line was removed, a recalculation dropped a group). */
export function outputCost(o: OutputRef, lines: readonly EstLine[], totalCostFallback: number | null = null): OutputCost | null {
  const inside = linesOfOutput(o, lines);
  if (o.kind !== "total" && inside.length === 0) return null;
  const sum = inside.reduce((s, l) => s + lineCost(l), 0);
  const cost = o.kind === "total" && inside.length === 0 && totalCostFallback != null ? Number(totalCostFallback) : sum;
  const one = o.kind === "line" ? inside[0] : null;
  return {
    key: outputKey(o), kind: o.kind,
    label: o.kind === "total" ? "Whole estimate" : o.kind === "line" ? one!.description : `WBS ${o.code}`,
    cost: round2(cost), qty: one ? Number(one.qty) : null, unit: one?.uom ?? null, lines: inside.length, unpriced: inside.filter(isUnpriced).length,
  };
}

// ── Cost per BOQ unit ────────────────────────────────────────────────────────────────────────────────────────────────

export type Basis = "per_unit" | "total";
export const isBasis = (v: unknown): v is Basis => v === "per_unit" || v === "total";

export function cleanShare(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

export type PerUnit = { ok: true; perUnit: number } | { ok: false; reason: string };

/**
 * The cost per BOQ unit one link contributes. Never read from a request: the route calls this with the output as the database holds
 * it now. A "total" basis needs a BOQ quantity above zero; a "per_unit" basis needs an output that is a single line with a quantity.
 */
export function costPerUnit(args: { basis: Basis; out: OutputCost; boqQty: number; sharePct: number }): PerUnit {
  const share = cleanShare(args.sharePct);
  if (share === null) return { ok: false, reason: "The share must be more than 0 and at most 100 percent" };
  let perUnit: number;
  if (args.basis === "total") {
    if (!(args.boqQty > 0)) return { ok: false, reason: "The BOQ line has no quantity to spread the cost over" };
    perUnit = (args.out.cost * (share / 100)) / args.boqQty;
  } else {
    if (args.out.kind !== "line" || !(args.out.qty != null && args.out.qty > 0)) return { ok: false, reason: "A cost per unit needs a single estimate line with a quantity" };
    perUnit = (args.out.cost / args.out.qty) * (share / 100);
  }
  perUnit = round4(perUnit);
  if (!Number.isFinite(perUnit) || perUnit <= 0) return { ok: false, reason: "That output has no cost yet" };
  if (perUnit > MAX_UNIT_COST) return { ok: false, reason: "That cost is too large" };
  return { ok: true, perUnit };
}

/** A BOQ line's cost per unit is what its links add up to. */
export const sumPerUnit = (parts: readonly number[]): number => round4(parts.reduce((s, n) => s + n, 0));

/** The selling rate for a cost per unit: the existing markup rule (cost x (1 + markup %), 2 places). */
export const rateFromCost = (cost: number, markupPct: number | null | undefined): number => rateFor({ kind: "cost", price: cost }, markupPct ?? 0);

// ── Shares and allocation ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Percentages (2 places) in proportion to the weights, adding up to exactly 100 (largest remainder). Weights of zero or less get
 * zero; if nothing has a weight the shares are equal.
 */
export function splitShares(weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const total = w.reduce((s, x) => s + x, 0);
  const basis = total > 0 ? w : w.map(() => 1);
  const sum = basis.reduce((s, x) => s + x, 0);
  const exact = basis.map((x) => (x / sum) * 10000);
  const floors = exact.map((x) => Math.floor(x));
  let left = 10000 - floors.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) { if (left <= 0) break; floors[o.i] += 1; left--; }
  return floors.map((x) => x / 100);
}

export type AllocationLink = { boq_line_id: string; output: string; basis: Basis; share_pct: number };
export type OutputAllocation = {
  key: string; label: string; cost: number;
  allocated_pct: number; allocated_cost: number; unallocated_pct: number; unallocated_cost: number; over: boolean;
};
export type AllocationSummary = { outputs: OutputAllocation[]; total_cost: number; allocated_cost: number; unallocated_cost: number; over: string[] };

const hundredths = (n: number) => Math.round(n * 100);

/** Only "total" links consume an output (a "per_unit" link borrows a rate and takes nothing out of the pool). */
export function allocationSummary(outputs: readonly { key: string; label: string; cost: number }[], links: readonly AllocationLink[]): AllocationSummary {
  const rows: OutputAllocation[] = outputs.map((o) => {
    const pct = links.filter((l) => l.output === o.key && l.basis === "total").reduce((s, l) => s + hundredths(l.share_pct), 0) / 100;
    const over = hundredths(pct) > 10000;
    const freePct = Math.max(0, 100 - pct);
    return {
      key: o.key, label: o.label, cost: o.cost,
      allocated_pct: pct, allocated_cost: round2(o.cost * Math.min(pct, 100) / 100),
      unallocated_pct: round2(freePct), unallocated_cost: round2(o.cost * freePct / 100), over,
    };
  });
  // The estimate's cost lives in its lines: a "total" output and the lines inside it are the same money, so the unallocated figure
  // reported for the estimate is that of the whole-estimate output when it is in use, else the sum over its line outputs.
  const total = rows.find((r) => r.key === "total");
  const lineRows = rows.filter((r) => r.key !== "total");
  const useTotal = !!total && total.allocated_pct > 0;
  const basisRows = useTotal ? [total!] : lineRows.length > 0 ? lineRows : total ? [total] : [];
  return {
    outputs: rows,
    total_cost: round2(basisRows.reduce((s, r) => s + r.cost, 0)),
    allocated_cost: round2(basisRows.reduce((s, r) => s + r.allocated_cost, 0)),
    unallocated_cost: round2(basisRows.reduce((s, r) => s + r.unallocated_cost, 0)),
    over: rows.filter((r) => r.over).map((r) => r.key),
  };
}

/** Whether adding `proposed` on top of the links that stay would give any total-basis output more than 100 percent. Returns the output keys. */
export function overAllocated(stays: readonly AllocationLink[], proposed: readonly AllocationLink[]): string[] {
  const sum = new Map<string, number>();
  for (const l of [...stays, ...proposed]) if (l.basis === "total") sum.set(l.output, (sum.get(l.output) ?? 0) + hundredths(l.share_pct));
  return [...sum].filter(([, v]) => v > 10000).map(([k]) => k);
}

// ── Staleness ────────────────────────────────────────────────────────────────────────────────────────────────────────

const time = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * "Estimate changed, re-price": the estimate was saved after the figures were applied. A link never applied (a build-up still being
 * worked on) is not stale, it is waiting; a link whose stamp is missing cannot be shown to be current, so it counts as stale.
 */
export function isLinkStale(link: { applied_at: string | null; estimate_updated_at: string | null }, estimateUpdatedAt: string | null | undefined): boolean {
  if (!link.applied_at) return false;
  const est = time(estimateUpdatedAt);
  if (est === null) return false;
  const stamp = time(link.estimate_updated_at);
  return stamp === null ? true : est > stamp;
}

/** The stages in which a bid is still being built. From Submitted on a bid is in the client's hands and is never re-priced by itself. */
export const BID_OPEN_STAGES: readonly string[] = ["received", "bid_no_bid", "estimating"];
export const bidIsLocked = (stage: string | null | undefined): boolean => !!stage && !BID_OPEN_STAGES.includes(stage);

// ── Missing costs ────────────────────────────────────────────────────────────────────────────────────────────────────

export type CostMeta = { unit_cost: number; as_of: string; source: string; ref: string | null };

/**
 * Where a line's cost came from, if a supplier award wrote it: `custom_data.cost_meta` on a hand-added line,
 * `custom_data.override.cost_meta` on a computed one (an override survives a recalculation, a plain key would not). The meta only
 * counts while the line's unit cost is still the figure it was written for, so a later hand edit does not keep an old date.
 */
export function costMetaOf(line: Pick<EstLine, "unit_cost" | "custom_data">): CostMeta | null {
  const cd = line.custom_data ?? {};
  const raw = (cd.override && typeof cd.override === "object" ? (cd.override as Record<string, unknown>).cost_meta : undefined) ?? cd.cost_meta;
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const unit = Number(m.unit_cost);
  const asOf = typeof m.as_of === "string" ? m.as_of.slice(0, 10) : "";
  if (!Number.isFinite(unit) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  if (line.unit_cost == null || Math.abs(Number(line.unit_cost) - unit) > 0.00005) return null;
  return { unit_cost: unit, as_of: asOf, source: typeof m.source === "string" ? m.source : "rfq", ref: typeof m.ref === "string" ? m.ref : null };
}

const DAY = 86_400_000;
const dayNumber = (key: string | null | undefined): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key ?? "");
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / DAY) : null;
};

/** When a line's cost was last confirmed: the award that wrote it, else the product's cost date, else when the line was last saved. */
export function lineCostAsOf(line: Pick<EstLine, "unit_cost" | "custom_data" | "updated_at">, productCostAsOf: string | null | undefined): string | null {
  const meta = costMetaOf(line);
  if (meta) return meta.as_of;
  if (productCostAsOf) return productCostAsOf.slice(0, 10);
  return line.updated_at ? line.updated_at.slice(0, 10) : null;
}

export type MissingReason = "no_cost" | "stale";
export type MissingCost = { line_id: string; reason: MissingReason; age_days: number | null; as_of: string | null };

/**
 * Lines that need a supplier price: no unit cost at all, or a cost confirmed longer ago than the RFQ price validity
 * (`config.rfq.price_valid_days`, 180 by default). A line with a quantity of zero is left out; so is the age check on labour and factory
 * overhead lines (they are the company's own figures), though a labour line with no cost at all is still listed.
 */
export function missingCosts(
  lines: readonly EstLine[], todayKey: string, validDays: number, productAsOf: ReadonlyMap<string, string | null> = new Map(),
): MissingCost[] {
  const today = dayNumber(todayKey);
  const out: MissingCost[] = [];
  for (const l of lines) {
    if (!(Number(l.qty) > 0)) continue;
    const noCost = l.unit_cost == null || !(Number(l.unit_cost) > 0);
    if (noCost) { out.push({ line_id: l.id, reason: "no_cost", age_days: null, as_of: null }); continue; }
    // Labour and factory overhead are the company's own figures, not something a supplier's price goes stale on.
    if (l.component === "labour" || l.component === "overhead") continue;
    const asOf = lineCostAsOf(l, l.product_id ? productAsOf.get(l.product_id) : null);
    const then = dayNumber(asOf);
    if (today === null || then === null) continue;
    const age = Math.max(0, today - then);
    if (age > validDays) out.push({ line_id: l.id, reason: "stale", age_days: age, as_of: asOf });
  }
  return out;
}

// ── Resource types for the budget ────────────────────────────────────────────────────────────────────────────────────

/**
 * An estimate line's cost category becomes a contract project resource type (the ePROMIS levels in erp_masters):
 *   materials -> 11 Material            moulds and formwork -> 21 Asset        production labour -> 31 Man Power
 *   erection  -> 41 Sub Contractor      transport, factory overhead, other -> 51 Other Direct Cost
 * A person can change a line's resource on the Budget tab; this is where it starts.
 */
export const RESOURCE_FOR_COMPONENT: Record<EstimateComponent, string> = {
  materials: "11", moulds: "21", labour: "31", erection: "41", transport: "51", overhead: "51", other: "51",
};
export const RESOURCE_FOR_UNKNOWN = "51";

export function resourceForComponent(component: string | null | undefined): string {
  return (ESTIMATE_COMPONENTS as readonly string[]).includes(component ?? "") ? RESOURCE_FOR_COMPONENT[component as EstimateComponent] : RESOURCE_FOR_UNKNOWN;
}
export const componentLabel = (component: string | null | undefined): string =>
  (ESTIMATE_COMPONENTS as readonly string[]).includes(component ?? "") ? ESTIMATE_COMPONENT_LABEL[component as EstimateComponent] : "Other";

// ── Build up this rate ───────────────────────────────────────────────────────────────────────────────────────────────

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const QTY_KEYS = new Set(["qty", "quantity", "length", "length_m", "area", "area_m2", "count", "number", "units"]);

const AREA_UNITS = new Set(["m2", "m²", "sqm", "sqmt", "sqmtr", "sqmeter", "sqmeters", "sqmetre", "sqmetres", "squaremeter", "squaremeters", "squaremetre", "squaremetres"]);
const VOLUME_UNITS = new Set(["m3", "m³", "cum", "cbm", "cubicmeter", "cubicmeters", "cubicmetre", "cubicmetres"]);
const LENGTH_UNITS = new Set(["m", "mtr", "mtrs", "meter", "meters", "metre", "metres", "lm", "rm"]);

/** A unit in one spelling, so "m2", "m²" and "sq m" are the same unit. Anything unknown is lowercased, de-punctuated and singular. */
export function canonUnit(u: string | null | undefined): string {
  const flat = (u ?? "").toLowerCase().replace(/[\s._-]+/g, "");
  if (AREA_UNITS.has(flat)) return "m2";
  if (VOLUME_UNITS.has(flat)) return "m3";
  if (LENGTH_UNITS.has(flat)) return "m";
  return norm(u).replace(/s$/, "");
}

type Dimension = "length" | "area" | "volume";
const dimensionOf = (canon: string): Dimension | null => (canon === "m2" ? "area" : canon === "m3" ? "volume" : canon === "m" || canon === "mm" || canon === "cm" || canon === "km" ? "length" : null);
/** Two units of known, different kinds (a length and an area) never describe the same quantity. */
const clashes = (a: string, b: string): boolean => { const x = dimensionOf(a); const y = dimensionOf(b); return !!x && !!y && x !== y; };

/** The part of a template input the quantity rules read. */
export type QtyInputDef = { key: string; label?: string; type: string; unit?: string; min?: number; max?: number; default?: unknown };

// Inputs that describe a room, a slab or a panel in plan: a length and a width in metres. Anything about a corner cut-out, a door, a
// border, a tile or a thickness is another measure and is never the plan size.
const NOT_THE_PLAN = /cutout|corner|opening|door|skirt|border|thick|height|depth|tile|joint|grout|bed/;
const word = (key: string, w: string) => new RegExp(`(^|_)${w}(_|$)`).test(key);

function planInputs(numbers: readonly QtyInputDef[]): { len: QtyInputDef; wid: QtyInputDef; cutLen: QtyInputDef | null; cutWid: QtyInputDef | null } | null {
  const metres = numbers.filter((i) => canonUnit(i.unit) === "m");
  const plan = metres.filter((i) => !NOT_THE_PLAN.test(i.key));
  const len = plan.filter((i) => word(i.key, "length"));
  const wid = plan.filter((i) => word(i.key, "width"));
  if (len.length !== 1 || wid.length !== 1) return null;
  const cuts = metres.filter((i) => /cutout|corner/.test(i.key));
  const cutLen = cuts.filter((i) => word(i.key, "length"));
  const cutWid = cuts.filter((i) => word(i.key, "width"));
  return { len: len[0], wid: wid[0], cutLen: cutLen.length === 1 ? cutLen[0] : null, cutWid: cutWid.length === 1 ? cutWid[0] : null };
}

const valueOf = (i: QtyInputDef, params: Record<string, unknown>): number | null => {
  const raw = params[i.key] ?? i.default;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * The one input that carries the quantity among several in the BOQ unit: the only one, else the only one named like a quantity
 * (`length_m` beside `depth_m`). Null when it is still not clear, and then nothing is guessed.
 */
function quantityInput(sameUnit: readonly QtyInputDef[]): QtyInputDef | null {
  if (sameUnit.length === 1) return sameUnit[0];
  const named = sameUnit.filter((i) => QTY_KEYS.has(i.key));
  return named.length === 1 ? named[0] : null;
}

/** The label of the input that carries the quantity, e.g. "Pipeline length (m)"; null when the rules cannot tell which it is. */
export function quantityFieldLabel(inputs: readonly QtyInputDef[] | null | undefined, boqUnit: string | null | undefined): string | null {
  if (!Array.isArray(inputs)) return null;
  const numbers = inputs.filter((i) => i.type === "number");
  const unit = canonUnit(boqUnit);
  const byUnit = unit ? numbers.filter((i) => canonUnit(i.unit) === unit) : [];
  const one = quantityInput(byUnit) ?? (byUnit.length === 0 ? quantityInput(numbers.filter((i) => QTY_KEYS.has(i.key) && !(unit && i.unit && clashes(canonUnit(i.unit), unit)))) : null);
  if (!one) return null;
  const name = (one.label ?? one.key).trim();
  return one.unit && !name.includes(`(${one.unit})`) ? `${name} (${one.unit})` : name;
}

// Widths tried, in order, when a floor area is turned into a rectangle: the first whose length also lies inside its range wins.
const PREFERRED_WIDTHS = [10, 8, 6, 5, 4, 3, 2, 1];

/**
 * Prefill the quantity input of a template from a BOQ line: a number input whose unit is the line's unit, else the one input named
 * like a quantity, else (an area in m2 and a template with a room length and a room width in metres) a rectangle of exactly that
 * area. Never invents a value for an input outside its range. Returns only the inputs it is sure about.
 */
export function prefillParams(inputs: readonly QtyInputDef[], boqUnit: string | null | undefined, qty: number): Record<string, number> {
  if (!(qty > 0)) return {};
  const numbers = inputs.filter((i) => i.type === "number");
  const inRange = (i: { min?: number; max?: number }, v: number = qty) => (i.min == null || v >= i.min) && (i.max == null || v <= i.max);
  const unit = canonUnit(boqUnit);
  const byUnit = unit ? numbers.filter((i) => canonUnit(i.unit) === unit && inRange(i)) : [];
  const sole = quantityInput(byUnit);
  if (sole) return { [sole.key]: qty };
  const byName = numbers.filter((i) => QTY_KEYS.has(i.key) && inRange(i) && !(unit && i.unit && clashes(canonUnit(i.unit), unit)));
  if (byUnit.length === 0 && byName.length === 1) return { [byName[0].key]: qty };
  if (byUnit.length > 0 || byName.length > 0 || unit !== "m2") return {};

  const plan = planInputs(numbers);
  if (!plan) return {};
  // An L-shaped default would make length x width the wrong area, so a template that starts with a cut-out is left alone.
  for (const cut of [plan.cutLen, plan.cutWid]) if (cut && (valueOf(cut, {}) ?? 0) !== 0) return {};
  for (const w of PREFERRED_WIDTHS) {
    const width = Math.min(Math.max(w, plan.wid.min ?? w), plan.wid.max ?? w);
    if (!(width > 0) || !inRange(plan.wid, width)) continue;
    const length = round4(qty / width);
    if (length > 0 && inRange(plan.len, length)) return { [plan.len.key]: length, [plan.wid.key]: width };
  }
  return {};
}

// ── Does the estimate cover the quantity the BOQ line is priced for? ───────────────────────────────────────────────────

/**
 * The quantity an estimate is measured for, read from its own inputs the same way prefillParams writes them: the one input in the BOQ
 * unit, else the one named like a quantity, else the plan area (length x width, less a corner cut-out) when the BOQ unit is m2.
 * Null when it cannot be told, which is not the same as zero.
 */
export function measuredQuantity(inputs: readonly QtyInputDef[], params: Record<string, unknown>, boqUnit: string | null | undefined): number | null {
  const numbers = inputs.filter((i) => i.type === "number");
  const unit = canonUnit(boqUnit);
  const good = (n: number | null): number | null => (n != null && n > 0 ? n : null);
  const byUnit = unit ? numbers.filter((i) => canonUnit(i.unit) === unit) : [];
  if (byUnit.length > 0) { const sole = quantityInput(byUnit); return sole ? good(valueOf(sole, params)) : null; }
  const byName = numbers.filter((i) => QTY_KEYS.has(i.key) && !(unit && i.unit && clashes(canonUnit(i.unit), unit)));
  if (byName.length === 1) return good(valueOf(byName[0], params));
  if (byName.length > 1 || unit !== "m2") return null;
  const plan = planInputs(numbers);
  if (!plan) return null;
  const l = valueOf(plan.len, params);
  const w = valueOf(plan.wid, params);
  if (l == null || w == null) return null;
  const cl = plan.cutLen ? valueOf(plan.cutLen, params) : 0;
  const cw = plan.cutWid ? valueOf(plan.cutWid, params) : 0;
  if (cl == null || cw == null) return null;
  return good(round4(l * w - cl * cw));
}

export type QuantityStatus = "matches" | "mismatch" | "unknown";
export type QuantityCheck = { status: QuantityStatus; measured: number | null; boq_qty: number; uom: string | null };
/** What the screens show about one build-up link. `needs_confirm` is the rule the server enforces; `note` is the words. */
export type QuantityView = QuantityCheck & { item: string; needs_confirm: boolean; note: string | null; /** The estimate input that carries the quantity ("Pipeline length (m)"), when the rules can tell. */ field?: string | null };

/** The estimate's own quantity may differ from the BOQ line's by this much (1 percent) before it counts as another quantity. */
export const QUANTITY_TOLERANCE = 0.01;

export function quantityCheck(args: { inputs: readonly QtyInputDef[] | null | undefined; params: Record<string, unknown> | null | undefined; boqUnit: string | null | undefined; boqQty: number }): QuantityCheck {
  const base = { boq_qty: args.boqQty, uom: args.boqUnit ?? null };
  const measured = Array.isArray(args.inputs) && args.boqQty > 0 ? measuredQuantity(args.inputs, args.params ?? {}, args.boqUnit) : null;
  if (measured == null) return { ...base, status: "unknown", measured: null };
  return { ...base, measured, status: Math.round((Math.abs(measured - args.boqQty) / args.boqQty) * 1e6) / 1e6 > QUANTITY_TOLERANCE ? "mismatch" : "matches" };
}

/**
 * A link that divides a whole estimate by one BOQ line's quantity: the whole estimate, all of it, and no other BOQ line draws on this
 * estimate. Only then is the cost per unit wrong when the estimate was made for another quantity. A part of an estimate, a share of
 * it, or an estimate spread over several lines does not depend on one line's quantity this way.
 */
export const isRateBuildUp = (link: { output: string; basis: string; share_pct: number }, linksOnEstimate: number): boolean =>
  link.output === "total" && link.basis === "total" && link.share_pct === 100 && linksOnEstimate === 1;

/** Pricing a build-up that has never been used needs a person to confirm unless its own quantity is known to match. */
export const needsQuantityConfirm = (check: QuantityCheck, applied: boolean): boolean => !applied && check.status !== "matches";

const qtyText = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const withUnit = (n: number, uom: string | null) => `${qtyText(n)}${uom ? ` ${uom}` : ""}`;

/** What the banner and the BOQ line say. Null when there is nothing to say (the quantities match, or a rate already in use cannot be judged). */
export function quantityNote(check: QuantityCheck, applied: boolean, field?: string | null): string | null {
  const boq = withUnit(check.boq_qty, check.uom);
  if (check.status === "matches") return null;
  const todo = field ? `Set ${field} to ${qtyText(check.boq_qty)}, then confirm.` : `Make this estimate for ${boq}, then confirm.`;
  if (check.status === "unknown") return applied ? null : `The quantity was not filled in automatically. ${todo}`;
  const own = withUnit(check.measured ?? 0, check.uom);
  return applied ? `This estimate is for ${own}, the BOQ line is ${boq}.` : `This estimate is for ${own}, the BOQ line is ${boq}. ${todo}`;
}

export function quantityView(check: QuantityCheck, applied: boolean, item: string, field?: string | null): QuantityView {
  return { ...check, item, needs_confirm: needsQuantityConfirm(check, applied), note: quantityNote(check, applied, field), field: field ?? null };
}

/** The words of the confirmation a person gives before a build-up is priced (one line, or several). */
export function quantityConfirmCopy(views: readonly QuantityView[]): { title: string; body: string; confirmLabel: string } {
  if (views.length === 1) {
    const v = views[0];
    const boq = withUnit(v.boq_qty, v.uom);
    return { title: `Is this estimate for ${boq}?`, body: v.note ?? `The estimate's cost is divided by ${boq}.`, confirmLabel: `Yes, it is for ${boq}` };
  }
  return {
    title: `Are these ${views.length} estimates made for the BOQ quantities?`,
    body: views.slice(0, 3).map((v) => `${v.item}: ${withUnit(v.boq_qty, v.uom)}`).join("; ") + (views.length > 3 ? `; and ${views.length - 3} more` : "") + ". Each estimate's cost is divided by its line's quantity.",
    confirmLabel: "Yes, they are",
  };
}

/** The name an estimate built for a BOQ line gets. */
export function buildUpName(item: { item_no: string | null; description: string }): string {
  const head = item.item_no ? `${item.item_no} ` : "";
  return `${head}${item.description}`.trim().slice(0, 200) || "Rate build-up";
}

export const buildUpNote = (item: { item_no: string | null; qty: number; uom: string | null }): string =>
  `Rate build-up for BOQ item ${item.item_no ?? "(no number)"}: ${item.qty}${item.uom ? ` ${item.uom}` : ""}. The cost per unit is the estimate's total cost divided by this quantity.`;

// ── The outputs an estimate offers ───────────────────────────────────────────────────────────────────────────────────

/**
 * Everything a BOQ line can be priced from in one estimate: the whole estimate, each WBS group (the number before the first dot of a
 * line's wbs code, named after the group the line belongs to), and each line that has a quantity. Costs are computed from the lines.
 */
export function listOutputs(lines: readonly EstLine[], totalCostFallback: number | null = null): OutputCost[] {
  const out: OutputCost[] = [];
  const total = outputCost({ kind: "total" }, lines, totalCostFallback);
  if (total) out.push(total);
  const names = new Map<string, string>();
  for (const l of lines) {
    const head = l.wbs_code ? l.wbs_code.split(".")[0] : "";
    if (!head || names.has(head)) continue;
    const g = l.custom_data?.group;
    names.set(head, typeof g === "string" && g.trim() ? g.trim() : `Group ${head}`);
  }
  for (const [code, name] of [...names].sort((a, b) => Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0]))) {
    const o = outputCost({ kind: "wbs", code }, lines);
    if (o) out.push({ ...o, label: `${code} · ${name}` });
  }
  for (const l of lines) {
    if (!(Number(l.qty) > 0)) continue;
    const o = outputCost({ kind: "line", id: l.id }, lines);
    if (o) out.push(o);
  }
  return out;
}
