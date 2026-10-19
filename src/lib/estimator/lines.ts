// Mapping between the three shapes an estimate line takes: the computed line
// (compute.ts), the stored row (estimate_lines) and the inputs the builders
// want (summariseLines, the BOM/WBS export, the quote). Pure, no I/O.
//
// The stored row has no group display name and no SKU column, so those ride in
// `custom_data` as a snapshot (`group`, `sku`, and for schedule rows `label`),
// next to any `override` a person made (overrides.ts). A line therefore keeps
// the name and item number it was priced with even if the template or the
// product changes later.

import { roundHalfAway } from "./formula";
import type { ComputedLine, ScheduleQty } from "./compute";
import type { SummarisableLine } from "./compute";
import type { ExportLineInput } from "./exports";
import type { QuoteSourceLine } from "./quoteLines";
import type { OverridableRow } from "./overrides";
import { readOverride } from "./overrides";
import { groupSlug } from "./types";
import type { EstimateComponent } from "./types";
import type { EstimateLine } from "@/lib/types";

const asNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A row straight from PostgREST -> an EstimateLine with real numbers. */
export function normaliseLine(raw: Record<string, unknown>): EstimateLine {
  const r = raw as unknown as EstimateLine;
  return {
    ...r,
    sort_order: asNum(raw.sort_order) ?? 0,
    qty: asNum(raw.qty) ?? 0,
    waste_pct: asNum(raw.waste_pct) ?? 0,
    unit_cost: asNum(raw.unit_cost),
    cost_total: asNum(raw.cost_total),
    custom_data: raw.custom_data && typeof raw.custom_data === "object" ? (raw.custom_data as Record<string, unknown>) : null,
  };
}

const titleCase = (s: string) => s.replace(/_+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

/** group_key (slug) -> display name for the template's groups. */
export function templateGroupNames(rules: readonly { group: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rules) {
    const slug = groupSlug(r.group);
    if (!m.has(slug)) m.set(slug, r.group);
  }
  return m;
}

export function groupNameOf(line: Pick<EstimateLine, "group_key" | "custom_data">, templateGroups: ReadonlyMap<string, string>): string {
  const snap = line.custom_data?.group;
  if (typeof snap === "string" && snap.trim()) return snap;
  const key = line.group_key ?? "";
  return templateGroups.get(key) ?? (key ? titleCase(key) : "Ungrouped");
}

export const skuOf = (line: Pick<EstimateLine, "custom_data">): string | null => {
  const s = line.custom_data?.sku;
  return typeof s === "string" && s.trim() ? s : null;
};

/** What pricing learned about the product behind a line, kept on the line so the
 *  BOM export and the flags still read right after the product changes. */
export type ProductSnapshot = {
  sku: string | null;
  ref: string | null;
  /** A kit whose roll-up had components without a cost. */
  kit_incomplete?: boolean;
};

/** The snapshot a computed line is stored with. */
export function customDataFor(
  line: Pick<ComputedLine, "group" | "sku" | "source" | "qty">, label: string | null, product?: ProductSnapshot | null
): Record<string, unknown> {
  // The real item number wins over the key the template wrote (which may be a reference).
  const sku = product?.sku || line.sku;
  return {
    group: line.group,
    ...(sku ? { sku } : {}),
    ...(product?.ref ? { product_ref: product.ref } : {}),
    ...(product?.kit_incomplete ? { kit_incomplete: true } : {}),
    // The file's own quantity and label, so a recompute can rebuild the
    // schedule even after a person has hand-edited the line.
    ...(line.source === "schedule" ? { schedule_qty: line.qty, ...(label ? { label } : {}) } : {}),
  };
}

/** A computed line as the row that is persisted (and that overrides apply to). */
export type PersistLine = OverridableRow & {
  sort_order: number;
  group_key: string;
  source: ComputedLine["source"];
  element_ref: string | null;
  product_id: string | null;
};

export function persistLine(l: ComputedLine, productId: string | null, label: string | null, product?: ProductSnapshot | null): PersistLine {
  return {
    sort_order: l.sort_order,
    code: l.code,
    group_key: l.group_key,
    description: l.description,
    uom: l.uom,
    qty: l.qty,
    waste_pct: l.waste_pct,
    unit_cost: l.unit_cost,
    cost_total: l.cost_total,
    component: l.component,
    product_id: productId,
    source: l.source,
    element_ref: l.element_ref,
    wbs_code: l.wbs_code,
    custom_data: customDataFor(l, label, product),
  };
}

/** The product snapshot a stored line carries, to keep across a recalculation that does not reprice. */
export function snapshotOf(l: Pick<EstimateLine, "custom_data">): ProductSnapshot | null {
  const sku = typeof l.custom_data?.sku === "string" ? (l.custom_data.sku as string) : null;
  const ref = typeof l.custom_data?.product_ref === "string" ? (l.custom_data.product_ref as string) : null;
  if (!sku && !ref) return null;
  return { sku, ref, ...(l.custom_data?.kit_incomplete === true ? { kit_incomplete: true } : {}) };
}

export function toSummarisable(lines: readonly Pick<EstimateLine, "group_key" | "custom_data" | "component" | "cost_total">[], groups: ReadonlyMap<string, string>): SummarisableLine[] {
  return lines.map((l) => ({
    group: groupNameOf(l, groups),
    group_key: l.group_key ?? "ungrouped",
    component: l.component,
    cost_total: l.cost_total,
  }));
}

export function toExportLine(l: EstimateLine, groups: ReadonlyMap<string, string>): ExportLineInput {
  return {
    code: l.code,
    sku: skuOf(l),
    description: l.description,
    uom: l.uom,
    qty: l.qty,
    waste_pct: l.waste_pct,
    unit_cost: l.unit_cost,
    cost_total: l.cost_total,
    group: groupNameOf(l, groups),
    group_key: l.group_key,
    component: l.component as EstimateComponent | null,
    element_ref: l.element_ref,
    sort_order: l.sort_order,
  };
}

export function toQuoteSource(l: EstimateLine, groups: ReadonlyMap<string, string>): QuoteSourceLine & { sku: string | null; product_id: string | null } {
  return {
    description: l.description,
    uom: l.uom,
    qty: l.qty,
    waste_pct: l.waste_pct,
    group: groupNameOf(l, groups),
    group_key: l.group_key ?? "ungrouped",
    cost_total: l.cost_total,
    sku: skuOf(l),
    product_id: l.product_id,
  };
}

/** Codes of lines that still have no cost (the estimate is not quotable yet). */
export function unpricedCodes(lines: readonly EstimateLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.qty <= 0 || l.cost_total !== null) continue;
    const id = l.code ?? l.description;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The schedule the stored schedule lines came from (so a recompute that is
 *  not about the schedule keeps using it). */
export function scheduleFromLines(lines: readonly EstimateLine[]): ScheduleQty[] {
  return lines
    .filter((l) => l.source === "schedule" && l.code)
    .map((l) => {
      const label = typeof l.custom_data?.label === "string" ? (l.custom_data.label as string) : null;
      return { rule_code: l.code as string, qty: Number(l.custom_data?.schedule_qty ?? l.qty), element_ref: l.element_ref, label };
    });
}

/**
 * Unit costs worth keeping across a recompute that does not reprice: the stored
 * cost of each product rule, unless a person edited it by hand. The working page
 * uses them to show finish options for a saved estimate without asking the server.
 */
export function reusableCosts(lines: readonly EstimateLine[]): { costs: Record<string, number>; products: Record<string, string> } {
  const costs: Record<string, number> = {};
  const products: Record<string, string> = {};
  for (const l of lines) {
    if (l.source === "manual" || !l.code || !skuOf(l) || l.unit_cost === null || !l.product_id) continue;
    const o = readOverride(l.custom_data);
    if (o && "unit_cost" in o) continue; // the engine's cost is not what is stored
    if (!(l.code in costs)) { costs[l.code] = l.unit_cost; products[l.code] = l.product_id; }
  }
  return { costs, products };
}

export const round2 = (x: number) => roundHalfAway(x, 2);
