"use client";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import { blankDrawingRow, issuesUnder, type DrawingRowDraft, type InputDraft } from "@/components/estimator/templateDraft";
import type { DrawingMeasure } from "@/lib/estimator/types";
import type { TemplateIssue } from "@/lib/estimator/template";
import { DRAWING_TIPS } from "@/lib/estimator/drawing/tips";

const MEASURES: { id: DrawingMeasure; label: string }[] = [
  { id: "length_m", label: "Length (m)" },
  { id: "area_m2", label: "Area (m²)" },
  { id: "count", label: "Count" },
];

/**
 * The drawing layer map: which layers of a DXF drawing feed which number input (drawing intake). One row per input; the
 * explanations sit behind the "i" (docs/design/drawing-intake.md, rule 6b). Shown in the Inputs tab, next to the inputs.
 */
export default function DrawingEditor({
  rows, inputs, onChange, issues, available,
}: {
  rows: DrawingRowDraft[];
  inputs: InputDraft[];
  onChange: (next: DrawingRowDraft[]) => void;
  issues: TemplateIssue[];
  /** False while the database update (0215) has not been applied: the section says so instead of offering a map that cannot be saved. */
  available: boolean;
}) {
  if (!available) {
    return (
      <Card title="Drawing layers" info={DRAWING_TIPS.section}>
        <div className="bpm-t-help">Available after the next database update.</div>
      </Card>
    );
  }
  const numbers = inputs.filter((i) => i.type === "number" && i.key.trim() !== "");
  const set = (i: number, patch: Partial<DrawingRowDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const free = numbers.filter((n) => !rows.some((r) => r.input === n.key));
  return (
    <Card title="Drawing layers" info={DRAWING_TIPS.section} padding={14}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-guide="estimate-template.drawing-layers">
        {rows.length === 0 && <div className="bpm-t-help">No layers mapped. A DXF drawing will list its layers but fill nothing.</div>}
        {rows.map((r, i) => {
          const problems = issuesUnder(issues, `drawing_map[${i}]`).map((x) => (x.field ? `${x.field}: ${x.message}` : x.message));
          const known = numbers.some((n) => n.key === r.input);
          return (
            <div key={i} style={{ border: `1px solid ${problems.length ? "var(--err-line)" : "var(--line)"}`, borderRadius: 10, padding: 12 }}>
              <div className="fg3" style={{ alignItems: "end" }}>
                <Field label="Input" info={DRAWING_TIPS.input}>
                  <Select value={r.input} onChange={(e) => set(i, { input: e.target.value })} invalid={!!r.input && !known}>
                    <option value="">Choose…</option>
                    {numbers.map((n) => <option key={n.key} value={n.key} disabled={n.key !== r.input && rows.some((x) => x.input === n.key)}>{n.label || n.key}</option>)}
                    {!!r.input && !known && <option value={r.input}>{r.input}</option>}
                  </Select>
                </Field>
                <Field label="Measures" info={DRAWING_TIPS.measure}>
                  <Select value={r.measure} onChange={(e) => set(i, { measure: e.target.value as DrawingMeasure, ...(e.target.value !== "count" ? { blocks: "" } : {}) })}>
                    {MEASURES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </Select>
                </Field>
                <Field label="Layers" info={DRAWING_TIPS.layers}>
                  <Input value={r.layers} onChange={(e) => set(i, { layers: e.target.value })} placeholder="FENCE, BOUNDARY" maxLength={600} />
                </Field>
              </div>
              <div className="fg3" style={{ marginTop: 10, alignItems: "end" }}>
                {r.measure === "count" && (
                  <Field label="Blocks" info={DRAWING_TIPS.blocks}>
                    <Input value={r.blocks} onChange={(e) => set(i, { blocks: e.target.value })} placeholder="GATE" maxLength={600} />
                  </Field>
                )}
                {r.measure !== "count" && (
                  <Field label="Scale" info={DRAWING_TIPS.scale}>
                    <Input type="number" step="any" min="0" value={r.scale} onChange={(e) => set(i, { scale: e.target.value })} placeholder="From the drawing" />
                  </Field>
                )}
                <div style={{ display: "flex", alignItems: "end" }}>
                  <Button size="sm" variant="quiet" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove the row for ${r.input || "this input"}`}>Remove</Button>
                </div>
              </div>
              {problems.length > 0 && (
                <ul role="alert" style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--err-ink)" }}>
                  {problems.map((p, k) => <li key={k}>{p}</li>)}
                </ul>
              )}
            </div>
          );
        })}
        <div>
          <Button variant="secondary" disabled={free.length === 0} onClick={() => onChange([...rows, { ...blankDrawingRow(), input: free[0]?.key ?? "" }])}>+ Add layer</Button>
        </div>
      </div>
    </Card>
  );
}
