import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canViewWorkcenter, type PermissionSet } from "@/lib/permissions";
import { loadEstimateBundle } from "@/lib/estimator/server";
import { unpricedCodes } from "@/lib/estimator/lines";
import { customerFigures, printedFigures } from "@/lib/estimator/quoteLines";
import { promptText } from "./promptSafe";
import { findRecords } from "./sources";

// Estimates are made in the Estimator, from a template, and priced there: the assistant never creates or changes one, so it must never
// say it did. The one thing it does with an estimate is read a saved one (explain_estimate): every figure comes from the stored
// estimate and its lines through the tenant-scoped loaders, and the model is told to use nothing else.

export const EXPLAIN_ESTIMATE_TOOL = "explain_estimate";

export const ESTIMATE_PROMPT_RULE =
  "\n16. ESTIMATES: you cannot create or change an estimate from this chat, and you never say you did. Estimates are made in the Estimator: the person picks a template, enters the quantities and the price is built there. " +
  "When asked to create or start one, say that in one or two plain sentences and call navigate with the New Estimate target from NAVIGATION; never write that it was created, started or done. " +
  "The only estimate step you can do is tender_action estimate on a tender deal, and that shows a card. Never bring up a tender the person did not ask about. " +
  "To explain how an estimate's price is built call explain_estimate and use only the figures it returns. Its price figures are the ones the customer is quoted; never work out another price from the cost and the margin.";

export const ESTIMATE_CREATE_ANSWER =
  "Estimates are made in the Estimator, not from this chat: pick a template, enter the quantities and the price is built there. I can't create one for you.";

// The words between the verb and "estimate" may describe it, but may not point at something else ("a quote from the estimate",
// "add a line to the estimate") or at one that already exists ("make this estimate cheaper").
const OTHER_THING = "(?:from|of|on|to|in|with|for|about|this|that|these|those|quotes?|quotations?|lines?|notes?|tasks?|reports?|charts?|emails?|reminders?|activity|accounts?|contacts?|leads?|deals?|cases?|rfqs?|invoices?|orders?|templates?)";
const GAP = `(?:\\s+(?!${OTHER_THING}\\b)[^\\s.?!;:,]+){0,5}?`;
const NOT_THE_ESTIMATE = "(?!['\u2019]s\\b|\\s+(?:templates?|list|margin|total|status|cheaper|lines?)\\b)";
const CREATE_ASK = new RegExp(`(?:\\b(?:create|make|build|prepare|draft|start|set\\s*up|add|raise|generate|need|want)\\b${GAP}|^\\s*(?:a\\s+)?new(?:\\s+cost)?)\\s+estimates?\\b${NOT_THE_ESTIMATE}`, "i");
const LOOKUP_ASK = /^\s*(?:how|where|which|what|show|list|find|open|explain|did|have|has|who|when|why|is|are|was|were)\b/i;

/** The person asked for an estimate to be made (not a question about estimates that exist). */
export const isEstimateCreateAsk = (question: string): boolean => !LOOKUP_ASK.test(question) && CREATE_ASK.test(question);

export const estimateAccess = (a: { features: Record<string, boolean | undefined>; perms: PermissionSet }): boolean =>
  a.features.estimator === true && canViewWorkcenter(a.perms, "estimates");

export function explainEstimateTool(): Anthropic.Tool {
  return {
    name: EXPLAIN_ESTIMATE_TOOL,
    description:
      "Read a saved estimate and return its facts: name, template, status, customer, cost by section, cost total, margin, price before and after VAT, the lines that have no price yet, and whether a quote was made from it. " +
      "Use it when the person asks how an estimate's price is built or what an estimate holds. Pass the estimate's reference (EST-0001) or exact name; leave it out when they have an estimate open and mean that one. " +
      "Explain only with the figures it returns, and never invent one.",
    input_schema: {
      type: "object",
      properties: { estimate: { type: "string", description: "The estimate's reference or exact name." } },
    },
  };
}

export type ExplainEnv = {
  supabase: SupabaseClient;
  tenantId: string;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
  openEstimateId: string | null;
};

const money = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

export async function runExplainEstimate(input: unknown, env: ExplainEnv): Promise<string> {
  if (!estimateAccess(env)) return "Error: estimates are not available to this person.";
  const asked = input && typeof input === "object" ? (input as { estimate?: unknown }).estimate : null;
  const query = typeof asked === "string" ? asked.trim().slice(0, 100) : "";
  let id = env.openEstimateId;
  if (query) {
    const hits = await findRecords({ tenantId: env.tenantId, perms: env.perms, features: env.features }, "estimate", query);
    if (hits.length === 0) return "No estimate matched. Say so in one short line.";
    if (hits.length > 1) return JSON.stringify({ several_match: hits.map((h) => h.title), instruction: "Ask which one." });
    id = hits[0].id;
  }
  if (!id) return "Error: name the estimate by its reference, or ask on an estimate's own page.";

  const { bundle, missing } = await loadEstimateBundle(env.supabase, env.tenantId, id);
  if (missing) return "Error: estimates are waiting for a database update. Say so in one short line.";
  if (!bundle) return "No estimate matched. Say so in one short line.";

  const { estimate: e, lines, template, account, quote } = bundle;
  const t = e.totals;
  const unpriced = unpricedCodes(lines);
  const quoted = t && money(t.price) !== null ? printedFigures(customerFigures(t.price, money(t.vat_pct) ?? 0)) : null;
  const facts = {
    reference: e.ref,
    name: promptText(e.name, 120),
    status: e.status,
    template: template ? { name: promptText(template.name, 120), outdated: bundle.template_outdated } : null,
    account: account ? promptText(account.name, 120) : null,
    currency: e.currency,
    priced: !!t,
    cost_by_section: t ? t.by_group.map((g) => ({ section: promptText(g.name, 80), cost: money(g.cost) })) : [],
    cost_total: t ? money(t.cost_total) : null,
    margin_pct: t ? money(t.margin_pct) : money(e.margin_pct),
    price_before_vat: quoted?.price ?? null,
    vat_pct: t ? money(t.vat_pct) : null,
    vat_amount: quoted?.vat ?? null,
    price_including_vat: quoted?.total ?? null,
    lines: lines.length,
    lines_without_price: unpriced.length,
    lines_without_price_codes: unpriced.slice(0, 10).map((c) => promptText(c, 60)),
    quote: quote ? { reference: quote.ref, status: quote.status } : null,
  };
  return `${JSON.stringify(facts)}\nExplain using only these figures and say which are missing; never invent one. Nothing was changed. Keep it short.`;
}
