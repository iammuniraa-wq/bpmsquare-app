// Builds what an AI review of an estimate is allowed to see (ai.ts ReviewFacts):
// quantities, groups, totals and the inputs. Unit costs and line costs are NOT
// included. Pure.

import type { Estimate, EstimateLine, EstimateTemplate } from "@/lib/types";
import type { ReviewFacts } from "./ai";
import { groupNameOf, templateGroupNames } from "./lines";

export function buildReviewFacts(
  estimate: Pick<Estimate, "name" | "params" | "totals" | "model" | "margin_pct">,
  lines: readonly EstimateLine[],
  template: Pick<EstimateTemplate, "name" | "rules"> | null
): ReviewFacts {
  const groups = templateGroupNames(template?.rules ?? []);
  const pieceCounts: Record<string, number> = {};
  for (const p of estimate.model?.pieces ?? []) pieceCounts[p.code] = (pieceCounts[p.code] ?? 0) + 1;
  const t = estimate.totals;
  return {
    name: estimate.name,
    template: template?.name ?? null,
    params: estimate.params ?? {},
    lines: lines.map((l) => ({
      code: l.code, group: groupNameOf(l, groups), description: l.description, uom: l.uom, qty: l.qty, source: l.source,
    })),
    groups: (t?.by_group ?? []).map((g) => ({ name: g.name, cost: g.cost })),
    totals: {
      cost_total: t?.cost_total ?? 0,
      margin_pct: estimate.margin_pct,
      price: t?.price ?? 0,
      vat_pct: t?.vat_pct ?? 0,
      by_component: Object.fromEntries(Object.entries(t?.by_component ?? {}).map(([k, v]) => [k, v ?? 0])),
    },
    piece_counts: pieceCounts,
    warnings: (t?.warnings ?? []).slice(0, 20),
    unpriced: t?.unpriced ?? [],
    unresolved: t?.unresolved ?? [],
  };
}
