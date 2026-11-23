import { cleanBuildingCode, cleanElementCode, cleanTypeCode } from "./pattern";
import { ELEMENT_LIMITS } from "./types";
import { cleanQty } from "./quantity";

// The model comparison (docs/design/pcbs-buildings-elements.md section 2.4), pure. A model (or the drawings) says what buildings and elements
// there are and how many; this sets that beside the budget and says, per row: the same, a changed quantity, a new element, a new building, or
// "in the BOQ, not in the model". It never decides to write: the screen lets a person tick rows, and "Apply selected" is the only thing that does.
//
// The batch shape is the connector's: { source, model_ref, received_at, rows: [{ building_code?, building_name?, element_type, element_code?,
// qty, unit, drawing_no?, drawing_rev? }] }. A file in that shape works before any CAD connector exists; the connector later posts the same batch.

export const IMPORT_SOURCES = ["file", "connector", "hand"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export type BatchRow = {
  building_code: string | null;
  building_name: string | null;
  element_type: string | null;
  element_code: string | null;
  qty: number;
  unit: string | null;
  drawing_no: string | null;
  drawing_rev: string | null;
};
export type Batch = { source: ImportSource; model_ref: string | null; received_at: string | null; rows: BatchRow[] };

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export type BatchResult = { ok: true; batch: Batch } | { ok: false; error: string; row: number | null };

/** The shape check of a batch from a request. Codes are upper-cased; a row needs a quantity and an element type or an element code. */
export function parseBatch(raw: unknown, codeMax: number = ELEMENT_LIMITS.codeMaxDefault): BatchResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid body", row: null };
  const b = raw as Record<string, unknown>;
  const source = typeof b.source === "string" && (IMPORT_SOURCES as readonly string[]).includes(b.source) ? (b.source as ImportSource) : "file";
  if (!Array.isArray(b.rows) || b.rows.length === 0) return { ok: false, error: "The batch has no rows", row: null };
  if (b.rows.length > ELEMENT_LIMITS.maxModelRows) return { ok: false, error: `A comparison holds up to ${ELEMENT_LIMITS.maxModelRows} rows`, row: null };
  const received = typeof b.received_at === "string" && !Number.isNaN(Date.parse(b.received_at)) ? new Date(b.received_at).toISOString() : null;
  const rows: BatchRow[] = [];
  for (let i = 0; i < b.rows.length; i++) {
    const r = b.rows[i] as Record<string, unknown> | null;
    const row = i + 1;
    if (!r || typeof r !== "object") return { ok: false, error: "Each row must be an object", row };
    const bc = r.building_code === undefined || r.building_code === null || r.building_code === "" ? null : cleanBuildingCode(r.building_code);
    if (r.building_code && !bc) return { ok: false, error: "A building code is 1 to 6 letters or digits", row };
    const et = r.element_type === undefined || r.element_type === null || r.element_type === "" ? null : cleanTypeCode(r.element_type);
    if (r.element_type && !et) return { ok: false, error: "An element type is 2 to 5 letters or digits", row };
    let ec: string | null = null;
    if (r.element_code !== undefined && r.element_code !== null && r.element_code !== "") {
      const c = cleanElementCode(r.element_code, codeMax);
      if (!c.ok) return { ok: false, error: c.error, row };
      ec = c.code;
    }
    if (!et && !ec) return { ok: false, error: "A row needs an element type or an element code", row };
    const qty = cleanQty(r.qty, ELEMENT_LIMITS.qtyMax);
    if (qty === null) return { ok: false, error: "Quantity must be a number of 0 or more", row };
    rows.push({
      building_code: bc, building_name: text(r.building_name, 200), element_type: et, element_code: ec, qty,
      unit: text(r.unit, 30), drawing_no: text(r.drawing_no, 100), drawing_rev: text(r.drawing_rev, 30),
    });
  }
  return { ok: true, batch: { source, model_ref: text(b.model_ref, 200), received_at: received, rows } };
}

// ── Matching ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type CompareLine = {
  key: string;
  line_no: number;
  building_code: string | null;
  element_type: string | null;
  element_code: string | null;
  qty: number;
  unit: string | null;
  /** A cost-only category line: never matched (it inherits through its contract line). */
  is_category?: boolean;
};

export const MATCH_KINDS = ["same", "qty_changed", "new_element", "new_building", "not_in_model"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];
export const MATCH_LABEL: Record<MatchKind, string> = {
  same: "Same", qty_changed: "Quantity changed", new_element: "New element", new_building: "New building", not_in_model: "In the BOQ, not in the model",
};

export type MatchedRow = BatchRow & {
  row_no: number;
  kind: MatchKind;
  matched_key: string | null;
  /** The budget quantity of the matched line (null when nothing matched). */
  current_qty: number | null;
  /** Several lines fit this row (or two rows fit one line): nothing is applied for it until a person decides. */
  ambiguous: boolean;
};

const sameQty = (a: number, b: number) => Math.abs(a - b) < 0.0005;
const sameUnit = (a: string | null, b: string | null) => !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Per row of the model: by element code when it has one; else by building code + element type + unit, and only when exactly one uncoded line
 * of the budget fits. `buildings` is the set of building codes the project already has.
 */
export function matchRows(rows: readonly BatchRow[], lines: readonly CompareLine[], buildings: ReadonlySet<string>): MatchedRow[] {
  const real = lines.filter((l) => !l.is_category);
  const byCode = new Map(real.filter((l) => l.element_code).map((l) => [l.element_code as string, l]));
  const used = new Map<string, number>();
  const out: MatchedRow[] = rows.map((r, i) => {
    const base = { ...r, row_no: i + 1, matched_key: null as string | null, current_qty: null as number | null, ambiguous: false };
    let hit: CompareLine | null = null;
    let ambiguous = false;
    if (r.element_code) hit = byCode.get(r.element_code) ?? null;
    else {
      const fits = real.filter((l) => !l.element_code && l.element_type === r.element_type && (r.building_code ? l.building_code === r.building_code : true) && sameUnit(l.unit, r.unit));
      if (fits.length === 1) hit = fits[0];
      else if (fits.length > 1) ambiguous = true;
    }
    if (hit) {
      used.set(hit.key, (used.get(hit.key) ?? 0) + 1);
      return { ...base, matched_key: hit.key, current_qty: hit.qty, kind: sameQty(hit.qty, r.qty) ? ("same" as const) : ("qty_changed" as const) };
    }
    const unknownBuilding = !!r.building_code && !buildings.has(r.building_code);
    return { ...base, kind: unknownBuilding ? ("new_building" as const) : ("new_element" as const), ambiguous };
  });
  // Two rows that fit one line: neither is applied on its own.
  return out.map((m) => (m.matched_key && (used.get(m.matched_key) ?? 0) > 1 ? { ...m, ambiguous: true } : m));
}

/**
 * Lines of the budget the model does not mention, in the buildings the model does mention: flagged, never deleted, never zeroed. A partial
 * model (one building) does not flag the other buildings.
 */
export function missingFromModel(rows: readonly BatchRow[], matched: readonly MatchedRow[], lines: readonly CompareLine[]): MatchedRow[] {
  const mentioned = new Set(rows.map((r) => r.building_code).filter((c): c is string => !!c));
  const hit = new Set(matched.map((m) => m.matched_key).filter((k): k is string => !!k));
  const start = matched.length;
  return lines
    .filter((l) => !l.is_category && (l.element_code || l.element_type) && l.building_code && mentioned.has(l.building_code) && !hit.has(l.key))
    .sort((a, b) => a.line_no - b.line_no)
    .map((l, i) => ({
      building_code: l.building_code, building_name: null, element_type: l.element_type, element_code: l.element_code, qty: 0, unit: l.unit, drawing_no: null, drawing_rev: null,
      row_no: start + i + 1, kind: "not_in_model" as const, matched_key: l.key, current_qty: l.qty, ambiguous: false,
    }));
}

export type ApplyPlan = {
  /** A budget line whose model quantity (and, with it, the budget quantity) takes the model's number. */
  quantities: { row_no: number; line_key: string; from: number; to: number }[];
  /** A line to add for an element the budget does not have. */
  newElements: { row_no: number; building_code: string | null; element_type: string | null; element_code: string | null; qty: number; unit: string | null }[];
  /** A building to add first (level 1 of the WBS), proposed by the model and accepted by a person. */
  newBuildings: { code: string; name: string }[];
  /** Rows ticked that nothing can be done for, with the reason. */
  skipped: { row_no: number; reason: string }[];
};

/** What "Apply selected" would do with the ticked rows. Same rows and not-in-model rows are never written; an ambiguous row waits for a person. */
export function planApply(matched: readonly MatchedRow[], selected: ReadonlySet<number>): ApplyPlan {
  const plan: ApplyPlan = { quantities: [], newElements: [], newBuildings: [], skipped: [] };
  const buildings = new Map<string, string>();
  for (const m of matched) {
    if (!selected.has(m.row_no)) continue;
    if (m.kind === "same") continue;
    if (m.kind === "not_in_model") { plan.skipped.push({ row_no: m.row_no, reason: "In the BOQ, not in the model: nothing is changed or removed" }); continue; }
    if (m.ambiguous) { plan.skipped.push({ row_no: m.row_no, reason: "Several lines fit this row: decide it by hand" }); continue; }
    if (m.kind === "qty_changed" && m.matched_key && m.current_qty !== null) {
      plan.quantities.push({ row_no: m.row_no, line_key: m.matched_key, from: m.current_qty, to: m.qty });
      continue;
    }
    if (m.kind === "new_building" && m.building_code) buildings.set(m.building_code, m.building_name ?? m.building_code);
    plan.newElements.push({ row_no: m.row_no, building_code: m.building_code, element_type: m.element_type, element_code: m.element_code, qty: m.qty, unit: m.unit });
  }
  plan.newBuildings = [...buildings].map(([code, name]) => ({ code, name }));
  return plan;
}

/** A line of the plan in words, for the change log and the confirmation ("B01-HCS-0003 quantity 120 to 126"). */
export function planText(plan: ApplyPlan): string {
  const bits: string[] = [];
  if (plan.quantities.length) bits.push(`${plan.quantities.length} quantit${plan.quantities.length === 1 ? "y" : "ies"} changed`);
  if (plan.newElements.length) bits.push(`${plan.newElements.length} new element${plan.newElements.length === 1 ? "" : "s"}`);
  if (plan.newBuildings.length) bits.push(`${plan.newBuildings.length} new building${plan.newBuildings.length === 1 ? "" : "s"}`);
  return bits.length ? bits.join(", ") : "nothing to apply";
}
