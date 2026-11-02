// The rules of a WBS (work breakdown structure), shared by the tender and the contract project (docs/design/wbs.md section 2.3).
// PURE: no I/O and no server imports, so both sides, the screens and the tests share one set of rules.
//
// A WBS is a tree of items up to three levels deep. A BOQ line (a budget line on the project) sits in ONE leaf item by default, or, as an
// option, is split across several leaves by percent. Money rolls up the tree. Nothing here knows where the rows are stored.

export const WBS_MAX_DEPTH = 3;
export const WBS_LIMITS = { codeMax: 20, nameMax: 200, noteMax: 1000, maxPerRecord: 500 } as const;
/** Shares are kept as percent with four decimals; a set adds up when it is within this of 100. */
export const SHARE_TOLERANCE = 0.01;

const EPS = 0.00005;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export type TreeItem = {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  /** True once a person typed the code: renumbering leaves it alone. */
  code_is_manual: boolean;
  owner_employee_id: string | null;
  /** Breaks a tie between siblings with the same sort_order; an ISO string. */
  created_at?: string | null;
};

/** One share of a line in one item, in percent. */
export type Share = { wbs_item_id: string; share_pct: number };

/** Where a line sits: in one item (parts empty), split across several (wbs_item_id null), or nowhere. Never both. */
export type Membership = { wbs_item_id: string | null; parts: readonly Share[] };

// ── Walking the tree ────────────────────────────────────────────────────────────────────────────────────────────────

const bySibling = (a: TreeItem, b: TreeItem) =>
  a.sort_order - b.sort_order || (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id);

export const childrenOf = <T extends TreeItem>(items: readonly T[], parentId: string | null): T[] =>
  items.filter((i) => i.parent_id === parentId).sort(bySibling);

export const isLeaf = (items: readonly TreeItem[], id: string): boolean => !items.some((i) => i.parent_id === id);

/** 1 for a top-level item, 2 for its child, and so on. 0 when the id is not in the tree (or sits in a cycle). */
export function depthOf(items: readonly TreeItem[], id: string): number {
  const byId = new Map(items.map((i) => [i.id, i]));
  let depth = 0;
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) return 0;
    seen.add(cur.id);
    depth++;
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return depth;
}

/** How many levels the subtree starting at `id` has: 1 for a leaf. */
export function heightOf(items: readonly TreeItem[], id: string): number {
  const kids = items.filter((i) => i.parent_id === id);
  return 1 + kids.reduce((m, k) => Math.max(m, heightOf(items, k.id)), 0);
}

/** Is `id` somewhere below `ancestorId`? (Strictly below: an item is not its own descendant.) */
export function isDescendant(items: readonly TreeItem[], ancestorId: string, id: string): boolean {
  const byId = new Map(items.map((i) => [i.id, i]));
  let cur = byId.get(id)?.parent_id ? byId.get(byId.get(id)!.parent_id!) : undefined;
  const seen = new Set<string>();
  while (cur) {
    if (cur.id === ancestorId) return true;
    if (seen.has(cur.id)) return false;
    seen.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return false;
}

export type OrderedItem<T extends TreeItem = TreeItem> = T & { depth: number; is_leaf: boolean };

/** Depth-first, siblings in their order: the order a tree is drawn in. Items whose parent is missing are treated as top-level. */
export function treeOrder<T extends TreeItem>(items: readonly T[]): OrderedItem<T>[] {
  const ids = new Set(items.map((i) => i.id));
  const out: OrderedItem<T>[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const it of childrenOf(items, parentId)) {
      out.push({ ...it, depth, is_leaf: isLeaf(items, it.id) });
      walk(it.id, depth + 1);
    }
  };
  walk(null, 1);
  // An orphan (parent id not in the list) would vanish from the walk; show it at the top rather than lose it.
  const seen = new Set(out.map((o) => o.id));
  for (const it of items.filter((i) => i.parent_id && !ids.has(i.parent_id)).sort(bySibling)) {
    if (seen.has(it.id)) continue;
    out.push({ ...it, depth: 1, is_leaf: isLeaf(items, it.id) });
    seen.add(it.id);
    walk(it.id, 2);
  }
  return out;
}

// ── Moves and additions ─────────────────────────────────────────────────────────────────────────────────────────────

export const DEPTH_MESSAGE = "A WBS goes three levels deep";
export const CYCLE_MESSAGE = "An item cannot be moved under itself";

/** Can a new item be added under `parentId` (null = top level)? Returns the reason it cannot, else null. */
export function addProblem(items: readonly TreeItem[], parentId: string | null): string | null {
  if (items.length >= WBS_LIMITS.maxPerRecord) return `A WBS holds up to ${WBS_LIMITS.maxPerRecord} items`;
  if (parentId === null) return null;
  if (!items.some((i) => i.id === parentId)) return "That parent is not in this WBS";
  return depthOf(items, parentId) + 1 > WBS_MAX_DEPTH ? DEPTH_MESSAGE : null;
}

/**
 * Can `id` move under `newParentId` (null = top level)? Refused when it would sit under itself or one of its own sub-items, when the moved
 * subtree would end deeper than three levels, and when the new parent holds lines or parts (`holders`: the item ids that do): those would
 * stop being a leaf's, so the person adds a sub-item for them first.
 */
export function moveProblem(items: readonly TreeItem[], id: string, newParentId: string | null, holders: ReadonlySet<string> = new Set()): string | null {
  const me = items.find((i) => i.id === id);
  if (!me) return "That WBS item is not on this record";
  if (newParentId === null) return null;
  if (newParentId === id || isDescendant(items, id, newParentId)) return CYCLE_MESSAGE;
  const parent = items.find((i) => i.id === newParentId);
  if (!parent) return "That parent is not in this WBS";
  if (depthOf(items, newParentId) + heightOf(items, id) > WBS_MAX_DEPTH) return DEPTH_MESSAGE;
  if (holders.has(newParentId) && me.parent_id !== newParentId) return `${parent.code} holds lines. Add a sub-item for them first.`;
  return null;
}

// ── Codes ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The code every item has once the auto-numbered ones are recomputed: parent code, a dot, the 1-based position among its siblings. An item
 * whose code a person typed keeps it, and keeps its position among its siblings (1, C-200, 3), so the order never shifts under a typed
 * code. A computed code that another item already holds gets a "-2" style suffix, so a renumbering never produces a duplicate.
 */
export function autoCodes(items: readonly TreeItem[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set(items.filter((i) => i.code_is_manual).map((i) => i.code));
  const walk = (parentId: string | null, prefix: string) => {
    childrenOf(items, parentId).forEach((it, idx) => {
      let code = it.code;
      if (!it.code_is_manual) {
        const base = `${prefix}${idx + 1}`.slice(0, WBS_LIMITS.codeMax);
        code = base;
        for (let n = 2; taken.has(code); n++) {
          const suffix = `-${n}`;
          code = `${base.slice(0, WBS_LIMITS.codeMax - suffix.length)}${suffix}`;
        }
        taken.add(code);
      }
      out.set(it.id, code);
      walk(it.id, `${code}.`);
    });
  };
  walk(null, "");
  // Orphans keep what they have.
  for (const it of items) if (!out.has(it.id)) out.set(it.id, it.code);
  return out;
}

/** What a recode changes: the items whose computed code is not the one they carry. */
export function codeChanges(items: readonly TreeItem[]): { id: string; from: string; to: string }[] {
  const next = autoCodes(items);
  return items.filter((i) => next.get(i.id) !== i.code).map((i) => ({ id: i.id, from: i.code, to: next.get(i.id) as string }));
}

/** Renumber: every item becomes auto-numbered again, typed codes included. The caller decides whether to ask first. */
export function renumberAll(items: readonly TreeItem[]): { id: string; from: string; to: string; manual_cleared: boolean }[] {
  const cleared = items.map((i) => ({ ...i, code_is_manual: false }));
  const next = autoCodes(cleared);
  return items
    .filter((i) => next.get(i.id) !== i.code || i.code_is_manual)
    .map((i) => ({ id: i.id, from: i.code, to: next.get(i.id) as string, manual_cleared: i.code_is_manual }));
}

/** A code or name typed in a box: trimmed and cut to its limit; null when empty. */
export function cleanText(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

// ── Splitting a line across items ───────────────────────────────────────────────────────────────────────────────────

export type SplitInput = { wbs_item_id: string; share_pct: number };
export type SplitResult =
  | { ok: true; kind: "whole"; wbs_item_id: string }
  | { ok: true; kind: "parts"; parts: Share[] }
  | { ok: false; error: string };

export const pctText = (n: number) => n.toFixed(2);

/**
 * A line's split as the person entered it. Every part names a leaf, no item twice, every share above 0, the shares add up to 100 (within
 * 0.01). A set of ONE part at 100 % is not a split: it is the line sitting whole in that item.
 */
export function setSplit(items: readonly TreeItem[], parts: readonly SplitInput[]): SplitResult {
  if (parts.length === 0) return { ok: false, error: "Add at least one part" };
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  for (const p of parts) {
    const item = byId.get(p.wbs_item_id);
    if (!item) return { ok: false, error: "A part names a WBS item that is not on this record" };
    if (!isLeaf(items, item.id)) return { ok: false, error: `${item.code} has sub-items` };
    if (seen.has(item.id)) return { ok: false, error: `${item.code} appears twice` };
    seen.add(item.id);
    if (!Number.isFinite(p.share_pct) || p.share_pct <= 0) return { ok: false, error: "Every share must be more than 0 %" };
    if (p.share_pct > 100 + SHARE_TOLERANCE) return { ok: false, error: "A share cannot be more than 100 %" };
  }
  const sum = round4(parts.reduce((s, p) => s + p.share_pct, 0));
  if (Math.abs(sum - 100) > SHARE_TOLERANCE) return { ok: false, error: `Shares add up to ${pctText(sum)} %, not 100 %` };
  if (parts.length === 1) return { ok: true, kind: "whole", wbs_item_id: parts[0].wbs_item_id };
  // The set stands at exactly 100: any rounding slack goes on the largest part, so what is stored adds up.
  const shares = parts.map((p) => ({ wbs_item_id: p.wbs_item_id, share_pct: round4(p.share_pct) }));
  const slack = round4(100 - shares.reduce((s, p) => s + p.share_pct, 0));
  if (slack !== 0) {
    let big = 0;
    shares.forEach((p, i) => { if (p.share_pct > shares[big].share_pct) big = i; });
    shares[big].share_pct = round4(shares[big].share_pct + slack);
  }
  return { ok: true, kind: "parts", parts: shares };
}

/** The shares a line has, whole or split: a whole line is one share at 100 %; an unassigned line has none. */
export function partsOf(m: Membership): Share[] {
  if (m.parts.length > 0) return [...m.parts];
  return m.wbs_item_id ? [{ wbs_item_id: m.wbs_item_id, share_pct: 100 }] : [];
}

/** The part of the line that is in no item: 100 for an unassigned line, the leftover after an item was removed, else 0. */
export function remainderOf(m: Membership): number {
  const used = partsOf(m).reduce((s, p) => s + p.share_pct, 0);
  const rest = round4(100 - used);
  return rest > SHARE_TOLERANCE ? rest : 0;
}

export const isSplit = (m: Membership): boolean => m.parts.length > 0;

/**
 * A value (an amount, a quantity) divided by shares, to the line's precision. When the shares fill the whole line the last part takes the
 * rounding, so the parts add up to the value exactly; when they do not (an item was removed) each part is its plain share.
 */
export function divideByShares(value: number, shares: readonly number[], decimals = 2): number[] {
  const f = 10 ** decimals;
  const round = (n: number) => Math.round((n + Number.EPSILON) * f) / f;
  const out = shares.map((p) => round((value * p) / 100));
  const full = Math.abs(shares.reduce((s, p) => s + p, 0) - 100) <= SHARE_TOLERANCE;
  if (full && out.length > 1) {
    const rest = round(value - out.slice(0, -1).reduce((s, v) => s + v, 0));
    out[out.length - 1] = rest;
  }
  return out;
}

/** Percent to quantity and back, for the panel's toggle: a display conversion, percent is what is stored. */
export const qtyOfShare = (qty: number, pct: number, decimals = 2): number => divideByShares(qty, [pct], decimals)[0];
export const shareOfQty = (qty: number, partQty: number): number => (qty > 0 ? round4((partQty / qty) * 100) : 0);

// ── What a line moves with an item ──────────────────────────────────────────────────────────────────────────────────

/** Adding a sub-item under an item that holds lines or parts moves them into the new sub-item. Pure: returns the new memberships. */
export function moveHeld<K extends string>(memberships: ReadonlyMap<K, Membership>, fromItemId: string, toItemId: string): Map<K, Membership> {
  const out = new Map<K, Membership>();
  for (const [k, m] of memberships) {
    out.set(k, {
      wbs_item_id: m.wbs_item_id === fromItemId ? toItemId : m.wbs_item_id,
      parts: m.parts.map((p) => (p.wbs_item_id === fromItemId ? { ...p, wbs_item_id: toItemId } : p)),
    });
  }
  return out;
}

/** Removing an item: a whole line goes back to unassigned, a split line loses that part and shows the rest as an unassigned remainder. */
export function dropItem<K extends string>(memberships: ReadonlyMap<K, Membership>, itemId: string): Map<K, Membership> {
  const out = new Map<K, Membership>();
  for (const [k, m] of memberships) {
    out.set(k, { wbs_item_id: m.wbs_item_id === itemId ? null : m.wbs_item_id, parts: m.parts.filter((p) => p.wbs_item_id !== itemId) });
  }
  return out;
}

/** The ids of the items that hold lines or parts: a branch cannot take a child while one of these is its parent. */
export function holdersOf(memberships: Iterable<Membership>): Set<string> {
  const out = new Set<string>();
  for (const m of memberships) for (const p of partsOf(m)) out.add(p.wbs_item_id);
  return out;
}

// ── Roll-up ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a line contributes to the roll-up. `amount` is what the client pays (0 when unpriced), `cost` the line's total cost or null when unknown. */
export type RollLine = Membership & { id: string; qty: number; amount: number; cost: number | null; priced: boolean; removed?: boolean };

/** The figures of one item or of everything under it. `cost` is null while none of its lines has a cost. */
export type Figures = { part_count: number; shared_count: number; client_amount: number; cost: number | null; priced_count: number };
export const ZERO_FIGURES: Figures = { part_count: 0, shared_count: 0, client_amount: 0, cost: null, priced_count: 0 };

/** The figures of what sits directly in each item. A line removed from the latest file is not counted. */
export function ownFigures(lines: readonly RollLine[]): Map<string, Figures> {
  const out = new Map<string, Figures>();
  for (const line of lines) {
    if (line.removed) continue;
    const shares = partsOf(line);
    if (shares.length === 0) continue;
    const amounts = divideByShares(line.amount, shares.map((s) => s.share_pct));
    const costs = line.cost == null ? null : divideByShares(line.cost, shares.map((s) => s.share_pct));
    shares.forEach((s, i) => {
      const f = out.get(s.wbs_item_id) ?? { ...ZERO_FIGURES };
      f.part_count += 1;
      if (s.share_pct < 100 - SHARE_TOLERANCE) f.shared_count += 1;
      f.client_amount = round2(f.client_amount + amounts[i]);
      if (costs) f.cost = round2((f.cost ?? 0) + costs[i]);
      if (line.priced) f.priced_count += 1;
      out.set(s.wbs_item_id, f);
    });
  }
  return out;
}

/** Adds a figure; null means "not known" and only stays null when both are. */
const addNum = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : round2(a + b));

/**
 * Each item's own figures plus every descendant's, in one pass bottom-up. `zero` names the fields (so the project can roll up more than the
 * tender does); a field that is null on every row stays null. The root totals are the sums of the top-level items, so nothing is counted twice.
 */
export function rollUp<T extends Record<string, number | null>>(items: readonly TreeItem[], own: ReadonlyMap<string, T>, zero: T): Map<string, T> {
  const out = new Map<string, T>();
  const keys = Object.keys(zero) as (keyof T & string)[];
  const visit = (id: string): T => {
    const acc = { ...zero, ...(own.get(id) ?? {}) } as T;
    for (const k of items.filter((i) => i.parent_id === id)) {
      const child = visit(k.id);
      for (const key of keys) (acc as Record<string, number | null>)[key] = addNum(acc[key], child[key]);
    }
    out.set(id, acc);
    return acc;
  };
  const ids = new Set(items.map((i) => i.id));
  for (const root of items.filter((i) => i.parent_id === null || !ids.has(i.parent_id))) visit(root.id);
  return out;
}

export const rollupFigures = (items: readonly TreeItem[], lines: readonly RollLine[]): Map<string, Figures> => rollUp(items, ownFigures(lines), ZERO_FIGURES);

/** The total of a roll-up: its top-level items only. */
export function totalOf(items: readonly TreeItem[], rolled: ReadonlyMap<string, Figures>): Figures {
  let t: Figures = { ...ZERO_FIGURES };
  for (const root of items.filter((i) => i.parent_id === null)) {
    const f = rolled.get(root.id);
    if (!f) continue;
    t = { part_count: t.part_count + f.part_count, shared_count: t.shared_count + f.shared_count, client_amount: round2(t.client_amount + f.client_amount), cost: addNum(t.cost, f.cost), priced_count: t.priced_count + f.priced_count };
  }
  return t;
}

/** The lines (and remainders of split lines) that are in no item. A removed line is not listed. */
export function unassignedOf<L extends Membership & { removed?: boolean }>(lines: readonly L[]): { line: L; remainder: number; split: boolean }[] {
  return lines.filter((l) => !l.removed).map((l) => ({ line: l, remainder: remainderOf(l), split: isSplit(l) })).filter((x) => x.remainder > 0);
}
