"use client";

import { c } from "@/lib/theme";
import { describeCondition, formatRateValue, formatTiers, type MethodTemplate, type ScaleEntry } from "@/lib/pricing/wizard";
import type { AttrValue } from "@/lib/pricing-core";

export type SnapshotRule = {
  id: string;
  component_code: string;
  match_attributes: Record<string, AttrValue>;
  value: number | null;
  scale?: { entries: ScaleEntry[] } | null;
};

/**
 * Read-only "rate card" render of a config version's rules, grouped by
 * component, one row per condition — the plain-language view the owner's UX
 * doctrine calls for (never raw JSON). A component can carry any number of
 * rules (margin by tier, by region, by deal size...); this always shows all
 * of them, never just the first. Shared by Today's rates and History's
 * as-of-date viewer so the two never drift on how a snapshot reads.
 */
export default function RateSnapshotView({ template, rules }: { template: MethodTemplate; rules: SnapshotRule[] }) {
  const byComponent = new Map<string, SnapshotRule[]>();
  for (const r of rules) {
    const list = byComponent.get(r.component_code) ?? [];
    list.push(r);
    byComponent.set(r.component_code, list);
  }

  const shown = template.components.filter((cmp) => byComponent.has(cmp.code));
  if (shown.length === 0) {
    return <div style={{ fontSize: 12.5, color: c.muted }}>No numbers were entered for this version.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {shown.map((cmp) => {
        const unit: "currency" | "percent" = cmp.calc_type === "PERCENT" ? "percent" : "currency";
        return (
          <div key={cmp.code} style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>{cmp.name}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {byComponent.get(cmp.code)!.map((rule) => (
                <div key={rule.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
                  <span style={{ color: c.muted }}>{describeCondition(template, rule.match_attributes)}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                    {rule.scale?.entries ? formatTiers(rule.scale.entries, unit) : formatRateValue(rule.value, unit)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
