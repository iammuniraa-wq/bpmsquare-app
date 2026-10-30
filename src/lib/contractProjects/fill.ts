import { round2 } from "./budget";
import type { CostSnapshot } from "@/lib/tender/bids/costSnapshot";
import type { BudgetLine } from "./types";

// "Fill from tender costs" (KAMCO feedback, 2026-10-29), pure: copy the costs RECORDED on the tender into the allocation, once, by button,
// never automatically and never an estimated figure. A line with no recorded cost is listed, not filled. Two sources, in this order: the cost
// frozen with the winning bid version (matched on the item number the bid line and the budget line both carry), else the tender's BOQ rows
// (matched on the deal line the budget line came from).

export type Found = { amount: number; ref: string } | { skip: string };
export type FillSkip = { item: string; reason: string };

const itemOf = (l: Pick<BudgetLine, "wbs" | "description">): string => l.wbs ?? l.description;

/** The cost recorded with the winning bid version for each budget line, by item number. */
export function costsFromSnapshot(lines: readonly BudgetLine[], snapshot: CostSnapshot, versionNo: number): Map<string, Found> {
  const out = new Map<string, Found>();
  const byItem = new Map<string, CostSnapshot["lines"]>();
  for (const cl of snapshot.lines) if (cl.item_no) byItem.set(cl.item_no, [...(byItem.get(cl.item_no) ?? []), cl]);
  const wbsCount = new Map<string, number>();
  for (const l of lines) if (l.wbs) wbsCount.set(l.wbs, (wbsCount.get(l.wbs) ?? 0) + 1);
  for (const l of lines) {
    const matches = l.wbs ? byItem.get(l.wbs) ?? [] : [];
    if (!l.wbs || matches.length === 0) { out.set(l.line_key, { skip: `no recorded cost in bid v${versionNo}` }); continue; }
    if (matches.length > 1 || (wbsCount.get(l.wbs) ?? 0) > 1) { out.set(l.line_key, { skip: "item number not unique" }); continue; }
    const cl = matches[0];
    // The cost of a bid line is what its cost lines add up to: the recorded cost times the quantity, or what the estimate that priced it gave.
    // A snapshot stored before costs stopped being guessed may hold "the rate less a margin" under the estimated flag: that is not a recorded cost.
    const guessed = (cl.estimated && !cl.from_estimate) || cl.lines.every((b) => b.cost_known === false);
    if (cl.lines.length === 0 || cl.cost_total <= 0 || guessed) { out.set(l.line_key, { skip: `no recorded cost in bid v${versionNo}` }); continue; }
    out.set(l.line_key, { amount: round2(cl.cost_total), ref: `Cost from bid v${versionNo}${cl.from_estimate ? " (estimate)" : cl.lines[0]?.source_ref ? ` (${cl.lines[0].source_ref.replace(/^Cost from /, "")})` : ""}`.slice(0, 300) });
  }
  return out;
}

export type BoqCostRow = { line_id: string | null; unit_cost: number | null; price_source: string | null; price_source_ref: string | null };

/** The cost recorded on the tender's BOQ rows for each budget line, by the deal line it came from. Only a cost above zero counts. */
export function costsFromBoq(lines: readonly BudgetLine[], rows: readonly BoqCostRow[]): Map<string, Found> {
  const out = new Map<string, Found>();
  const byLine = new Map(rows.filter((r) => r.line_id).map((r) => [r.line_id as string, r]));
  for (const l of lines) {
    const r = l.source_line_id ? byLine.get(l.source_line_id) : undefined;
    const unit = r?.unit_cost != null ? Number(r.unit_cost) : 0;
    if (!r || !(unit > 0)) { out.set(l.line_key, { skip: "no recorded cost on the tender" }); continue; }
    out.set(l.line_key, { amount: round2(l.qty * unit), ref: `Cost from ${r.price_source_ref || r.price_source || "the tender"}`.slice(0, 300) });
  }
  return out;
}

export type FillPlan = {
  /** Lines to write. */
  fills: { line_key: string; amount: number; ref: string }[];
  skipped: FillSkip[];
};

/**
 * What to write. A line that already has an allocation is left alone unless `replace` is true (the screen confirms first); a line with no
 * recorded cost is listed with the reason.
 */
export function planFill(lines: readonly BudgetLine[], found: ReadonlyMap<string, Found>, replace: boolean): FillPlan {
  const fills: FillPlan["fills"] = [];
  const skipped: FillSkip[] = [];
  for (const l of lines) {
    const f = found.get(l.line_key);
    if (!f) continue;
    if ("skip" in f) { skipped.push({ item: itemOf(l), reason: f.skip }); continue; }
    if (l.allocated && l.amount > 0 && !replace) { skipped.push({ item: itemOf(l), reason: "already allocated" }); continue; }
    fills.push({ line_key: l.line_key, amount: f.amount, ref: f.ref });
  }
  return { fills, skipped };
}
