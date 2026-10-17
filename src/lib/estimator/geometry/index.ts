// Geometry module registry and the bridge from pieces to the formula engine
// (docs/estimator-architecture.md §10.2).
//
// Geometry modules are the only coded, trade-specific part of the estimator.
// A template names one by key (`geometry: "precast_villa"`); adding a trade
// means adding a module here, never touching the engine. A template with no
// geometry module is formula-only and has no 3D model.

import { roundHalfAway } from "../formula";
import { PRECAST_VILLA_MODULE } from "./precastVilla";
import type { GeometryModel, GeometryModule, PieceFamilyTotals } from "./types";

export type { GeometryModel, GeometryModule, GeometryResult, Piece, PieceOpening, Vec3, PieceKind, PieceCodeInfo, PieceFamilyTotals } from "./types";

const MODULES: Readonly<Record<string, GeometryModule>> = {
  [PRECAST_VILLA_MODULE.key]: PRECAST_VILLA_MODULE,
};

export const GEOMETRY_KEYS: readonly string[] = Object.keys(MODULES);

/** The module for a key, or null for an unknown key (never a prototype property). */
export function getGeometry(key: string | null | undefined): GeometryModule | null {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(MODULES, key) ? MODULES[key] : null;
}

/** Used for weight_total when the template defines no density rate. */
export const DEFAULT_DENSITY_T_M3 = 2.4;

/** Names the module's pieces make available to formulas, besides the template's own. */
export const TOTAL_IDENTIFIERS = ["vol_total", "n_total", "area_total", "weight_total"] as const;

export function geometryIdentifiers(mod: GeometryModule): string[] {
  const out: string[] = [...TOTAL_IDENTIFIERS];
  for (const p of mod.piece_codes) out.push(`vol_${p.code}`, `n_${p.code}`, `area_${p.code}`);
  return out;
}

/** The density rate of a template: the first rate whose key ends density_t_m3. */
export function densityFromRates(rates: readonly { key: string; value: number }[]): number {
  const r = rates.find((x) => /density_t_m3$/.test(x.key));
  return r && Number.isFinite(r.value) && r.value > 0 ? r.value : DEFAULT_DENSITY_T_M3;
}

export function familyTotals(model: GeometryModel, code: string): PieceFamilyTotals {
  const mine = model.pieces.filter((p) => p.code === code);
  return {
    n: mine.length,
    vol: roundHalfAway(mine.reduce((a, p) => a + p.vol, 0), 3),
    area: roundHalfAway(mine.reduce((a, p) => a + (p.area ?? 0), 0), 3),
    first_mark: mine[0]?.id ?? null,
    last_mark: mine[mine.length - 1]?.id ?? null,
  };
}

/**
 * The numbers a model puts in the formula scope: vol_<code> (m3), n_<code>
 * (count) and area_<code> (m2) for every family the module can emit -- zero
 * when a family is absent -- plus vol_total, n_total, area_total and
 * weight_total (t = vol_total * density). Quantities are rounded to 3 dp, the
 * same as every other quantity the pipeline stores.
 */
export function pieceScope(mod: GeometryModule, model: GeometryModel, density: number): Record<string, number> {
  const scope: Record<string, number> = {};
  let vol = 0;
  let area = 0;
  let n = 0;
  for (const p of mod.piece_codes) {
    const t = familyTotals(model, p.code);
    scope[`vol_${p.code}`] = t.vol;
    scope[`n_${p.code}`] = t.n;
    scope[`area_${p.code}`] = t.area;
    vol += t.vol;
    area += t.area;
    n += t.n;
  }
  scope.vol_total = roundHalfAway(vol, 3);
  scope.n_total = n;
  scope.area_total = roundHalfAway(area, 3);
  scope.weight_total = roundHalfAway(scope.vol_total * density, 3);
  return scope;
}

/** "EW-01..EW-40" for a family, "EW-01" for one piece, null when absent. */
export function markRange(model: GeometryModel, code: string): string | null {
  const t = familyTotals(model, code);
  if (t.n === 0 || !t.first_mark || !t.last_mark) return null;
  return t.n === 1 ? t.first_mark : `${t.first_mark}..${t.last_mark}`;
}
