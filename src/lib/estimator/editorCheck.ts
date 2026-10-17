// What the template editor asks the server on every keystroke-worth of change:
// "is this template valid, and what does it come to with its default inputs?"
// and "is this formula valid, and what is it worth here?". Pure, no I/O.
//
// The example uses the template's own defaults and a zero margin, and product
// rules have no price in an example (no database), so the example total is the
// rate-priced part only -- `unpriced` says which lines are missing. It is a
// sanity check, not a quote.

import { evaluateFormula, validateFormula } from "./formula";
import type { FormulaError } from "./formula";
import { computeEstimate } from "./compute";
import type { ComputeSuccess, CostSummary } from "./compute";
import { validateTemplate } from "./template";
import type { TemplateIssue } from "./template";
import { getGeometry, geometryIdentifiers, pieceScope, densityFromRates } from "./geometry";
import { groupSlug } from "./types";

export const EXAMPLE_LINE_LIMIT = 200;

export type ExampleLine = {
  code: string; group: string; description: string; uom: string; qty: number; qty_gross: number;
  unit_cost: number | null; cost_total: number | null; needs_price: boolean; sku: string | null;
};

export type TemplateExample = {
  line_count: number;
  lines: ExampleLine[];
  truncated: boolean;
  summary: CostSummary;
  /** Rule codes of product lines that have no price in an example. */
  unpriced: string[];
  warnings: string[];
};

export type TemplateCheck = {
  ok: boolean;
  issues: TemplateIssue[];
  warnings: TemplateIssue[];
  /** Present when the template is valid AND computes with its defaults. */
  example: TemplateExample | null;
  /** Why a valid template did not compute (a formula that fails with the defaults, say). */
  example_issues: TemplateIssue[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function example(res: ComputeSuccess): TemplateExample {
  return {
    line_count: res.lines.length,
    lines: res.lines.slice(0, EXAMPLE_LINE_LIMIT).map((l) => ({
      code: l.code, group: l.group, description: l.description, uom: l.uom, qty: l.qty, qty_gross: l.qty_gross,
      unit_cost: l.unit_cost, cost_total: l.cost_total, needs_price: l.needs_price, sku: l.sku,
    })),
    truncated: res.lines.length > EXAMPLE_LINE_LIMIT,
    summary: res.summary,
    unpriced: res.unpriced,
    warnings: res.warnings,
  };
}

export function checkTemplate(raw: unknown): TemplateCheck {
  const v = validateTemplate(raw);
  if (!v.ok || !v.template) return { ok: false, issues: v.issues, warnings: v.warnings, example: null, example_issues: [] };
  const res = computeEstimate(v.template, {}, {});
  if (!res.ok) return { ok: true, issues: [], warnings: v.warnings, example: null, example_issues: res.issues };
  return { ok: true, issues: [], warnings: v.warnings, example: example(res), example_issues: [] };
}

export type FormulaCheck = {
  ok: boolean;
  errors: FormulaError[] | { message: string }[];
  identifiers: string[];
  unknown: string[];
  /** The formula's value with the template's default inputs, when it can be worked out. */
  value: number | null;
  /** Why no value, when the formula itself is fine. */
  note: string | null;
};

/**
 * Check one formula against a template's names, and evaluate it with the
 * defaults: every input and rate, the example's `qty_<code>` and `sub_<group>`,
 * and the geometry module's piece totals.
 */
export function checkFormula(rawTemplate: unknown, formula: string): FormulaCheck {
  const t = isRecord(rawTemplate) ? rawTemplate : {};
  const keys = (list: unknown): string[] => (Array.isArray(list) ? list.filter(isRecord).map((x) => x.key).filter((k): k is string => typeof k === "string") : []);
  const rules = Array.isArray(t.rules) ? t.rules.filter(isRecord) : [];
  const known = new Set<string>([...keys(t.inputs), ...keys(t.rates)]);
  const mod = getGeometry(typeof t.geometry === "string" ? t.geometry : null);
  if (mod) for (const n of geometryIdentifiers(mod)) known.add(n);
  for (const r of rules) {
    if (typeof r.code === "string") known.add(`qty_${r.code}`);
    if (typeof r.group === "string" && groupSlug(r.group)) known.add(`sub_${groupSlug(r.group)}`);
  }

  const syntax = validateFormula(formula, known);
  const base = { identifiers: syntax.identifiers, unknown: syntax.unknownIdentifiers };
  if (!syntax.ok) return { ok: false, errors: syntax.errors, ...base, value: null, note: null };

  const v = validateTemplate(rawTemplate);
  if (!v.ok || !v.template) return { ok: true, errors: [], ...base, value: null, note: "The formula is valid; fix the template problems to see its value." };
  const res = computeEstimate(v.template, {}, {});
  if (!res.ok) return { ok: true, errors: [], ...base, value: null, note: "The formula is valid; the template does not compute with its defaults yet." };

  const scope: Record<string, number> = {};
  for (const i of v.template.inputs) {
    scope[i.key] = i.type === "number" ? Number(i.default)
      : i.type === "boolean" ? (i.default ? 1 : 0)
      : (i.options?.find((o) => o.key === i.default)?.value ?? 0);
  }
  for (const r of v.template.rates) scope[r.key] = r.value;
  const gmod = getGeometry(v.template.geometry);
  if (gmod && res.model) Object.assign(scope, pieceScope(gmod, res.model, densityFromRates(v.template.rates)));
  for (const r of v.template.rules) {
    scope[`qty_${r.code}`] = res.lines.filter((l) => l.code === r.code).reduce((a, l) => a + l.qty, 0);
    scope[`sub_${groupSlug(r.group)}`] = res.summary.by_group.find((g) => g.key === groupSlug(r.group))?.cost ?? 0;
  }
  const out = evaluateFormula(formula, scope);
  if (!out.ok) return { ok: false, errors: [out.error], ...base, value: null, note: null };
  return { ok: true, errors: [], ...base, value: out.value, note: null };
}
