import { depthOf, partsOf, type Membership, type TreeItem } from "@/lib/wbs/tree";
import { BUILDING_CODE_RE, COMMON_BUILDING } from "./types";
import { budgetUses, clientQtyOf, round3, toleranceBand, varianceOf, type QtyBand } from "./quantity";

// Buildings (docs/design/pcbs-buildings-elements.md section 2.1), pure. A building is a LEVEL-1 WBS item that carries a building code. The
// tree, its three-level limit, its split and its roll-up are the WBS's own (src/lib/wbs/tree.ts); nothing here stores a line's building a second
// time: it is derived from the WBS item the line sits in (its level-1 ancestor).

export type BuildingItem = TreeItem & { building_code: string | null };

export const isBuilding = (i: Pick<BuildingItem, "building_code" | "parent_id">): boolean => !!i.building_code && i.parent_id === null;

/** The level-1 ancestor of an item (the item itself when it is level 1); null when it is not in the tree. */
export function topItemOf<T extends TreeItem>(items: readonly T[], id: string): T | null {
  const byId = new Map(items.map((i) => [i.id, i]));
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && cur.parent_id) {
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    cur = byId.get(cur.parent_id);
  }
  return cur ?? null;
}

/** The building an item sits in: its level-1 ancestor when that ancestor carries a building code, else null (an ordinary WBS item). */
export function buildingOfItem(items: readonly BuildingItem[], id: string): BuildingItem | null {
  const top = topItemOf(items, id);
  return top && top.building_code ? top : null;
}

export type LineBuilding = { kind: "none" } | { kind: "one"; code: string; item_id: string } | { kind: "mixed"; codes: string[] };

/** Where a line sits, building-wise: in none, in one, or (a split line) in more than one. A part outside any building counts as none. */
export function buildingOfLine(items: readonly BuildingItem[], m: Membership): LineBuilding {
  const shares = partsOf(m);
  if (shares.length === 0) return { kind: "none" };
  const found = shares.map((s) => buildingOfItem(items, s.wbs_item_id));
  const codes = [...new Set(found.map((b) => b?.building_code ?? null))];
  if (codes.length === 1) return codes[0] === null ? { kind: "none" } : { kind: "one", code: codes[0], item_id: (found[0] as BuildingItem).id };
  return { kind: "mixed", codes: codes.filter((c): c is string => c !== null) };
}

export const ELEMENT_SPLIT_MESSAGE = "An element belongs to one building";

/**
 * A line that carries an element code cannot be split across buildings. `m` is the membership the line WOULD have; it can still be split across
 * the activities of one building. Returns the reason, else null.
 */
export function elementSplitProblem(items: readonly BuildingItem[], m: Membership, hasElementCode: boolean): string | null {
  if (!hasElementCode) return null;
  const where = buildingOfLine(items, m);
  return where.kind === "mixed" ? ELEMENT_SPLIT_MESSAGE : null;
}

/** A building code typed in a box: trimmed, upper-cased; null when it is not 1 to 6 of A-Z 0-9. */
export function normaliseBuildingCode(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim().toUpperCase() : "";
  return BUILDING_CODE_RE.test(t) ? t : null;
}

export const BUILDING_CODE_MESSAGE = "A building code is 1 to 6 letters or digits";

/**
 * Can this level-1 item carry `code`? `itemId` null = an item about to be made. Refused: a bad code, a child item (a building is level 1), and
 * a code another building of the same tender or project already has.
 */
export function buildingCodeProblem(items: readonly BuildingItem[], itemId: string | null, parentId: string | null, code: string): string | null {
  if (!BUILDING_CODE_RE.test(code)) return BUILDING_CODE_MESSAGE;
  if (parentId !== null) return "A building is a top-level item";
  if (itemId) {
    const me = items.find((i) => i.id === itemId);
    if (!me) return "That item is not on this record";
    if (me.parent_id !== null || depthOf(items, itemId) !== 1) return "A building is a top-level item";
  }
  const clash = items.find((i) => i.id !== itemId && i.building_code === code);
  return clash ? `${code} is already a building here` : null;
}

// ── The Buildings view ────────────────────────────────────────────────────────────────────────────────────────────────

/** One line as the Buildings view reads it. Money is the contract side (client rate) and the budget side (allocated cost). */
export type ViewLine = Membership & {
  key: string;
  qty: number;
  /** What the client pays for the line; 0 for a line made by hand. */
  client_amount: number;
  /** The cost allocated to the line (the budget), or null when none is. */
  cost: number | null;
  client_rate: number | null;
  element_type: string | null;
  element_code: string | null;
  client_qty: number | null;
  model_qty: number | null;
  is_category?: boolean;
  removed?: boolean;
};

export type TypeFigures = {
  type: string;
  count: number;
  client_qty: number;
  model_qty: number;
  /** Elements whose model quantity differs from the client's by more than the tolerance. */
  outside: number;
};

export type BuildingRow = {
  item_id: string;
  code: string;
  name: string;
  sort_order: number;
  line_count: number;
  element_count: number;
  client_amount: number;
  cost: number | null;
  /** Money at the client rate that a remeasurement to the model quantity would add (negative: take away). */
  variance_amount: number;
  outside_tolerance: number;
  worst_band: QtyBand;
  types: TypeFigures[];
  is_common: boolean;
};

export type BuildingsView = {
  buildings: BuildingRow[];
  /** Lines in no building (shown as "No building"; they stay as they are). */
  no_building: { line_count: number; client_amount: number };
  totals: { line_count: number; element_count: number; client_amount: number; cost: number | null; variance_amount: number; outside_tolerance: number };
};

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const BAND_RANK: Record<QtyBand, number> = { none: 0, within: 1, over: 2, red: 3 };

/**
 * The Buildings view: one row per building (a level-1 item with a code), its lines, element count, contract value, budget, the money a
 * remeasurement would move and how many elements are outside the tolerance, plus one row of quantities per element type. A line split across
 * several buildings counts in each, by its share; an element (which cannot be split) counts once. Category lines count as lines, never as elements.
 */
export function buildingsView(items: readonly BuildingItem[], lines: readonly ViewLine[], tolerancePct: number): BuildingsView {
  const buildings = items.filter(isBuilding).sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
  const rows = new Map<string, BuildingRow & { _types: Map<string, TypeFigures> }>();
  for (const b of buildings) {
    rows.set(b.id, {
      item_id: b.id, code: b.building_code as string, name: b.name, sort_order: b.sort_order, line_count: 0, element_count: 0, client_amount: 0, cost: null,
      variance_amount: 0, outside_tolerance: 0, worst_band: "none", types: [], is_common: b.building_code === COMMON_BUILDING.code, _types: new Map(),
    });
  }
  const none = { line_count: 0, client_amount: 0 };
  for (const l of lines) {
    if (l.removed) continue;
    const shares = partsOf(l);
    if (shares.length === 0) { none.line_count++; none.client_amount = money(none.client_amount + l.client_amount); continue; }
    const pct = new Map<string, number>();
    let outside = 0;
    for (const s of shares) {
      const top = buildingOfItem(items, s.wbs_item_id);
      if (!top) outside += s.share_pct; else pct.set(top.id, (pct.get(top.id) ?? 0) + s.share_pct);
    }
    if (outside > 0.01) { none.line_count++; none.client_amount = money(none.client_amount + (l.client_amount * outside) / 100); }
    for (const [id, p] of pct) {
      const row = rows.get(id);
      if (!row) continue;
      row.line_count++;
      row.client_amount = money(row.client_amount + (l.client_amount * p) / 100);
      if (l.cost !== null) row.cost = money((row.cost ?? 0) + (l.cost * p) / 100);
      if (!l.element_type && !l.element_code) continue;
      if (l.is_category) continue;
      row.element_count++;
      const cq = clientQtyOf({ client_qty: l.client_qty, qty: l.qty, client_rate: l.client_rate });
      const t = l.element_type ?? "—";
      const tf = row._types.get(t) ?? { type: t, count: 0, client_qty: 0, model_qty: 0, outside: 0 };
      tf.count++;
      tf.client_qty = round3(tf.client_qty + (cq ?? 0));
      tf.model_qty = round3(tf.model_qty + (l.model_qty ?? cq ?? 0));
      if (l.model_qty !== null && cq !== null) {
        const v = varianceOf(cq, l.model_qty, l.client_rate ?? 0);
        row.variance_amount = money(row.variance_amount + v.money);
        const band = toleranceBand(v.pct, tolerancePct);
        if (band === "over" || band === "red") { row.outside_tolerance++; tf.outside++; }
        if (BAND_RANK[band] > BAND_RANK[row.worst_band]) row.worst_band = band;
        else if (row.worst_band === "none" && band === "within") row.worst_band = "within";
      }
      row._types.set(t, tf);
    }
  }
  const out = [...rows.values()].map(({ _types, ...r }) => ({ ...r, types: [..._types.values()].sort((a, b) => a.type.localeCompare(b.type)) }));
  const totals = out.reduce((t, r) => ({
    line_count: t.line_count + r.line_count, element_count: t.element_count + r.element_count, client_amount: money(t.client_amount + r.client_amount),
    cost: r.cost === null ? t.cost : money((t.cost ?? 0) + r.cost), variance_amount: money(t.variance_amount + r.variance_amount), outside_tolerance: t.outside_tolerance + r.outside_tolerance,
  }), { line_count: 0, element_count: 0, client_amount: 0, cost: null as number | null, variance_amount: 0, outside_tolerance: 0 });
  return { buildings: out, no_building: none, totals };
}

/** How a line's quantities read on the screen: which quantity the budget uses, the variance and its band. */
export function lineQuantitySummary(l: { qty: number; client_qty: number | null; model_qty: number | null; client_rate: number | null }, tolerancePct: number) {
  const client = clientQtyOf(l);
  const v = client !== null && l.model_qty !== null ? varianceOf(client, l.model_qty, l.client_rate ?? 0) : null;
  return { client, model: l.model_qty, uses: budgetUses(l), variance: v, band: v ? toleranceBand(v.pct, tolerancePct) : ("none" as QtyBand) };
}
