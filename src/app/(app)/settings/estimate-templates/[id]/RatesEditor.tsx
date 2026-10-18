"use client";

import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import EditorRow from "@/components/estimator/EditorRow";
import { blankRate, issuesUnder, moveItem, type RateDraft } from "@/components/estimator/templateDraft";
import type { TemplateIssue } from "@/lib/estimator/template";

export default function RatesEditor({
  rates, onChange, issues,
}: {
  rates: RateDraft[];
  onChange: (next: RateDraft[]) => void;
  issues: TemplateIssue[];
}) {
  const set = (i: number, patch: Partial<RateDraft>) => onChange(rates.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="bpm-t-help" style={{ margin: 0 }}>
        Named constants: a unit cost for a rule line (a rate per m3, a labour rate per hour) or a number used inside a formula (density, loads per truck).
        Prices and rates here are placeholders until you set your own.
      </p>
      {rates.map((r, i) => (
        <EditorRow
          key={i} index={i} count={rates.length} title={r.label || r.key}
          onMove={(d) => onChange(moveItem(rates, i, d))}
          onRemove={() => onChange(rates.filter((_, j) => j !== i))}
          problems={issuesUnder(issues, `rates[${i}]`).map((x) => (x.field ? `${x.field}: ${x.message}` : x.message))}
        >
          <div className="fg2">
            <Field label="Key" required><Input value={r.key} onChange={(e) => set(i, { key: e.target.value })} placeholder="concrete_per_m3" /></Field>
            <Field label="Label" required><Input value={r.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Concrete" /></Field>
            <Field label="Unit" required><Input value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} placeholder="per m3" maxLength={30} /></Field>
            <Field label="Value" required><Input type="number" step="any" value={r.value} onChange={(e) => set(i, { value: e.target.value })} /></Field>
          </div>
        </EditorRow>
      ))}
      <div><Button variant="secondary" onClick={() => onChange([...rates, blankRate()])}>+ Add rate</Button></div>
    </div>
  );
}
