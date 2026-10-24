// Estimate template schema and validation (docs/estimator-architecture.md §1).
//
// A template is tenant data: named inputs, named rates (constants) and an
// ordered list of rule lines whose quantity is a formula. Hand-validated --
// the repo carries no schema library and this shape is small enough that a
// bespoke check gives better messages ("rule ewp: qty refers to a later line")
// than a generic one.
//
// The scope a rule's formulas may read is, in order of appearance:
//   - every input key (a select reads as its chosen option's number, a
//     boolean as 1 or 0),
//   - every rate key,
//   - `qty_<code>` of EARLIER rules (their net quantity, after rounding),
//   - `sub_<group>` of EARLIER groups that are already complete (every rule of
//     that group sits above the rule asking), where <group> is groupSlug().
// Anything else is rejected with a precise message, which also rules out
// cycles: a rule can only ever depend on the rules above it.

import { ESTIMATE_COMPONENTS, groupSlug } from "./types";
import type {
  EstimateTemplateBody, ProductMatch, TemplateInput, TemplateInputOption, TemplateRate, TemplateRule, TemplateRuleCost,
} from "./types";
import { ATTR_KEY_RE, MAX_ATTRS, MAX_ATTR_VALUE } from "./productMatch";
import { FORMULA_FUNCTIONS, formulaIdentifiers, parseFormula } from "./formula";
import { getGeometry, geometryIdentifiers, TOTAL_IDENTIFIERS, GEOMETRY_KEYS } from "./geometry";
import { SIM_CAPACITY_RATES, SIM_RATE_KEYS } from "./simRates";

const SIM_CAPACITY_BY_KEY = new Map<string, (typeof SIM_CAPACITY_RATES)[number]>(SIM_CAPACITY_RATES.map((r) => [r.key, r]));

export const MAX_INPUTS = 100;
export const MAX_RATES = 200;
export const MAX_RULES = 300;
export const MAX_OPTIONS = 50;

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const OPTION_KEY_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;

/** Words an input, rate or rule code may not use: they would shadow syntax. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(["and", "or", "not", ...FORMULA_FUNCTIONS, ...TOTAL_IDENTIFIERS]);

export type TemplateIssue = {
  /** Where, e.g. "rules[3].qty" -- stable enough for a form to point at. */
  path: string;
  message: string;
};

export type TemplateValidation = {
  ok: boolean;
  issues: TemplateIssue[];
  /** Non-blocking observations (unused inputs and rates). */
  warnings: TemplateIssue[];
  /** The cleaned template, present only when ok. */
  template?: EstimateTemplateBody;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function text(v: unknown, max: number): string | null {
  if (!isStr(v)) return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

function optText(v: unknown, max: number): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return isStr(v) && v.trim().length <= max ? v.trim() : undefined;
}

function checkName(kind: string, key: unknown, path: string, issues: TemplateIssue[]): string | null {
  if (!isStr(key) || !KEY_RE.test(key)) {
    issues.push({ path, message: `${kind} key must be lowercase letters, digits and underscores, starting with a letter (e.g. wall_height_m).` });
    return null;
  }
  if (RESERVED_NAMES.has(key)) {
    issues.push({ path, message: `"${key}" is a reserved word in formulas; choose another ${kind} key.` });
    return null;
  }
  if (key.startsWith("qty_") || key.startsWith("sub_")) {
    issues.push({ path, message: `${kind} keys cannot start with "qty_" or "sub_"; those prefixes belong to rule lines and group subtotals.` });
    return null;
  }
  return key;
}

function validateInputs(raw: unknown, issues: TemplateIssue[]): TemplateInput[] {
  const out: TemplateInput[] = [];
  if (raw === undefined) return out;
  if (!Array.isArray(raw)) { issues.push({ path: "inputs", message: "inputs must be a list." }); return out; }
  if (raw.length > MAX_INPUTS) issues.push({ path: "inputs", message: `A template can have at most ${MAX_INPUTS} inputs.` });
  raw.slice(0, MAX_INPUTS).forEach((r, i) => {
    const path = `inputs[${i}]`;
    if (!isRecord(r)) { issues.push({ path, message: "Each input must be an object." }); return; }
    const key = checkName("input", r.key, `${path}.key`, issues);
    const label = text(r.label, 120);
    if (!label) issues.push({ path: `${path}.label`, message: "Every input needs a label (up to 120 characters)." });
    const type = r.type;
    if (type !== "number" && type !== "select" && type !== "boolean") {
      issues.push({ path: `${path}.type`, message: 'Input type must be "number", "select" or "boolean".' });
      return;
    }
    const base = { unit: optText(r.unit, 30), help: optText(r.help, 300), section: optText(r.section, 60) };
    if (!key || !label) return;

    if (type === "number") {
      if (!isNum(r.default)) { issues.push({ path: `${path}.default`, message: "A number input needs a numeric default." }); return; }
      const min = r.min === undefined || r.min === null ? undefined : r.min;
      const max = r.max === undefined || r.max === null ? undefined : r.max;
      if (min !== undefined && !isNum(min)) { issues.push({ path: `${path}.min`, message: "min must be a number." }); return; }
      if (max !== undefined && !isNum(max)) { issues.push({ path: `${path}.max`, message: "max must be a number." }); return; }
      if (min !== undefined && max !== undefined && min > max) { issues.push({ path: `${path}.min`, message: "min cannot be greater than max." }); return; }
      if (min !== undefined && r.default < min) { issues.push({ path: `${path}.default`, message: `Default ${r.default} is below the minimum ${min}.` }); return; }
      if (max !== undefined && r.default > max) { issues.push({ path: `${path}.default`, message: `Default ${r.default} is above the maximum ${max}.` }); return; }
      out.push({ key, label, type, default: r.default, ...(min !== undefined ? { min: min as number } : {}), ...(max !== undefined ? { max: max as number } : {}), ...stripUndef(base) });
    } else if (type === "boolean") {
      if (typeof r.default !== "boolean") { issues.push({ path: `${path}.default`, message: "A yes/no input needs a true or false default." }); return; }
      out.push({ key, label, type, default: r.default, ...stripUndef(base) });
    } else {
      const opts = validateOptions(r.options, `${path}.options`, issues);
      if (!opts) return;
      if (!isStr(r.default) || !opts.some((o) => o.key === r.default)) {
        issues.push({ path: `${path}.default`, message: "A select input's default must be the key of one of its options." });
        return;
      }
      out.push({ key, label, type, default: r.default, options: opts, ...(r.quote_alternatives === true ? { quote_alternatives: true } : {}), ...stripUndef(base) });
    }
  });
  return out;
}

function validateOptions(raw: unknown, path: string, issues: TemplateIssue[]): TemplateInputOption[] | null {
  if (!Array.isArray(raw) || raw.length === 0) { issues.push({ path, message: "A select input needs at least one option." }); return null; }
  if (raw.length > MAX_OPTIONS) { issues.push({ path, message: `A select input can have at most ${MAX_OPTIONS} options.` }); return null; }
  const seen = new Set<string>();
  const out: TemplateInputOption[] = [];
  let bad = false;
  raw.forEach((o, i) => {
    const p = `${path}[${i}]`;
    if (!isRecord(o)) { issues.push({ path: p, message: "Each option must be an object." }); bad = true; return; }
    const key = isStr(o.key) && OPTION_KEY_RE.test(o.key) ? o.key : null;
    const label = text(o.label, 80);
    if (!key) { issues.push({ path: `${p}.key`, message: "Option key must be lowercase letters, digits and underscores." }); bad = true; }
    else if (seen.has(key)) { issues.push({ path: `${p}.key`, message: `Duplicate option key "${key}".` }); bad = true; }
    if (!label) { issues.push({ path: `${p}.label`, message: "Every option needs a label." }); bad = true; }
    if (!isNum(o.value)) { issues.push({ path: `${p}.value`, message: "Every option needs a numeric value; formulas see this number." }); bad = true; }
    const attrs = validateAttrs(o.attrs, `${p}.attrs`, issues);
    if (attrs === null) bad = true;
    if (key && label && isNum(o.value) && attrs !== null) { seen.add(key); out.push({ key, label, value: o.value, ...(attrs ? { attrs } : {}) }); }
  });
  return bad ? null : out;
}

/** Catalogue attributes: lowercase names, short text values. undefined = none given, null = invalid. */
function validateAttrs(raw: unknown, path: string, issues: TemplateIssue[]): Record<string, string> | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) { issues.push({ path, message: "Attributes must be name and text pairs." }); return null; }
  const entries = Object.entries(raw);
  if (entries.length > MAX_ATTRS) { issues.push({ path, message: `At most ${MAX_ATTRS} attributes.` }); return null; }
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!ATTR_KEY_RE.test(k)) { issues.push({ path, message: `Attribute name "${k.slice(0, 40)}" must be lowercase letters, digits and underscores.` }); return null; }
    if (!isStr(v) || v.trim() === "" || v.trim().length > MAX_ATTR_VALUE) { issues.push({ path: `${path}.${k}`, message: `Attribute "${k}" needs a text value of up to ${MAX_ATTR_VALUE} characters.` }); return null; }
    out[k] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function validateRates(raw: unknown, issues: TemplateIssue[]): TemplateRate[] {
  const out: TemplateRate[] = [];
  if (raw === undefined) return out;
  if (!Array.isArray(raw)) { issues.push({ path: "rates", message: "rates must be a list." }); return out; }
  if (raw.length > MAX_RATES) issues.push({ path: "rates", message: `A template can have at most ${MAX_RATES} rates.` });
  raw.slice(0, MAX_RATES).forEach((r, i) => {
    const path = `rates[${i}]`;
    if (!isRecord(r)) { issues.push({ path, message: "Each rate must be an object." }); return; }
    const key = checkName("rate", r.key, `${path}.key`, issues);
    const label = text(r.label, 120);
    if (!label) issues.push({ path: `${path}.label`, message: "Every rate needs a label." });
    const unit = isStr(r.unit) && r.unit.trim().length <= 30 ? r.unit.trim() : null;
    if (unit === null) issues.push({ path: `${path}.unit`, message: "Every rate needs a unit (it may be empty text, up to 30 characters)." });
    if (!isNum(r.value)) issues.push({ path: `${path}.value`, message: "A rate's value must be a finite number." });
    let rangeOk = true;
    const hasLow = r.low !== undefined && r.low !== null && r.low !== "";
    const hasHigh = r.high !== undefined && r.high !== null && r.high !== "";
    if (hasLow !== hasHigh) {
      issues.push({ path: `${path}.${hasLow ? "high" : "low"}`, message: "Give both a low and a high for the risk range, or neither." });
      rangeOk = false;
    } else if (hasLow && hasHigh) {
      if (!isNum(r.low)) { issues.push({ path: `${path}.low`, message: "The low end of the range must be a number." }); rangeOk = false; }
      if (!isNum(r.high)) { issues.push({ path: `${path}.high`, message: "The high end of the range must be a number." }); rangeOk = false; }
      if (rangeOk && isNum(r.value) && isNum(r.low) && isNum(r.high)) {
        if (r.low > r.value) { issues.push({ path: `${path}.low`, message: `The low end (${r.low}) must not be above the value (${r.value}).` }); rangeOk = false; }
        else if (r.high < r.value) { issues.push({ path: `${path}.high`, message: `The high end (${r.high}) must not be below the value (${r.value}).` }); rangeOk = false; }
      }
    }
    if (key && SIM_CAPACITY_BY_KEY.has(key) && isNum(r.value)) {
      const spec = SIM_CAPACITY_BY_KEY.get(key)!;
      if (spec.kind === "positive" && r.value <= 0) issues.push({ path: `${path}.value`, message: `${spec.label} must be more than zero.` });
      if (spec.kind === "day" && (r.value < 0 || !Number.isInteger(r.value))) issues.push({ path: `${path}.value`, message: `${spec.label} must be a whole number of days, zero or more.` });
    }
    if (key && label && unit !== null && isNum(r.value) && rangeOk) {
      out.push({ key, label, unit, value: r.value, ...(hasLow && isNum(r.low) && isNum(r.high) ? { low: r.low, high: r.high } : {}) });
    }
  });
  return out;
}

function stripUndef<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

type RawRule = {
  code: string; group: string; description: string; uom: string; qty: string;
  waste_pct: number | string | undefined; component: TemplateRule["component"]; cost: TemplateRuleCost; element_type: string | undefined;
};

function validateRuleShapes(raw: unknown, rateKeys: Set<string>, inputs: readonly TemplateInput[], issues: TemplateIssue[]): RawRule[] {
  const out: RawRule[] = [];
  if (!Array.isArray(raw)) { issues.push({ path: "rules", message: "rules must be a list." }); return out; }
  if (raw.length === 0) issues.push({ path: "rules", message: "A template needs at least one rule line." });
  if (raw.length > MAX_RULES) issues.push({ path: "rules", message: `A template can have at most ${MAX_RULES} rule lines.` });
  const codes = new Set<string>();
  const elementTypes = new Set<string>();
  raw.slice(0, MAX_RULES).forEach((r, i) => {
    const path = `rules[${i}]`;
    if (!isRecord(r)) { issues.push({ path, message: "Each rule must be an object." }); return; }
    let ok = true;
    const fail = (p: string, message: string) => { issues.push({ path: `${path}.${p}`, message }); ok = false; };

    const code = isStr(r.code) && KEY_RE.test(r.code) ? r.code : null;
    if (!code) fail("code", "Rule code must be lowercase letters, digits and underscores, starting with a letter (e.g. wall_panels).");
    else if (codes.has(code)) fail("code", `Duplicate rule code "${code}"; codes must be unique.`);
    else codes.add(code);

    const group = text(r.group, 80);
    if (!group) fail("group", "Every rule needs a group (up to 80 characters).");
    else if (groupSlug(group) === "") fail("group", "The group name needs at least one letter or digit.");
    const description = text(r.description, 200);
    if (!description) fail("description", "Every rule needs a description (up to 200 characters).");
    const uom = text(r.uom, 20);
    if (!uom) fail("uom", "Every rule needs a unit of measure (up to 20 characters).");
    const qty = text(r.qty, 1000);
    if (!qty) fail("qty", "Every rule needs a quantity formula.");

    let waste: number | string | undefined;
    if (r.waste_pct !== undefined && r.waste_pct !== null && r.waste_pct !== "") {
      if (isNum(r.waste_pct)) {
        if (r.waste_pct < 0 || r.waste_pct > 100) fail("waste_pct", "Waste must be between 0 and 100 percent.");
        else waste = r.waste_pct;
      } else if (isStr(r.waste_pct) && r.waste_pct.trim() !== "") waste = r.waste_pct.trim();
      else fail("waste_pct", "Waste must be a number of percent or a formula.");
    }

    const component = ESTIMATE_COMPONENTS.find((c) => c === r.component);
    if (!component) fail("component", `Component must be one of: ${ESTIMATE_COMPONENTS.join(", ")}.`);

    let cost: TemplateRuleCost | null = null;
    if (!isRecord(r.cost)) fail("cost", "Every rule needs a cost source: a product SKU or a rate.");
    else if (r.cost.kind === "product") {
      const sku = text(r.cost.sku, 80);
      const ref = text(r.cost.ref, 80);
      let match: ProductMatch | undefined;
      if (r.cost.match !== undefined && r.cost.match !== null) {
        const m = r.cost.match;
        if (!isRecord(m)) fail("cost.match", "A product match must have attributes.");
        else {
          const before = issues.length;
          const attrs = validateAttrs(m.attrs, `${path}.cost.match.attrs`, issues);
          let from: string[] | undefined;
          if (m.from !== undefined && m.from !== null) {
            if (!Array.isArray(m.from) || m.from.some((x) => !isStr(x))) fail("cost.match.from", "\"from\" must be a list of select input keys.");
            else {
              from = [...new Set(m.from as string[])];
              for (const k of from) {
                const input = inputs.find((x) => x.key === k);
                if (!input || input.type !== "select") fail("cost.match.from", `Match input "${k}" must be one of the template's select inputs.`);
              }
            }
          }
          if (issues.length > before) ok = false;
          else if (!attrs && !(from && from.length > 0)) fail("cost.match", "A product match needs at least one attribute or one select input.");
          else match = { attrs: attrs ?? {}, ...(from && from.length > 0 ? { from } : {}) };
        }
      }
      if (!sku && !ref && !match) { if (ok) fail("cost.sku", "A product cost needs the product's SKU or its product reference, or a catalogue match."); }
      else if (ok) cost = { kind: "product", ...(sku ? { sku } : {}), ...(ref ? { ref } : {}), ...(match ? { match } : {}) };
    } else if (r.cost.kind === "rate") {
      if (!isStr(r.cost.rate) || !rateKeys.has(r.cost.rate)) fail("cost.rate", `Cost rate "${String(r.cost.rate)}" is not one of the template's rates.`);
      else cost = { kind: "rate", rate: r.cost.rate };
    } else fail("cost.kind", 'Cost kind must be "product" or "rate".');

    let elementType: string | undefined;
    if (r.element_type !== undefined && r.element_type !== null && r.element_type !== "") {
      if (!isStr(r.element_type) || !KEY_RE.test(r.element_type)) fail("element_type", "Element type must be lowercase letters, digits and underscores (e.g. wall_panel).");
      else if (elementTypes.has(r.element_type)) fail("element_type", `Element type "${r.element_type}" is already used by another rule; each type feeds one line.`);
      else { elementTypes.add(r.element_type); elementType = r.element_type; }
    }

    if (ok && code && group && description && uom && qty && component && cost) {
      out.push({ code, group, description, uom, qty, waste_pct: waste, component, cost, element_type: elementType });
    }
  });
  return out;
}

/**
 * Validate a template body (the three jsonb columns). Returns every problem
 * found, not just the first, so the editor can show them all at once.
 */
export function validateTemplate(raw: unknown): TemplateValidation {
  const issues: TemplateIssue[] = [];
  const warnings: TemplateIssue[] = [];
  if (!isRecord(raw)) {
    return { ok: false, issues: [{ path: "", message: "A template must be an object with inputs, rates and rules." }], warnings };
  }

  const inputs = validateInputs(raw.inputs, issues);
  const rates = validateRates(raw.rates, issues);

  // Inputs and rates share one namespace in formulas.
  const names = new Map<string, string>();
  inputs.forEach((x, i) => {
    if (names.has(x.key)) issues.push({ path: `inputs[${i}].key`, message: `"${x.key}" is already used by ${names.get(x.key)}.` });
    else names.set(x.key, "another input");
  });
  rates.forEach((x, i) => {
    if (names.has(x.key)) issues.push({ path: `rates[${i}].key`, message: `"${x.key}" is already used by ${names.get(x.key)}.` });
    else names.set(x.key, "another rate or input");
  });

  const rules = validateRuleShapes(raw.rules, new Set(rates.map((r) => r.key)), inputs, issues);

  // Geometry module: optional, must exist, and the template must supply the
  // inputs the module reads. Its pieces then add vol_/n_/area_ names.
  let geometry: string | undefined;
  const geometryNames = new Set<string>();
  const used = new Set<string>();
  if (raw.geometry !== undefined && raw.geometry !== null && raw.geometry !== "") {
    const mod = isStr(raw.geometry) ? getGeometry(raw.geometry) : null;
    if (!mod) {
      issues.push({ path: "geometry", message: `Unknown geometry module "${String(raw.geometry).slice(0, 40)}". Available: ${GEOMETRY_KEYS.join(", ")}.` });
    } else {
      geometry = mod.key;
      for (const n of geometryIdentifiers(mod)) geometryNames.add(n);
      for (const spec of mod.inputs) {
        const input = inputs.find((x) => x.key === spec.key);
        if (!input && spec.required) {
          issues.push({ path: "inputs", message: `The "${mod.key}" geometry needs an input with the key "${spec.key}".` });
        } else if (input) {
          used.add(spec.key);
          if (input.type === "select" && !spec.select_ok) issues.push({ path: "inputs", message: `Input "${spec.key}" is read by the "${mod.key}" geometry and must be a number or yes/no input.` });
        }
      }
      // The density rate feeds weight_total.
      for (const r of rates) if (/density_t_m3$/.test(r.key)) used.add(r.key);
    }
  }

  // Group identifiers: two display names that slug the same would share one
  // `sub_` name, which is ambiguous.
  const slugToGroup = new Map<string, string>();
  const lastIndexOfGroup = new Map<string, number>(); // slug -> index of the group's LAST rule
  rules.forEach((rule, i) => {
    const slug = groupSlug(rule.group);
    const known = slugToGroup.get(slug);
    if (known !== undefined && known !== rule.group) {
      issues.push({ path: `rules[${i}].group`, message: `Group "${rule.group}" has the same identifier (sub_${slug}) as "${known}"; rename one.` });
    }
    if (known === undefined) slugToGroup.set(slug, rule.group);
    lastIndexOfGroup.set(slug, i);
  });

  const inputRateNames = new Set(names.keys());
  const codeIndex = new Map(rules.map((r, i) => [r.code, i]));

  const checkFormula = (src: string, ruleIndex: number, field: "qty" | "waste_pct") => {
    const path = `rules[${ruleIndex}].${field}`;
    const rule = rules[ruleIndex];
    const parsed = parseFormula(src);
    if (!parsed.ok) { issues.push({ path, message: `${rule.code}: ${parsed.error.message}` }); return; }
    const ownSlug = groupSlug(rule.group);
    for (const id of formulaIdentifiers(parsed.ast)) {
      const name = id.name;
      used.add(name);
      if (inputRateNames.has(name) || geometryNames.has(name)) continue;
      if (name.startsWith("qty_")) {
        const ref = name.slice(4);
        const at = codeIndex.get(ref);
        if (at === undefined) issues.push({ path, message: `${rule.code}: "${name}" refers to a rule "${ref}" that does not exist.` });
        else if (at === ruleIndex) issues.push({ path, message: `${rule.code}: "${name}" refers to the line itself (a rule cannot use its own quantity).` });
        else if (at > ruleIndex) issues.push({ path, message: `${rule.code}: "${name}" refers to a later line; a rule can only use lines above it (move "${ref}" above "${rule.code}").` });
        continue;
      }
      if (name.startsWith("sub_")) {
        const slug = name.slice(4);
        const last = lastIndexOfGroup.get(slug);
        if (last === undefined) issues.push({ path, message: `${rule.code}: "${name}" refers to a group that does not exist.` });
        else if (slug === ownSlug) issues.push({ path, message: `${rule.code}: "${name}" is the rule's own group; a group's subtotal is only available to rules below it.` });
        else if (last >= ruleIndex) issues.push({ path, message: `${rule.code}: "${name}" is not complete at this point; every rule of group "${slugToGroup.get(slug)}" must sit above "${rule.code}".` });
        continue;
      }
      issues.push({ path, message: `${rule.code}: unknown name "${name}". Use an input or rate key, qty_<rule code> or sub_<group>${geometryNames.size ? ", or a piece total such as vol_total" : ""}.` });
    }
  };

  rules.forEach((rule, i) => {
    checkFormula(rule.qty, i, "qty");
    if (isStr(rule.waste_pct)) checkFormula(rule.waste_pct, i, "waste_pct");
    if (rule.cost.kind === "rate") used.add(rule.cost.rate);
    if (rule.cost.kind === "product") for (const k of rule.cost.match?.from ?? []) used.add(k);
  });

  inputs.forEach((x, i) => { if (!used.has(x.key)) warnings.push({ path: `inputs[${i}]`, message: `Input "${x.key}" is not used by any rule.` }); });
  rates.forEach((x, i) => { if (!used.has(x.key) && !SIM_RATE_KEYS.has(x.key)) warnings.push({ path: `rates[${i}]`, message: `Rate "${x.key}" is not used by any rule.` }); });

  if (issues.length > 0) return { ok: false, issues, warnings };

  const template: EstimateTemplateBody = {
    ...(geometry ? { geometry } : {}),
    inputs,
    rates,
    rules: rules.map((r) => ({
      code: r.code, group: r.group, description: r.description, uom: r.uom, qty: r.qty,
      ...(r.waste_pct !== undefined ? { waste_pct: r.waste_pct } : {}),
      component: r.component, cost: r.cost,
      ...(r.element_type ? { element_type: r.element_type } : {}),
    })),
  };
  return { ok: true, issues, warnings, template };
}

// ── Parameters ───────────────────────────────────────────────────────────────

export type EstimateParams = Record<string, number | string | boolean>;

export type ResolvedParams = {
  ok: boolean;
  issues: TemplateIssue[];
  /** Normalised values by input key (what an estimate stores in `params`). */
  params: EstimateParams;
  /** What formulas see: numbers only (select -> option value, boolean -> 1/0). */
  scope: Record<string, number>;
};

/** The default value of every input. */
export function defaultParams(inputs: readonly TemplateInput[]): EstimateParams {
  const out: EstimateParams = {};
  for (const i of inputs) out[i.key] = i.default;
  return out;
}

/**
 * Check supplied input values against the template and turn them into the
 * numeric scope formulas read. Missing values take the default; anything out
 * of range or of the wrong kind is an issue (never silently clamped, so a
 * typo does not become a wrong price).
 */
export function resolveParams(inputs: readonly TemplateInput[], supplied: Record<string, unknown> | null | undefined): ResolvedParams {
  const issues: TemplateIssue[] = [];
  const params: EstimateParams = {};
  const scope: Record<string, number> = {};
  const src = supplied ?? {};
  for (const input of inputs) {
    const path = `params.${input.key}`;
    const given = Object.prototype.hasOwnProperty.call(src, input.key) ? src[input.key] : undefined;
    const v = given === undefined || given === null || given === "" ? input.default : given;
    if (input.type === "number") {
      const n = isNum(v) ? v : isStr(v) && v.trim() !== "" ? Number(v) : NaN;
      if (!Number.isFinite(n)) { issues.push({ path, message: `${input.label} must be a number.` }); continue; }
      if (input.min !== undefined && n < input.min) { issues.push({ path, message: `${input.label} cannot be below ${input.min}.` }); continue; }
      if (input.max !== undefined && n > input.max) { issues.push({ path, message: `${input.label} cannot be above ${input.max}.` }); continue; }
      params[input.key] = n;
      scope[input.key] = n;
    } else if (input.type === "boolean") {
      let b: boolean | null = null;
      if (typeof v === "boolean") b = v;
      else if (v === 1 || v === "1" || v === "true") b = true;
      else if (v === 0 || v === "0" || v === "false") b = false;
      if (b === null) { issues.push({ path, message: `${input.label} must be yes or no.` }); continue; }
      params[input.key] = b;
      scope[input.key] = b ? 1 : 0;
    } else {
      const opt = (input.options ?? []).find((o) => o.key === v);
      if (!opt) { issues.push({ path, message: `${input.label} must be one of: ${(input.options ?? []).map((o) => o.key).join(", ")}.` }); continue; }
      params[input.key] = opt.key;
      scope[input.key] = opt.value;
    }
  }
  return { ok: issues.length === 0, issues, params, scope };
}
