import { addProblem, autoCodes, childrenOf, depthOf, divideByShares, heightOf, isDescendant, isSplit, qtyOfShare, remainderOf, shareOfQty, pctText, treeOrder, partsOf, SHARE_TOLERANCE, type Share, type TreeItem } from "./tree";

// What the WBS screens need to decide, kept pure so a test can hold it (docs/design/wbs.md section 3): the cell a line shows in the BOQ table,
// the figures of each part of a split line, the split panel's draft and its totals, and the order and visibility of the tree.

type ItemRef = Pick<TreeItem, "id" | "code" | "name">;

/** The slice of a BOQ line (or budget line) the screens read. */
export type ScreenLine = { id: string; qty: number; amount: number; wbs_item_id: string | null; wbs_parts: readonly Share[] };

export type PartView = { wbs_item_id: string; code: string; name: string; share_pct: number; qty: number; amount: number };

const byId = (items: readonly ItemRef[]) => new Map(items.map((i) => [i.id, i]));

/** Each part of a split line with its share of the quantity and of the amount (the parts add up to the line). */
export function partViews(line: Pick<ScreenLine, "qty" | "amount" | "wbs_item_id" | "wbs_parts">, items: readonly ItemRef[]): PartView[] {
  const map = byId(items);
  const shares = partsOf({ wbs_item_id: line.wbs_item_id, parts: line.wbs_parts });
  const qtys = divideByShares(line.qty, shares.map((s) => s.share_pct), 3);
  const amounts = divideByShares(line.amount, shares.map((s) => s.share_pct));
  return shares.map((s, i) => ({ wbs_item_id: s.wbs_item_id, code: map.get(s.wbs_item_id)?.code ?? "?", name: map.get(s.wbs_item_id)?.name ?? "", share_pct: s.share_pct, qty: qtys[i], amount: amounts[i] }));
}

export type WbsCell = {
  kind: "none" | "whole" | "split";
  /** The code for a whole line; "Split 3" for a split one; empty for an unassigned line. */
  label: string;
  /** The item's name, or the codes of a split line's parts. */
  title: string;
  /** The percent of the line that is in no item (an item was removed from a split line). 100 for a line in no item. */
  remainder: number;
};

export function wbsCell(line: Pick<ScreenLine, "wbs_item_id" | "wbs_parts">, items: readonly ItemRef[]): WbsCell {
  const map = byId(items);
  const remainder = remainderOf({ wbs_item_id: line.wbs_item_id, parts: line.wbs_parts });
  if (isSplit({ wbs_item_id: line.wbs_item_id, parts: line.wbs_parts })) {
    const codes = line.wbs_parts.map((p) => map.get(p.wbs_item_id)?.code ?? "?");
    return { kind: "split", label: `Split ${line.wbs_parts.length}`, title: codes.join(", "), remainder };
  }
  if (line.wbs_item_id) {
    const it = map.get(line.wbs_item_id);
    return { kind: "whole", label: it?.code ?? "?", title: it?.name ?? "", remainder };
  }
  return { kind: "none", label: "", title: "", remainder };
}

/** `2.1 Fabrication · 60 % · 202.26 m · 84,949`, the one line a part reads as. */
export function partText(p: PartView, uom: string | null, money: (n: number) => string): string {
  return `${p.code} ${p.name} · ${trimPct(p.share_pct)} % · ${p.qty.toLocaleString("en-US", { maximumFractionDigits: 3 })}${uom ? ` ${uom}` : ""} · ${money(p.amount)}`;
}

/** 60 -> "60", 33.3333 -> "33.3333", 12.5 -> "12.5": a share without trailing zeros. */
export const trimPct = (n: number): string => String(Number(n.toFixed(4)));

// ── The split panel's draft ─────────────────────────────────────────────────────────────────────────────────────────

/** One row of the panel. `item` is an item id, "" (not chosen yet) or NEW; `pct` and `qty` are what the person typed, kept as text so typing never jumps. */
export type DraftRow = { key: string; item: string; newName: string; pct: string; qty: string };
export const NEW_ITEM = "__new__";

let seq = 0;
export const draftKey = () => `r${++seq}`;

const num = (s: string): number => (s.trim() === "" ? Number.NaN : Number(s));

export function draftFromLine(line: Pick<ScreenLine, "qty" | "wbs_item_id" | "wbs_parts">): DraftRow[] {
  const shares = partsOf({ wbs_item_id: line.wbs_item_id, parts: line.wbs_parts });
  if (shares.length === 0) return [{ key: draftKey(), item: "", newName: "", pct: "100", qty: String(line.qty) }, { key: draftKey(), item: "", newName: "", pct: "", qty: "" }];
  return shares.map((s) => ({ key: draftKey(), item: s.wbs_item_id, newName: "", pct: trimPct(s.share_pct), qty: String(qtyOfShare(line.qty, s.share_pct, 3)) }));
}

/** A row edited in percent: the quantity follows. */
export const withPct = (r: DraftRow, pct: string, qty: number): DraftRow => ({ ...r, pct, qty: Number.isFinite(num(pct)) ? String(qtyOfShare(qty, num(pct), 3)) : "" });
/** A row edited in quantity: the percent follows. */
export const withQty = (r: DraftRow, text: string, qty: number): DraftRow => ({ ...r, qty: text, pct: Number.isFinite(num(text)) && qty > 0 ? trimPct(shareOfQty(qty, num(text))) : "" });

export type DraftTotals = { total: number; remaining: number; balanced: boolean };

export function draftTotals(rows: readonly DraftRow[]): DraftTotals {
  const total = Math.round(rows.reduce((s, r) => s + (Number.isFinite(num(r.pct)) ? num(r.pct) : 0), 0) * 10000) / 10000;
  const remaining = Math.round((100 - total) * 10000) / 10000;
  return { total, remaining, balanced: Math.abs(remaining) <= SHARE_TOLERANCE };
}

/** Why Save is disabled, in plain words; null when the split can be saved. A visible blocker, never behind an "i". */
export function draftBlocker(rows: readonly DraftRow[], items: readonly ItemRef[]): string | null {
  if (rows.length === 0) return "Add a part";
  const ids = new Set(items.map((i) => i.id));
  for (const r of rows) {
    if (!r.item) return "Choose a WBS item for every part";
    if (r.item === NEW_ITEM && !r.newName.trim()) return "Name the new WBS item";
    if (r.item !== NEW_ITEM && !ids.has(r.item)) return "Choose a WBS item for every part";
    if (!Number.isFinite(num(r.pct)) || num(r.pct) <= 0) return "Every part needs a share above 0 %";
  }
  const chosen = rows.filter((r) => r.item !== NEW_ITEM).map((r) => r.item);
  if (new Set(chosen).size !== chosen.length) return "An item can appear once";
  const t = draftTotals(rows);
  if (!t.balanced) return t.remaining > 0 ? `${pctText(t.remaining)} % still to share` : `${pctText(-t.remaining)} % too much`;
  return null;
}

/** The request body for PUT .../tender/wbs/split. */
export function draftToParts(rows: readonly DraftRow[]): { wbs_item_id?: string; new?: { name: string }; share_pct: number }[] {
  return rows.map((r) => (r.item === NEW_ITEM ? { new: { name: r.newName.trim() }, share_pct: num(r.pct) } : { wbs_item_id: r.item, share_pct: num(r.pct) }));
}

/** What a new part starts at: whatever is still unshared. */
export const nextShare = (rows: readonly DraftRow[]): string => {
  const left = draftTotals(rows).remaining;
  return left > 0 ? trimPct(left) : "";
};

// ── The tree's visibility ───────────────────────────────────────────────────────────────────────────────────────────

/** Items in tree order, with those below a collapsed branch left out. */
export function visibleItems<T extends TreeItem>(items: readonly T[], collapsed: ReadonlySet<string>): (T & { depth: number; is_leaf: boolean })[] {
  const ordered = treeOrder(items);
  const hidden = new Set<string>();
  const out: (T & { depth: number; is_leaf: boolean })[] = [];
  for (const it of ordered) {
    if (it.parent_id && (collapsed.has(it.parent_id) || hidden.has(it.parent_id))) { hidden.add(it.id); continue; }
    out.push(it);
  }
  return out;
}

/** The leaves a line can be put into (a branch cannot hold lines), in tree order. */
export const leafItems = <T extends TreeItem>(items: readonly T[]): T[] => treeOrder(items).filter((i) => i.is_leaf);

/** The bar of each top-level item: its share of the client amount and of the cost, as whole percents of the totals. */
export function rootBars<T extends TreeItem>(items: readonly T[], rolled: Readonly<Record<string, { client_amount: number; cost: number | null }>>): { id: string; code: string; name: string; client_pct: number; cost_pct: number | null; client_amount: number; cost: number | null }[] {
  const roots = treeOrder(items).filter((i) => i.depth === 1);
  const totalClient = roots.reduce((s, r) => s + (rolled[r.id]?.client_amount ?? 0), 0);
  const totalCost = roots.reduce((s, r) => s + (rolled[r.id]?.cost ?? 0), 0);
  const hasCost = roots.some((r) => rolled[r.id]?.cost != null);
  return roots.map((r) => ({
    id: r.id, code: r.code, name: r.name, client_amount: rolled[r.id]?.client_amount ?? 0, cost: rolled[r.id]?.cost ?? null,
    client_pct: totalClient > 0 ? Math.round(((rolled[r.id]?.client_amount ?? 0) / totalClient) * 100) : 0,
    cost_pct: hasCost && totalCost > 0 ? Math.round(((rolled[r.id]?.cost ?? 0) / totalCost) * 100) : null,
  }));
}

// ── The item form ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The code a new item would get under `parentId`, so the form can show it before saving. */
export function previewCode(items: readonly TreeItem[], parentId: string | null): string {
  const draft: TreeItem = {
    id: "__preview__", code: "?", name: "", parent_id: parentId, sort_order: childrenOf(items, parentId).reduce((m, i) => Math.max(m, i.sort_order), 0) + 10,
    code_is_manual: false, owner_employee_id: null, created_at: "9999-12-31T00:00:00Z",
  };
  return autoCodes([...items, draft]).get("__preview__") ?? "1";
}

/**
 * The parents an item can be given. A new item can go under any item that still has room below it; an item being moved cannot go under
 * itself, under its own sub-items, or where its subtree would end deeper than three levels. `holders` (items that hold lines) are marked, not
 * hidden: a new item under one takes its lines, a moved item cannot go there.
 */
export function parentChoices<T extends TreeItem>(items: readonly T[], movingId: string | null, holders: ReadonlySet<string>): { item: T; depth: number; holds: boolean; allowed: boolean }[] {
  return treeOrder(items)
    .filter((i) => !movingId || (i.id !== movingId && !isDescendant(items, movingId, i.id)))
    .map((i) => {
      const room = movingId ? depthOf(items, i.id) + heightOf(items, movingId) <= 3 : addProblem(items, i.id) === null;
      const holds = holders.has(i.id);
      return { item: i as unknown as T, depth: i.depth, holds, allowed: room && (!movingId || !holds) };
    });
}
