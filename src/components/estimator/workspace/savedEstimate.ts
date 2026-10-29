import { buildPriceView } from "@/lib/estimator/preview";
import { reusableCosts, scheduleFromLines, templateGroupNames, toQuoteSource } from "@/lib/estimator/lines";
import type { Estimate, EstimateLine, EstimateTemplate } from "@/lib/types";
import type { SavedEstimate } from "./EstimateWorkspace";
import type { WorkspaceLine, WorkspaceTemplate } from "./types";

export function toWorkspaceTemplate(t: Pick<EstimateTemplate, "id" | "name" | "description" | "geometry" | "inputs" | "rates" | "rules" | "quote_granularity"> & Partial<Pick<EstimateTemplate, "visual" | "customer_visible">>): WorkspaceTemplate {
  return {
    id: t.id, name: t.name, description: t.description, geometry: t.geometry ?? null,
    inputs: t.inputs ?? [], rates: t.rates ?? [], rules: t.rules ?? [], quote_granularity: t.quote_granularity ?? "group",
    visual: t.visual ?? null, customer_visible: t.customer_visible === true,
  };
}

export function storedLines(lines: readonly EstimateLine[]): WorkspaceLine[] {
  return lines.map((l) => ({
    code: l.code, group_key: l.group_key, component: l.component, uom: l.uom, qty: l.qty,
    cost_total: l.cost_total, source: l.source, description: l.description, element_ref: l.element_ref,
  }));
}

/**
 * A saved estimate as the working page shows it until it is edited: the customer's
 * sections and total from the STORED lines (so hand edits are in them), the stored
 * totals and model for the internal sections, and the stored unit costs and
 * schedule so the finish options can be worked out without asking the server.
 */
export function buildSavedEstimate(a: {
  estimate: Estimate;
  lines: readonly EstimateLine[];
  template: EstimateTemplate | null;
  templateOutdated: boolean;
  quote: { id: string; ref: string; status: string } | null;
  vatPct: number;
}): SavedEstimate {
  const { estimate, lines, template } = a;
  const groups = templateGroupNames(template?.rules ?? []);
  const view = buildPriceView(lines.map((l) => toQuoteSource(l, groups)), {
    granularity: template?.quote_granularity ?? "group", margin_pct: estimate.margin_pct, vat_pct: a.vatPct,
  });
  return {
    id: estimate.id,
    locked: !!estimate.standard_quote_id,
    quote: a.quote,
    accountId: estimate.account_id ?? "",
    contactId: estimate.contact_id ?? "",
    storedParams: estimate.params ?? {},
    storedMargin: estimate.margin_pct,
    templateOutdated: a.templateOutdated,
    view,
    shown: { lines: storedLines(lines), model: estimate.model, totals: estimate.totals, live: false },
    unitCosts: reusableCosts(lines).costs,
    schedule: scheduleFromLines(lines),
  };
}
