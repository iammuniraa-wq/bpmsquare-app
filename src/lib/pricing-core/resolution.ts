// Rule resolution — the generalized access sequence (spec §4).
// Pure: candidates and the registry come in as plain data; the winner (or a
// typed error) comes out. Determinism guarantees:
//  - a rule only matches when EVERY match_attribute equals the context value
//    (containment) AND its validity window covers the pricing date;
//  - the winner is the highest specificity (sum of registry weights);
//  - ties break by most recent valid_from, then latest created_at;
//  - a still-standing tie is a hard AMBIGUOUS_RULE error — never silent.

import { COST_QUALITY_RANK, type AttrValue, type CostCandidate, type CostQuality, type CostSourceDef, type DimensionRegistry, type PriceRule, type ResolutionStrategy } from "./types";

export class PricingError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "PricingError";
  }
}

/**
 * Flatten a nested context object into dot-path attribute map for matching,
 * e.g. { customer: { tier: "A" } } → { "customer.tier": "A" }. Top-level
 * scalar keys stay as-is (so `document_type` matches without a prefix).
 * Arrays and null/undefined values are skipped — they are not matchable
 * attributes. Own properties only.
 */
export function flattenContext(ctx: Record<string, unknown>, prefix = ""): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  for (const key of Object.keys(ctx)) {
    const value = ctx[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined || Array.isArray(value)) continue;
    if (typeof value === "object") {
      Object.assign(out, flattenContext(value as Record<string, unknown>, path));
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[path] = value;
    }
  }
  return out;
}

/**
 * Specificity = sum of registry weights over the rule's matched attributes.
 * An attribute missing from the registry is a configuration error (the rule
 * could never have been authored through a valid DimensionRegistry) — raised
 * loudly rather than weighted 0, because a silent 0 would let an unregistered
 * dimension lose every tie in a way nobody can see.
 */
export function computeSpecificity(matchAttributes: Record<string, AttrValue>, registry: DimensionRegistry): number {
  let total = 0;
  for (const attr of Object.keys(matchAttributes)) {
    const weight = registry[attr];
    if (weight === undefined) {
      throw new PricingError("UNREGISTERED_DIMENSION", `Attribute "${attr}" is not in the DimensionRegistry`);
    }
    total += weight;
  }
  return total;
}

function coversDate(rule: PriceRule, pricingDate: string): boolean {
  if (rule.valid_from && pricingDate < rule.valid_from) return false;
  if (rule.valid_to && pricingDate > rule.valid_to) return false;
  return true;
}

function matchesContext(rule: PriceRule, flatCtx: Record<string, AttrValue>): boolean {
  for (const [attr, expected] of Object.entries(rule.match_attributes)) {
    if (flatCtx[attr] !== expected) return false;
  }
  return true;
}

export type ResolvedRule = { rule: PriceRule; specificity: number; candidatesConsidered: number };

/**
 * Resolve the applicable rule(s) for one component.
 * - MOST_SPECIFIC (default): single winner per the determinism contract above.
 * - ALL_APPLY: every matching rule, ordered by specificity desc (stacking
 *   surcharges); duplicates are the caller's semantic domain.
 * - BEST_FOR_CUSTOMER: the matching rule with the lowest numeric `value`
 *   (lowest charge / deepest discount). Rules whose value lives in a scale or
 *   formula are not comparable at resolution time — their presence under this
 *   strategy is a configuration error, surfaced as NOT_COMPARABLE.
 * Returns [] when nothing matches (the step simply does not apply — the calc
 * core records SKIPPED with a reason).
 */
export function resolveRules(
  candidates: PriceRule[],
  flatCtx: Record<string, AttrValue>,
  registry: DimensionRegistry,
  pricingDate: string,
  strategy: ResolutionStrategy = "MOST_SPECIFIC"
): ResolvedRule[] {
  const matching = candidates
    .filter((rule) => coversDate(rule, pricingDate) && matchesContext(rule, flatCtx))
    .map((rule) => ({ rule, specificity: computeSpecificity(rule.match_attributes, registry), candidatesConsidered: candidates.length }));

  if (matching.length === 0) return [];

  if (strategy === "ALL_APPLY") {
    return [...matching].sort((a, b) => b.specificity - a.specificity);
  }

  if (strategy === "BEST_FOR_CUSTOMER") {
    for (const m of matching) {
      if (typeof m.rule.value !== "number") {
        throw new PricingError(
          "NOT_COMPARABLE",
          `Rule ${m.rule.rule_id} has no scalar value; BEST_FOR_CUSTOMER cannot compare scale/formula rules`
        );
      }
    }
    return [[...matching].sort((a, b) => (a.rule.value as number) - (b.rule.value as number))[0]];
  }

  // MOST_SPECIFIC
  const sorted = [...matching].sort((a, b) => {
    if (b.specificity !== a.specificity) return b.specificity - a.specificity;
    const aFrom = a.rule.valid_from ?? "";
    const bFrom = b.rule.valid_from ?? "";
    if (aFrom !== bFrom) return bFrom < aFrom ? -1 : 1;
    const aCreated = a.rule.created_at ?? "";
    const bCreated = b.rule.created_at ?? "";
    if (aCreated !== bCreated) return bCreated < aCreated ? -1 : 1;
    return 0;
  });

  const [winner, runnerUp] = sorted;
  if (
    runnerUp &&
    runnerUp.specificity === winner.specificity &&
    (runnerUp.rule.valid_from ?? "") === (winner.rule.valid_from ?? "") &&
    (runnerUp.rule.created_at ?? "") === (winner.rule.created_at ?? "")
  ) {
    throw new PricingError(
      "AMBIGUOUS_RULE",
      `Rules ${winner.rule.rule_id} and ${runnerUp.rule.rule_id} tie on specificity ${winner.specificity} with identical validity — resolve in configuration`
    );
  }
  return [winner];
}

/**
 * Resolve a cost input value for a pricing date (spec §3: cost inputs are
 * resolved by effective date only — the version snapshot pins structure, not
 * rates). Overlapping windows for one path pick the most recent valid_from;
 * an exact tie is AMBIGUOUS_COST_INPUT.
 */
export function resolveCostInput(
  inputs: { path: string; value: number; valid_from?: string | null; valid_to?: string | null }[],
  path: string,
  pricingDate: string
): number | null {
  const live = inputs.filter(
    (input) =>
      input.path === path &&
      (!input.valid_from || pricingDate >= input.valid_from) &&
      (!input.valid_to || pricingDate <= input.valid_to)
  );
  if (live.length === 0) return null;
  const sorted = [...live].sort((a, b) => ((b.valid_from ?? "") < (a.valid_from ?? "") ? -1 : (b.valid_from ?? "") > (a.valid_from ?? "") ? 1 : 0));
  const [winner, runnerUp] = sorted;
  if (runnerUp && (runnerUp.valid_from ?? "") === (winner.valid_from ?? "")) {
    throw new PricingError("AMBIGUOUS_COST_INPUT", `Cost input "${path}" has overlapping windows with identical valid_from`);
  }
  return winner.value;
}

// ── Cost source ladder (spec §17, cost-based step 1) ────────────────────────

export type CostConsidered = {
  source: string;
  quality: CostQuality;
  value: number;
  as_of?: string | null;
  status: "won" | "lost" | "stale" | "requirement" | "expired";
  reason?: string;
};

export type ResolvedCost = {
  value: number;
  source: string;
  quality: CostQuality;
  as_of: string | null;
};

export type CostResolution = { winner: ResolvedCost | null; considered: CostConsidered[] };

const UNLISTED_TIER = Number.MAX_SAFE_INTEGER;
const DEFAULT_SOURCE = "MANUAL";

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/**
 * Resolve one cost figure for a path from every candidate in play -- the
 * cost model's own rates plus any line-level candidates (this product's
 * ERP cost, its RFQ reply) -- through the model's source ladder.
 *
 * Order of business, per candidate: validity must cover the pricing date;
 * the source's requirement (if any) must hold; the figure must not be stale
 * (as_of within max_age_days of the pricing date). Then the lowest tier
 * wins; within a tier the higher quality; within the same source the most
 * recent valid_from. An exact tie is AMBIGUOUS_COST_INPUT -- never a guess.
 * Every candidate's fate is returned so the trace can show "SAP cost was
 * 40 days old, fell back to the RFQ reply".
 *
 * No ladder = legacy: most recent valid_from across all candidates.
 */
export function resolveCost(
  candidates: CostCandidate[],
  ladder: CostSourceDef[] | null | undefined,
  path: string,
  pricingDate: string,
  requirementHolds: (expr: string) => boolean = () => true
): CostResolution {
  const considered: CostConsidered[] = [];
  const defs = new Map((ladder ?? []).map((d) => [d.code, d]));
  const useLadder = defs.size > 0;

  type Live = { c: CostCandidate; source: string; quality: CostQuality; tier: number; def: CostSourceDef | undefined };
  const live: Live[] = [];
  for (const c of candidates) {
    const source = c.source ?? DEFAULT_SOURCE;
    const def = defs.get(source);
    const quality: CostQuality = c.quality ?? def?.quality ?? "list";
    const entry = (status: CostConsidered["status"], reason?: string) =>
      considered.push({ source, quality, value: c.value, as_of: c.as_of ?? null, status, reason });

    if ((c.valid_from && pricingDate < c.valid_from) || (c.valid_to && pricingDate > c.valid_to)) {
      entry("expired", `valid ${c.valid_from ?? "…"} → ${c.valid_to ?? "…"}`);
      continue;
    }
    if (useLadder && def?.requirement) {
      const expr = def.requirement.startsWith("dsl:") ? def.requirement.slice(4) : def.requirement;
      if (!requirementHolds(expr)) { entry("requirement", `requirement not met: ${expr}`); continue; }
    }
    if (useLadder && def?.max_age_days != null && c.as_of) {
      const age = daysBetween(c.as_of, pricingDate);
      if (age > def.max_age_days) { entry("stale", `${age} days old, limit ${def.max_age_days}`); continue; }
    }
    live.push({ c, source, quality, tier: useLadder ? (def?.tier ?? UNLISTED_TIER) : 0, def });
  }
  if (live.length === 0) return { winner: null, considered };

  const sorted = [...live].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const q = COST_QUALITY_RANK[b.quality] - COST_QUALITY_RANK[a.quality];
    if (q !== 0) return q;
    const af = a.c.valid_from ?? "", bf = b.c.valid_from ?? "";
    if (af !== bf) return bf < af ? -1 : 1;
    const aa = a.c.as_of ?? "", ba = b.c.as_of ?? "";
    if (aa !== ba) return ba < aa ? -1 : 1;
    return 0;
  });
  const [winner, runnerUp] = sorted;
  if (
    runnerUp &&
    runnerUp.tier === winner.tier &&
    runnerUp.quality === winner.quality &&
    (runnerUp.c.valid_from ?? "") === (winner.c.valid_from ?? "") &&
    (runnerUp.c.as_of ?? "") === (winner.c.as_of ?? "")
  ) {
    throw new PricingError(
      "AMBIGUOUS_COST_INPUT",
      `Cost input "${path}" has two equally ranked figures (${winner.source} ${winner.c.value} and ${runnerUp.source} ${runnerUp.c.value}) — resolve in configuration`,
      { path, sources: [winner.source, runnerUp.source] }
    );
  }
  for (const l of sorted) {
    considered.push({
      source: l.source, quality: l.quality, value: l.c.value, as_of: l.c.as_of ?? null,
      status: l === winner ? "won" : "lost",
      reason: l === winner ? undefined : l.tier !== winner.tier ? `tier ${l.tier} after ${winner.source} (tier ${winner.tier})` : `${l.quality} ranks below ${winner.quality}`,
    });
  }
  return { winner: { value: winner.c.value, source: winner.source, quality: winner.quality, as_of: winner.c.as_of ?? null }, considered };
}
