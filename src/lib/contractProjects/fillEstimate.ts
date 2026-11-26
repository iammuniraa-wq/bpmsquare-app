import { round2, round4 } from "./budget";
import type { FillSkip } from "./fill";
import { isCategoryLine, type BudgetLine, type DraftLine } from "./types";
import { resourceForComponent } from "@/lib/tender/estimates/rules";
import { groupNameOf } from "@/lib/estimator/lines";
import { roundQty } from "@/lib/estimator/compute";

// "Fill from estimate costs", pure (docs/design/won-quote-to-project.md, slice 2). A project made from a quote that was assembled from an
// estimate starts with the contract and no cost. This reads the estimate's cost lines and, for each quote line it can match BY NAME, puts the cost
// on the budget by cost category: the quote line stays ONE contract line (it keeps the client's rate and amount, its key and its WBS item) and its
// cost is split into one budget line per category (materials 11, moulds 21, labour 31, erection 41, transport / overhead / other 51). The first
// category sits on the contract line itself; every other category is a cost-only line (client amount 0) tied to the same contract line by its
// source_line_id. A quote line that cannot be matched is left unallocated and listed: nothing is guessed.

export type EstimateLineIn = {
  description: string;
  uom: string | null;
  qty: number;
  waste_pct: number | null;
  group_key: string | null;
  custom_data: Record<string, unknown> | null;
  component: string | null;
  cost_total: number | null;
};

export type Bucket = { code: string; label: string; amount: number };
/** What one quote line of the estimate stands for: the name the quote printed, and its cost by category. */
export type EstimateGroup = { description: string; buckets: Bucket[]; total: number; unpriced: number };

/**
 * The quote lines the estimate prints, with their cost by category. The names are built exactly as the quote built them (a group's name, or
 * "line description (quantity unit)"), so a budget line that came from the quote can be matched on its name.
 */
export function estimateGroups(lines: readonly EstimateLineIn[], groupNames: ReadonlyMap<string, string>, granularity: "group" | "line"): EstimateGroup[] {
  const live = lines.filter((l) => Number.isFinite(Number(l.qty)) && Number(l.qty) > 0);
  const byKey = new Map<string, { description: string; lines: EstimateLineIn[] }>();
  live.forEach((l, i) => {
    const description = granularity === "line"
      ? `${l.description} (${String(roundQty(Number(l.qty) * (1 + (Number(l.waste_pct) || 0) / 100)))}${l.uom ? ` ${l.uom}` : ""})`
      : groupNameOf({ group_key: l.group_key, custom_data: l.custom_data } as Parameters<typeof groupNameOf>[0], groupNames)?.trim() || "Items";
    // The quote prints one line per estimate line ("line") or one per group key ("group").
    const key = granularity === "line" ? String(i) : l.group_key || "ungrouped";
    const have = byKey.get(key);
    if (have) have.lines.push(l); else byKey.set(key, { description, lines: [l] });
  });
  const out: EstimateGroup[] = [];
  for (const { description, lines: ls } of byKey.values()) {
    const sums = new Map<string, number>();
    let unpriced = 0;
    for (const l of ls) {
      if (l.cost_total === null || !Number.isFinite(Number(l.cost_total))) { unpriced++; continue; }
      const code = resourceForComponent(l.component);
      sums.set(code, round2((sums.get(code) ?? 0) + Number(l.cost_total)));
    }
    const buckets = [...sums.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, amount]) => ({ code, label: CATEGORY_LABEL[code] ?? "Other", amount })).filter((b) => b.amount > 0);
    out.push({ description, buckets, total: round2(buckets.reduce((s, b) => s + b.amount, 0)), unpriced });
  }
  return out;
}

/** The cost categories of an estimate, by the resource code they land on (transport, overhead and other share one). */
export const CATEGORY_LABEL: Record<string, string> = { "11": "Materials", "21": "Moulds", "31": "Labour", "41": "Erection", "51": "Transport and other" };

// ── Which lines the fill made, so a second press can replace them and nothing else ─────────────────────────────────────────

/** The text a filled line carries as its source: `Estimate EST-0004 · Labour · cost 12345.60`. The amount in it is how an edit by hand is noticed. */
export const fillRef = (estimateRef: string, label: string, amount: number): string => `Estimate ${estimateRef} · ${label} · cost ${amount.toFixed(2)}`.slice(0, 300);
const FILL_REF = /^Estimate .+ · cost (\d+\.\d{2})$/;

/** A line the fill wrote and nobody has touched since: its source still says the cost it was given and its cost still is that. */
export const isFilled = (l: Pick<BudgetLine, "source_ref" | "amount" | "allocated">): boolean => {
  const m = l.source_ref ? FILL_REF.exec(l.source_ref) : null;
  return !!m && l.allocated && Number(m[1]) === round2(l.amount);
};

/**
 * The quote lines that belong to an option the client did NOT choose. The chosen option's lines are the contract and carry group_type
 * "alternative" too, so the group type alone would wrongly refuse every line of a quote that has finish options.
 */
export function unchosenOptionLineIds(rows: readonly { id: string; group_type: string | null; is_selected: boolean | null }[]): Set<string> {
  return new Set(rows.filter((q) => q.group_type === "alternative" && q.is_selected === false).map((q) => q.id));
}

/** `ref` is what a tender fill says the cost came from ("Cost from estimate EST-0004"); an estimate fill leaves it out and the line says "Estimate EST-0004 · Labour · cost 123.00". */
export type FillItem = { base: BudgetLine; buckets: Bucket[]; ref?: string };
export type EstimateFillPlan = { fills: FillItem[]; skipped: FillSkip[] };

const itemOf = (l: Pick<BudgetLine, "wbs" | "description">): string => l.wbs ?? l.description;

export function planEstimateFill(args: { lines: readonly BudgetLine[]; groups: readonly EstimateGroup[]; optionLineIds: ReadonlySet<string> }): EstimateFillPlan {
  const contract = args.lines.filter((l) => !isCategoryLine(l));
  const nameCount = new Map<string, number>();
  for (const l of contract) nameCount.set(l.description.trim(), (nameCount.get(l.description.trim()) ?? 0) + 1);
  const fills: FillItem[] = [];
  const skipped: FillSkip[] = [];
  for (const l of contract) {
    if (!l.source_line_id) continue;
    const skip = (reason: string) => skipped.push({ item: itemOf(l), reason });
    if (args.optionLineIds.has(l.source_line_id)) { skip("is an option of an alternative quote"); continue; }
    const name = l.description.trim();
    const found = args.groups.filter((g) => g.description.trim() === name);
    if (found.length === 0) { skip("matches nothing in the estimate"); continue; }
    if (found.length > 1 || (nameCount.get(name) ?? 0) > 1) { skip("its name is used more than once"); continue; }
    const g = found[0];
    if (g.unpriced > 0) { skip(`${g.unpriced} estimate line${g.unpriced === 1 ? " has" : "s have"} no cost yet`); continue; }
    if (g.buckets.length === 0) { skip("has no cost in the estimate"); continue; }
    const extras = args.lines.filter((x) => x.source_line_id === l.source_line_id && isCategoryLine(x));
    if (l.allocated && l.amount > 0 && !isFilled(l)) { skip("already has a cost you entered"); continue; }
    if (extras.some((x) => !isFilled(x))) { skip("has cost lines you edited"); continue; }
    fills.push({ base: l, buckets: g.buckets });
  }
  return { fills, skipped };
}

const unitCostOf = (qty: number, amount: number) => (qty > 0 ? round4(amount / qty) : amount);

const draftOf = (l: BudgetLine): DraftLine => ({
  line_key: l.line_key, resource_code: l.resource_code, cost_code: l.cost_code, wbs: l.wbs, description: l.description, qty: l.qty, unit: l.unit, unit_cost: l.unit_cost,
  cost_known: l.cost_known, source_ref: l.source_ref, reserve: l.reserve, amount: l.amount, allocated: l.allocated, client_rate: l.client_rate, client_amount: l.client_amount, source_line_id: l.source_line_id,
});

/**
 * The whole set of budget lines after the fill, in order: every line as it was, except that a filled contract line takes its first category and is
 * followed by one cost-only line per further category. The cost lines an earlier fill made are replaced (a category that is still there keeps its
 * key, so the WBS item it sits in follows it). `made` are the new keys, `dropped` the keys that went, so the WBS can follow.
 */
export function applyEstimateFill(lines: readonly BudgetLine[], fills: readonly FillItem[], estimateRef: string, newKey: () => string): { lines: DraftLine[]; made: { line_key: string; of: string }[]; dropped: string[] } {
  const byBase = new Map(fills.map((f) => [f.base.line_key, f]));
  const replaced = new Map<string, BudgetLine[]>();
  for (const f of fills) replaced.set(f.base.source_line_id as string, lines.filter((x) => x.source_line_id === f.base.source_line_id && isCategoryLine(x)));
  const out: DraftLine[] = [];
  const made: { line_key: string; of: string }[] = [];
  const kept = new Set<string>();
  for (const l of lines) {
    if (isCategoryLine(l) && replaced.has(l.source_line_id as string)) continue;
    const f = byBase.get(l.line_key);
    if (!f) { out.push(draftOf(l)); continue; }
    const [first, ...rest] = f.buckets;
    const refOf = (b: Bucket): string => (f.ref ? `${f.ref} · ${b.label}`.slice(0, 300) : fillRef(estimateRef, b.label, b.amount));
    out.push({ ...draftOf(l), resource_code: first.code, amount: first.amount, unit_cost: unitCostOf(l.qty, first.amount), allocated: true, source_ref: refOf(first) });
    for (const b of rest) {
      const earlier = (replaced.get(l.source_line_id as string) ?? []).find((x) => x.resource_code === b.code && !kept.has(x.line_key));
      const key = earlier?.line_key ?? newKey();
      if (earlier) kept.add(earlier.line_key); else made.push({ line_key: key, of: l.line_key });
      out.push({
        line_key: key, resource_code: b.code, cost_code: l.cost_code, wbs: l.wbs, description: `${l.description} · ${b.label}`.slice(0, 500), qty: l.qty, unit: l.unit,
        unit_cost: unitCostOf(l.qty, b.amount), cost_known: true, source_ref: refOf(b), reserve: false, amount: b.amount, allocated: true,
        client_rate: null, client_amount: 0, source_line_id: l.source_line_id,
      });
    }
  }
  const dropped = [...replaced.values()].flat().map((x) => x.line_key).filter((k) => !kept.has(k));
  return { lines: out, made, dropped };
}
