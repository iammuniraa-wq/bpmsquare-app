import { round2, round4 } from "./budget";
import { DEFAULT_RESOURCE_CODE, type DraftLine } from "./types";
import type { BudgetPartInput } from "@/lib/tender/estimates/budgetParts";

// "Create contract project" from a won tender (docs/design/gcc-tender-deals.md section 15), pure. The deal's lines become the contract: each
// one a budget line with its quantity, unit and the CLIENT's rate and amount, resource Material, the cost code from the client's BOQ when
// the workspace's cost-code list holds it, and NO cost. Nothing is guessed (KAMCO feedback, 2026-10-29): the line starts "not allocated" and a
// person allocates the cost, by line or by work package, or copies the costs recorded on the tender once with "Fill from tender costs".

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

/** What the estimates linked to each BOQ line give the cost, keyed by the deal line id (read by the bid cost snapshot, not by the project copy). */
export type EstimateBudgetInput = ReadonlyMap<string, Pick<BudgetPartInput, "links">>;

export type TenderMapping = {
  lines: DraftLine[];
  /** Cost codes the BOQ carried that the workspace's list does not hold (those lines have no cost code until a person picks one). */
  unmappedCodes: string[];
  /** Lines left out: not selected, or a quantity-break row. */
  skipped: number;
};

/** The rate the client pays for one unit, after the line's own discount. */
export function clientRateOf(rate: number, discountPct: number): number {
  return round4(Math.max(0, rate) * (1 - Math.max(0, Math.min(100, discountPct)) / 100));
}

export function mapTenderToBudget(args: {
  lines: readonly DealLine[];
  /** Only the cost code and item number of a BOQ row are read here; its cost is for Fill. */
  boq: ReadonlyMap<string, Pick<BoqInfo, "item_no" | "cost_code">>;
  /** The workspace's cost-code list (active codes). */
  costCodes: ReadonlySet<string>;
}): TenderMapping {
  const byLower = new Map([...args.costCodes].map((c) => [c.trim().toLowerCase(), c]));
  const out: DraftLine[] = [];
  const unmapped = new Set<string>();
  let skipped = 0;
  for (const l of args.lines) {
    if (l.is_selected === false || l.break_of) { skipped++; continue; }
    const info = args.boq.get(l.id);
    const qty = Math.round((Number(l.qty) || 0) * 1000) / 1000;
    const given = info?.cost_code?.trim() || null;
    const code = given ? byLower.get(given.toLowerCase()) ?? null : null;
    if (given && !code) unmapped.add(given);
    const clientRate = clientRateOf(Number(l.rate) || 0, Number(l.discount_pct) || 0);
    out.push({
      line_key: null,
      resource_code: DEFAULT_RESOURCE_CODE,
      cost_code: code,
      wbs: info?.item_no ?? l.sl_no ?? null,
      description: (l.description || "").trim().slice(0, 500) || "Line",
      qty,
      unit: l.uom?.trim() ? l.uom.trim().slice(0, 30) : null,
      unit_cost: 0,
      amount: 0,
      allocated: false,
      cost_known: true,
      source_ref: null,
      reserve: false,
      client_rate: clientRate,
      client_amount: round2(qty * clientRate),
      source_line_id: l.id,
    });
  }
  return { lines: out, unmappedCodes: [...unmapped].sort(), skipped };
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
