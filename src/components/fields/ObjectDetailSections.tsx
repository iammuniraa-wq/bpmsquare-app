"use client";

import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { applyRules } from "@/lib/fieldRegistry";
import { useEffectiveFieldConfig } from "./useEffectiveFieldConfig";
import FieldWidget from "./FieldWidget";

type Props = {
  objectType: string;
  record: Record<string, unknown>;
};

/** Read-only, section-grouped display of every standard + custom field for a record. */
export default function ObjectDetailSections({ objectType, record }: Props) {
  const { sections, rules, loading } = useEffectiveFieldConfig(objectType);

  if (loading || sections.length === 0) return null;

  const customData = (record.custom_data as Record<string, unknown> | null) ?? {};
  const values: Record<string, unknown> = { ...record, ...customData };

  const visibleSections = sections
    .map((section) => ({
      label: section.label,
      fields: section.fields.filter((f) => !applyRules(rules, f.field_key, f.hidden, f.required, values).hidden),
    }))
    .filter((s) => s.fields.length > 0);

  if (visibleSections.length === 0) return null;

  return (
    <section style={cardStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
        Details
      </div>
      {visibleSections.map((section, i) => (
        <div key={section.label} style={{ marginTop: i === 0 ? 0 : 14, paddingTop: i === 0 ? 0 : 14, borderTop: i === 0 ? "none" : `1px solid ${c.line}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            {section.label}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px 20px" }}>
            {section.fields.map((f) => (
              <div key={f.field_key}>
                <div style={{ fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                  {f.label}
                </div>
                <div style={{ fontSize: 13, color: c.ink }}>
                  <FieldWidget field={f} mode="view" value={values[f.field_key]} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
