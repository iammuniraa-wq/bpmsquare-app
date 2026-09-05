// Calculation core (spec §6): the waterfall executor. Pure and deterministic —
// procedures, components, rules, cost models and the document come in as plain
// data; a priced document with a full trace comes out. No I/O, no wall clock.
//
// Trace philosophy (spec §1.3): explainability is an output, not a log. Every
// step lands in the trace — APPLIED with the rule and basis that produced the
// number, EXCLUDED with the exclusion-group verdict, SKIPPED with why, and a
// required component that can't resolve is a hard error, never a silent 0.

import { DslError } from "./dsl/ast";
import { parseFormula } from "./dsl/parser";
import { evaluate, resolveScaleTiered, type EvalContext } from "./dsl/evaluator";
import { flattenContext, resolveRules, resolveCostInput, resolveCost, PricingError, type ResolvedRule, type CostConsidered } from "./resolution";
import type {
  AttrValue, CostCandidate, CostInputKind, CostModel, CostQuality, DimensionRegistry, PriceComponent, PriceRule,
  PricingProcedure, ProcedureStep, RoundingRule, StepGuardrail,
} from "./types";

// ── Input / output shapes ───────────────────────────────────────────────────

/** One cost quantity on a line. `kind` is needed only when the path is not
 *  defined on the cost model (a product-specific path such as
 *  purchase.unit_cost); `candidates` are this line's own figures for the
 *  path (ERP cost, RFQ reply), resolved through the model's ladder together
 *  with the model's tenant-wide rates. */
export type CostItem = { path: string; qty: number; kind?: CostInputKind; candidates?: CostCandidate[] };

export type LineFlag = {
  code: "MARGIN_FLOOR";
  policy: StepGuardrail["policy"];
  component: string;
  floor_pct: number;
  actual_pct: number;
  cost: number;
  revenue: number;
};

export type DocumentLine = {
  line_no: number;
  attributes?: Record<string, unknown>;     // product/line matching attrs + DSL ctx.line
  quantity?: number;
  weight_kg?: number;
  cost_items?: CostItem[];
  /** Rep-entered overrides, gated by each component's manual_override policy. */
  manual?: Record<string, { value: number; reason?: string }>;
};

export type PriceInput = {
  procedure: PricingProcedure & { steps: (ProcedureStep & { rollup_kind?: CostInputKind })[] };
  components: PriceComponent[];
  rules: PriceRule[];
  cost_models: CostModel[];
  registry: DimensionRegistry;
  document: {
    attributes?: Record<string, unknown>;   // header matching attrs (document_type, customer.*, region…)
    lines: DocumentLine[];
  };
  pricing_date: string;                     // ISO yyyy-mm-dd
  currency?: string;
};

export type TraceStatus = "APPLIED" | "EXCLUDED" | "SKIPPED" | "SUBTOTAL";

export type TraceStep = {
  step: number;
  component?: string;
  subtotal?: string;
  status: TraceStatus;
  reason?: string;
  rule_id?: string;
  matched_on?: Record<string, AttrValue>;
  specificity?: number;
  candidates_considered?: number;
  inputs?: TraceCostInput[];
  basis?: number;
  value?: number;                            // rule value / rate before basis application
  result?: number;                           // signed amount contributed (0 for statistical display)
  statistical?: boolean;
  manual?: boolean;
  guardrail?: LineFlag;                      // on a guardrail step: the check's outcome
};

export type TraceCostInput = {
  path: string; rate: number; qty: number;
  source?: string; quality?: CostQuality; as_of?: string | null;
  considered?: CostConsidered[];
};

export type PricedLine = {
  line_no: number;
  net: number;
  subtotals: Record<string, number>;
  components: Record<string, number>;        // signed amounts incl. statistical
  trace: TraceStep[];
  flags: LineFlag[];
};

export type PriceResult = {
  pricing_date: string;
  currency: string | null;
  lines: PricedLine[];
  totals: { net: number; subtotals: Record<string, number> };
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function applyRounding(value: number, rule: RoundingRule | null | undefined): number {
  if (!rule) return value;
  const factor = 10 ** rule.precision;
  // COMMERCIAL is half-up on the magnitude (symmetric); HALF_UP is plain.
  const rounded = rule.mode === "COMMERCIAL"
    ? Math.sign(value) * Math.round(Math.abs(value) * factor) / factor
    : Math.round(value * factor) / factor;
  if (rule.charm === "END_99") return Math.floor(rounded) + 0.99;
  if (rule.charm === "END_95") return Math.floor(rounded) + 0.95;
  return rounded;
}

function applySign(value: number, sign: PriceComponent["sign"]): number {
  if (sign === "POSITIVE") return Math.abs(value);
  if (sign === "NEGATIVE") return -Math.abs(value);
  return value;
}

/** Graduated (slab) accumulation: each band's units priced at that band's rate. */
export function resolveScaleGraduated(entries: { from: number; value: number }[], basis: number): number {
  const sorted = [...entries].sort((a, b) => a.from - b.from);
  if (sorted.length === 0 || sorted[0].from > 0) {
    throw new PricingError("BAD_SCALE", "Graduated scale must start at from: 0");
  }
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    const bandStart = sorted[i].from;
    if (basis <= bandStart) break;
    const bandEnd = i + 1 < sorted.length ? Math.min(sorted[i + 1].from, basis) : basis;
    total += (bandEnd - bandStart) * sorted[i].value;
  }
  return total;
}

// ── The executor ────────────────────────────────────────────────────────────

export function priceDocument(input: PriceInput): PriceResult {
  const componentsByCode = new Map(input.components.map((c) => [c.code, c]));
  const rulesByComponent = new Map<string, PriceRule[]>();
  for (const r of input.rules) {
    const list = rulesByComponent.get(r.component_code) ?? [];
    list.push(r);
    rulesByComponent.set(r.component_code, list);
  }
  const costModelsByCode = new Map(input.cost_models.map((m) => [m.code, m]));

  const headerAttrs = input.document.attributes ?? {};
  const lines: PricedLine[] = [];

  for (const line of input.document.lines) {
    lines.push(priceLine(line));
  }

  const totals: PriceResult["totals"] = { net: 0, subtotals: {} };
  for (const l of lines) {
    totals.net += l.net;
    for (const [name, v] of Object.entries(l.subtotals)) {
      totals.subtotals[name] = (totals.subtotals[name] ?? 0) + v;
    }
  }

  return { pricing_date: input.pricing_date, currency: input.currency ?? null, lines, totals };

  // ── per line ──────────────────────────────────────────────────────────────

  function priceLine(line: DocumentLine): PricedLine {
    const lineAttrs = line.attributes ?? {};
    const flatCtx = {
      ...flattenContext(headerAttrs as Record<string, unknown>),
      ...flattenContext(lineAttrs as Record<string, unknown>),
    };

    let net = 0;
    const subtotals: Record<string, number> = {};
    const componentAmounts: Record<string, number> = {};
    const trace: TraceStep[] = [];
    const flags: LineFlag[] = [];

    // DSL context: header + line trees plus computed cost tree resolved lazily.
    const dslCtx: Record<string, unknown> = {
      ...structuredCloneSafe(headerAttrs),
      line: { ...structuredCloneSafe(lineAttrs), quantity: line.quantity ?? null, weight_kg: line.weight_kg ?? null, cost_items: line.cost_items ?? [] },
      cost: buildCostTree(),
    };

    const hooks: EvalContext["hooks"] = {
      lookup: (code) => {
        if (!(code in componentAmounts)) throw new DslError(`lookup('${code}'): component not computed yet at this step`, 0);
        return componentAmounts[code];
      },
      subtotal: (ref) => {
        if (!(ref in subtotals)) throw new DslError(`subtotal('${ref}'): not accumulated yet at this step`, 0);
        return subtotals[ref];
      },
      pricingDate: () => input.pricing_date,
    };

    // Exclusion groups are resolved best-for-customer across the group: every
    // member computes, the lowest signed amount wins, the rest are EXCLUDED.
    type Pending = { step: ProcedureStep & { rollup_kind?: CostInputKind }; component: PriceComponent; trace: TraceStep };
    const pendingByGroup = new Map<string, Pending[]>();

    const steps = [...input.procedure.steps].sort((a, b) => a.step - b.step);
    for (const step of steps) {
      if (step.subtotal) {
        flushExclusionGroups();
        subtotals[step.subtotal] = net;
        trace.push({ step: step.step, subtotal: step.subtotal, status: "SUBTOTAL", result: net });
        continue;
      }
      if (!step.component) continue;

      const component = componentsByCode.get(step.component);
      if (!component) throw new PricingError("UNKNOWN_COMPONENT", `Step ${step.step} references unknown component "${step.component}"`);

      // Requirement gate.
      if (step.requirement) {
        const expr = step.requirement.startsWith("dsl:") ? step.requirement.slice(4) : step.requirement;
        let pass: boolean;
        try {
          pass = Boolean(evaluate(parseFormula(expr), { ctx: dslCtx, hooks }));
        } catch (e) {
          throw new PricingError("REQUIREMENT_ERROR", `Step ${step.step} requirement failed to evaluate: ${(e as Error).message}`);
        }
        if (!pass) {
          trace.push({ step: step.step, component: component.code, status: "SKIPPED", reason: "requirement not met" });
          continue;
        }
      }

      const computed = computeStep(step, component);
      if (!computed) continue; // already traced as SKIPPED

      if (step.exclusion_group) {
        const list = pendingByGroup.get(step.exclusion_group) ?? [];
        list.push({ step, component, trace: computed });
        pendingByGroup.set(step.exclusion_group, list);
        continue; // applied or excluded at flush time
      }
      if (step.guardrail) applyGuardrail(step, component, computed);
      commit(component, computed, step);
    }
    flushExclusionGroups();

    return { line_no: line.line_no, net, subtotals, components: componentAmounts, trace, flags };

    // ── guardrails ──────────────────────────────────────────────────────────

    function applyGuardrail(step: ProcedureStep, component: PriceComponent, t: TraceStep): void {
      const g = step.guardrail!;
      if (g.kind !== "MARGIN_FLOOR") return;
      // The component's amount IS the floor percentage (a statistical
      // FIXED_AMOUNT rule such as 15). Both subtotals must already exist --
      // a guardrail placed before its revenue subtotal is a config error.
      for (const ref of [g.cost_subtotal, g.revenue_subtotal]) {
        if (!(ref in subtotals)) throw new PricingError("UNKNOWN_BASIS", `Guardrail on step ${step.step}: subtotal "${ref}" not accumulated yet`);
      }
      const cost = subtotals[g.cost_subtotal];
      const revenue = subtotals[g.revenue_subtotal];
      const floorPct = Math.abs(t.result ?? 0);
      const actualPct = cost === 0 ? (revenue > 0 ? Infinity : 0) : ((revenue - cost) / cost) * 100;
      const flag: LineFlag = {
        code: "MARGIN_FLOOR", policy: g.policy, component: component.code,
        floor_pct: floorPct, actual_pct: Number.isFinite(actualPct) ? Math.round(actualPct * 100) / 100 : actualPct,
        cost, revenue,
      };
      t.guardrail = flag;
      if (actualPct < floorPct) flags.push(flag);
    }

    // ── step computation ────────────────────────────────────────────────────

    function computeStep(step: ProcedureStep & { rollup_kind?: CostInputKind }, component: PriceComponent): TraceStep | null {
      // Manual override first — gated by policy.
      const manual = line.manual?.[component.code];
      if (manual) {
        if (component.manual_override === "FORBIDDEN") {
          throw new PricingError("OVERRIDE_FORBIDDEN", `Component ${component.code} does not allow manual override`);
        }
        if (component.manual_override === "ALLOWED_WITH_REASON" && !manual.reason?.trim()) {
          throw new PricingError("OVERRIDE_NEEDS_REASON", `Manual override on ${component.code} requires a reason`);
        }
        const amount = applyRounding(applySign(manual.value, component.sign), component.rounding_rule);
        return { step: step.step, component: component.code, status: "APPLIED", manual: true, result: amount, statistical: component.is_statistical || step.statistical };
      }

      const basis = basisFor(step, component);

      if (component.calc_type === "COST_ROLLUP") {
        return computeRollup(step, component);
      }

      if (component.calc_type === "FORMULA" || step.formula) {
        const formula = step.formula ?? null;
        // Component-level formulas live on the matched rule; step formulas win.
        const resolved = formula ? [] : resolveFor(component);
        const src = formula ?? resolved[0]?.rule.formula;
        if (!src) {
          return skip(step, component, "no formula and no matching rule");
        }
        let value: number;
        try {
          const out = evaluate(parseFormula(src), { ctx: dslCtx, hooks });
          if (typeof out !== "number") throw new DslError("formula did not produce a number", 0);
          value = out;
        } catch (e) {
          throw new PricingError("FORMULA_ERROR", `Step ${step.step} (${component.code}): ${(e as Error).message}`);
        }
        const amount = applyRounding(applySign(value, component.sign), component.rounding_rule);
        return {
          step: step.step, component: component.code, status: "APPLIED",
          rule_id: resolved[0]?.rule.rule_id, result: amount,
          statistical: component.is_statistical || step.statistical,
        };
      }

      const resolved = resolveFor(component);
      if (resolved.length === 0) {
        if (step.required) {
          throw new PricingError("MISSING_REQUIRED_COMPONENT", `Required component ${component.code} has no matching rule for this context`);
        }
        return skip(step, component, `no matching rule (${(rulesByComponent.get(component.code) ?? []).length} candidates)`);
      }

      // ALL_APPLY stacks: sum each resolved rule with the same math.
      let amount = 0;
      const first = resolved[0];
      for (const r of resolved) {
        amount += ruleAmount(r.rule, component, basis);
      }
      amount = applyRounding(applySign(amount, component.sign), component.rounding_rule);

      return {
        step: step.step, component: component.code, status: "APPLIED",
        rule_id: first.rule.rule_id, matched_on: first.rule.match_attributes,
        specificity: first.specificity, candidates_considered: first.candidatesConsidered,
        basis, value: first.rule.value ?? undefined, result: amount,
        statistical: component.is_statistical || step.statistical,
      };
    }

    function ruleAmount(rule: PriceRule, component: PriceComponent, basis: number): number {
      switch (component.calc_type) {
        case "FIXED_AMOUNT":
          return rule.value ?? 0;
        case "PERCENT":
          return ((rule.value ?? 0) / 100) * basis;
        case "PER_UNIT":
          return (rule.value ?? 0) * (line.quantity ?? 0);
        case "SCALE_TIERED": {
          const table = rule.scale?.entries ?? [];
          const rate = resolveScaleTiered(table, basis);
          // Rate semantics follow the basis: quantity/weight bases price per
          // unit of that basis; other bases treat the tier value as an amount.
          if (component.calc_basis === "QUANTITY") return rate * (line.quantity ?? 0);
          if (component.calc_basis === "WEIGHT") return rate * (line.weight_kg ?? 0);
          return rate;
        }
        case "SCALE_GRADUATED": {
          const table = rule.scale?.entries ?? [];
          return resolveScaleGraduated(table, basis);
        }
        default:
          throw new PricingError("BAD_CALC_TYPE", `Component ${component.code}: calc_type ${component.calc_type} not computable from a rule`);
      }
    }

    function computeRollup(step: ProcedureStep & { rollup_kind?: CostInputKind }, component: PriceComponent): TraceStep {
      const modelCode = step.cost_model;
      if (!modelCode) throw new PricingError("MISSING_COST_MODEL", `COST_ROLLUP step ${step.step} names no cost_model`);
      const model = costModelsByCode.get(modelCode);
      if (!model) throw new PricingError("UNKNOWN_COST_MODEL", `Cost model "${modelCode}" not found`);
      const kind = step.rollup_kind;
      if (!kind) throw new PricingError("MISSING_ROLLUP_KIND", `COST_ROLLUP step ${step.step} names no rollup_kind`);

      const inputsUsed: TraceCostInput[] = [];
      const missing: { path: string; considered: CostConsidered[] }[] = [];
      let amount = 0;
      for (const item of line.cost_items ?? []) {
        const def = model.inputs.find((i) => i.path === item.path);
        const itemKind = item.kind ?? def?.kind;
        if (itemKind !== kind) continue;
        // Every figure in play for this path: the model's own rates plus the
        // line's candidates (this product's ERP cost, its RFQ reply), through
        // the model's source ladder. Legacy models (no ladder) behave as before.
        const candidates: CostCandidate[] = [
          ...model.inputs.filter((i) => i.path === item.path),
          ...(item.candidates ?? []).filter((c) => !c.path || c.path === item.path),
        ];
        const { winner, considered } = resolveCost(candidates, model.sources, item.path, input.pricing_date, requirementHolds);
        if (!winner) {
          missing.push({ path: item.path, considered });
          continue;
        }
        amount += winner.value * item.qty;
        inputsUsed.push({
          path: item.path, rate: winner.value, qty: item.qty,
          source: winner.source, quality: winner.quality, as_of: winner.as_of, considered,
        });
      }
      if (missing.length > 0) {
        // A cost quantity with no figure behind it is never a silent zero:
        // this is the NEEDS_RFQ moment (adapter maps it), with every source
        // that was tried and why it did not answer.
        throw new PricingError(
          "NO_RATE_IN_FORCE",
          `No cost figure in force on ${input.pricing_date} for ${missing.map((m) => `"${m.path}"`).join(", ")}`,
          { paths: missing.map((m) => m.path), component: component.code, cost_model: modelCode, missing }
        );
      }
      if (step.required && inputsUsed.length === 0) {
        throw new PricingError(
          "COST_MISSING",
          `Required cost step ${step.step} (${component.code}) received no ${kind} cost items on line ${line.line_no}`,
          { component: component.code, cost_model: modelCode, kind, line_no: line.line_no }
        );
      }
      const signed = applyRounding(applySign(amount, component.sign), component.rounding_rule);
      return {
        step: step.step, component: component.code, status: "APPLIED",
        inputs: inputsUsed, result: signed,
        statistical: component.is_statistical || step.statistical,
      };
    }

    function requirementHolds(expr: string): boolean {
      try {
        return Boolean(evaluate(parseFormula(expr), { ctx: dslCtx, hooks }));
      } catch (e) {
        throw new PricingError("REQUIREMENT_ERROR", `Cost source requirement failed to evaluate: ${(e as Error).message}`);
      }
    }

    function resolveFor(component: PriceComponent): ResolvedRule[] {
      return resolveRules(
        rulesByComponent.get(component.code) ?? [],
        flatCtx,
        input.registry,
        input.pricing_date,
        component.resolution_strategy ?? "MOST_SPECIFIC"
      );
    }

    function basisFor(step: ProcedureStep, component: PriceComponent): number {
      if (step.calc_basis_ref) {
        if (!(step.calc_basis_ref in subtotals)) {
          throw new PricingError("UNKNOWN_BASIS", `Step ${step.step}: basis subtotal "${step.calc_basis_ref}" not accumulated yet`);
        }
        return subtotals[step.calc_basis_ref];
      }
      switch (component.calc_basis) {
        case "QUANTITY": return line.quantity ?? 0;
        case "WEIGHT": return line.weight_kg ?? 0;
        case "GROSS":
        case "NET_SO_FAR": return net;
        default: return net;
      }
    }

    function skip(step: ProcedureStep, component: PriceComponent, reason: string): null {
      trace.push({ step: step.step, component: component.code, status: "SKIPPED", reason });
      return null;
    }

    function commit(component: PriceComponent, t: TraceStep, step: ProcedureStep): void {
      const statistical = Boolean(t.statistical);
      componentAmounts[component.code] = t.result ?? 0;
      if (!statistical) net += t.result ?? 0;
      trace.push(t);
      void step;
    }

    function flushExclusionGroups(): void {
      for (const [group, members] of pendingByGroup) {
        if (members.length === 0) continue;
        // Best for customer: the lowest signed contribution wins.
        const winner = members.reduce((best, m) => ((m.trace.result ?? 0) < (best.trace.result ?? 0) ? m : best), members[0]);
        for (const m of members) {
          if (m === winner) {
            commit(m.component, m.trace, m.step);
          } else {
            trace.push({
              step: m.step.step, component: m.component.code, status: "EXCLUDED",
              reason: `exclusion_group ${group} lost to ${winner.component.code} (${winner.trace.result} < ${m.trace.result})`,
            });
          }
        }
      }
      pendingByGroup.clear();
    }

    function buildCostTree(): Record<string, unknown> {
      // ctx.cost.<path> resolved for the pricing date across all cost models.
      const tree: Record<string, unknown> = {};
      for (const model of input.cost_models) {
        for (const inputDef of model.inputs) {
          const rate = resolveCostInput(model.inputs, inputDef.path, input.pricing_date);
          if (rate === null) continue;
          const segs = inputDef.path.split(".");
          let cursor = tree;
          for (let i = 0; i < segs.length - 1; i++) {
            cursor = (cursor[segs[i]] ??= {}) as Record<string, unknown>;
          }
          cursor[segs[segs.length - 1]] = rate;
        }
      }
      return tree;
    }
  }
}

function structuredCloneSafe(obj: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
}
