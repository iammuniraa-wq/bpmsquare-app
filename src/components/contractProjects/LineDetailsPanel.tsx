"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import { round4 } from "@/lib/contractProjects/budget";
import { money } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import type { BudgetLine } from "@/lib/contractProjects/types";
import MasterPicker from "./MasterPicker";

/**
 * The detail of one budget line, kept out of the allocation table so that stays five columns: its description, resource type, cost code,
 * quantity, unit and reserve flag. Saving replaces the revision's lines through PUT /api/contract-projects/[id]/budget with the allocation
 * exactly as it was last saved, so a line's details can change without touching what was allocated. A new line (a project made by hand)
 * starts not allocated. `blocked` says why it cannot be saved now (unsaved allocation on the screen).
 */
export default function LineDetailsPanel({ projectId, revisionId, lines, lineKey, resources, currency, canEdit, blocked, onClose, onSaved }: {
  projectId: string;
  revisionId: string;
  lines: BudgetLine[];
  /** null = a new line. */
  lineKey: string | null;
  resources: { code: string; name: string; revenue_side: boolean }[];
  currency: string | null;
  canEdit: boolean;
  blocked: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { confirm } = useFeel();
  const line = lineKey ? lines.find((l) => l.line_key === lineKey) ?? null : null;
  const costResources = resources.filter((r) => !r.revenue_side);
  const [f, setF] = useState({
    description: line?.description ?? "", resource_code: line?.resource_code ?? costResources.find((r) => r.code === "11")?.code ?? costResources[0]?.code ?? "",
    cost_code: line?.cost_code ?? "", wbs: line?.wbs ?? "", qty: String(line?.qty ?? 1), unit: line?.unit ?? "", reserve: line?.reserve ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const disabled = !canEdit || !!blocked;

  const payload = (drop: boolean) => {
    const rows: Record<string, unknown>[] = lines.filter((l) => !(drop && l.line_key === lineKey)).map((l) => {
      const mine = l.line_key === lineKey && !drop;
      const qty = mine ? (f.qty === "" ? 1 : Number(f.qty)) : l.qty;
      const amount = l.allocated ? l.amount : 0;
      return {
        line_key: l.line_key,
        resource_code: (mine ? f.resource_code : l.resource_code) || null, cost_code: (mine ? f.cost_code.trim() : l.cost_code) || null, wbs: (mine ? f.wbs : l.wbs) || null,
        description: mine ? f.description : l.description, qty, unit: (mine ? f.unit : l.unit) || null,
        // The unit cost follows the allocated amount, so a changed quantity leaves what was allocated alone.
        unit_cost: l.allocated ? (qty > 0 ? round4(amount / qty) : amount) : 0, amount, allocated: l.allocated,
        source_ref: l.source_ref, reserve: mine ? f.reserve : l.reserve, client_rate: l.client_rate, client_amount: l.client_amount, source_line_id: l.source_line_id,
      };
    });
    if (!line && !drop) {
      rows.push({
        resource_code: f.resource_code || null, cost_code: f.cost_code.trim() || null, wbs: f.wbs || null, description: f.description,
        qty: f.qty === "" ? 1 : Number(f.qty), unit: f.unit || null, unit_cost: 0, amount: 0, allocated: false, source_ref: null, reserve: f.reserve, client_rate: null, client_amount: null, source_line_id: null,
      });
    }
    return rows;
  };

  async function send(drop: boolean) {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/contract-projects/${projectId}/budget`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision_id: revisionId, lines: payload(drop) }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(`${j.row ? `Line ${j.row}: ` : ""}${j.error ?? "Could not save the line"}`); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!(await confirm({ title: "Remove this line?", body: "It leaves the budget and any work package it was in. The tender is not changed.", confirmLabel: "Remove" }))) return;
    await send(true);
  }

  const perUnit = line && line.allocated && line.qty > 0 ? money(round4(line.amount / line.qty), currency, 2) : "—";

  return (
    <SidePanel
      title={line ? `Line ${line.wbs ?? line.line_no}` : "New line"} subtitle={line?.description} onClose={onClose}
      footer={canEdit ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" loading={busy} disabled={disabled || !f.description.trim()} data-guide="cp.alloc.line_save" style={{ minHeight: 44 }} onClick={() => send(false)}>Save line</Button>
          {line && <Button variant="danger" disabled={disabled || busy} data-guide="cp.alloc.line_remove" style={{ minHeight: 44 }} onClick={remove}>Remove line</Button>}
        </div>
      ) : undefined}
    >
      <div data-guide="cp.alloc.line_panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {blocked && <div role="status" data-guide="cp.alloc.line_blocked" style={{ fontSize: 13, color: "var(--amberink)" }}>{blocked}</div>}
        <Field label="Description"><Input value={f.description} maxLength={500} disabled={disabled} style={{ minHeight: 44 }} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Resource type" info={PROJECT_TIPS.resource}>
          <Select value={f.resource_code} disabled={disabled} style={{ minHeight: 44 }} onChange={(e) => setF({ ...f, resource_code: e.target.value })}>
            <option value="">— Choose —</option>
            {costResources.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}
            {f.resource_code && !costResources.some((x) => x.code === f.resource_code) && <option value={f.resource_code}>{f.resource_code}</option>}
          </Select>
        </Field>
        <Field label="Cost code" info={PROJECT_TIPS.costCode}><MasterPicker kind="cost_code" label="Cost code" value={f.cost_code} disabled={disabled} onChange={(v) => setF({ ...f, cost_code: v })} guide="cp.budget.cost_code" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          <Field label="Item reference" info={PROJECT_TIPS.wbs}><Input value={f.wbs} maxLength={100} disabled={disabled} style={{ minHeight: 44 }} onChange={(e) => setF({ ...f, wbs: e.target.value })} /></Field>
          <Field label="Quantity"><Input type="number" min="0" step="any" inputMode="decimal" value={f.qty} disabled={disabled} style={{ minHeight: 44 }} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
          <Field label="Unit"><Input value={f.unit} maxLength={30} disabled={disabled} style={{ minHeight: 44 }} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, fontSize: 13, color: c.ink }}>
          <input type="checkbox" checked={f.reserve} disabled={disabled} style={{ width: 20, height: 20 }} onChange={(e) => setF({ ...f, reserve: e.target.checked })} />
          Reserve line <InfoTip label="Reserve">{PROJECT_TIPS.reserve}</InfoTip>
        </label>
        {line && <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: c.muted }}>Cost per unit <b style={{ color: c.ink }}>{perUnit}</b><InfoTip label="Cost per unit">{PROJECT_TIPS.unitCost}</InfoTip></div>}
        {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
      </div>
    </SidePanel>
  );
}
