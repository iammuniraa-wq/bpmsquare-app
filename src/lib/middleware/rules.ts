import { ESTIMATE_PARTS, FENCE_PARTS, type EstimateSelection, type FenceSelection, type IntegrationMiddlewareConfig, type Outcome, type OutcomeRule, type RuleMode } from "./types";

// Rules and fence selection live in tenants.config.integration_middleware
// (no secrets there). Pure: parse what is stored, validate what is submitted.

export const DEFAULT_RULES: IntegrationMiddlewareConfig = {
  rules: {
    quote_awarded: { enabled: true, mode: "auto" },
    quote_rejected: { enabled: true, mode: "auto" },
  },
  fence: { summary: true, quantity_lines: true, security_profile: false, drawing_link: false, notes_terms: false },
  // bom and wbs are on by default but only ever apply to a Project target; costs are internal and OFF.
  estimate: { summary: true, quote_lines: true, bom: true, wbs: true, internal_costs: false },
  payload_capture: false,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function parseRule(raw: unknown, def: OutcomeRule): OutcomeRule {
  if (!isObj(raw)) return { ...def };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : def.enabled,
    mode: raw.mode === "manual" || raw.mode === "auto" ? raw.mode : def.mode,
  };
}

/** The rules in force: what is stored, with anything missing or malformed
 *  falling back to the default. Never throws. */
export function parseRules(raw: unknown): IntegrationMiddlewareConfig {
  const r = isObj(raw) ? raw : {};
  const rules = isObj(r.rules) ? r.rules : {};
  const fenceRaw = isObj(r.fence) ? r.fence : {};
  const fence = { ...DEFAULT_RULES.fence } as FenceSelection;
  for (const p of FENCE_PARTS) if (typeof fenceRaw[p] === "boolean") fence[p] = fenceRaw[p] as boolean;
  const estRaw = isObj(r.estimate) ? r.estimate : {};
  const estimate = { ...DEFAULT_RULES.estimate } as EstimateSelection;
  for (const p of ESTIMATE_PARTS) if (typeof estRaw[p] === "boolean") estimate[p] = estRaw[p] as boolean;
  return {
    rules: {
      quote_awarded: parseRule(rules.quote_awarded, DEFAULT_RULES.rules.quote_awarded),
      quote_rejected: parseRule(rules.quote_rejected, DEFAULT_RULES.rules.quote_rejected),
    },
    fence,
    estimate,
    payload_capture: r.payload_capture === true,
  };
}

export type RulesValidation = { ok: true; value: IntegrationMiddlewareConfig } | { ok: false; errors: { field: string; message: string }[] };

/** Strict check of a submitted rules object: unknown keys and wrong types are
 *  rejected rather than silently dropped, so the screen learns about a typo. */
export function validateRulesInput(raw: unknown): RulesValidation {
  const errors: { field: string; message: string }[] = [];
  if (!isObj(raw)) return { ok: false, errors: [{ field: "body", message: "Send the rules as an object." }] };
  const known = new Set(["rules", "fence", "estimate", "payload_capture"]);
  for (const k of Object.keys(raw)) if (!known.has(k)) errors.push({ field: k, message: "Unknown setting." });

  if (raw.rules !== undefined) {
    if (!isObj(raw.rules)) errors.push({ field: "rules", message: "Rules must be an object." });
    else {
      for (const [k, v] of Object.entries(raw.rules)) {
        if (k !== "quote_awarded" && k !== "quote_rejected") { errors.push({ field: `rules.${k}`, message: "Unknown rule." }); continue; }
        if (!isObj(v)) { errors.push({ field: `rules.${k}`, message: "A rule is an object with enabled and mode." }); continue; }
        if (v.enabled !== undefined && typeof v.enabled !== "boolean") errors.push({ field: `rules.${k}.enabled`, message: "On or off." });
        if (v.mode !== undefined && v.mode !== "auto" && v.mode !== "manual") errors.push({ field: `rules.${k}.mode`, message: "Choose automatic or manual." });
      }
    }
  }
  if (raw.fence !== undefined) {
    if (!isObj(raw.fence)) errors.push({ field: "fence", message: "Fence selection must be an object." });
    else {
      for (const [k, v] of Object.entries(raw.fence)) {
        if (!(FENCE_PARTS as readonly string[]).includes(k)) errors.push({ field: `fence.${k}`, message: "Unknown fence part." });
        else if (typeof v !== "boolean") errors.push({ field: `fence.${k}`, message: "Ticked or not." });
      }
    }
  }
  if (raw.estimate !== undefined) {
    if (!isObj(raw.estimate)) errors.push({ field: "estimate", message: "Estimate selection must be an object." });
    else {
      for (const [k, v] of Object.entries(raw.estimate)) {
        if (!(ESTIMATE_PARTS as readonly string[]).includes(k)) errors.push({ field: `estimate.${k}`, message: "Unknown estimate part." });
        else if (typeof v !== "boolean") errors.push({ field: `estimate.${k}`, message: "Ticked or not." });
      }
    }
  }
  if (raw.payload_capture !== undefined && typeof raw.payload_capture !== "boolean") errors.push({ field: "payload_capture", message: "On or off." });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: parseRules(raw) };
}

/** Merge a validated partial change over what is stored. */
export function mergeRules(current: IntegrationMiddlewareConfig, patch: unknown): IntegrationMiddlewareConfig {
  const p = isObj(patch) ? patch : {};
  const pr = isObj(p.rules) ? p.rules : {};
  return parseRules({
    rules: {
      quote_awarded: { ...current.rules.quote_awarded, ...(isObj(pr.quote_awarded) ? pr.quote_awarded : {}) },
      quote_rejected: { ...current.rules.quote_rejected, ...(isObj(pr.quote_rejected) ? pr.quote_rejected : {}) },
    },
    fence: { ...current.fence, ...(isObj(p.fence) ? p.fence : {}) },
    estimate: { ...current.estimate, ...(isObj(p.estimate) ? p.estimate : {}) },
    payload_capture: typeof p.payload_capture === "boolean" ? p.payload_capture : current.payload_capture,
  });
}

export function ruleFor(cfg: IntegrationMiddlewareConfig, outcome: Outcome): OutcomeRule {
  return outcome === "awarded" ? cfg.rules.quote_awarded : cfg.rules.quote_rejected;
}

/** What an automatic status change should do with this rule. */
export function autoAction(rule: OutcomeRule): "send" | "wait" | "none" {
  if (!rule.enabled) return "none";
  return rule.mode === "auto" ? "send" : "wait";
}

export type { RuleMode };
