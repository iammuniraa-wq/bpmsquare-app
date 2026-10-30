"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { TERM_LIMITS, percentTotal } from "@/lib/contractProjects/paymentTerms";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import type { PaymentTermMilestone, PaymentTermTemplate } from "@/lib/constants";
import s from "./PaymentTermsSection.module.css";

/**
 * Settings > Contract projects > Payment terms: a few named schedules (one table, a row per template; a row opens a side panel).
 * A template is data the workspace edits: a name and milestones, each a percent of the contract or a fixed amount with a "due when"
 * text. A tender's Bid tab chooses one; the project's billing schedule copies it. `onSave` saves the whole list and answers with a
 * problem text, or null when it worked.
 */
export default function PaymentTermsSection({ templates, onSave }: { templates: PaymentTermTemplate[]; onSave: (next: PaymentTermTemplate[]) => Promise<string | null> }) {
  const [editing, setEditing] = useState<PaymentTermTemplate | "new" | null>(null);

  return (
    <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: c.ink, fontSize: 14, padding: "10px 16px" }}>
        Payment terms <InfoTip label="Payment terms">{PROJECT_TIPS.paymentTemplates}</InfoTip>
        <Button size="sm" variant="secondary" data-guide="cp.settings.terms.add" style={{ minHeight: 44, marginLeft: "auto" }} onClick={() => setEditing("new")}>+ New template</Button>
      </div>
      {templates.length === 0 ? (
        <div style={{ padding: "0 16px 14px", fontSize: 13, color: c.hint }}>No templates yet. Add one, then choose it on a tender&apos;s Bid tab.</div>
      ) : (
        <div data-guide="cp.settings.terms" style={{ minWidth: 0 }}>
          {templates.map((t) => (
            <div key={t.id} data-guide="cp.settings.terms.row" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "2px 12px", padding: "6px 16px", minHeight: 56, borderTop: `1px solid ${c.line}`, minWidth: 0 }}>
              <span style={{ flex: "1 1 150px", minWidth: 0, fontSize: 13.5, color: c.ink, fontWeight: 600, overflowWrap: "anywhere" }}>{t.name}</span>
              <span style={{ fontSize: 13, color: c.muted }}>{t.milestones.length} milestone{t.milestones.length === 1 ? "" : "s"}</span>
              <Button size="sm" variant="secondary" data-guide="cp.settings.terms.open" style={{ minHeight: 44, marginLeft: "auto" }} onClick={() => setEditing(t)}>Open</Button>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <TemplatePanel
          template={editing === "new" ? null : editing} onClose={() => setEditing(null)}
          onSave={(t) => onSave(editing === "new" ? [...templates, t] : templates.map((x) => (x.id === t.id ? t : x)))}
          onDelete={editing === "new" ? undefined : () => onSave(templates.filter((x) => x.id !== editing.id))}
        />
      )}
    </section>
  );
}

const blankMilestone = (): PaymentTermMilestone => ({ title: "", basis: "percent", percent: null, fixed_amount: null, trigger: "" });

function TemplatePanel({ template, onClose, onSave, onDelete }: {
  template: PaymentTermTemplate | null;
  onClose: () => void;
  onSave: (t: PaymentTermTemplate) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [rows, setRows] = useState<PaymentTermMilestone[]>(template?.milestones ?? [blankMilestone()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = (i: number, p: Partial<PaymentTermMilestone>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const total = percentTotal(rows);

  async function run(action: () => Promise<string | null>) {
    setBusy(true); setError("");
    const problem = await action();
    setBusy(false);
    if (problem) setError(problem); else onClose();
  }

  return (
    <SidePanel title={template ? template.name : "New payment-term template"} onClose={onClose}>
      <div data-guide="cp.settings.terms.panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Name"><Input value={name} maxLength={TERM_LIMITS.nameMax} placeholder="For example 30 / 60 / 10" style={{ minHeight: 44 }} onChange={(e) => setName(e.target.value)} /></Field>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r, i) => (
            <div key={i} className={s.row} data-solo={rows.length === 1 ? "true" : undefined} data-guide="cp.settings.terms.milestone" style={{ borderTop: i === 0 ? "none" : `1px solid ${c.line}`, paddingTop: i === 0 ? 0 : 10 }}>
              <Field label="Milestone"><Input value={r.title} maxLength={TERM_LIMITS.titleMax} style={{ minHeight: 44 }} onChange={(e) => patch(i, { title: e.target.value })} /></Field>
              <Field label="Amount as">
                <Select aria-label="Amount as" value={r.basis} style={{ minHeight: 44 }} onChange={(e) => patch(i, { basis: e.target.value === "fixed" ? "fixed" : "percent" })}>
                  <option value="percent">Percent</option>
                  <option value="fixed">Fixed amount</option>
                </Select>
              </Field>
              <Field label={r.basis === "percent" ? "Percent" : "Amount"}>
                <Input
                  type="number" min={0} max={r.basis === "percent" ? 100 : undefined} step="any" inputMode="decimal" style={{ minHeight: 44 }}
                  value={(r.basis === "percent" ? r.percent : r.fixed_amount) ?? ""}
                  onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); patch(i, r.basis === "percent" ? { percent: v } : { fixed_amount: v }); }}
                />
              </Field>
              <div className={s.due}><Field label="Due when"><Input value={r.trigger} maxLength={TERM_LIMITS.triggerMax} placeholder="On award" style={{ minHeight: 44 }} onChange={(e) => patch(i, { trigger: e.target.value })} /></Field></div>
              {rows.length > 1 && <Button variant="quiet" className={s.remove} aria-label="Remove milestone" style={{ minHeight: 44 }} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>Remove</Button>}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {rows.length < TERM_LIMITS.maxMilestones && <Button variant="secondary" data-guide="cp.settings.terms.add_milestone" style={{ minHeight: 44 }} onClick={() => setRows((rs) => [...rs, blankMilestone()])}>+ Add milestone</Button>}
          {total > 0 && total !== 100 && <span role="status" style={{ fontSize: 13, color: "var(--amberink)" }}>The percents add up to {total}%.</span>}
        </div>
        {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" loading={busy} data-guide="cp.settings.terms.save" style={{ minHeight: 44 }} onClick={() => run(() => onSave({ id: template?.id ?? "", name, milestones: rows }))}>Save template</Button>
          {onDelete && <Button variant="danger" disabled={busy} data-guide="cp.settings.terms.delete" style={{ minHeight: 44 }} onClick={() => run(onDelete)}>Delete</Button>}
        </div>
      </div>
    </SidePanel>
  );
}
