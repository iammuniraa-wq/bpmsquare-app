"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { previewEstimate, needsCatalogue } from "@/lib/estimator/preview";
import type { PreviewSuccess } from "@/lib/estimator/preview";
import type { ScheduleQty } from "@/lib/estimator/compute";
import type { TemplateIssue } from "@/lib/estimator/template";
import { toParams } from "@/components/estimator/InputsForm";
import type { InputValues } from "@/components/estimator/InputsForm";
import type { WorkspaceTemplate } from "./types";

/** Rate-priced templates recompute in the browser after a short pause for typing. */
export const LOCAL_DELAY_MS = 120;
/** Templates with product lines ask the server (which stores nothing) after this pause. */
export const CATALOGUE_DELAY_MS = 300;

export type LiveStatus = "ready" | "pricing" | "unavailable";

type Costs = { key: string; unit_costs: Record<string, number>; unresolved: string[]; unpriced: string[]; warnings: string[] };

export type LivePreview = {
  /** The latest preview that computed (kept while a newer edit does not). */
  preview: PreviewSuccess | null;
  /** Why the current inputs do not compute, if they do not. */
  issues: TemplateIssue[];
  status: LiveStatus;
  /** The template prices product lines from the catalogue. */
  catalogue: boolean;
  notes: string[];
  unresolved: string[];
};

/**
 * The page's price and model as the person types. Rate-priced templates run the
 * same pure code the server runs, right here; a template with product lines
 * asks POST /api/estimates/preview (debounced, stores nothing) for the unit
 * costs and applies them with that same code. `fixedUnitCosts` (a saved
 * estimate's own) skips the server.
 */
export function useLivePreview(a: {
  template: WorkspaceTemplate | null;
  values: InputValues;
  margin: string;
  vatPct: number;
  fixedUnitCosts?: Record<string, number>;
  schedule?: ScheduleQty[];
  enabled?: boolean;
}): LivePreview {
  const { template, values, margin, vatPct, fixedUnitCosts, schedule, enabled = true } = a;
  const params = useMemo(() => (template ? toParams(template.inputs, values) : {}), [template, values]);
  const marginNum = margin.trim() === "" ? 0 : Number(margin);
  const key = JSON.stringify([template?.id ?? null, params, marginNum]);

  const [settled, setSettled] = useState({ key, params, margin: marginNum });
  useEffect(() => {
    if (key === settled.key) return;
    const t = setTimeout(() => setSettled({ key, params, margin: marginNum }), LOCAL_DELAY_MS);
    return () => clearTimeout(t);
  }, [key, params, marginNum, settled.key]);

  const catalogue = !!template && !fixedUnitCosts && needsCatalogue(template);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const templateId = template?.id;
  useEffect(() => {
    if (!catalogue || !enabled || !templateId || !Number.isFinite(settled.margin)) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/estimates/preview", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
          body: JSON.stringify({ template_id: templateId, params: settled.params, margin_pct: settled.margin }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) { setCosts({ key: settled.key, unit_costs: json.unit_costs ?? {}, unresolved: json.unresolved ?? [], unpriced: json.unpriced ?? [], warnings: json.warnings ?? [] }); setFailed(null); }
        else if (res.status !== 422) setFailed(json.error ?? "Could not price from the catalogue.");
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") setFailed("Could not reach the server to price from the catalogue.");
      }
    }, CATALOGUE_DELAY_MS);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [catalogue, enabled, templateId, settled.key, settled.params, settled.margin]);

  const unitCosts = fixedUnitCosts ?? costs?.unit_costs;
  const result = useMemo(() => {
    if (!template || !enabled || !Number.isFinite(settled.margin)) return null;
    return previewEstimate({
      template: { ...(template.geometry ? { geometry: template.geometry } : {}), inputs: template.inputs, rates: template.rates, rules: template.rules },
      granularity: template.quote_granularity, params: settled.params, margin_pct: settled.margin,
      vat_pct: vatPct, unit_costs: unitCosts, schedule,
    });
  }, [template, enabled, settled, vatPct, unitCosts, schedule]);

  const lastGood = useRef<{ id: string | undefined; p: PreviewSuccess | null }>({ id: undefined, p: null });
  if (lastGood.current.id !== templateId) lastGood.current = { id: templateId, p: null };
  if (result?.ok) lastGood.current.p = result;

  const pricing = catalogue && enabled && (!costs || costs.key !== settled.key) && !failed;
  return {
    preview: result?.ok ? result : lastGood.current.p,
    issues: result && !result.ok ? result.issues : [],
    status: failed ? "unavailable" : pricing ? "pricing" : "ready",
    catalogue,
    notes: failed ? [failed] : costs?.warnings ?? [],
    unresolved: costs?.unresolved ?? [],
  };
}
