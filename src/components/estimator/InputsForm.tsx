"use client";

import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import type { TemplateInput } from "@/lib/estimator/types";

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

/**
 * The inputs form generated from a template: one card per section, a control
 * per input by type. Issues from the API (`params.<key>`) show under the field.
 */
export default function InputsForm({
  inputs, values, onChange, issues = [], disabled = false,
}: {
  inputs: readonly TemplateInput[];
  values: InputValues;
  onChange: (key: string, value: string | boolean) => void;
  issues?: InputIssue[];
  disabled?: boolean;
}) {
  if (inputs.length === 0) {
    return <Card><div className="bpm-t-help">This template has no inputs; the quantities come from its rules and rates alone.</div></Card>;
  }
  const errorOf = (key: string) => issues.find((x) => x.path === `params.${key}`)?.message;
  return (
    <>
      {groupInputs(inputs).map(({ section, items }) => (
        <Card key={section} title={section} padding={18}>
          <div className="fg2">
            {items.map((i) => {
              const err = errorOf(i.key);
              if (i.type === "boolean") {
                return (
                  <Field key={i.key} label={i.label} hint={hintFor(i)} error={err}>
                    <Select value={values[i.key] === true ? "yes" : "no"} onChange={(e) => onChange(i.key, e.target.value === "yes")} disabled={disabled} invalid={!!err}>
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </Select>
                  </Field>
                );
              }
              if (i.type === "select") {
                return (
                  <Field key={i.key} label={i.label} hint={hintFor(i)} error={err}>
                    <Select value={String(values[i.key] ?? "")} onChange={(e) => onChange(i.key, e.target.value)} disabled={disabled} invalid={!!err}>
                      {(i.options ?? []).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </Select>
                  </Field>
                );
              }
              return (
                <Field key={i.key} label={i.unit ? `${i.label} (${i.unit})` : i.label} hint={hintFor(i)} error={err}>
                  <Input
                    type="number" inputMode="decimal" step="any"
                    min={i.min} max={i.max}
                    value={String(values[i.key] ?? "")}
                    onChange={(e) => onChange(i.key, e.target.value)}
                    disabled={disabled} invalid={!!err}
                  />
                </Field>
              );
            })}
          </div>
        </Card>
      ))}
    </>
  );
}
