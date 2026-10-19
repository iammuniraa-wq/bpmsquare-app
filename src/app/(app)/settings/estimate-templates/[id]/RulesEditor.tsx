"use client";

import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import EditorRow from "@/components/estimator/EditorRow";
import { blankRule, issuesUnder, moveItem, type RuleDraft, type RateDraft } from "@/components/estimator/templateDraft";
import { ESTIMATE_COMPONENTS, ESTIMATE_COMPONENT_LABEL, type EstimateComponent } from "@/lib/estimator/types";
import type { TemplateIssue } from "@/lib/estimator/template";
import type { FormulaResult } from "@/components/estimator/useTemplateCheck";
import FormulaBox from "./FormulaBox";

export default function RulesEditor({
  rules, rates, onChange, issues, active, onActive, formula, formulaLoading,
}: {
  rules: RuleDraft[];
  rates: RateDraft[];
  onChange: (next: RuleDraft[]) => void;
  issues: TemplateIssue[];
  /** The rule whose formula box was focused last. */
  active: number | null;
  onActive: (i: number) => void;
  formula: FormulaResult | undefined;
  formulaLoading: boolean;
}) {
  const set = (i: number, patch: Partial<RuleDraft>) => onChange(rules.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const groups = [...new Set(rules.map((r) => r.group.trim()).filter(Boolean))];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="bpm-t-help" style={{ margin: 0 }}>
        Rules run top to bottom, and a rule can only read lines above it. Each one gives a quantity (a formula) and a cost, either a catalogue product by item number
        (priced by the pricing engine) or one of your rates times the quantity.
      </p>
      <datalist id="rule-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      {rules.map((r, i) => (
        <EditorRow
          key={i} index={i} count={rules.length} title={r.description || r.code}
          onMove={(d) => onChange(moveItem(rules, i, d))}
          onRemove={() => onChange(rules.filter((_, j) => j !== i))}
          problems={issuesUnder(issues, `rules[${i}]`).map((x) => (x.field ? `${x.field}: ${x.message}` : x.message))}
        >
          <div className="fg2">
            <Field label="Code" required hint="Lower case; later formulas read this line as qty_<code>."><Input value={r.code} onChange={(e) => set(i, { code: e.target.value })} placeholder="concrete" /></Field>
            <Field label="Group" required hint="Lines with the same group are subtotalled and quoted together."><Input value={r.group} onChange={(e) => set(i, { group: e.target.value })} list="rule-groups" placeholder="Structure" /></Field>
            <Field label="Description" required><Input value={r.description} onChange={(e) => set(i, { description: e.target.value })} maxLength={200} /></Field>
            <Field label="Unit" required><Input value={r.uom} onChange={(e) => set(i, { uom: e.target.value })} placeholder="m3" maxLength={20} /></Field>
          </div>
          <FormulaBox
            id={`rule-qty-${i}`} value={r.qty} onChange={(v) => set(i, { qty: v })} onFocus={() => onActive(i)}
            active={active === i} result={active === i ? formula : undefined} loading={formulaLoading}
          />
          <div className="fg2">
            <Field label="Waste %" hint="A number, or a formula. Cost is charged on quantity plus waste."><Input value={r.waste_pct} onChange={(e) => set(i, { waste_pct: e.target.value })} placeholder="0" /></Field>
            <Field label="Cost component">
              <Select value={r.component} onChange={(e) => set(i, { component: e.target.value as EstimateComponent })}>
                {ESTIMATE_COMPONENTS.map((k) => <option key={k} value={k}>{ESTIMATE_COMPONENT_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="Cost comes from">
              <Select value={r.costKind} onChange={(e) => set(i, { costKind: e.target.value as "product" | "rate" })}>
                <option value="rate">A rate of this template</option>
                <option value="product">A catalogue product or kit</option>
              </Select>
            </Field>
            {r.costKind === "rate" ? (
              <Field label="Rate" required>
                <Select value={r.rate} onChange={(e) => set(i, { rate: e.target.value })}>
                  <option value="">— Choose a rate —</option>
                  {rates.filter((x) => x.key.trim()).map((x) => <option key={x.key} value={x.key.trim()}>{x.label || x.key} ({x.unit || "no unit"})</option>)}
                  {r.rate && !rates.some((x) => x.key.trim() === r.rate) && <option value={r.rate}>{r.rate} (not defined)</option>}
                </Select>
              </Field>
            ) : (
              <Field label="Product SKU or reference" required hint="A SKU or a product reference such as PRD-0012. A BOM / kit is costed from its components."><Input value={r.sku} onChange={(e) => set(i, { sku: e.target.value })} placeholder="STEEL-REBAR-12" /></Field>
            )}
            <Field label="Element type" hint="Optional. Rows of this type in an imported schedule supply this line's quantity."><Input value={r.element_type} onChange={(e) => set(i, { element_type: e.target.value })} placeholder="external wall panel" /></Field>
          </div>
        </EditorRow>
      ))}
      <div><Button variant="secondary" onClick={() => onChange([...rules, blankRule()])}>+ Add rule</Button></div>
    </div>
  );
}
