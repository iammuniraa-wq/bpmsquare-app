"use client";

import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import type { WfmConfig } from "@/lib/constants";
import { SwitchRow } from "./parts";
import { WORKFORCE_TIPS as T } from "./tips";
import s from "./workforce.module.css";

type Costing = WfmConfig["costing"];
export const DEFAULT_COSTING: Costing = { default_bill_rate: 0, default_cost_rate: 0, rates_by_employment_type: {}, due_days: 30, auto_draft_monthly: false };

/** What an hour on a project is charged and what it costs. Shown only where project hours can be invoiced. */
export default function BillingTab({ cfg, onChange }: { cfg: WfmConfig; onChange: (costing: Costing) => void }) {
  const costing = cfg.costing ?? DEFAULT_COSTING;
  const set = (patch: Partial<Costing>) => onChange({ ...costing, ...patch });
  const money = (v: string) => Math.max(0, Number(v) || 0);

  function setTypeRate(code: string, key: "bill" | "cost", raw: string) {
    const v = raw.trim() === "" ? undefined : money(raw);
    const current = { ...(costing.rates_by_employment_type[code] ?? {}) };
    if (v === undefined || v === 0) delete current[key]; else current[key] = v;
    const next = { ...costing.rates_by_employment_type };
    if (Object.keys(current).length === 0) delete next[code]; else next[code] = current;
    set({ rates_by_employment_type: next });
  }

  const types = cfg.employment_types.filter((t) => t.code);

  return (
    <div className={s.shell}>
      <div className={s.card}>
        <div className={s.grid}>
          <Field label="Bill rate per hour" info={T.billRate}>
            <Input type="number" min={0} step="0.01" value={costing.default_bill_rate} onChange={(e) => set({ default_bill_rate: money(e.target.value) })} />
          </Field>
          <Field label="Cost rate per hour" info={T.costRate}>
            <Input type="number" min={0} step="0.01" value={costing.default_cost_rate} onChange={(e) => set({ default_cost_rate: money(e.target.value) })} />
          </Field>
          <Field label="Invoice due after (days)" info={T.dueDays}>
            <Input type="number" min={0} max={365} value={costing.due_days} onChange={(e) => set({ due_days: Math.min(365, Math.max(0, parseInt(e.target.value) || 0)) })} />
          </Field>
          <div className={s.full}>
            <SwitchRow label="Draft invoices at month end" info={T.autoDraft} checked={costing.auto_draft_monthly} onChange={(auto_draft_monthly) => set({ auto_draft_monthly })} />
          </div>
        </div>
      </div>

      {types.length > 0 && (
        <div className={s.card}>
          <div className={s.sectionHead}>Rate by employment type <InfoTip label="Rate by employment type">{T.typeRates}</InfoTip></div>
          <table className={s.rates}>
            <thead>
              <tr><th scope="col">Type</th><th scope="col">Bill / hr</th><th scope="col">Cost / hr</th></tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const r = costing.rates_by_employment_type[t.code] ?? {};
                return (
                  <tr key={t.code}>
                    <td>{t.label || t.code}</td>
                    <td><Input type="number" min={0} step="0.01" aria-label={`${t.label || t.code} bill rate`} placeholder={String(costing.default_bill_rate || "")} value={r.bill ?? ""} onChange={(e) => setTypeRate(t.code, "bill", e.target.value)} /></td>
                    <td><Input type="number" min={0} step="0.01" aria-label={`${t.label || t.code} cost rate`} placeholder={String(costing.default_cost_rate || "")} value={r.cost ?? ""} onChange={(e) => setTypeRate(t.code, "cost", e.target.value)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
