"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import InputsForm, { initialValues, toParams, type InputValues, type InputIssue } from "@/components/estimator/InputsForm";
import type { TemplateInput } from "@/lib/estimator/types";

export default function InputsTab({
  estimateId, inputs, params, marginPct, locked, canEdit, outdated, templateMissing,
}: {
  estimateId: string;
  inputs: TemplateInput[];
  params: Record<string, number | string | boolean>;
  marginPct: number;
  locked: boolean;
  canEdit: boolean;
  outdated: boolean;
  templateMissing: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<InputValues>(() => initialValues(inputs, params));
  const [margin, setMargin] = useState(String(marginPct));
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<InputIssue[]>([]);
  const [done, setDone] = useState("");

  const stored = useMemo(() => JSON.stringify(toParams(inputs, initialValues(inputs, params))), [inputs, params]);
  const paramsChanged = JSON.stringify(toParams(inputs, values)) !== stored;
  const marginChanged = Number(margin) !== marginPct;
  const readOnly = locked || !canEdit;

  function recalc() {
    setError(""); setIssues([]); setDone("");
    if (margin.trim() === "" || !Number.isFinite(Number(margin)) || Number(margin) < 0) { setError("Margin must be zero or more."); return; }
    startTransition(async () => {
      let res: Response;
      if (paramsChanged || marginChanged) {
        const body: Record<string, unknown> = {};
        if (paramsChanged) body.params = toParams(inputs, values);
        if (marginChanged) body.margin_pct = Number(margin);
        res = await fetch(`/api/estimates/${estimateId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      } else {
        res = await fetch(`/api/estimates/${estimateId}/calculate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not recalculate.");
        if (Array.isArray(json.issues)) setIssues(json.issues as InputIssue[]);
        return;
      }
      setDone("Recalculated. The BOM, costing and totals are up to date.");
      router.refresh();
    });
  }

  if (templateMissing) {
    return <Card><div className="bpm-t-help">This estimate's template was deleted, so its inputs can't be shown or recalculated. Its lines and totals are kept as they were.</div></Card>;
  }

  return (
    <>
      {locked && (
        <Card padding={14}>
          <div style={{ fontSize: 13 }}>
            <strong>Locked.</strong> This estimate already has a quote, so its inputs can no longer change. To revise the numbers, duplicate the estimate and quote the copy.
          </div>
        </Card>
      )}
      {outdated && !locked && (
        <Card padding={14}>
          <div style={{ fontSize: 13 }}>The template has changed since this estimate was calculated. Recalculate to use the current version; manual lines and hand edits are kept.</div>
        </Card>
      )}
      <InputsForm inputs={inputs} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} issues={issues} disabled={readOnly || pending} />
      <Card title="Margin" padding={18}>
        <Field label="Margin %" hint="Added on top of cost to give the price." style={{ marginBottom: 0 }}>
          <Input type="number" inputMode="decimal" step="any" min={0} max={1000} value={margin} onChange={(e) => setMargin(e.target.value)} disabled={readOnly || pending} />
        </Field>
      </Card>
      {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
      {done && !error && <div role="status" className="bpm-t-help">{done}</div>}
      {!readOnly && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" loading={pending} onClick={recalc}>Recalculate</Button>
        </div>
      )}
    </>
  );
}
