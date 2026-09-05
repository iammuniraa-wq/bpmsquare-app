// Shared validation for pricing config entities that both the authoring
// route (fail fast, before a draft is touched) and publish (the last word)
// apply. Pure; no framework imports.

import { parseFormula, type CostSourceDef, type ProcedureStep } from "@/lib/pricing-core";
import { COST_QUALITIES } from "./enums";

const CODE_RE = /^[A-Z][A-Z0-9_]{0,39}$/;

/** A cost model's source ladder: codes unique, tiers positive integers,
 *  quality from the enum, max_age_days a positive integer or null, and a
 *  requirement that parses. */
export function validateSources(raw: unknown): { sources: CostSourceDef[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "cost_model.sources must be an array." };
  const sources: CostSourceDef[] = [];
  const seen = new Set<string>();
  for (const s of raw as Record<string, unknown>[]) {
    if (!s || typeof s !== "object") return { error: "cost_model.sources entries must be objects." };
    const code = typeof s.code === "string" ? s.code.trim().toUpperCase() : "";
    if (!CODE_RE.test(code)) return { error: `source code "${s.code}" must be letters, digits and underscores.` };
    if (seen.has(code)) return { error: `source "${code}" is listed twice.` };
    seen.add(code);
    const tier = Number(s.tier);
    if (!Number.isInteger(tier) || tier <= 0) return { error: `source ${code}: tier must be a positive integer.` };
    const quality = s.quality as string;
    if (!COST_QUALITIES.includes(quality)) return { error: `source ${code}: quality must be one of ${COST_QUALITIES.join(", ")}.` };
    let maxAge: number | null = null;
    if (s.max_age_days !== undefined && s.max_age_days !== null && s.max_age_days !== "") {
      maxAge = Number(s.max_age_days);
      if (!Number.isInteger(maxAge) || maxAge <= 0) return { error: `source ${code}: max_age_days must be a positive integer or empty.` };
    }
    let requirement: string | null = null;
    if (typeof s.requirement === "string" && s.requirement.trim()) {
      requirement = s.requirement.trim();
      const expr = requirement.startsWith("dsl:") ? requirement.slice(4) : requirement;
      try { parseFormula(expr); } catch (e) {
        return { error: `source ${code}: requirement does not parse — ${(e as Error).message}` };
      }
    }
    sources.push({ code, label: typeof s.label === "string" ? s.label : null, tier, quality: quality as CostSourceDef["quality"], max_age_days: maxAge, requirement });
  }
  return { sources };
}

/** A guardrail step must sit AFTER both subtotals it compares, and name a
 *  component that exists. Returns the problems found, empty when clean. */
export function validateGuardrails(procedureCode: string, steps: ProcedureStep[], componentCodes: Set<string>): string[] {
  const errors: string[] = [];
  const sorted = [...steps].sort((a, b) => a.step - b.step);
  const seen = new Set<string>();
  for (const step of sorted) {
    if (step.subtotal) { seen.add(step.subtotal); continue; }
    if (!step.guardrail) continue;
    const g = step.guardrail;
    if (!step.component || !componentCodes.has(step.component)) {
      errors.push(`Procedure ${procedureCode} step ${step.step}: a guardrail needs a known component (the floor percentage).`);
    }
    if (g.kind !== "MARGIN_FLOOR") errors.push(`Procedure ${procedureCode} step ${step.step}: unknown guardrail kind "${g.kind}".`);
    if (!["warn", "block", "approve"].includes(g.policy)) errors.push(`Procedure ${procedureCode} step ${step.step}: guardrail policy must be warn, block or approve.`);
    for (const ref of [g.cost_subtotal, g.revenue_subtotal]) {
      if (!seen.has(ref)) errors.push(`Procedure ${procedureCode} step ${step.step}: guardrail compares subtotal "${ref}" which is not accumulated before this step.`);
    }
  }
  return errors;
}
