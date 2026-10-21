import { estimateFromInclude, fenceFromInclude, readDocument, rulesFromDocument } from "./documents";
import { ESTIMATE_PARTS, FENCE_PARTS, type IntegrationMiddlewareConfig, type Outcome, type OutcomeRule, type RuleMode } from "./types";

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

/** The rules in force, as the older rules + fence + estimate shape: a view of the Quote document
 *  (documents.ts), which migrates a workspace that never saved it. Anything missing or malformed
 *  falls back to the default. Never throws. */
export function parseRules(raw: unknown): IntegrationMiddlewareConfig {
  const r = isObj(raw) ? raw : {};
  const doc = readDocument(r);
  return {
    rules: rulesFromDocument(doc),
    fence: fenceFromInclude(doc.include),
    estimate: estimateFromInclude(doc.include),
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

/** Merge a validated partial change over what is stored. The two older selections (fence, estimate) stay apart here:
 *  the Quote document folds them together when it is saved, and needs to see which side the change was on. */
export function mergeRules(current: IntegrationMiddlewareConfig, patch: unknown): IntegrationMiddlewareConfig {
  const p = isObj(patch) ? patch : {};
  const pr = isObj(p.rules) ? p.rules : {};
  const rule = (cur: OutcomeRule, pat: unknown): OutcomeRule => {
    const o = isObj(pat) ? pat : {};
    return { enabled: typeof o.enabled === "boolean" ? o.enabled : cur.enabled, mode: o.mode === "auto" || o.mode === "manual" ? o.mode : cur.mode };
  };
  const sel = <T extends Record<string, boolean>>(cur: T, pat: unknown, parts: readonly string[]): T => {
    const out = { ...cur } as Record<string, boolean>;
    if (isObj(pat)) for (const part of parts) if (typeof pat[part] === "boolean") out[part] = pat[part] as boolean;
    return out as T;
  };
  return {
    rules: { quote_awarded: rule(current.rules.quote_awarded, pr.quote_awarded), quote_rejected: rule(current.rules.quote_rejected, pr.quote_rejected) },
    fence: sel(current.fence, p.fence, FENCE_PARTS),
    estimate: sel(current.estimate, p.estimate, ESTIMATE_PARTS),
    payload_capture: typeof p.payload_capture === "boolean" ? p.payload_capture : current.payload_capture,
  };
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
