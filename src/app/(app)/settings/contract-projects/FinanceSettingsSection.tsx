"use client";

import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import InfoTip from "@/components/ui/InfoTip";
import { PF_TIPS } from "@/lib/projectFinance/tips";
import type { FinanceVisibility } from "@/lib/projectFinance/types";

export type FinanceForm = { visibility: FinanceVisibility; drop: string; cash: string; late: string };

/**
 * Settings > Contract projects > Cost and margin (only with the project_dashboards flag): who sees cost and margin, and, behind one "More",
 * the three numbers of the health lights. Saved with the page's one Save (the parent sends it with the margin floor).
 */
export default function FinanceSettingsSection({ value, onChange }: { value: FinanceForm; onChange: (v: FinanceForm) => void }) {
  const set = (patch: Partial<FinanceForm>) => onChange({ ...value, ...patch });
  const radio = (v: FinanceVisibility, label: string) => (
    <label key={v} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13.5, color: c.ink }}>
      <input type="radio" name="finance_visibility" checked={value.visibility === v} onChange={() => set({ visibility: v })} style={{ width: 18, height: 18 }} data-guide={`cp.settings.finance.${v}`} />
      {label}
    </label>
  );
  const num = (label: string, key: "drop" | "cash" | "late", unit: string, max: number) => (
    <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13, color: c.ink, flexWrap: "wrap" }}>
      <span style={{ flex: "1 1 160px" }}>{label}</span>
      <input type="number" min={0.5} max={max} step={key === "drop" ? 0.5 : 1} inputMode="decimal" value={value[key]} aria-label={`${label} in ${unit}`}
        onChange={(e) => set({ [key]: e.target.value } as Partial<FinanceForm>)} className="bpm-input" style={{ width: 96, minHeight: 44 }} />
      <span style={{ color: c.hint, minWidth: 48 }}>{unit}</span>
    </label>
  );
  return (
    <section style={{ ...cardStyle }} data-guide="cp.settings.finance">
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: c.ink, fontSize: 14, minHeight: 36 }}>
        Cost and margin <InfoTip label="Cost and margin">{PF_TIPS.visibility}</InfoTip>
      </div>
      <div role="radiogroup" aria-label="Who sees cost and margin">
        {radio("everyone", "Everyone who can open Contract projects")}
        {radio("granted", "Only admins, project managers and people granted it")}
      </div>
      <details style={{ marginTop: 6 }} data-guide="cp.settings.finance.more">
        <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: c.muted }}>
          More <InfoTip label="Light thresholds">{PF_TIPS.thresholds}</InfoTip>
        </summary>
        {num("Margin drop that puts a project at risk", "drop", "points", 50)}
        {num("Billing behind that puts a project at risk", "cash", "days", 365)}
        {num("Late delivery that puts a project at risk", "late", "%", 100)}
      </details>
    </section>
  );
}
