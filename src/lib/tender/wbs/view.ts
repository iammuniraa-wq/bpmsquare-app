import { rollupFigures, totalOf, treeOrder, type Membership, type RollLine } from "@/lib/wbs/tree";
import type { LineMembers, WbsItemRow, WbsState, WbsItemView } from "./types";

// The tender WBS as a screen or an API answer needs it: the tree in order, each item's figures rolled up, the total. PURE.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The slice of a BOQ line the roll-up needs (BoqLineView satisfies it). */
export type BoqFigureLine = { id: string; qty: number; amount: number; priced: boolean; removed: boolean; unit_cost: number | null };

export function membershipOf(members: LineMembers, boqId: string): Membership {
  return { wbs_item_id: members.item.get(boqId) ?? null, parts: members.parts.get(boqId) ?? [] };
}

/** A BOQ line as the roll-up sees it: what the client pays (0 while unpriced), and its total cost when a unit cost is known. */
export function rollLine(line: BoqFigureLine, m: Membership): RollLine {
  return {
    id: line.id, qty: line.qty, amount: line.priced ? line.amount : 0, cost: line.unit_cost != null ? round2(line.qty * line.unit_cost) : null,
    priced: line.priced, removed: line.removed, wbs_item_id: m.wbs_item_id, parts: m.parts,
  };
}

export function buildWbsState(items: readonly WbsItemRow[], names: ReadonlyMap<string, string>, lines: readonly BoqFigureLine[], members: LineMembers): WbsState {
  const ordered: WbsItemView[] = treeOrder(items).map((i) => ({ ...i, owner_name: i.owner_employee_id ? names.get(i.owner_employee_id) ?? null : null }));
  const rolled = rollupFigures(items, lines.map((l) => rollLine(l, membershipOf(members, l.id))));
  return { pending: false, items: ordered, rollup: Object.fromEntries(rolled), total: totalOf(items, rolled) };
}
