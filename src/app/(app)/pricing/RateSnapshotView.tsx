"use client";

import { c } from "@/lib/theme";
import { describeCondition, type MethodTemplate } from "@/lib/pricing/wizard";
import type { AttrValue } from "@/lib/pricing-core";

export type SnapshotRule = { id: string; component_code: string; match_attributes: Record<string, AttrValue>; value: number | null };

function formatValue(value: number | null, calcType: string | undefined): string {
  if (value === null) return "a scale";
  return calcType === "PERCENT" ? `${Math.abs(value)}%` : Math.abs(value).toLocaleString();
}

/**
 * Read-only "rate card" render of a config version's rules, grouped by
 * component — the plain-language view the owner's UX doctrine calls for
 * (never raw JSON). Shared by Today's rates and History's as-of-date viewer
 * so the two never drift on how a snapshot reads.
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
      {shown.map((cmp) => (
        <div key={cmp.code} style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>{cmp.name}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {byComponent.get(cmp.code)!.map((rule) => (
              <div key={rule.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: c.muted }}>{describeCondition(template, rule.match_attributes)}</span>
                <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatValue(rule.value, cmp.calc_type)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
