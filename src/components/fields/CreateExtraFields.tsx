"use client";

import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { applyRules } from "@/lib/fieldRegistry";
import { useEffectiveFieldConfig } from "./useEffectiveFieldConfig";
import FieldWidget from "./FieldWidget";

type Props = {
  objectType: string;
  /** Field keys already rendered by dedicated inputs elsewhere on the page. */
  exclude: string[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown, kind: "standard" | "custom") => void;
};

/**
 * Renders every standard + custom field for objectType that isn't already
 * covered by a page's hand-built inputs, live from field-config — so a
 * "New X" form automatically picks up core fields added later (e.g. asset's
 * nameplate columns) and tenant custom fields, instead of needing every
 * creation page hand-edited each time the registry grows.
 */
export default function CreateExtraFields({ objectType, exclude, values, onChange }: Props) {
  const { sections, rules, loading } = useEffectiveFieldConfig(objectType);
  if (loading) return null;

  const excludeSet = new Set(exclude);
  const visibleSections = sections
    .map((section) => ({
      label: section.label,
      fields: section.fields.filter((f) => {
        if (excludeSet.has(f.field_key) || f.editable === false) return false;
        return !applyRules(rules, f.field_key, f.hidden, f.required, values).hidden;
      }),
    }))
    .filter((s) => s.fields.length > 0);

  if (visibleSections.length === 0) return null;

  return (
    <div style={cardStyle}>
      {visibleSections.map((section) => (
        <div key={section.label} style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 10px" }}>
            {section.label}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px 12px" }}>
            {section.fields.map((f) => {
              const { required } = applyRules(rules, f.field_key, f.hidden, f.required, values);
              return (
                <div key={f.field_key}>
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>
                    {f.label}{required ? " *" : ""}
                  </label>
                  <FieldWidget
                    field={f}
                    mode="edit"
                    value={values[f.field_key]}
                    onChange={(v) => onChange(f.field_key, v, f.kind)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
