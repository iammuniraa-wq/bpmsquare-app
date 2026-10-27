import { round2, round4 } from "./budget";
import { DEFAULT_MARGIN_PCT, DEFAULT_RESOURCE_CODE, type DraftLine } from "./types";
import { budgetPartsForBoqLine, type BudgetPartInput } from "@/lib/tender/estimates/budgetParts";

// "Create contract project" from a won tender (docs/design/gcc-tender-deals.md section 15), pure. The deal's lines become the
// baseline budget (revision 0): resource Material, the cost code from the client's BOQ when the workspace's cost-code list holds it,
// and a unit cost that is the line's recorded cost when there is one, else the selling rate less the workspace's default margin,
// marked "estimated" so nobody mistakes a guess for a cost.

export type DealLine = {
  id: string;
  sl_no: string | null;
  description: string;
  uom: string | null;
  qty: number;
  rate: number;
  discount_pct?: number | null;
  is_selected?: boolean | null;
  break_of?: string | null;
};

/** What the tender's BOQ row knows about a deal line: its cost code as the client wrote it, and an internal cost if a cost source priced it. */
export type BoqInfo = {
  item_no: string | null;
  cost_code: string | null;
  unit_cost: number | null;
  price_source: string | null;
  price_source_ref: string | null;
};

export const clampMargin = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(95, n)) : DEFAULT_MARGIN_PCT;
};

/** The workspace's default margin (Settings > Contract projects), read defensively from tenants.config. */
export function contractProjectSettings(config: { contract_projects?: { default_margin_pct?: unknown } } | null | undefined): { defaultMarginPct: number } {
  const v = config?.contract_projects?.default_margin_pct;
  return { defaultMarginPct: v === undefined || v === null ? DEFAULT_MARGIN_PCT : clampMargin(v) };
}

/**
 * The cost of a line whose cost is not recorded: the selling rate (after the line's discount) less the default margin. This is a
 * guess and is stored as one (`cost_known = false`); a recorded cost always wins over it.
 */
export function estimateUnitCost(rate: number, discountPct: number, marginPct: number): number {
  const selling = Math.max(0, rate) * (1 - Math.max(0, Math.min(100, discountPct)) / 100);
  return round4(selling * (1 - clampMargin(marginPct) / 100));
}

export type TenderMapping = {
  lines: DraftLine[];
  /** Lines with a guessed cost. */
  estimated: number;
  /** Cost codes the BOQ carried that the workspace's list does not hold (those lines have no cost code until a person picks one). */
  unmappedCodes: string[];
  /** Lines left out: not selected, or a quantity-break row. */
  skipped: number;
  /** BOQ lines whose budget came from the estimate that priced them (slice 3c-1). */
  fromEstimate: number;
  /** Things worth saying about those lines (an estimate output that is gone, a cost the estimate does not have yet). */
  estimateWarnings: string[];
};

/** What the estimates linked to each BOQ line give the budget, keyed by the deal line id. Absent or empty = the standard rule. */
export type EstimateBudgetInput = ReadonlyMap<string, Pick<BudgetPartInput, "links">>;

export function mapTenderToBudget(args: {
  lines: readonly DealLine[];
  boq: ReadonlyMap<string, BoqInfo>;
  /** The workspace's cost-code list (active codes). */
  costCodes: ReadonlySet<string>;
  defaultMarginPct: number;
  /** Slice 3c-1: BOQ lines priced from an estimate take the estimate's cost lines instead of one guessed line. */
  estimates?: EstimateBudgetInput;
}): TenderMapping {
  const byLower = new Map([...args.costCodes].map((c) => [c.trim().toLowerCase(), c]));
  const out: DraftLine[] = [];
  const unmapped = new Set<string>();
  let estimated = 0, skipped = 0, fromEstimate = 0;
  const estimateWarnings: string[] = [];
  for (const l of args.lines) {
    if (l.is_selected === false || l.break_of) { skipped++; continue; }
    const info = args.boq.get(l.id);
    const qty = Number(l.qty) || 0;

    const linked = args.estimates?.get(l.id);
    if (linked && linked.links.length > 0) {
      const asGiven = info?.cost_code?.trim() || null;
      const asCode = asGiven ? byLower.get(asGiven.toLowerCase()) ?? null : null;
      if (asGiven && !asCode) unmapped.add(asGiven);
      const parts = budgetPartsForBoqLine({
        boqQty: qty, links: linked.links,
        boq: { item_no: info?.item_no ?? l.sl_no, description: (l.description || "").trim(), unit: l.uom?.trim() ? l.uom.trim().slice(0, 30) : null, cost_code: asCode },
      });
      estimateWarnings.push(...parts.warnings);
      if (parts.lines.length > 0) {
        out.push(...parts.lines);
        fromEstimate++;
        continue;
      }
    }
    const recorded = info?.unit_cost != null && Number(info.unit_cost) > 0 ? Number(info.unit_cost) : null;
    const unitCost = recorded ?? estimateUnitCost(Number(l.rate) || 0, Number(l.discount_pct) || 0, args.defaultMarginPct);
    if (recorded === null) estimated++;

    const given = info?.cost_code?.trim() || null;
    const code = given ? byLower.get(given.toLowerCase()) ?? null : null;
    if (given && !code) unmapped.add(given);

    const sourceBits = [
      recorded !== null ? `Cost from ${info?.price_source_ref || info?.price_source || "the tender price"}` : `Estimated: rate less ${clampMargin(args.defaultMarginPct)}% margin`,
      given && !code ? `BOQ cost code ${given} is not in your cost codes` : null,
    ].filter(Boolean);
    out.push({
      line_key: null,
      resource_code: DEFAULT_RESOURCE_CODE,
      cost_code: code,
      wbs: info?.item_no ?? l.sl_no ?? null,
      description: (l.description || "").trim().slice(0, 500) || "Line",
      qty: Math.round(qty * 1000) / 1000,
      unit: l.uom?.trim() ? l.uom.trim().slice(0, 30) : null,
      unit_cost: unitCost,
      cost_known: recorded !== null,
      source_ref: sourceBits.join(" · ").slice(0, 300),
      reserve: false,
    });
  }
  return { lines: out, estimated, unmappedCodes: [...unmapped].sort(), skipped, fromEstimate, estimateWarnings };
}

/** The contract value: the awarded value when one was recorded, else what the deal says the bid came to. */
export function contractValueFor(args: { awardValue: number | null | undefined; dealAmount: number | null | undefined }): number {
  const award = Number(args.awardValue);
  if (Number.isFinite(award) && award > 0) return round2(award);
  const amount = Number(args.dealAmount);
  return Number.isFinite(amount) && amount > 0 ? round2(amount) : 0;
}

/** A project name from the deal: the deal's title, which already carries the tender number and issuer. */
export const projectNameFromDeal = (title: string): string => (title.trim() || "Contract project").slice(0, 200);
