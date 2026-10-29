import { LINE_LIMITS, type BudgetLine, type DraftLine } from "./types";

// The budget rules of a contract project (slice 5a), pure: the amount of a line, the totals, the planned margin, the shape check of
// a saved set of lines, and the difference between two revisions. The routes, the screens and the tests share them.

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** A line's amount is quantity times unit cost, to 2 places. The server always recomputes it; a typed amount is never believed. */
export const lineAmount = (qty: number, unitCost: number): number => round2(qty * unitCost);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

export type CleanLines = { ok: true; lines: DraftLine[] } | { ok: false; error: string; row: number | null };

/**
 * The shape check of a set of lines from a request body. Codes are checked against the workspace's lists elsewhere (they need the
 * database); this refuses what cannot be a line at all: no description, a negative or enormous number, too many lines. The row is
 * 1-based so a screen can point at it.
 */
export function cleanDraftLines(raw: unknown): CleanLines {
  if (!Array.isArray(raw)) return { ok: false, error: "lines must be a list", row: null };
  if (raw.length > LINE_LIMITS.maxLines) return { ok: false, error: `A budget holds up to ${LINE_LIMITS.maxLines} lines`, row: null };
  const lines: DraftLine[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown> | null;
    const row = i + 1;
    if (!r || typeof r !== "object") return { ok: false, error: "Each line must be an object", row };
    const description = text(r.description, 500);
    if (!description) return { ok: false, error: "Every line needs a description", row };
    const qty = r.qty === undefined || r.qty === null || r.qty === "" ? 1 : num(r.qty);
    if (qty === null || qty < 0 || qty > LINE_LIMITS.maxQty) return { ok: false, error: "Quantity must be a number of 0 or more", row };
    const unitCost = r.unit_cost === undefined || r.unit_cost === null || r.unit_cost === "" ? 0 : num(r.unit_cost);
    if (unitCost === null || unitCost < 0 || unitCost > LINE_LIMITS.maxUnitCost) return { ok: false, error: "Unit cost must be a number of 0 or more", row };
    if (lineAmount(qty, unitCost) > LINE_LIMITS.maxAmount) return { ok: false, error: "That line is too large", row };
    const key = r.line_key;
    if (key !== undefined && key !== null && key !== "" && !isUuid(key)) return { ok: false, error: "line_key is not an id", row };
    lines.push({
      line_key: isUuid(key) ? key : null,
      resource_code: text(r.resource_code, 40),
      cost_code: text(r.cost_code, 40),
      wbs: text(r.wbs, 100),
      description,
      qty: Math.round(qty * 1000) / 1000,
      unit: text(r.unit, 30),
      unit_cost: round4(unitCost),
      cost_known: r.cost_known === false ? false : true,
      source_ref: text(r.source_ref, 300),
      reserve: r.reserve === true,
    });
  }
  const keys = lines.map((l) => l.line_key).filter((k): k is string => !!k);
  if (new Set(keys).size !== keys.length) return { ok: false, error: "Two lines share one line_key", row: null };
  return { ok: true, lines };
}

/** The resource and cost codes in `lines` that the workspace's lists do not hold (blank codes are fine: they are flagged, not refused). */
export function unknownCodes(lines: readonly Pick<DraftLine, "resource_code" | "cost_code">[], resources: ReadonlySet<string>, costCodes: ReadonlySet<string>): { resource: string[]; cost_code: string[] } {
  const bad = (set: ReadonlySet<string>, values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v && !set.has(v)))];
  return { resource: bad(resources, lines.map((l) => l.resource_code)), cost_code: bad(costCodes, lines.map((l) => l.cost_code)) };
}

// ── Totals ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type BudgetTotals = {
  lineCount: number;
  total: number;
  /** Of the total, the lines marked as reserve. */
  reserve: number;
  byResource: { code: string; amount: number }[];
  /** Lines whose cost is a guess (rate less the default margin), and what they add up to. */
  estimatedCount: number;
  estimatedAmount: number;
  /** Lines with no cost code, or no resource. */
  noCostCodeCount: number;
  noResourceCount: number;
};

export function budgetTotals(lines: readonly Pick<BudgetLine, "amount" | "resource_code" | "cost_code" | "cost_known" | "reserve">[]): BudgetTotals {
  const by = new Map<string, number>();
  let total = 0, reserve = 0, estimatedCount = 0, estimatedAmount = 0, noCostCodeCount = 0, noResourceCount = 0;
  for (const l of lines) {
    const a = Number(l.amount) || 0;
    total += a;
    if (l.reserve) reserve += a;
    if (!l.cost_known) { estimatedCount++; estimatedAmount += a; }
    if (!l.cost_code) noCostCodeCount++;
    if (!l.resource_code) noResourceCount++;
    const k = l.resource_code ?? "";
    by.set(k, (by.get(k) ?? 0) + a);
  }
  return {
    lineCount: lines.length, total: round2(total), reserve: round2(reserve),
    byResource: [...by.entries()].map(([code, amount]) => ({ code, amount: round2(amount) })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    estimatedCount, estimatedAmount: round2(estimatedAmount), noCostCodeCount, noResourceCount,
  };
}

/** Contract value less the budget. `pct` is of the contract value, or null while there is no contract value to compare with. */
export function plannedMargin(contractValue: number, budgetTotal: number): { amount: number; pct: number | null } {
  const amount = round2(contractValue - budgetTotal);
  return { amount, pct: contractValue > 0 ? Math.round(((contractValue - budgetTotal) / contractValue) * 1000) / 10 : null };
}

export type MarginState = "none" | "ok" | "low" | "over";

/**
 * How a planned margin reads against the workspace's floor: red (`over`) when negative, amber (`low`) under the floor, otherwise `ok`;
 * `none` while there is no margin to read. A workspace with no floor set never goes amber: there is no number here to fall back on.
 */
export function marginState(pct: number | null | undefined, floor: number | null | undefined): MarginState {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "none";
  if (pct < 0) return "over";
  return floor !== null && floor !== undefined && pct < floor ? "low" : "ok";
}

/** The workspace's margin floor (Settings > Contract projects): a number from 0 to 95, or null when none is set. */
export function readMarginFloor(config: { contract_projects?: { margin_floor_pct?: unknown } } | null | undefined): number | null {
  const v = config?.contract_projects?.margin_floor_pct;
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 95 ? n : null;
}

// ── The difference between two revisions ──────────────────────────────────────────────────────────────────────────

const DIFF_FIELDS = ["resource_code", "cost_code", "wbs", "description", "qty", "unit", "unit_cost", "amount", "reserve"] as const;
export type DiffField = (typeof DIFF_FIELDS)[number];

export type RevisionDiff = {
  added: BudgetLine[];
  removed: BudgetLine[];
  changed: { line_key: string; before: BudgetLine; after: BudgetLine; fields: DiffField[] }[];
  unchanged: number;
  totalBefore: number;
  totalAfter: number;
  delta: number;
  deltaPct: number | null;
};

const same = (a: unknown, b: unknown) => (typeof a === "number" || typeof b === "number" ? Number(a ?? 0) === Number(b ?? 0) : (a ?? null) === (b ?? null));

/** Lines are matched on line_key, which a copy of a revision keeps; a line with a new key is added, one whose key is gone is removed. */
export function diffRevisions(before: readonly BudgetLine[], after: readonly BudgetLine[]): RevisionDiff {
  const was = new Map(before.map((l) => [l.line_key, l]));
  const now = new Map(after.map((l) => [l.line_key, l]));
  const added = after.filter((l) => !was.has(l.line_key));
  const removed = before.filter((l) => !now.has(l.line_key));
  const changed: RevisionDiff["changed"] = [];
  let unchanged = 0;
  for (const l of after) {
    const b = was.get(l.line_key);
    if (!b) continue;
    const fields = DIFF_FIELDS.filter((f) => !same(b[f], l[f]));
    if (fields.length > 0) changed.push({ line_key: l.line_key, before: b, after: l, fields });
    else unchanged++;
  }
  const totalBefore = round2(before.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const totalAfter = round2(after.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  return {
    added, removed, changed, unchanged, totalBefore, totalAfter, delta: round2(totalAfter - totalBefore),
    deltaPct: totalBefore > 0 ? Math.round(((totalAfter - totalBefore) / totalBefore) * 1000) / 10 : null,
  };
}
