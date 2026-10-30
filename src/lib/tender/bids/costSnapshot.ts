// GCC tender deals, after award (docs/design/gcc-tender-deals.md section 23): the INTERNAL cost behind a submitted bid version. PURE: no
// I/O and no server imports, so the submit route, the project creation and the tests share one shape and one reading.
//
// A bid version (rules.ts) is what the client was offered and never carries a cost. This is its private companion: for each bid line the
// recorded cost per unit, the row markup, and the cost lines that cost becomes (resource type, cost code, quantity, unit cost), worked out
// by mapTenderToCostLines: the estimates that priced the row, else the BOQ row's recorded cost, else nothing (the cost is never guessed).
// It is frozen at submit time, so "Fill from tender costs" on a contract project reads the bid that WON and not whatever the BOQ was
// edited into afterwards. It is stored in its own table (migration 0230) that no export, PDF, public link, answer sheet, Standard Quote,
// list source or API reads.

import type { BoqInfo, DealLine, EstimateBudgetInput } from "@/lib/contractProjects/fromTender";
import type { DraftLine } from "@/lib/contractProjects/types";
import { mapTenderToCostLines } from "./costLines";
import type { Snapshot } from "./rules";

export const COST_SNAPSHOT_VERSION = 1;

export type CostLine = {
  /** The bid line it belongs to (rules.ts `key`). */
  key: string;
  item_no: string | null;
  /** The cost per unit recorded on the BOQ row (what a supplier or BOM rate was built from); null when none was recorded. */
  unit_cost: number | null;
  /** The markup on that cost, as the BOQ row recorded it. */
  markup_pct: number | null;
  /** The cost code as the client's BOQ wrote it (checked against the workspace list when a project is made, not now). */
  cost_code: string | null;
  /** No cost was recorded for the row (the cost is never guessed; older snapshots stored a guess under this flag). */
  estimated: boolean;
  /** The budget lines came from the estimates that priced the row. */
  from_estimate: boolean;
  /** What the budget lines add up to. */
  cost_total: number;
  lines: DraftLine[];
};

export type CostSnapshot = {
  v: typeof COST_SNAPSHOT_VERSION;
  /** Things worth saying about the estimates behind it (an output that is gone, a cost the estimate does not have yet). */
  warnings: string[];
  lines: CostLine[];
};

/** What the BOQ row knows about a deal line, with the markup the cost source recorded. */
export type CostBoqInfo = BoqInfo & { markup_pct: number | null };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number | null => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export const costOfLines = (lines: readonly Pick<DraftLine, "qty" | "unit_cost">[]): number => round2(lines.reduce((s, l) => s + l.qty * l.unit_cost, 0));

/**
 * The cost snapshot of a bid: one entry per bid line, in the bid's order. `snapshot.source_ids` says which deal line each bid line was
 * made from; a bid line whose deal line cannot be found keeps an empty entry (no cost) so the two lists stay parallel.
 */
export function buildCostSnapshot(args: {
  snapshot: Pick<Snapshot, "lines" | "source_ids">;
  dealLines: ReadonlyMap<string, DealLine>;
  boq: ReadonlyMap<string, CostBoqInfo>;
  estimates?: EstimateBudgetInput;
}): CostSnapshot {
  const warnings = new Set<string>();
  const lines: CostLine[] = args.snapshot.lines.map((bid, i) => {
    const id = args.snapshot.source_ids[i];
    const deal = id ? args.dealLines.get(id) : undefined;
    const info = id ? args.boq.get(id) : undefined;
    const empty: CostLine = { key: bid.key, item_no: bid.item_no, unit_cost: null, markup_pct: null, cost_code: null, estimated: false, from_estimate: false, cost_total: 0, lines: [] };
    if (!deal) return empty;
    // The cost code is kept as the client wrote it: the workspace's list is read when a project is made, so a list imported later still counts.
    const raw = info?.cost_code?.trim() || null;
    const mapped = mapTenderToCostLines({ lines: [deal], boq: args.boq, costCodes: new Set(raw ? [raw] : []), estimates: args.estimates });
    for (const w of mapped.estimateWarnings) warnings.add(w);
    return {
      ...empty,
      unit_cost: info?.unit_cost != null && Number(info.unit_cost) > 0 ? Number(info.unit_cost) : null,
      markup_pct: info?.markup_pct ?? null,
      cost_code: raw,
      estimated: mapped.estimated > 0,
      from_estimate: mapped.fromEstimate > 0,
      cost_total: costOfLines(mapped.lines),
      lines: mapped.lines,
    };
  });
  return { v: COST_SNAPSHOT_VERSION, warnings: [...warnings].slice(0, 50), lines };
}

export const snapshotCostTotal = (s: Pick<CostSnapshot, "lines">): number => round2(s.lines.reduce((t, l) => t + l.cost_total, 0));

// ── Reading one back (jsonb: only well-formed rows, only the known fields) ─────────────────────────────────────────────

function parseDraftLine(raw: unknown): DraftLine | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const description = str(o.description, 500);
  const qty = num(o.qty);
  const unitCost = num(o.unit_cost);
  if (!description || qty === null || unitCost === null) return null;
  return {
    line_key: null, resource_code: str(o.resource_code, 40), cost_code: str(o.cost_code, 40), wbs: str(o.wbs, 100), description, qty, unit: str(o.unit, 30),
    unit_cost: unitCost, cost_known: o.cost_known === false ? false : true, source_ref: str(o.source_ref, 300), reserve: o.reserve === true,
  };
}

export function parseCostSnapshot(raw: unknown): CostSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== COST_SNAPSHOT_VERSION || !Array.isArray(o.lines)) return null;
  const lines: CostLine[] = [];
  for (const r of o.lines) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    if (typeof x.key !== "string") continue;
    const budget = (Array.isArray(x.lines) ? x.lines : []).map(parseDraftLine).filter((l): l is DraftLine => l !== null);
    lines.push({
      key: x.key, item_no: str(x.item_no, 100), unit_cost: num(x.unit_cost), markup_pct: num(x.markup_pct), cost_code: str(x.cost_code, 40),
      estimated: x.estimated === true, from_estimate: x.from_estimate === true, cost_total: costOfLines(budget), lines: budget,
    });
  }
  return {
    v: COST_SNAPSHOT_VERSION,
    warnings: (Array.isArray(o.warnings) ? o.warnings : []).filter((w): w is string => typeof w === "string").slice(0, 50), lines,
  };
}

// ── Bid against budget ─────────────────────────────────────────────────────────────────────────────────────────────────

export type BidVsBudget = {
  /** What the winning bid offered the client. */
  bid_price: number;
  /** What the bid cost, as recorded when it went in. */
  bid_cost: number;
  /** The project's current budget. */
  budget: number;
  /** budget less bid cost: positive means the budget is now larger than the bid assumed. */
  delta: number;
  delta_pct: number | null;
  /** Margin the bid was made on, and the planned margin now, as percent of the price / contract value; null with no price. */
  bid_margin_pct: number | null;
  planned_margin_pct: number | null;
};

const pct1 = (n: number) => Math.round(n * 10) / 10;

export function bidVsBudget(args: { bidPrice: number; bidCost: number; budget: number; contractValue: number }): BidVsBudget {
  const delta = round2(args.budget - args.bidCost);
  return {
    bid_price: round2(args.bidPrice), bid_cost: round2(args.bidCost), budget: round2(args.budget), delta,
    delta_pct: args.bidCost > 0 ? pct1((delta / args.bidCost) * 100) : null,
    bid_margin_pct: args.bidPrice > 0 ? pct1(((args.bidPrice - args.bidCost) / args.bidPrice) * 100) : null,
    planned_margin_pct: args.contractValue > 0 ? pct1(((args.contractValue - args.budget) / args.contractValue) * 100) : null,
  };
}
