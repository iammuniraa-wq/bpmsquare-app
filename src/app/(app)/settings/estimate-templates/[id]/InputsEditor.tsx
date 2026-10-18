"use client";

import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import EditorRow from "@/components/estimator/EditorRow";
import { blankInput, issuesUnder, moveItem, type InputDraft, type OptionDraft } from "@/components/estimator/templateDraft";
import type { TemplateInputType } from "@/lib/estimator/types";
import type { TemplateIssue } from "@/lib/estimator/template";

function OptionsEditor({ options, onChange }: { options: OptionDraft[]; onChange: (o: OptionDraft[]) => void }) {
  const set = (i: number, patch: Partial<OptionDraft>) => onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="bpm-t-label" style={{ marginBottom: 6 }}>Options</div>
      {options.map((o, i) => (
        <div key={i} className="fg3" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr auto", gap: 8, marginBottom: 6, alignItems: "end" }}>
          <Input value={o.key} onChange={(e) => set(i, { key: e.target.value })} placeholder="key" aria-label="Option key" />
          <Input value={o.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Label" aria-label="Option label" />
          <Input type="number" step="any" value={o.value} onChange={(e) => set(i, { value: e.target.value })} placeholder="Number in formulas" aria-label="Option value" />
          <Button size="sm" variant="quiet" onClick={() => onChange(options.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange([...options, { key: "", label: "", value: String(options.length + 1) }])}>+ Add option</Button>
      <div className="bpm-t-help" style={{ marginTop: 4 }}>A formula sees the chosen option as its number, so a finish level can be a price multiplier.</div>
    </div>
  );
}

export default function InputsEditor({
  inputs, onChange, issues,
}: {
  inputs: InputDraft[];
  onChange: (next: InputDraft[]) => void;
  issues: TemplateIssue[];
}) {
  const set = (i: number, patch: Partial<InputDraft>) => onChange(inputs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  function setType(i: number, type: TemplateInputType) {
    const cur = inputs[i];
    const patch: Partial<InputDraft> = { type };
    if (type === "boolean") patch.default = "false";
    else if (type === "number") patch.default = Number.isFinite(Number(cur.default)) && cur.default.trim() !== "" ? cur.default : "0";
    else {
      const options = cur.options.length ? cur.options : [{ key: "standard", label: "Standard", value: "1" }];
      patch.options = options;
      patch.default = options[0].key;
    }
    set(i, patch);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="bpm-t-help" style={{ margin: 0 }}>
        What a person fills in when they make an estimate. The key is the name formulas use; keep it short, lower case, with underscores.
      </p>
      {inputs.map((inp, i) => (
        <EditorRow
          key={i} index={i} count={inputs.length} title={inp.label || inp.key}
          onMove={(d) => onChange(moveItem(inputs, i, d))}
          onRemove={() => onChange(inputs.filter((_, j) => j !== i))}
          problems={issuesUnder(issues, `inputs[${i}]`).map((x) => (x.field ? `${x.field}: ${x.message}` : x.message))}
        >
          <div className="fg2">
            <Field label="Key" required><Input value={inp.key} onChange={(e) => set(i, { key: e.target.value })} placeholder="floors" /></Field>
            <Field label="Label" required><Input value={inp.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Number of floors" /></Field>
            <Field label="Type">
              <Select value={inp.type} onChange={(e) => setType(i, e.target.value as TemplateInputType)}>
                <option value="number">Number</option>
                <option value="select">Choice</option>
                <option value="boolean">Yes / no</option>
              </Select>
            </Field>
            <Field label="Default">
              {inp.type === "number" && <Input type="number" step="any" value={inp.default} onChange={(e) => set(i, { default: e.target.value })} />}
              {inp.type === "boolean" && (
                <Select value={inp.default} onChange={(e) => set(i, { default: e.target.value })}>
                  <option value="false">No</option><option value="true">Yes</option>
                </Select>
              )}
              {inp.type === "select" && (
                <Select value={inp.default} onChange={(e) => set(i, { default: e.target.value })}>
                  {inp.options.map((o, k) => <option key={k} value={o.key}>{o.label || o.key || "(unnamed)"}</option>)}
                </Select>
              )}
            </Field>
            {inp.type === "number" && (
              <>
                <Field label="Minimum"><Input type="number" step="any" value={inp.min} onChange={(e) => set(i, { min: e.target.value })} /></Field>
                <Field label="Maximum"><Input type="number" step="any" value={inp.max} onChange={(e) => set(i, { max: e.target.value })} /></Field>
                <Field label="Unit"><Input value={inp.unit} onChange={(e) => set(i, { unit: e.target.value })} placeholder="m, m2, %" maxLength={20} /></Field>
              </>
            )}
            <Field label="Section" hint="The card this input appears under."><Input value={inp.section} onChange={(e) => set(i, { section: e.target.value })} placeholder="Building" /></Field>
          </div>
          <Field label="Help text"><Input value={inp.help} onChange={(e) => set(i, { help: e.target.value })} maxLength={300} /></Field>
          {inp.type === "select" && (
            <>
              <OptionsEditor options={inp.options} onChange={(options) => set(i, { options, default: options.some((o) => o.key === inp.default) ? inp.default : (options[0]?.key ?? "") })} />
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 4 }}>
                <input type="checkbox" checked={inp.quote_alternatives} onChange={(e) => set(i, { quote_alternatives: e.target.checked })} />
                Quote every option as an alternative (e.g. finish levels)
              </label>
            </>
          )}
        </EditorRow>
      ))}
      <div><Button variant="secondary" onClick={() => onChange([...inputs, blankInput()])}>+ Add input</Button></div>
    </div>
  );
}
