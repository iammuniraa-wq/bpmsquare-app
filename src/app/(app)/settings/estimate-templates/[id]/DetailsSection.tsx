"use client";

import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { GEOMETRY_KEYS, getGeometry } from "@/lib/estimator/geometry";
import type { TemplateDraft } from "@/components/estimator/templateDraft";
import type { QuoteGranularity } from "@/lib/estimator/types";

export default function DetailsSection({
  draft, onChange,
}: {
  draft: TemplateDraft;
  onChange: (patch: Partial<TemplateDraft>) => void;
}) {
  const mod = getGeometry(draft.geometry);
  const defined = new Set(draft.inputs.map((i) => i.key.trim()));
  const missing = (mod?.inputs ?? []).filter((i) => i.required && !defined.has(i.key)).map((i) => i.key);

  return (
    <>
      <Card title="Template" padding={18}>
        <Field label="Name" required>
          <Input value={draft.name} onChange={(e) => onChange({ name: e.target.value })} maxLength={120} />
        </Field>
        <Field label="Description" hint="Shown to people choosing a template. Say if it is illustrative.">
          <Textarea value={draft.description} onChange={(e) => onChange({ description: e.target.value })} rows={3} maxLength={2000} />
        </Field>
        <div className="fg2">
          <Field label="Trade" hint="Free text, e.g. precast, fencing, roofing.">
            <Input value={draft.trade} onChange={(e) => onChange({ trade: e.target.value })} maxLength={60} />
          </Field>
          <Field label="Quote granularity" hint="What the customer sees: one line per group, or every BOM line.">
            <Select value={draft.quote_granularity} onChange={(e) => onChange({ quote_granularity: e.target.value as QuoteGranularity })}>
              <option value="group">One line per group</option>
              <option value="line">One line per BOM line</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Geometry module" padding={18}>
        <Field label="Module" hint="A coded building model that turns the inputs into real pieces (marks, volumes) the rules can price. Leave empty for a formula-only template.">
          <Select value={draft.geometry} onChange={(e) => onChange({ geometry: e.target.value })}>
            <option value="">None (formula-only)</option>
            {GEOMETRY_KEYS.map((k) => <option key={k} value={k}>{getGeometry(k)?.label ?? k}</option>)}
          </Select>
        </Field>
        {draft.geometry && !mod && (
          <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>"{draft.geometry}" is not a geometry module this product has.</div>
        )}
        {mod && (
          <div className="bpm-t-help">
            <div>Piece families: {mod.piece_codes.map((p) => `${p.code} (${p.label})`).join(", ")}.</div>
            <div style={{ marginTop: 4 }}>
              Inputs it reads: {mod.inputs.map((i) => `${i.key}${i.required ? " (required)" : ` (optional${i.default !== undefined ? `, default ${i.default}` : ""})`}`).join(", ")}.
            </div>
            {missing.length > 0 && (
              <div role="alert" style={{ marginTop: 4, color: "var(--err-ink)" }}>This template does not define: {missing.join(", ")}. Add them on the Inputs tab.</div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
