"use client";

import { useEffect, useState } from "react";
import type { TemplateIssue } from "@/lib/estimator/template";
import type { TemplateExample } from "@/lib/estimator/editorCheck";
import type { EstimateTemplateBody } from "@/lib/estimator/types";

export type FormulaResult = {
  ok: boolean;
  errors: { message: string }[];
  unknown: string[];
  value: number | null;
  note: string | null;
};

export type CheckResult = {
  ok: boolean;
  issues: TemplateIssue[];
  warnings: TemplateIssue[];
  example: TemplateExample | null;
  example_issues: TemplateIssue[];
  formula?: FormulaResult;
};

export type CheckState = { loading: boolean; result: CheckResult | null; failed: string };

/**
 * Asks the server whether the template (and optionally one formula) is valid,
 * a moment after the last change. Nothing is saved. The result is for the
 * body it was asked about; while a newer ask is in flight `loading` is true.
 */
export function useTemplateCheck(body: EstimateTemplateBody & { geometry?: string }, formula: string | null, delayMs = 600): CheckState {
  const [state, setState] = useState<CheckState>({ loading: true, result: null, failed: "" });
  const key = JSON.stringify([body, formula]);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/estimate-templates/validate", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
          body: JSON.stringify({ ...body, ...(formula !== null && formula.trim() !== "" ? { formula } : {}) }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) setState({ loading: false, result: null, failed: json.error ?? "The check could not run." });
        else setState({ loading: false, result: json as CheckResult, failed: "" });
      } catch (e) {
        if ((e as { name?: string }).name !== "AbortError") setState({ loading: false, result: null, failed: "The check could not run." });
      }
    }, delayMs);
    return () => { clearTimeout(timer); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
