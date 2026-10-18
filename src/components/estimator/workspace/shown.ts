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

export function liveTotals(preview: PreviewSuccess): EstimateTotals {
  return { ...preview.summary, unpriced: preview.unpriced, warnings: preview.warnings };
}

export function shownFromPreview(preview: PreviewSuccess | null): ShownData {
  if (!preview) return { lines: [], model: null, totals: null, live: true };
  return { lines: toWorkspaceLines(preview), model: preview.model, totals: liveTotals(preview), live: true };
}

/** Whether the typed inputs differ from the ones the estimate was last saved with. */
export function isDirty(storedParams: Record<string, unknown>, params: Record<string, unknown>, storedMargin: number, margin: string): boolean {
  const m = margin.trim() === "" ? 0 : Number(margin);
  if (m !== storedMargin) return true;
  const keys = new Set([...Object.keys(params), ...Object.keys(storedParams)]);
  for (const k of keys) {
    // An input left empty falls back to its default, so a stored value alone is not a change.
    if (!(k in params)) continue;
    if (params[k] !== storedParams[k]) return true;
  }
  return false;
}
