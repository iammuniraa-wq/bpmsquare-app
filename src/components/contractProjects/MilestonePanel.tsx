"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import StatusPill from "@/components/ui/StatusPill";
import { money } from "@/lib/contractProjects/format";
import { MILESTONE_LIMITS, MILESTONE_STATUS_LABEL, MILESTONE_TONE, amountEditable, type MilestoneStatus } from "@/lib/contractProjects/milestones";
import type { MilestoneView } from "@/lib/contractProjects/milestonesServer";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

// Add or edit one invoicing milestone: a side panel on a desktop, a bottom sheet on a phone (the shared SidePanel). The amount is a percent
// of the contract value as it stands, or a fixed amount, and can change until an invoice exists. The status a person may set by hand is
// planned, ready, or paid once invoiced; invoiced only comes from Create invoice. The server decides again on every call.

type Form = { title: string; due_date: string; basis: "percent" | "fixed"; percent: string; fixed_amount: string; note: string; status: MilestoneStatus };
const blank: Form = { title: "", due_date: "", basis: "percent", percent: "", fixed_amount: "", note: "", status: "planned" };
const fromMilestone = (m: MilestoneView): Form => ({
  title: m.title, due_date: m.due_date ?? "", basis: m.basis, percent: m.percent === null ? "" : String(m.percent), fixed_amount: m.fixed_amount === null ? "" : String(m.fixed_amount),
  note: m.note ?? "", status: m.display_status,
});

/** The statuses a person may pick for a milestone that stands where this one does. */
export function statusChoices(from: MilestoneStatus): MilestoneStatus[] {
  if (from === "planned" || from === "ready") return ["planned", "ready"];
  if (from === "invoiced") return ["invoiced", "paid"];
  return ["paid"];
}

export default function MilestonePanel({ projectId, milestone, contractValue, currency, canEdit, onClose, onChanged }: {
  projectId: string;
  /** Absent = a new milestone. */
  milestone?: MilestoneView;
  contractValue: number;
  currency: string | null;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<Form>(milestone ? fromMilestone(milestone) : blank);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const current = milestone?.display_status ?? "planned";
  const base = `/api/contract-projects/${projectId}/milestones`;
  const amountLocked = !amountEditable(current);
  const shown = form.basis === "percent" ? Math.round(((Number(form.percent) || 0) * contractValue) / 100 * 100) / 100 : Number(form.fixed_amount) || 0;

  async function save() {
    setError("");
    if (!form.title.trim()) { setError("Give the milestone a title"); return; }
    setBusy("save");
    try {
      const body: Record<string, unknown> = { title: form.title, due_date: form.due_date || null, note: form.note };
      if (!amountLocked) {
        body.basis = form.basis;
        if (form.basis === "percent") body.percent = form.percent; else body.fixed_amount = form.fixed_amount;
      }
      if (milestone && form.status !== current) body.status = form.status;
      const res = await fetch(milestone ? `${base}/${milestone.id}` : base, { method: milestone ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not save"); return; }
      onChanged();
    } finally { setBusy(""); }
  }

  async function remove() {
    setError(""); setBusy("remove");
    try {
      const res = await fetch(`${base}/${milestone!.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not remove"); return; }
      onChanged();
    } finally { setBusy(""); }
  }

  const title = milestone ? "Milestone" : "Add milestone";
  const footer = canEdit ? (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
      <Button variant="primary" loading={busy === "save"} disabled={!!busy} data-guide="cp.milestone.save" style={{ minHeight: 44 }} onClick={save}>Save</Button>
      {milestone && !milestone.invoice_id && (current === "planned" || current === "ready") && (
        <Button variant="quiet" loading={busy === "remove"} disabled={!!busy} data-guide="cp.milestone.remove" style={{ minHeight: 44 }} onClick={remove}>Remove</Button>
      )}
    </div>
  ) : undefined;

  return (
    <SidePanel title={title} subtitle={milestone ? <StatusPill label={MILESTONE_STATUS_LABEL[current]} tone={MILESTONE_TONE[current]} /> : undefined} label={title} onClose={onClose} footer={footer}>
      <div className="bpm-tap" data-guide="cp.milestone.panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        <Field label="Title" required guide="cp.milestone.field.title"><Input value={form.title} onChange={set("title")} maxLength={MILESTONE_LIMITS.titleMax} disabled={!canEdit} autoFocus={canEdit} /></Field>
        <div className="fg2">
          <Field label="Due date" guide="cp.milestone.field.due"><Input type="date" value={form.due_date} onChange={set("due_date")} disabled={!canEdit} /></Field>
          <Field label="Amount as" guide="cp.milestone.field.basis">
            <Select value={form.basis} onChange={set("basis")} disabled={!canEdit || amountLocked}>
              <option value="percent">Percent of contract value</option>
              <option value="fixed">Fixed amount</option>
            </Select>
          </Field>
        </div>
        {form.basis === "percent" ? (
          <Field label="Percent" info={PROJECT_TIPS.milestonePercent} guide="cp.milestone.field.percent">
            <Input value={form.percent} onChange={set("percent")} inputMode="decimal" placeholder="30" disabled={!canEdit || amountLocked} />
          </Field>
        ) : (
          <Field label="Amount" guide="cp.milestone.field.amount">
            <Input value={form.fixed_amount} onChange={set("fixed_amount")} inputMode="decimal" placeholder="0" disabled={!canEdit || amountLocked} />
          </Field>
        )}
        <div style={{ fontSize: 13, color: c.muted }}>Bills <strong style={{ color: c.ink }}>{money(shown, currency)}</strong>{form.basis === "percent" ? ` of ${money(contractValue, currency)}` : ""}</div>
        {milestone && (
          <Field label="Status" guide="cp.milestone.field.status">
            <Select value={form.status} onChange={set("status")} disabled={!canEdit}>
              {statusChoices(current).map((s) => <option key={s} value={s}>{MILESTONE_STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Note" guide="cp.milestone.field.note"><Textarea value={form.note} onChange={set("note")} maxLength={MILESTONE_LIMITS.noteMax} style={{ minHeight: 60 }} disabled={!canEdit} /></Field>
      </div>
    </SidePanel>
  );
}
