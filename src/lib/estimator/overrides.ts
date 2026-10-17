// Hand edits to a COMPUTED estimate line must survive a recalculation.
//
// A recompute replaces every rule/schedule line with freshly computed ones
// (manual lines are kept as they are). Without this, an estimator who bumps a
// panel quantity by hand and later changes the floor count would silently lose
// the edit. So an edit to a computed line is stored on the line as
// `custom_data.override` (only the fields the user changed), and the next
// recompute re-applies it to the fresh line with the same rule code (and, for
// schedule rows, the same position among that code's lines).
//
// An override only adjusts that line and the totals. It does not feed other
// rules' formulas: `qty_<code>` always reads the computed quantity.
//
// Pure: no I/O. server.ts applies it between "compute" and "persist".

import { roundMoney, roundQty } from "./compute";
import { ESTIMATE_COMPONENTS } from "./types";
import type { EstimateComponent } from "./types";

export type LineOverride = {
  qty?: number;
  waste_pct?: number;
  unit_cost?: number | null;
  description?: string;
  uom?: string | null;
  component?: EstimateComponent;
  wbs_code?: string | null;
};

export const OVERRIDE_KEYS = ["qty", "waste_pct", "unit_cost", "description", "uom", "component", "wbs_code"] as const;

/** The editable fields of a stored line, as a route reads them from a body. */
export type LineEditResult = { ok: true; edit: LineOverride } | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Validate the allow-listed fields of a line edit (PATCH body or manual-line
 * body). Only keys present in `body` end up in the result; unknown keys are
 * ignored. Numbers are range-checked to what the columns can hold.
 */
export function parseLineEdit(body: Record<string, unknown>): LineEditResult {
  const edit: LineOverride = {};
  if ("qty" in body) {
    const q = typeof body.qty === "string" && body.qty.trim() !== "" ? Number(body.qty) : body.qty;
    if (!isNum(q) || q < 0 || q > 1e9) return { ok: false, error: "Quantity must be a number between 0 and 1,000,000,000." };
    edit.qty = roundQty(q);
  }
  if ("waste_pct" in body) {
    const w = typeof body.waste_pct === "string" && body.waste_pct.trim() !== "" ? Number(body.waste_pct) : body.waste_pct;
    if (!isNum(w) || w < 0 || w > 100) return { ok: false, error: "Waste must be between 0 and 100 percent." };
    edit.waste_pct = Math.round(w * 100) / 100;
  }
  if ("unit_cost" in body) {
    if (body.unit_cost === null || body.unit_cost === "") edit.unit_cost = null;
    else {
      const u = typeof body.unit_cost === "string" ? Number(body.unit_cost) : body.unit_cost;
      if (!isNum(u) || u < 0 || u > 1e9) return { ok: false, error: "Unit cost must be a number between 0 and 1,000,000,000, or empty." };
      edit.unit_cost = Math.round(u * 10000) / 10000;
    }
  }
  if ("description" in body) {
    if (typeof body.description !== "string" || !body.description.trim() || body.description.trim().length > 200) {
      return { ok: false, error: "Description is required (up to 200 characters)." };
    }
    edit.description = body.description.trim();
  }
  if ("uom" in body) {
    if (body.uom === null || body.uom === "") edit.uom = null;
    else if (typeof body.uom === "string" && body.uom.trim().length <= 20) edit.uom = body.uom.trim();
    else return { ok: false, error: "Unit must be up to 20 characters." };
  }
  if ("component" in body) {
    const c = ESTIMATE_COMPONENTS.find((x) => x === body.component);
    if (!c) return { ok: false, error: `Component must be one of: ${ESTIMATE_COMPONENTS.join(", ")}.` };
    edit.component = c;
  }
  if ("wbs_code" in body) {
    if (body.wbs_code === null || body.wbs_code === "") edit.wbs_code = null;
    else if (typeof body.wbs_code === "string" && /^[A-Za-z0-9._-]{1,30}$/.test(body.wbs_code.trim())) edit.wbs_code = body.wbs_code.trim();
    else return { ok: false, error: "WBS code may use letters, digits, dots, dashes and underscores (up to 30 characters)." };
  }
  return { ok: true, edit };
}

/** Cost of a line from its quantity, waste and unit cost (compute.ts rules). */
export function lineCost(qty: number, waste_pct: number, unit_cost: number | null): number | null {
  if (unit_cost === null) return null;
  return roundMoney(roundQty(qty * (1 + waste_pct / 100)) * unit_cost);
}

/** `code#0`, `code#1`: the n-th line of a rule code, in stored order. */
export function occurrenceKeys(lines: readonly { code: string | null }[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const code = l.code ?? "";
    const n = seen.get(code) ?? 0;
    seen.set(code, n + 1);
    return `${code}#${n}`;
  });
}

export function readOverride(customData: unknown): LineOverride | null {
  if (!customData || typeof customData !== "object") return null;
  const o = (customData as Record<string, unknown>).override;
  if (!o || typeof o !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const k of OVERRIDE_KEYS) if (k in (o as Record<string, unknown>)) out[k] = (o as Record<string, unknown>)[k];
  return Object.keys(out).length > 0 ? (out as LineOverride) : null;
}

/** The part of a stored/persisted line an override touches. */
export type OverridableRow = {
  code: string | null;
  description: string;
  uom: string | null;
  qty: number;
  waste_pct: number;
  unit_cost: number | null;
  cost_total: number | null;
  component: EstimateComponent | null;
  wbs_code: string | null;
  custom_data: Record<string, unknown> | null;
};

/**
 * Re-apply the overrides carried by the OLD computed lines to the FRESH ones.
 * Matching is by rule code and position among that code's lines. An override
 * with no fresh line to land on is reported in `dropped` (the rule went away,
 * or a schedule has fewer rows now) so the caller can warn.
 */
export function applyOverrides<T extends OverridableRow>(
  fresh: readonly T[],
  old: readonly { code: string | null; description: string; custom_data: Record<string, unknown> | null }[]
): { rows: T[]; dropped: string[] } {
  const wanted = new Map<string, { override: LineOverride; description: string }>();
  const oldKeys = occurrenceKeys(old);
  old.forEach((l, i) => {
    const o = readOverride(l.custom_data);
    if (o) wanted.set(oldKeys[i], { override: o, description: l.description });
  });
  if (wanted.size === 0) return { rows: [...fresh], dropped: [] };

  const freshKeys = occurrenceKeys(fresh);
  const used = new Set<string>();
  const rows = fresh.map((row, i) => {
    const hit = wanted.get(freshKeys[i]);
    if (!hit) return row;
    used.add(freshKeys[i]);
    const o = hit.override;
    const next: T = {
      ...row,
      qty: o.qty ?? row.qty,
      waste_pct: o.waste_pct ?? row.waste_pct,
      unit_cost: "unit_cost" in o ? (o.unit_cost ?? null) : row.unit_cost,
      description: o.description ?? row.description,
      uom: "uom" in o ? (o.uom ?? null) : row.uom,
      component: o.component ?? row.component,
      wbs_code: "wbs_code" in o ? (o.wbs_code ?? null) : row.wbs_code,
      custom_data: { ...(row.custom_data ?? {}), override: o },
    };
    next.cost_total = lineCost(next.qty, next.waste_pct, next.unit_cost);
    return next;
  });
  const dropped = [...wanted].filter(([k]) => !used.has(k)).map(([, v]) => v.description);
  return { rows, dropped };
}
