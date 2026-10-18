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
        &quot;Range (low / high)&quot; is optional: give both ends and the Build schedule and risk section of an estimate treats the rate as a risk driver (what-if sliders, the risk run and the tornado).
        Rates named cap_cast_m3_per_day, cap_trucks_loads_per_day, cap_crane_m3_per_day, transport_start_day and erection_start_day set the build schedule (defaults 18, 4, 24, day 5, day 6 when absent).
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
          <div className="fg2">
            <Field label="Range (low)" hint="Cheapest it is likely to be. Optional; give both ends or neither.">
              <Input type="number" step="any" value={r.low} onChange={(e) => set(i, { low: e.target.value })} placeholder="e.g. 297" />
            </Field>
            <Field label="Range (high)" hint="Dearest it is likely to be. Between low and high is the value above.">
              <Input type="number" step="any" value={r.high} onChange={(e) => set(i, { high: e.target.value })} placeholder="e.g. 412.5" />
            </Field>
          </div>
        </EditorRow>
      ))}
      <div><Button variant="secondary" onClick={() => onChange([...rates, blankRate()])}>+ Add rate</Button></div>
    </div>
  );
}
