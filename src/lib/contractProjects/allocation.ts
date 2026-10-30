import { budgetTotals, isUuid, marginView, round2, round4, type BudgetTotals, type MarginView } from "./budget";
import { LINE_LIMITS, type AllocationBasis, type BudgetLine, type WorkPackageRow } from "./types";

// Allocating a project's budget (KAMCO feedback, decided 2026-10-29): the system never makes the budget, the person allocates it, by BOQ line
// or by work package. Planned margin = contract value less what has been allocated so far, live. PURE: no I/O and no server imports, so the
// routes, the screen and the tests share one set of rules.

export const PACKAGE_LIMITS = { codeMax: 20, nameMax: 200, noteMax: 1000, maxPerProject: 500 } as const;

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// ── Spreading a package's cost over its lines ───────────────────────────────────────────────────────────────────────

export type SpreadLine = { line_key: string; client_amount: number | null; qty: number };
export type Spread = { line_key: string; amount: number; unit_cost: number };

/**
 * A package's allocated cost laid over its lines, in proportion to what the client pays for each (equal shares when none of them knows
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

/** The lines that are in no work package. */
export function unassignedLines<L extends Pick<BudgetLine, "line_key">>(lines: readonly L[], packages: readonly Pick<WorkPackageRow, "line_keys">[]): L[] {
  const taken = new Set(packages.flatMap((p) => p.line_keys));
  return lines.filter((l) => !taken.has(l.line_key));
}

// ── The allocation as the screen shows it ───────────────────────────────────────────────────────────────────────────

export type LineRow = {
  line_key: string;
  /** The client's item number (the line's WBS reference). */
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
};

export type PackageRow = {
  id: string;
  code: string;
  name: string;
  owner_employee_id: string | null;
  owner_name: string | null;
  line_count: number;
  items: string[];
  client_amount: number | null;
  allocated_cost: number | null;
  allocated: boolean;
  left: number | null;
};

export type AllocationView = {
  basis: AllocationBasis;
  lineRows: LineRow[];
  packageRows: PackageRow[];
  totals: BudgetTotals;
  margin: MarginView;
  /** Lines in no work package (package mode lists them; line mode does not need them). */
  unassigned: { line_key: string; item: string | null; description: string }[];
  warnings: string[];
};

const leftOf = (client: number | null, allocated: number): number | null => (client === null ? null : round2(client - allocated));

export function allocationView(
  project: { allocation_basis: AllocationBasis; contract_value: number },
  lines: readonly BudgetLine[],
  packages: readonly WorkPackageRow[],
  floor: number | null,
): AllocationView {
  const totals = budgetTotals(lines);
  const byKey = new Map(lines.map((l) => [l.line_key, l]));
  const lineRows: LineRow[] = lines.map((l) => {
    const amount = l.allocated ? l.amount : 0;
    const missing: LineRow["missing"] = [...(l.resource_code ? [] : ["resource type" as const]), ...(l.cost_code ? [] : ["cost code" as const])];
    return { line_key: l.line_key, item: l.wbs, description: l.description, missing, qty: l.qty, unit: l.unit, client_amount: l.client_amount, amount, allocated: l.allocated, left: leftOf(l.client_amount, amount) };
  });
  const packageRows: PackageRow[] = packages.map((p) => {
    const held = p.line_keys.map((k) => byKey.get(k)).filter((l): l is BudgetLine => !!l);
    const known = held.filter((l) => l.client_amount !== null);
    const client = known.length > 0 ? round2(known.reduce((s, l) => s + (l.client_amount ?? 0), 0)) : null;
    const cost = p.allocated_cost ?? 0;
    return {
      id: p.id, code: p.code, name: p.name, owner_employee_id: p.owner_employee_id, owner_name: p.owner_name, line_count: held.length,
      items: held.map((l) => l.wbs ?? l.description), client_amount: client, allocated_cost: p.allocated_cost, allocated: p.allocated_cost !== null, left: leftOf(client, cost),
    };
  });
  const unassigned = unassignedLines(lines, packages).map((l) => ({ line_key: l.line_key, item: l.wbs, description: l.description }));
  const warnings: string[] = [];
  if (project.allocation_basis === "package" && unassigned.length > 0) warnings.push(`${unassigned.length} line${unassigned.length === 1 ? " is" : "s are"} not in a work package`);
  return { basis: project.allocation_basis, lineRows, packageRows, totals, margin: marginView(project.contract_value, totals, floor), unassigned, warnings };
}

// ── A work package from a request body ──────────────────────────────────────────────────────────────────────────────

export type WorkPackageInput = { code: string; name: string; owner_employee_id: string | null; line_keys: string[]; note: string | null };
export type ParsedPackage = { ok: true; value: Partial<WorkPackageInput> } | { ok: false; error: string };

/**
 * A create (code and name required) or an edit (any subset). `validLineKeys` are the line_keys of the revision being worked on: a package
 * can only hold lines that are there. The owner's id is checked against the workspace (and for a login) by the server, not here.
 */
export function parseWorkPackage(body: unknown, validLineKeys: ReadonlySet<string>, mode: "create" | "update"): ParsedPackage {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const value: Partial<WorkPackageInput> = {};
  if ("code" in b || mode === "create") {
    const code = text(b.code, PACKAGE_LIMITS.codeMax);
    if (!code) return { ok: false, error: "Give the work package a code" };
    value.code = code;
  }
  if ("name" in b || mode === "create") {
    const name = text(b.name, PACKAGE_LIMITS.nameMax);
    if (!name) return { ok: false, error: "Give the work package a name" };
    value.name = name;
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
  if (raw.length > PACKAGE_LIMITS.maxPerProject) return { ok: false, error: `A project holds up to ${PACKAGE_LIMITS.maxPerProject} work packages` };
  const rows: PackageAllocation[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    if (!isUuid(o.id)) return { ok: false, error: "Each row needs a package id" };
    if (seen.has(o.id)) return { ok: false, error: "A package appears twice" };
    seen.add(o.id);
    const m = money(o.allocated_cost);
    if (!m.ok) return { ok: false, error: "A cost is a number of 0 or more" };
    rows.push({ id: o.id, allocated_cost: m.value });
  }
  return { ok: true, rows };
}
