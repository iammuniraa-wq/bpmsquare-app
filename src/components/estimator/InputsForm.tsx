"use client";

import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import type { TemplateInput } from "@/lib/estimator/types";
import { SwatchChoice } from "./VisualPicker";

/** Form state: numbers stay text while typing so "1." and "" are possible. */
export type InputValues = Record<string, string | boolean>;

export type InputIssue = { path: string; message: string };

export const DEFAULT_SECTION = "Inputs";

export function initialValues(inputs: readonly TemplateInput[], stored?: Record<string, number | string | boolean> | null): InputValues {
  const out: InputValues = {};
  for (const i of inputs) {
    const v = stored && Object.prototype.hasOwnProperty.call(stored, i.key) ? stored[i.key] : i.default;
    out[i.key] = i.type === "boolean" ? v === true || v === "true" || v === 1 : String(v ?? "");
  }
  return out;
}

/** What the API takes: numbers as numbers, an empty box left out so the default applies. */
export function toParams(inputs: readonly TemplateInput[], values: InputValues): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const i of inputs) {
    const v = values[i.key];
    if (i.type === "boolean") out[i.key] = v === true;
    else if (i.type === "number") {
      const s = String(v ?? "").trim();
      if (s !== "") out[i.key] = Number(s);
    } else out[i.key] = String(v ?? "");
  }
  return out;
}

export function groupInputs(inputs: readonly TemplateInput[]): { section: string; items: TemplateInput[] }[] {
  const order: string[] = [];
  const map = new Map<string, TemplateInput[]>();
  for (const i of inputs) {
    const s = i.section?.trim() || DEFAULT_SECTION;
    if (!map.has(s)) { map.set(s, []); order.push(s); }
    map.get(s)!.push(i);
  }
  return order.map((section) => ({ section, items: map.get(section)! }));
}

function hintFor(i: TemplateInput): string | undefined {
  const parts: string[] = [];
  if (i.help) parts.push(i.help);
  if (i.type === "number" && (i.min !== undefined || i.max !== undefined)) {
    parts.push(i.min !== undefined && i.max !== undefined ? `Between ${i.min} and ${i.max}.` : i.min !== undefined ? `At least ${i.min}.` : `At most ${i.max}.`);
  }
  return parts.length ? parts.join(" ") : undefined;
}

function InputControl({
  input: i, value, onChange, error, disabled, note,
}: {
  input: TemplateInput;
  value: string | boolean | undefined;
  onChange: (key: string, value: string | boolean) => void;
  error?: string;
  /** What the email reading says about this input (missing or likely); shown in place of the usual hint. */
  note?: string;
  disabled: boolean;
}) {
  if (i.type === "boolean") {
    return (
      <Field label={i.label} hint={note ?? hintFor(i)} error={error}>
        <Select value={value === true ? "yes" : "no"} onChange={(e) => onChange(i.key, e.target.value === "yes")} disabled={disabled} invalid={!!error}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </Select>
      </Field>
    );
  }
  if (i.type === "select" && i.paints && (i.options ?? []).some((o) => o.visual)) {
    return (
      // htmlFor keeps the label a sibling: a label that wrapped the chips would nest labels and forward clicks to the first one.
      <Field label={i.label} htmlFor={`swatch-${i.key}`} hint={note ?? hintFor(i)} error={error}>
        <SwatchChoice label={i.label} options={i.options ?? []} value={String(value ?? "")} onChange={(k) => onChange(i.key, k)} disabled={disabled} />
      </Field>
    );
  }
  if (i.type === "select") {
    return (
      <Field label={i.label} hint={note ?? hintFor(i)} error={error}>
        <Select value={String(value ?? "")} onChange={(e) => onChange(i.key, e.target.value)} disabled={disabled} invalid={!!error}>
          {(i.options ?? []).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Select>
      </Field>
    );
  }
  return (
    <Field label={i.unit ? `${i.label} (${i.unit})` : i.label} hint={note ?? hintFor(i)} error={error}>
      <Input
        type="number" inputMode="decimal" step="any" min={i.min} max={i.max}
        value={String(value ?? "")} onChange={(e) => onChange(i.key, e.target.value)}
        disabled={disabled} invalid={!!error}
      />
    </Field>
  );
}

/**
 * The inputs generated from a template: one control per input by type, with a
 * small heading per section when the template has several. Issues from the API
 * (`params.<key>`) show under the field. Rendered inside the caller's card.
 */
export default function InputsForm({
  inputs, values, onChange, issues = [], disabled = false, notes,
}: {
  inputs: readonly TemplateInput[];
  values: InputValues;
  onChange: (key: string, value: string | boolean) => void;
  issues?: InputIssue[];
  disabled?: boolean;
  /** Per input key: a note to show instead of the hint (from reading an email). */
  notes?: Record<string, string>;
}) {
  if (inputs.length === 0) {
    return <div className="bpm-t-help">This template has no inputs; the quantities come from its rules and rates alone.</div>;
  }
  const sections = groupInputs(inputs);
  const errorOf = (key: string) => issues.find((x) => x.path === `params.${key}`)?.message;
  return (
    <div className="est-fields">
      {sections.map(({ section, items }) => (
        <div key={section}>
          {sections.length > 1 && <h3 className="bpm-t-label" style={{ margin: "4px 0 8px", color: "var(--muted)" }}>{section}</h3>}
          {items.map((i) => (
            <InputControl key={i.key} input={i} value={values[i.key]} onChange={onChange} error={errorOf(i.key)} disabled={disabled} note={notes?.[i.key]} />
          ))}
        </div>
      ))}
    </div>
  );
}
