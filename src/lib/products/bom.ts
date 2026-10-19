import { KIT_ITEM_TYPE } from "./itemTypes";

// Bill of materials: pure cost roll-up and loop checks over product_bom_lines
// (migration 0133). No database access here: callers load the products and
// lines and hand in lookups, so every rule below is testable on its own.
//
// Rules (owner decisions 2026-10-19):
//  - a CONSUMED line adds qty x (1 + scrap% / 100) x unit cost of the component;
//  - the unit cost of a component that is itself a BOM / kit WITH lines is its
//    own rolled-up cost, otherwise its stored cost_price;
//  - a USED line (a tool) is listed but adds nothing to the material cost;
//  - a component with no cost is never counted as zero: it is listed as
//    missing and the roll-up is "incomplete";
//  - kits can contain kits, to a depth of MAX_BOM_DEPTH; loops are refused.

export const MAX_BOM_DEPTH = 8;

export type BomProduct = {
  id: string;
  name: string;
  sku?: string | null;
  item_type?: string | null;
  cost_price: number | null;
  cost_price_as_of?: string | null;
};

export type BomLine = {
  id: string;
  parent_product_id: string;
  component_product_id: string;
  qty: number;
  uom?: string | null;
  scrap_pct: number;
  line_kind: "consumed" | "used";
  sort_order?: number;
  note?: string | null;
};

export type CostSource = "stored" | "rolled_up" | "missing";

export type RollUpLine = {
  lineId: string;
  componentId: string;
  name: string;
  sku: string | null;
  itemType: string | null;
  qty: number;
  uom: string | null;
  scrapPct: number;
  lineKind: "consumed" | "used";
  /** Cost of ONE unit of the component (4 dp); null when it has none. */
  unitCost: number | null;
  /** What this line adds to the total (2 dp). 0 for a used line, null when the cost is missing. */
  lineCost: number | null;
  source: CostSource;
  /** The component's own roll-up when it is a kit with lines. */
  sub?: RollUp;
};

export type MissingComponent = { id: string; name: string; sku: string | null; parentId: string };

export type BomError =
  | { kind: "cycle"; path: string[] }
  | { kind: "depth"; path: string[] };

export type RollUp = {
  /** Sum of the line costs (2 dp). Excludes anything in `missing`. */
  total: number;
  lines: RollUpLine[];
  missing: MissingComponent[];
  /** True when something has no cost or a loop / depth error cut a branch: do not treat `total` as the full cost. */
  incomplete: boolean;
  /** Oldest cost_price_as_of (yyyy-mm-dd) among the stored costs that were used; null when none is dated. */
  asOf: string | null;
  /** How many stored costs used here carry no date at all. */
  undated: number;
  /** Levels of kits: 1 = the root has only plain components. */
  depth: number;
  errors: BomError[];
};

export type RollUpOptions = {
  /** Item type key that can contain components. Defaults to bom_kit. */
  kitType?: string;
  maxDepth?: number;
};

/** Round half away from zero to `dp` places, without the 1.005 float trap. */
export function roundHalfAway(value: number, dp: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const text = String(abs);
  const shifted = text.includes("e") ? abs * 10 ** dp : Number(`${text}e${dp}`);
  return (sign * Math.round(shifted)) / 10 ** dp || 0;
}

const money = (n: number) => roundHalfAway(roundHalfAway(n, 8), 2);
const unit = (n: number) => roundHalfAway(n, 4);
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

type Memo = Map<string, RollUp>;

function walk(
  productId: string,
  level: number,
  path: string[],
  getProduct: (id: string) => BomProduct | undefined,
  getLines: (parentId: string) => BomLine[],
  opts: Required<RollUpOptions>,
  memo: Memo
): RollUp {
  const lines: RollUpLine[] = [];
  const missing: MissingComponent[] = [];
  const errors: BomError[] = [];
  let total = 0;
  let asOf: string | null = null;
  let undated = 0;
  let depth = 1;

  const takeDate = (d: string | null) => { if (d && (asOf === null || d < asOf)) asOf = d; };

  const ordered = [...getLines(productId)].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const l of ordered) {
    const comp = getProduct(l.component_product_id);
    const base = {
      lineId: l.id,
      componentId: l.component_product_id,
      name: comp?.name ?? "(item not found)",
      sku: comp?.sku ?? null,
      itemType: comp?.item_type ?? null,
      qty: l.qty,
      uom: l.uom ?? null,
      scrapPct: l.scrap_pct,
      lineKind: l.line_kind,
    };
    const used = l.line_kind === "used";
    const storedCost = comp && comp.cost_price != null ? unit(comp.cost_price) : null;
    const isKit = comp?.item_type === opts.kitType && getLines(l.component_product_id).length > 0;

    // A tool is listed with its own stored cost for reference but never rolled up or counted.
    if (used) {
      lines.push({ ...base, unitCost: storedCost, lineCost: 0, source: storedCost == null ? "missing" : "stored" });
      continue;
    }

    let sub: RollUp | undefined;
    let unitCost = storedCost;
    let source: CostSource = storedCost == null ? "missing" : "stored";

    if (isKit) {
      if (path.includes(l.component_product_id) || l.component_product_id === productId) {
        errors.push({ kind: "cycle", path: [...path, productId, l.component_product_id] });
        lines.push({ ...base, unitCost: null, lineCost: null, source: "missing" });
        missing.push({ id: l.component_product_id, name: base.name, sku: base.sku, parentId: productId });
        continue;
      }
      if (level + 1 > opts.maxDepth) {
        errors.push({ kind: "depth", path: [...path, productId, l.component_product_id] });
        lines.push({ ...base, unitCost: null, lineCost: null, source: "missing" });
        missing.push({ id: l.component_product_id, name: base.name, sku: base.sku, parentId: productId });
        continue;
      }
      const hit = memo.get(l.component_product_id);
      if (hit && level + hit.depth <= opts.maxDepth) {
        sub = hit;
      } else {
        sub = walk(l.component_product_id, level + 1, [...path, productId], getProduct, getLines, opts, memo);
        if (sub.errors.length === 0) memo.set(l.component_product_id, sub);
      }
      unitCost = sub.total;
      source = "rolled_up";
      depth = Math.max(depth, sub.depth + 1);
      missing.push(...sub.missing);
      errors.push(...sub.errors);
      undated += sub.undated;
      takeDate(sub.asOf);
    } else if (storedCost != null) {
      const d = day(comp?.cost_price_as_of);
      if (d) takeDate(d); else undated += 1;
    }

    if (unitCost == null) {
      lines.push({ ...base, unitCost: null, lineCost: null, source: "missing" });
      missing.push({ id: l.component_product_id, name: base.name, sku: base.sku, parentId: productId });
      continue;
    }

    const lineCost = money(l.qty * (1 + l.scrap_pct / 100) * unitCost);
    total += lineCost;
    lines.push({ ...base, unitCost, lineCost, source, ...(sub ? { sub } : {}) });
  }

  const seen = new Set<string>();
  const uniqueMissing = missing.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  return {
    total: money(total),
    lines,
    missing: uniqueMissing,
    incomplete: uniqueMissing.length > 0 || errors.length > 0,
    asOf,
    undated,
    depth,
    errors,
  };
}

/** Roll the cost of `rootId` up through its components. */
export function rollUpBom(
  rootId: string,
  getProduct: (id: string) => BomProduct | undefined,
  getLines: (parentId: string) => BomLine[],
  opts: RollUpOptions = {}
): RollUp {
  return walk(rootId, 1, [], getProduct, getLines, { kitType: opts.kitType ?? KIT_ITEM_TYPE, maxDepth: opts.maxDepth ?? MAX_BOM_DEPTH }, new Map());
}

/** Would adding `componentId` under `parentId` make a loop? True when it is the
 *  parent itself, or the parent is already somewhere inside the component. */
export function wouldCreateCycle(parentId: string, componentId: string, getLines: (parentId: string) => BomLine[]): boolean {
  if (parentId === componentId) return true;
  const seen = new Set<string>();
  const stack = [componentId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === parentId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const l of getLines(id)) stack.push(l.component_product_id);
  }
  return false;
}

/** The deepest chain of kits there would be if `componentId` were added under
 *  `parentId`: the levels above the parent, plus the parent, plus the levels
 *  below the component. Compare with MAX_BOM_DEPTH before saving. */
export function depthIfAdded(parentId: string, componentId: string, allLines: BomLine[]): number {
  const down = new Map<string, string[]>();
  const up = new Map<string, string[]>();
  for (const l of allLines) {
    down.set(l.parent_product_id, [...(down.get(l.parent_product_id) ?? []), l.component_product_id]);
    up.set(l.component_product_id, [...(up.get(l.component_product_id) ?? []), l.parent_product_id]);
  }
  // Levels of kits: 0 for a plain item, 1 for a kit holding only plain items.
  const levels = (id: string, seen: Set<string>): number => {
    const kids = down.get(id) ?? [];
    if (kids.length === 0 || seen.has(id)) return 0;
    const next = new Set(seen).add(id);
    return 1 + Math.max(...kids.map((k) => levels(k, next)));
  };
  const above = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    const next = new Set(seen).add(id);
    return Math.max(0, ...(up.get(id) ?? []).map((p) => 1 + above(p, next)));
  };
  return above(parentId, new Set()) + 1 + levels(componentId, new Set());
}
