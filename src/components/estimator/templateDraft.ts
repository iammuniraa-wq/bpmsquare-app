// The template editor's working copy. Numbers are kept as the text the person
// typed (so "1." and an empty box survive), and turned into the template shape
// the API validates only when a check or a save is made. Pure, no I/O.

import type {
  EstimateComponent, EstimateTemplateBody, QuoteGranularity, TemplateInput, TemplateInputType, TemplateRate, TemplateRule,
} from "@/lib/estimator/types";
import { groupSlug } from "@/lib/estimator/types";

export type OptionDraft = { key: string; label: string; value: string };

export type InputDraft = {
  key: string; label: string; type: TemplateInputType;
  /** number: text; select: option key; boolean: "true" | "false". */
  default: string;
  min: string; max: string; unit: string; help: string; section: string;
  quote_alternatives: boolean;
  options: OptionDraft[];
};

/** `low` / `high` are the optional risk range (Simulation); empty text = none. */
export type RateDraft = { key: string; label: string; unit: string; value: string; low: string; high: string };

export type RuleDraft = {
  code: string; group: string; description: string; uom: string; qty: string;
  /** A number or a formula. */
  waste_pct: string;
  component: EstimateComponent;
  costKind: "product" | "rate";
  /** A product rule's SKU or product reference (whichever the template names). */
  sku: string; rate: string;
  /** The product is named by its reference (PRD-0012), not a SKU; kept so a save writes back the key it read. */
  skuIsRef?: boolean;
  element_type: string;
};

export type TemplateDraft = {
  name: string; description: string; trade: string; quote_granularity: QuoteGranularity;
  geometry: string;
  inputs: InputDraft[]; rates: RateDraft[]; rules: RuleDraft[];
};

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

export function toDraft(t: {
  name: string; description: string | null; trade: string | null; quote_granularity: QuoteGranularity; geometry: string | null;
  inputs: TemplateInput[]; rates: TemplateRate[]; rules: TemplateRule[];
}): TemplateDraft {
  return {
    name: t.name, description: t.description ?? "", trade: t.trade ?? "", quote_granularity: t.quote_granularity, geometry: t.geometry ?? "",
    inputs: (t.inputs ?? []).map((i) => ({
      key: i.key, label: i.label, type: i.type, default: str(i.default),
      min: str(i.min), max: str(i.max), unit: str(i.unit), help: str(i.help), section: str(i.section),
      quote_alternatives: i.quote_alternatives === true,
      options: (i.options ?? []).map((o) => ({ key: o.key, label: o.label, value: str(o.value) })),
    })),
    rates: (t.rates ?? []).map((r) => ({ key: r.key, label: r.label, unit: r.unit, value: str(r.value), low: r.low === undefined ? "" : str(r.low), high: r.high === undefined ? "" : str(r.high) })),
    rules: (t.rules ?? []).map((r) => ({
      code: r.code, group: r.group, description: r.description, uom: r.uom, qty: r.qty, waste_pct: str(r.waste_pct),
      component: r.component, costKind: r.cost.kind, sku: r.cost.kind === "product" ? (r.cost.sku ?? r.cost.ref ?? "") : "", skuIsRef: r.cost.kind === "product" && !r.cost.sku && !!r.cost.ref, rate: r.cost.kind === "rate" ? r.cost.rate : "",
      element_type: str(r.element_type),
    })),
  };
}

/** A number from text; empty stays undefined, non-numbers become NaN so the validator names them. */
const optNum = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));

export function toBody(d: TemplateDraft): EstimateTemplateBody & { geometry?: string } {
  const inputs = d.inputs.map((i): TemplateInput => {
    const base: TemplateInput = {
      key: i.key.trim(), label: i.label.trim(), type: i.type,
      default: i.type === "number" ? Number(i.default) : i.type === "boolean" ? i.default === "true" : i.default,
    };
    if (i.unit.trim()) base.unit = i.unit.trim();
    if (i.help.trim()) base.help = i.help.trim();
    if (i.section.trim()) base.section = i.section.trim();
    if (i.type === "number") {
      const min = optNum(i.min); const max = optNum(i.max);
      if (min !== undefined) base.min = min;
      if (max !== undefined) base.max = max;
    }
    if (i.type === "select") {
      base.options = i.options.map((o) => ({ key: o.key.trim(), label: o.label.trim(), value: Number(o.value) }));
      if (i.quote_alternatives) base.quote_alternatives = true;
    }
    return base;
  });
  const rates = d.rates.map((r): TemplateRate => {
    const rate: TemplateRate = { key: r.key.trim(), label: r.label.trim(), unit: r.unit.trim(), value: Number(r.value) };
    // One end alone is passed through so the validator can say "give both".
    if (r.low.trim() !== "") rate.low = Number(r.low);
    if (r.high.trim() !== "") rate.high = Number(r.high);
    return rate;
  });
  const rules = d.rules.map((r): TemplateRule => {
    const rule: TemplateRule = {
      code: r.code.trim(), group: r.group.trim(), description: r.description.trim(), uom: r.uom.trim(), qty: r.qty.trim(),
      component: r.component,
      cost: r.costKind === "product" ? (r.skuIsRef ? { kind: "product", ref: r.sku.trim() } : { kind: "product", sku: r.sku.trim() }) : { kind: "rate", rate: r.rate.trim() },
    };
    const w = r.waste_pct.trim();
    if (w !== "") rule.waste_pct = Number.isFinite(Number(w)) ? Number(w) : w;
    if (r.element_type.trim()) rule.element_type = r.element_type.trim();
    return rule;
  });
  return { ...(d.geometry ? { geometry: d.geometry } : {}), inputs, rates, rules };
}

/** Names a formula in this template may use, for the reference panel. */
export function templateIdentifiers(d: TemplateDraft): { inputs: string[]; rates: string[]; lines: string[]; groups: string[] } {
  return {
    inputs: d.inputs.map((i) => i.key.trim()).filter(Boolean),
    rates: d.rates.map((r) => r.key.trim()).filter(Boolean),
    lines: d.rules.map((r) => r.code.trim()).filter(Boolean).map((c) => `qty_${c}`),
    groups: [...new Set(d.rules.map((r) => groupSlug(r.group)).filter(Boolean))].map((g) => `sub_${g}`),
  };
}

export const blankInput = (): InputDraft => ({
  key: "", label: "", type: "number", default: "0", min: "", max: "", unit: "", help: "", section: "", quote_alternatives: false, options: [],
});
export const blankRate = (): RateDraft => ({ key: "", label: "", unit: "", value: "0", low: "", high: "" });
export const blankRule = (): RuleDraft => ({
  code: "", group: "", description: "", uom: "", qty: "", waste_pct: "", component: "materials",
  costKind: "rate", sku: "", rate: "", element_type: "",
});

/** Move item i by delta within a list (no-op at the ends). */
export function moveItem<T>(list: readonly T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  if (j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Issues whose path sits under `prefix` (e.g. "rules[2]"), keyed by the rest ("qty"). */
export function issuesUnder(issues: readonly { path: string; message: string }[], prefix: string): { field: string; message: string }[] {
  return issues
    .filter((x) => x.path === prefix || x.path.startsWith(`${prefix}.`) || x.path.startsWith(`${prefix}[`))
    .map((x) => ({ field: x.path.slice(prefix.length).replace(/^\./, ""), message: x.message }));
}
