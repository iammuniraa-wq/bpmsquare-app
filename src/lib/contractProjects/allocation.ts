import { budgetTotals, isUuid, marginView, round2, round4, type BudgetTotals, type MarginView } from "./budget";
import { LINE_LIMITS, type AllocationBasis, type BudgetLine, type WorkPackageRow } from "./types";
import { WBS_LIMITS, divideByShares, partsOf, remainderOf, rollUp, treeOrder, type Membership, type TreeItem } from "@/lib/wbs/tree";

// Allocating a project's budget (KAMCO feedback, decided 2026-10-29): the system never makes the budget, the person allocates it, by BOQ line
// or by WBS item (docs/design/wbs.md). Planned margin = contract value less what has been allocated so far, live. The WBS is a tree of items
// (three levels); a BOQ line sits in one leaf item or, as an option, is split across several by percent. PURE: no I/O and no server imports,
// so the routes, the screen and the tests share one set of rules.

/** The limits of a WBS item. The name is kept for the code that already imports it; the values are the tree's. */
export const PACKAGE_LIMITS = WBS_LIMITS;

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// ── Spreading an item's cost over its lines ─────────────────────────────────────────────────────────────────────────

export type SpreadLine = { line_key: string; client_amount: number | null; qty: number };
export type Spread = { line_key: string; amount: number; unit_cost: number };

/**
 * An item's allocated cost laid over its lines, in proportion to what the client pays for each (equal shares when none of them knows
 * a client amount). Worked in whole cents so the shares add up to the cost exactly: the last line takes the remainder. The unit cost
 * is what the amount works out to per unit, so quantity times unit cost reads right on the line.
 */
export function spreadPackageCost(cost: number, lines: readonly SpreadLine[]): Spread[] {
  if (lines.length === 0) return [];
  const cents = Math.max(0, Math.round(cost * 100));
  const weights = lines.map((l) => Math.max(0, Number(l.client_amount) || 0));
  const sum = weights.reduce((s, w) => s + w, 0);
  const share = lines.map((_, i) => (sum > 0 ? Math.round((cents * weights[i]) / sum) : Math.round(cents / lines.length)));
  const last = lines.length - 1;
  share[last] = 0;
  const rest = cents - share.reduce((s, v) => s + v, 0);
  if (rest >= 0) share[last] = rest;
  else {
    // The earlier shares rounded up past the whole: take the surplus off the largest one so nothing is negative and the sum stays exact.
    let big = 0;
    share.forEach((v, i) => { if (v > share[big]) big = i; });
    share[big] += rest;
  }
  return lines.map((l, i) => {
    const amount = round2(share[i] / 100);
    return { line_key: l.line_key, amount, unit_cost: l.qty > 0 ? round4(amount / l.qty) : amount };
  });
}

/** The lines that are in no WBS item at all (not even a part). */
export function unassignedLines<L extends Pick<BudgetLine, "line_key">>(lines: readonly L[], packages: readonly Pick<WorkPackageRow, "line_keys" | "line_parts">[]): L[] {
  const taken = new Set(packages.flatMap((p) => [...p.line_keys, ...(p.line_parts ?? []).map((x) => x.line_key)]));
  return lines.filter((l) => !taken.has(l.line_key));
}

// ── Where each line sits ────────────────────────────────────────────────────────────────────────────────────────────

/** A budget line's place in the WBS: the item it sits whole in, or its shares across items. Keyed by line_key. */
export function lineMemberships(packages: readonly Pick<WorkPackageRow, "id" | "line_keys" | "line_parts">[]): Map<string, Membership> {
  const out = new Map<string, { item: string | null; parts: { wbs_item_id: string; share_pct: number }[] }>();
  const at = (k: string) => { let m = out.get(k); if (!m) { m = { item: null, parts: [] }; out.set(k, m); } return m; };
  for (const p of packages) {
    for (const k of p.line_keys) at(k).item = p.id;
    for (const part of p.line_parts ?? []) at(part.line_key).parts.push({ wbs_item_id: p.id, share_pct: part.share_pct });
  }
  return new Map([...out].map(([k, m]) => [k, { wbs_item_id: m.parts.length > 0 ? null : m.item, parts: m.parts }]));
}

const emptyMembership: Membership = { wbs_item_id: null, parts: [] };

/** A package row as the tree rules read it. */
export const asTreeItem = (p: Pick<WorkPackageRow, "id" | "code" | "name" | "sort_order" | "owner_employee_id"> & Partial<Pick<WorkPackageRow, "parent_id" | "code_is_manual">>): TreeItem => ({
  id: p.id, code: p.code, name: p.name, parent_id: p.parent_id ?? null, sort_order: p.sort_order, code_is_manual: p.code_is_manual ?? false, owner_employee_id: p.owner_employee_id,
});

export type LineSpread = { amount: number; unit_cost: number };

/**
 * The cost of each line when the budget is allocated by WBS: every LEAF item that has a cost lays it over what it holds, a split line
 * contributing its share of quantity and client amount to each item, and a line's budget amount is the sum of what its items give it. A
 * line in no item, or only in items with no cost, is absent (it is not allocated). A parent's own cost is ignored: parents are roll-ups.
 */
export function respreadTargets(packages: readonly WorkPackageRow[], lines: readonly Pick<BudgetLine, "line_key" | "qty" | "client_amount">[]): Map<string, LineSpread> {
  const byKey = new Map(lines.map((l) => [l.line_key, l]));
  const memberships = lineMemberships(packages);
  const hasChild = new Set(packages.map((p) => p.parent_id).filter((x): x is string => !!x));
  const sums = new Map<string, number>();
  for (const p of packages) {
    if (p.allocated_cost === null || hasChild.has(p.id)) continue;
    const held: SpreadLine[] = [];
    for (const [key, m] of memberships) {
      const l = byKey.get(key);
      if (!l) continue;
      const mine = partsOf(m).find((s) => s.wbs_item_id === p.id);
      if (!mine) continue;
      held.push({ line_key: key, client_amount: l.client_amount === null ? null : (l.client_amount * mine.share_pct) / 100, qty: (l.qty * mine.share_pct) / 100 });
    }
    for (const sp of spreadPackageCost(p.allocated_cost, held)) sums.set(sp.line_key, round2((sums.get(sp.line_key) ?? 0) + sp.amount));
  }
  const out = new Map<string, LineSpread>();
  for (const [key, amount] of sums) {
    const l = byKey.get(key) as Pick<BudgetLine, "qty">;
    out.set(key, { amount, unit_cost: l.qty > 0 ? round4(amount / l.qty) : amount });
  }
  return out;
}

// ── The allocation as the screen shows it ───────────────────────────────────────────────────────────────────────────

export type LineRow = {
  line_key: string;
  /** The client's item number (the line's reference). */
  item: string | null;
  description: string;
  /** What the row still lacks (shown under its description: a missing resource type blocks approval). */
  missing: ("resource type" | "cost code")[];
  qty: number;
  unit: string | null;
  client_amount: number | null;
  /** The cost allocated to the line; 0 while it is not allocated. */
  amount: number;
  allocated: boolean;
  /** Client amount less the allocated cost; null when the client's amount is not known. */
  left: number | null;
  /** The WBS items the line sits in: one at 100 % for a whole line, several for a split one, none for an unassigned line. */
  wbs: { code: string; share_pct: number }[];
};

export type WbsRow = {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  depth: number;
  is_leaf: boolean;
  owner_employee_id: string | null;
  owner_name: string | null;
  source_wbs_item_id: string | null;
  /** The whole lines and the parts of split lines the item holds directly. */
  line_count: number;
  shared_count: number;
  /** The reference or description of what it holds directly, for a card. */
  items: string[];
  /** What the client pays for what the item holds directly; null when none of it knows a client amount. */
  client_amount: number | null;
  /** The cost typed on the item (a leaf, in the WBS basis). */
  allocated_cost: number | null;
  allocated: boolean;
  left: number | null;
  /** This item's figures plus every sub-item's. Parents show these; nothing is counted twice. */
  rolled: { line_count: number; client_amount: number | null; allocated: number; left: number | null };
};

export type AllocationView = {
  basis: AllocationBasis;
  lineRows: LineRow[];
  /** The WBS in tree order. */
  wbsRows: WbsRow[];
  totals: BudgetTotals;
  margin: MarginView;
  /** Lines not (fully) in a WBS item: the line, and the percent of it that is in none (100 for a line in no item). */
  unassigned: { line_key: string; item: string | null; description: string; remainder_pct: number; split: boolean }[];
  warnings: string[];
};

const leftOf = (client: number | null, allocated: number): number | null => (client === null ? null : round2(client - allocated));
const addN = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : round2(a + b));

type Own = { line_count: number; shared_count: number; client: number | null; allocated: number };

export function allocationView(
  project: { allocation_basis: AllocationBasis; contract_value: number },
  lines: readonly BudgetLine[],
  packages: readonly WorkPackageRow[],
  floor: number | null,
): AllocationView {
  const totals = budgetTotals(lines);
  const items = packages.map(asTreeItem);
  const codeOf = new Map(packages.map((p) => [p.id, p.code]));
  const memberships = lineMemberships(packages);

  const lineRows: LineRow[] = lines.map((l) => {
    const amount = l.allocated ? l.amount : 0;
    const missing: LineRow["missing"] = [...(l.resource_code ? [] : ["resource type" as const]), ...(l.cost_code ? [] : ["cost code" as const])];
    const wbs = partsOf(memberships.get(l.line_key) ?? emptyMembership).map((s) => ({ code: codeOf.get(s.wbs_item_id) ?? "?", share_pct: s.share_pct }));
    return { line_key: l.line_key, item: l.wbs, description: l.description, missing, qty: l.qty, unit: l.unit, client_amount: l.client_amount, amount, allocated: l.allocated, left: leftOf(l.client_amount, amount), wbs };
  });

  // What each item holds directly, then rolled up the tree.
  const own = new Map<string, Own>();
  const labels = new Map<string, string[]>();
  for (const p of packages) own.set(p.id, { line_count: 0, shared_count: 0, client: null, allocated: p.allocated_cost ?? 0 });
  for (const l of lines) {
    const shares = partsOf(memberships.get(l.line_key) ?? emptyMembership);
    if (shares.length === 0) continue;
    const parts = l.client_amount === null ? null : divideByShares(l.client_amount, shares.map((s) => s.share_pct));
    shares.forEach((s, i) => {
      const o = own.get(s.wbs_item_id);
      if (!o) return;
      o.line_count += 1;
      if (s.share_pct < 100 - 0.01) o.shared_count += 1;
      if (parts) o.client = addN(o.client, parts[i]);
      labels.set(s.wbs_item_id, [...(labels.get(s.wbs_item_id) ?? []), l.wbs ?? l.description]);
    });
  }
  const rolled = rollUp<Own>(items, own, { line_count: 0, shared_count: 0, client: null, allocated: 0 });
  const wbsRows: WbsRow[] = treeOrder(items).map((it) => {
    const p = packages.find((x) => x.id === it.id) as WorkPackageRow;
    const o = own.get(it.id) as Own;
    const r = rolled.get(it.id) as Own;
    return {
      id: p.id, code: p.code, name: p.name, parent_id: p.parent_id ?? null, depth: it.depth, is_leaf: it.is_leaf, owner_employee_id: p.owner_employee_id, owner_name: p.owner_name,
      source_wbs_item_id: p.source_wbs_item_id ?? null, line_count: o.line_count, shared_count: o.shared_count, items: labels.get(p.id) ?? [], client_amount: o.client,
      allocated_cost: p.allocated_cost, allocated: p.allocated_cost !== null, left: leftOf(o.client, o.allocated),
      rolled: { line_count: r.line_count, client_amount: r.client, allocated: r.allocated, left: leftOf(r.client, r.allocated) },
    };
  });

  const unassigned = lines
    .map((l) => ({ l, remainder: remainderOf(memberships.get(l.line_key) ?? emptyMembership), split: (memberships.get(l.line_key)?.parts.length ?? 0) > 0 }))
    .filter((x) => x.remainder > 0)
    .map((x) => ({ line_key: x.l.line_key, item: x.l.wbs, description: x.l.description, remainder_pct: x.remainder, split: x.split }));
  const warnings: string[] = [];
  if (project.allocation_basis === "package" && unassigned.length > 0) warnings.push(`${unassigned.length} line${unassigned.length === 1 ? " is" : "s are"} not in a WBS item`);
  return { basis: project.allocation_basis, lineRows, wbsRows, totals, margin: marginView(project.contract_value, totals, floor), unassigned, warnings };
}

// ── A WBS item from a request body ──────────────────────────────────────────────────────────────────────────────────

export type WorkPackageInput = { code: string; name: string; parent_id: string | null; owner_employee_id: string | null; line_keys: string[]; note: string | null };
export type ParsedPackage = { ok: true; value: Partial<WorkPackageInput> } | { ok: false; error: string };

/**
 * A create (a name required; the code numbers itself when absent) or an edit (any subset). `validLineKeys` are the line_keys of the revision
 * being worked on: an item can only hold lines that are there. The owner's id is checked against the workspace (and for a login) by the
 * server, not here; so is the parent.
 */
export function parseWorkPackage(body: unknown, validLineKeys: ReadonlySet<string>, mode: "create" | "update"): ParsedPackage {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const value: Partial<WorkPackageInput> = {};
  if ("code" in b) {
    const code = text(b.code, PACKAGE_LIMITS.codeMax);
    // An empty code on an edit hands the item back to the numbering; on a create it simply numbers itself.
    if (code) value.code = code;
    else if (mode === "update" && (b.code === null || b.code === "")) value.code = "";
    else if (mode === "update") return { ok: false, error: "Give the WBS item a code" };
  }
  if ("name" in b || mode === "create") {
    const name = text(b.name, PACKAGE_LIMITS.nameMax);
    if (!name) return { ok: false, error: "Give the WBS item a name" };
    value.name = name;
  }
  if ("parent_id" in b) {
    if (b.parent_id === null || b.parent_id === "") value.parent_id = null;
    else if (isUuid(b.parent_id)) value.parent_id = b.parent_id;
    else return { ok: false, error: "The parent must be a WBS item" };
  }
  if ("owner_employee_id" in b) {
    if (b.owner_employee_id === null || b.owner_employee_id === "") value.owner_employee_id = null;
    else if (isUuid(b.owner_employee_id)) value.owner_employee_id = b.owner_employee_id;
    else return { ok: false, error: "The owner must be an employee" };
  }
  if ("note" in b) value.note = text(b.note, PACKAGE_LIMITS.noteMax);
  if ("line_keys" in b) {
    if (!Array.isArray(b.line_keys)) return { ok: false, error: "line_keys must be a list" };
    const keys = [...new Set(b.line_keys.filter((k): k is string => typeof k === "string"))];
    if (keys.length !== b.line_keys.length) return { ok: false, error: "Each line must appear once" };
    const unknown = keys.filter((k) => !validLineKeys.has(k));
    if (unknown.length > 0) return { ok: false, error: "A line is not in this budget" };
    value.line_keys = keys;
  }
  return { ok: true, value };
}

/** Group into WBS on the project: those budget lines into one leaf item (null = unassigned). */
export function parseAssign(body: unknown, validLineKeys: ReadonlySet<string>): { ok: true; line_keys: string[]; package_id: string | null } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!Array.isArray(b.line_keys) || b.line_keys.length === 0) return { ok: false, error: "Choose at least one line" };
  if (b.line_keys.length > LINE_LIMITS.maxLines) return { ok: false, error: `Choose up to ${LINE_LIMITS.maxLines} lines at a time` };
  const keys = [...new Set(b.line_keys.filter((k): k is string => typeof k === "string"))];
  if (keys.length !== b.line_keys.length) return { ok: false, error: "Each line must appear once" };
  if (keys.some((k) => !validLineKeys.has(k))) return { ok: false, error: "A line is not in this budget" };
  if (b.package_id !== null && b.package_id !== undefined && !isUuid(b.package_id)) return { ok: false, error: "That is not a WBS item" };
  return { ok: true, line_keys: keys, package_id: (b.package_id as string | null | undefined) ?? null };
}

/** A line's split from a request body: the line and its parts (a WBS item and a share each). The sum rule is the tree's (setSplit). */
export function parseSplit(body: unknown, validLineKeys: ReadonlySet<string>): { ok: true; line_key: string; parts: { package_id: string; share_pct: number }[] } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof b.line_key !== "string" || !validLineKeys.has(b.line_key)) return { ok: false, error: "A line is not in this budget" };
  if (!Array.isArray(b.parts)) return { ok: false, error: "parts must be a list" };
  if (b.parts.length > 50) return { ok: false, error: "Split a line into up to 50 parts" };
  const parts: { package_id: string; share_pct: number }[] = [];
  for (const r of b.parts) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const pct = typeof o.share_pct === "number" ? o.share_pct : typeof o.share_pct === "string" && o.share_pct.trim() !== "" ? Number(o.share_pct) : Number.NaN;
    if (!Number.isFinite(pct)) return { ok: false, error: "Every part needs a share" };
    const id = o.package_id ?? o.wbs_item_id;
    if (!isUuid(id)) return { ok: false, error: "Every part needs a WBS item" };
    parts.push({ package_id: id, share_pct: pct });
  }
  return { ok: true, line_key: b.line_key, parts };
}

// ── The allocation from a request body ──────────────────────────────────────────────────────────────────────────────

export type LineAllocation = { line_key: string; amount: number | null };
export type PackageAllocation = { id: string; allocated_cost: number | null };

/** null / "" clears the allocation; otherwise a number from 0 up to the limit. */
function money(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n <= LINE_LIMITS.maxAmount ? { ok: true, value: round2(n) } : { ok: false };
}

export function parseLineAllocation(raw: unknown): { ok: true; rows: LineAllocation[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "basis_rows must be a list" };
  if (raw.length > LINE_LIMITS.maxLines) return { ok: false, error: `A budget holds up to ${LINE_LIMITS.maxLines} lines` };
  const rows: LineAllocation[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    if (!isUuid(o.line_key)) return { ok: false, error: "Each row needs a line_key" };
    if (seen.has(o.line_key)) return { ok: false, error: "A line appears twice" };
    seen.add(o.line_key);
    const m = money(o.amount);
    if (!m.ok) return { ok: false, error: "A cost is a number of 0 or more" };
    rows.push({ line_key: o.line_key, amount: m.value });
  }
  return { ok: true, rows };
}

export function parsePackageAllocation(raw: unknown): { ok: true; rows: PackageAllocation[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "packages must be a list" };
  if (raw.length > PACKAGE_LIMITS.maxPerRecord) return { ok: false, error: `A project holds up to ${PACKAGE_LIMITS.maxPerRecord} WBS items` };
  const rows: PackageAllocation[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    if (!isUuid(o.id)) return { ok: false, error: "Each row needs a WBS item id" };
    if (seen.has(o.id)) return { ok: false, error: "A WBS item appears twice" };
    seen.add(o.id);
    const m = money(o.allocated_cost);
    if (!m.ok) return { ok: false, error: "A cost is a number of 0 or more" };
    rows.push({ id: o.id, allocated_cost: m.value });
  }
  return { ok: true, rows };
}

// ── The live roll-up while a person types ───────────────────────────────────────────────────────────────────────────

/** Each item's allocated cost and what is left of the client's money, from what is typed on the leaves (a parent adds its sub-items; never counted twice). */
export function rollTyped(rows: readonly Pick<WbsRow, "id" | "parent_id" | "rolled">[], typed: Readonly<Record<string, string>>): Map<string, { allocated: number; left: number | null }> {
  const kids = new Map<string, string[]>();
  for (const r of rows) if (r.parent_id) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r.id]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, { allocated: number; left: number | null }>();
  const visit = (id: string): number => {
    const own = kids.get(id)?.length ? 0 : (() => { const v = typed[id]; const n = v === undefined || v.trim() === "" ? NaN : Number(v); return Number.isFinite(n) ? n : 0; })();
    const total = round2(own + (kids.get(id) ?? []).reduce((s, k) => s + visit(k), 0));
    const client = byId.get(id)?.rolled.client_amount ?? null;
    out.set(id, { allocated: total, left: client === null ? null : round2(client - total) });
    return total;
  };
  for (const r of rows) if (!r.parent_id || !byId.has(r.parent_id)) visit(r.id);
  return out;
}
