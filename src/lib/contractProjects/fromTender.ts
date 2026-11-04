import { round2, round4 } from "./budget";
import { DEFAULT_RESOURCE_CODE, type DraftLine } from "./types";
import type { BudgetPartInput } from "@/lib/tender/estimates/budgetParts";
import { partsOf, remainderOf, treeOrder, type TreeItem } from "@/lib/wbs/tree";

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

// ── The tender's WBS, copied to the project (docs/design/wbs.md section 2.5), pure ─────────────────────────────────────────────────────────────


/** A tender WBS item as the copy reads it. */
export type TenderWbsItem = TreeItem;
/** A row of the tender BOQ as the copy reads it: the deal line it belongs to, the item it sits in, and its shares when it is split. */
export type TenderBoqMembership = { line_id: string | null; wbs_item_id: string | null; parts: { wbs_item_id: string; share_pct: number }[] };

export type WbsCopyPlan = {
  /** In tree order, parents first. `new_id` is the project item's id; `parent` is the new id of its parent. */
  items: { new_id: string; source_id: string; parent: string | null; code: string; name: string; owner_employee_id: string | null; code_is_manual: boolean; sort_order: number }[];
  whole: { package: string; line_key: string; sort_order: number }[];
  parts: { package: string; line_key: string; share_pct: number; sort_order: number }[];
  /** The numbers the notice and the log entry say. */
  summary: { items: number; lines: number; split: number; unassigned: number };
};

/**
 * The project's own copy of the tender's WBS: every item (codes, names, owners, the typed-code flag), every whole line in its item, every
 * share of a split line. A budget line is matched to its BOQ row through `source_line_id` (the deal line id). A line whose BOQ row is
 * unassigned, and the unassigned remainder of a split line, stay so on the project. Nothing is read from the tender again afterwards.
 */
export function mapTenderWbs(args: {
  items: readonly TenderWbsItem[];
  boq: readonly TenderBoqMembership[];
  budgetLines: readonly { line_key: string; source_line_id: string | null }[];
  newId: () => string;
}): WbsCopyPlan {
  const ids = new Map(args.items.map((i) => [i.id, args.newId()]));
  const items = treeOrder(args.items).map((i) => ({
    new_id: ids.get(i.id) as string, source_id: i.id, parent: i.parent_id ? ids.get(i.parent_id) ?? null : null, code: i.code, name: i.name,
    owner_employee_id: i.owner_employee_id, code_is_manual: i.code_is_manual, sort_order: i.sort_order,
  }));
  const byDealLine = new Map(args.boq.filter((b) => b.line_id).map((b) => [b.line_id as string, b]));
  const whole: WbsCopyPlan["whole"] = [];
  const parts: WbsCopyPlan["parts"] = [];
  const order = new Map<string, number>();
  const next = (pkg: string) => { const n = order.get(pkg) ?? 0; order.set(pkg, n + 1); return n; };
  let lines = 0, split = 0, unassigned = 0;
  for (const l of args.budgetLines) {
    const m = l.source_line_id ? byDealLine.get(l.source_line_id) : undefined;
    const shares = m ? partsOf({ wbs_item_id: m.wbs_item_id, parts: m.parts }).filter((s) => ids.has(s.wbs_item_id)) : [];
    if (!m || shares.length === 0) { unassigned++; continue; }
    lines++;
    if (m.parts.length > 0) {
      split++;
      shares.forEach((s, i) => parts.push({ package: ids.get(s.wbs_item_id) as string, line_key: l.line_key, share_pct: s.share_pct, sort_order: i }));
      if (remainderOf({ wbs_item_id: null, parts: shares }) > 0) unassigned++;
    } else {
      const pkg = ids.get(shares[0].wbs_item_id) as string;
      whole.push({ package: pkg, line_key: l.line_key, sort_order: next(pkg) });
    }
  }
  return { items, whole, parts, summary: { items: items.length, lines, split, unassigned } };
}

/** `9 items · 14 lines (2 split) · 4 unassigned`, the one line the log and the Overview say. */
export function wbsCopyText(s: WbsCopyPlan["summary"]): string {
  return `${s.items} item${s.items === 1 ? "" : "s"} · ${s.lines} line${s.lines === 1 ? "" : "s"}${s.split > 0 ? ` (${s.split} split)` : ""} · ${s.unassigned} unassigned`;
}
