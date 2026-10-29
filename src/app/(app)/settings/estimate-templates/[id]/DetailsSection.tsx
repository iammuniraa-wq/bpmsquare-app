"use client";

import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { GEOMETRY_KEYS, getGeometry } from "@/lib/estimator/geometry";
import { ROLE_LABEL, inferVisualMapping } from "@/lib/estimator/visual";
import { VISUAL_TIPS } from "@/lib/estimator/visualTips";
import type { TemplateDraft } from "@/components/estimator/templateDraft";
import { VISUAL_ROLES } from "@/lib/estimator/types";
import type { QuoteGranularity, TemplateInput } from "@/lib/estimator/types";

type PictureMode = "bespoke" | "inputs" | "none";

/** The number inputs of the draft, as the picture mapping can name them. */
function numberInputs(draft: TemplateDraft): TemplateInput[] {
  return draft.inputs.filter((i) => i.type === "number" && i.key.trim()).map((i) => ({ key: i.key.trim(), label: i.label.trim() || i.key.trim(), type: "number", default: 0, unit: i.unit.trim() || undefined }));
}

export default function DetailsSection({
  draft, onChange, visualAvailable = true,
}: {
  draft: TemplateDraft;
  onChange: (patch: Partial<TemplateDraft>) => void;
  /** False while migration 0235 is pending: the picture settings cannot be saved. */
  visualAvailable?: boolean;
}) {
  const mod = getGeometry(draft.geometry);
  const mode: PictureMode = draft.geometry ? "bespoke" : draft.picture_off ? "none" : "inputs";
  const numbers = numberInputs(draft);
  const own = VISUAL_ROLES.some((r) => !!draft.visual[r]);
  const shown = own ? draft.visual : inferVisualMapping(numbers);
  const setMode = (m: PictureMode) => {
    if (m === "bespoke") onChange({ geometry: draft.geometry || GEOMETRY_KEYS[0] || "", picture_off: false });
    else onChange({ geometry: "", picture_off: m === "none" });
  };
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
          <Field label="Quote granularity" hint="What the customer sees: one line per group, or every bill of materials line.">
            <Select value={draft.quote_granularity} onChange={(e) => onChange({ quote_granularity: e.target.value as QuoteGranularity })}>
              <option value="group">One line per group</option>
              <option value="line">One line per bill of materials line</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Visual" padding={18}>
        <Field label="Picture" info={VISUAL_TIPS.picture}>
          <Select value={mode} onChange={(e) => setMode(e.target.value as PictureMode)}>
            <option value="bespoke">Built-in model</option>
            <option value="inputs">Built from the inputs</option>
            <option value="none">None</option>
          </Select>
        </Field>
        {mode !== "bespoke" && !visualAvailable && (
          <div role="status" className="bpm-t-help">The picture settings need a database update before they can be saved. Until then the picture follows your inputs.</div>
        )}
        {mode === "inputs" && (
          <>
            <div className="bpm-t-label" style={{ margin: "4px 0 6px" }}>
              Picture follows <InfoTip label="picture follows">{VISUAL_TIPS.mapping}</InfoTip>
            </div>
            <div className="fg2">
              {VISUAL_ROLES.map((r) => (
                <Field key={r} label={ROLE_LABEL[r]}>
                  <Select value={shown[r] ?? ""} disabled={numbers.length === 0}
                    onChange={(e) => onChange({ visual: Object.fromEntries(VISUAL_ROLES.map((x) => [x, x === r ? e.target.value : shown[x] ?? ""]).filter(([, v]) => !!v)) })}>
                    <option value="">Not used</option>
                    {numbers.map((i) => <option key={i.key} value={i.key}>{i.label}{i.unit ? ` (${i.unit})` : ""}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            {numbers.length === 0 && <div className="bpm-t-help">Add a number input first; the picture is drawn from sizes and counts.</div>}
          </>
        )}
        {mode === "bespoke" && (
          <>
            <Field label="Model">
              <Select value={draft.geometry} onChange={(e) => onChange({ geometry: e.target.value })}>
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
          </>
        )}
      </Card>
    </>
  );
}
