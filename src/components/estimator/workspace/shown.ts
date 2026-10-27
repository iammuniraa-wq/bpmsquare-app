import type { PreviewSuccess } from "@/lib/estimator/preview";
import type { EstimateTotals } from "@/lib/types";
import type { ShownData, WorkspaceLine } from "./types";

/** A computed line, slimmed to what the viewer, the schedule and the risk run read. */
export function toWorkspaceLines(preview: PreviewSuccess): WorkspaceLine[] {
  return preview.lines.map((l) => ({
    code: l.code, group_key: l.group_key, component: l.component, uom: l.uom, qty: l.qty,
    cost_total: l.cost_total, source: l.source, description: l.description, element_ref: l.element_ref,
  }));
}

/** The model of a blank new estimate (starting sizes), with no cost lines and no totals: the page draws it but shows no price. */
export function shownBlank(preview: PreviewSuccess | null): ShownData {
  if (!preview) return { lines: [], model: null, totals: null, live: true };
  return { lines: [], model: preview.model, totals: null, live: true };
}

export function liveTotals(preview: PreviewSuccess): EstimateTotals {
  return { ...preview.summary, unpriced: preview.unpriced, warnings: preview.warnings };
}

export function shownFromPreview(preview: PreviewSuccess | null): ShownData {
  if (!preview) return { lines: [], model: null, totals: null, live: true };
  return { lines: toWorkspaceLines(preview), model: preview.model, totals: liveTotals(preview), live: true };
}

/** Whether any typed input differs from the one the estimate was last saved with (the margin is not an input). */
export function inputsChanged(storedParams: Record<string, unknown>, params: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(params), ...Object.keys(storedParams)]);
  for (const k of keys) {
    // An input left empty falls back to its default, so a stored value alone is not a change.
    if (!(k in params)) continue;
    if (params[k] !== storedParams[k]) return true;
  }
  return false;
}

/** Whether the typed inputs differ from the ones the estimate was last saved with. */
export function isDirty(storedParams: Record<string, unknown>, params: Record<string, unknown>, storedMargin: number, margin: string): boolean {
  const m = margin.trim() === "" ? 0 : Number(margin);
  if (m !== storedMargin) return true;
  return inputsChanged(storedParams, params);
}

/**
 * The unit costs a saved estimate may carry into its live preview. They are keyed by rule code and were found for the inputs the
 * estimate was saved with (which pipe, which diameter), so they are valid only while those inputs are unchanged: after an edit the
 * preview must ask the catalogue again, or it prices the new quantities at the old product's cost (the 2026-10-27 live bug, where a
 * steel DN300 pipe's rate priced an HDPE DN600 pipeline and the page showed 411,482 against a saved cost of 741,650.55).
 */
export function carriedUnitCosts(saved: { storedParams: Record<string, unknown>; unitCosts: Record<string, number> } | undefined, params: Record<string, unknown>): Record<string, number> | undefined {
  if (!saved) return undefined;
  return inputsChanged(saved.storedParams, params) ? undefined : saved.unitCosts;
}
