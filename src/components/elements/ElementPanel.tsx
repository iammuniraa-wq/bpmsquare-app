"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import type { BuildingsData } from "@/lib/elements/clientTypes";
import type { ElementLineRow } from "@/lib/elements/rows";
import { ELEMENT_LIMITS } from "@/lib/elements/types";
import { ELEMENT_TIPS } from "@/lib/elements/tips";
import { call } from "./api";
import s from "./Buildings.module.css";

// One line as an element: its type, its code (issued from the pattern, or typed), the client's quantity and the model's side by side as two bars,
// the "Budget uses" chip and the two ways to settle which one the budget carries. Nothing here moves money on its own: accepting the model quantity
// is an explicit button, on a draft budget only, and the contract side (client rate and amount) never changes.

const nf = (n: number | null, unit: string | null) => (n === null ? "none" : `${n.toLocaleString("en-US", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`);
const BAND_CLASS = { none: s.mutedPill, within: s.tealPill, over: s.amberPill, red: s.redPill } as const;
const BAND_WORDS = { none: "No variance", within: "Within tolerance", over: "Over tolerance", red: "Well over tolerance" } as const;

export default function ElementPanel({ root, data, row, canEdit, onClose, onSaved }: {
  /** `/api/contract-projects/<id>` or `/api/opportunities/<id>/tender`. */
  root: string;
  data: BuildingsData;
  row: ElementLineRow;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const project = data.scope === "project";
  const [type, setType] = useState(row.element_type ?? "");
  const [code, setCode] = useState(row.element_code ?? "");
  const [model, setModel] = useState(row.model_qty === null ? "" : String(row.model_qty));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const locked = data.lock;
  const disabled = !canEdit || !!locked;
  const known = data.types.some((t) => t.code === type) || type === (row.element_type ?? "");

  const max = Math.max(row.client_qty ?? 0, row.model_qty ?? 0, 0.001);
  const pct = (n: number | null) => `${Math.max(2, Math.round(((n ?? 0) / max) * 100))}%`;

  async function patch(body: Record<string, unknown>, after?: string) {
    setBusy(true); setError(""); setNotice("");
    const r = await call(`${root}/elements/${row.key}`, "PATCH", body);
    setBusy(false);
    if (!r.ok) { setError(r.j.error ?? "Could not save"); return false; }
    if (after) setNotice(after);
    onSaved();
    return true;
  }

  async function save() {
    const body: Record<string, unknown> = {};
    if (type !== (row.element_type ?? "")) body.element_type = type || null;
    if (code.trim().toUpperCase() !== (row.element_code ?? "")) body.element_code = code.trim() || null;
    if (model.trim() !== (row.model_qty === null ? "" : String(row.model_qty))) body.model_qty = model.trim() === "" ? null : model.trim();
    if (Object.keys(body).length === 0) { onClose(); return; }
    if (await patch(body)) onClose();
  }

  async function issueOne() {
    setBusy(true); setError(""); setNotice("");
    if (type !== (row.element_type ?? "")) {
      const t = await call(`${root}/elements/${row.key}`, "PATCH", { element_type: type || null });
      if (!t.ok) { setBusy(false); setError(t.j.error ?? "Could not save the type"); return; }
    }
    const r = await call<{ plan?: { assignments: { code: string }[]; skipped: { reason: string }[] } }>(`${root}/elements/issue`, "POST", { keys: [row.key] });
    setBusy(false);
    if (!r.ok) { setError(r.j.error ?? "Could not issue the code"); return; }
    const made = r.j.plan?.assignments[0]?.code;
    if (made) { setCode(made); setNotice(`Issued ${made}`); onSaved(); } else setError(r.j.plan?.skipped[0]?.reason ?? "Nothing was issued");
  }

  return (
    <SidePanel
      title={row.element_code ?? (row.ref ? `${row.ref} ${row.description}` : row.description)} subtitle={row.building_code ? `${row.building_code} ${row.building_name ?? ""}` : "No building yet"} label="Element" onClose={onClose}
      footer={<Button variant="primary" loading={busy} disabled={disabled} style={{ minHeight: 44 }} data-guide="elements.panel.save" onClick={() => void save()}>Save</Button>}
    >
      <div className={s.stack} data-guide="elements.panel">
        {locked && <div role="status" className={s.warn}>{locked}</div>}
        {!locked && !canEdit && <div role="status" className={s.note}>You can view this record but not change it</div>}
        {row.mixed && <div role="status" className={s.warn}>This line is split across buildings, so it cannot carry an element code. Put it in one building first.</div>}
        {row.is_category && <div role="status" className={s.note}>A cost line: it takes its element code from its contract line.</div>}

        <div className={s.two}>
          <Field label="Element type" info={ELEMENT_TIPS.elementType}>
            <Select value={type} disabled={disabled || row.is_category} style={{ minHeight: 44 }} data-guide="elements.panel.type" onChange={(e) => setType(e.target.value)}>
              <option value="">No type</option>
              {row.element_type && !data.types.some((t) => t.code === row.element_type) && <option value={row.element_type}>{row.element_type} (switched off)</option>}
              {data.types.map((t) => <option key={t.code} value={t.code}>{t.code} {t.name}</option>)}
            </Select>
          </Field>
          <Field label="Element code" info={ELEMENT_TIPS.elementCode}>
            <Input value={code} maxLength={ELEMENT_LIMITS.codeMaxHard} disabled={disabled || row.is_category || row.mixed} placeholder="Issue one, or type one" style={{ minHeight: 44, textTransform: "uppercase" }} data-guide="elements.panel.code" onChange={(e) => setCode(e.target.value)} />
          </Field>
        </div>
        {!known && <div className={s.warn}>That type is not in your Element types list.</div>}
        {data.types.length === 0 && <div role="status" className={s.warn} data-guide="elements.panel.no_types">No element types yet. An admin adds them in Settings, Contract projects.</div>}
        {row.outside_pattern && <div className={s.warn} data-guide="elements.panel.outside"><span className={`${s.pill} ${s.amberPill}`}>Outside pattern</span> <InfoTip label="Outside pattern">{ELEMENT_TIPS.outsidePattern}</InfoTip></div>}
        {!disabled && !row.is_category && !row.mixed && !row.element_code && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Button variant="secondary" disabled={busy || !type || !row.building_code} style={{ minHeight: 44 }} data-guide="elements.panel.issue" onClick={() => void issueOne()}>Issue code</Button>
            <InfoTip label="Issue code">{ELEMENT_TIPS.issue}</InfoTip>
            {!row.building_code && <span className={s.note}>Put the line in a building first</span>}
          </div>
        )}

        <div className={s.compare} data-guide="elements.panel.quantities">
          <div className="bpm-label-row"><span className="bpm-t-label">Quantity</span><InfoTip label="Quantity">{ELEMENT_TIPS.clientQty}</InfoTip></div>
          <div className={s.compareLine}><span>Client</span><span className={`${s.compareBar} ${s.barClient}`} style={{ width: pct(row.client_qty) }} /><span className={s.num}>{nf(row.client_qty, row.unit)}</span></div>
          <div className={s.compareLine}><span>Model</span><span className={`${s.compareBar} ${row.band === "red" ? s.barRed : row.band === "over" ? s.barWarn : s.barModel}`} style={{ width: pct(row.model_qty) }} /><span className={s.num}>{nf(row.model_qty, row.unit)}</span></div>
          {project && <div className={s.compareLine}><span>Budget</span><span className={`${s.compareBar} ${s.barClient}`} style={{ width: pct(row.qty) }} /><span className={s.num}>{nf(row.qty, row.unit)}</span></div>}
          <div className={s.chips}>
            {project && <><span className={`${s.pill} ${row.uses === "model" ? s.bluePill : s.mutedPill}`} data-guide="elements.panel.uses">Budget uses: {row.uses === "model" ? "Model" : "Client"}</span><InfoTip label="Budget uses">{ELEMENT_TIPS.budgetUses}</InfoTip></>}
            {row.variance_pct !== null && <><span className={`${s.pill} ${BAND_CLASS[row.band]}`} data-guide="elements.panel.variance">{BAND_WORDS[row.band]}: {row.variance_qty !== null && row.variance_qty > 0 ? "+" : ""}{row.variance_qty} ({row.variance_pct}%)</span><InfoTip label="Variance">{ELEMENT_TIPS.variance}</InfoTip></>}
          </div>
        </div>

        <Field label="Model quantity" info={ELEMENT_TIPS.modelQty}>
          <Input type="number" inputMode="decimal" min={0} step="any" value={model} disabled={disabled || row.is_category} placeholder="Not set" style={{ minHeight: 44 }} data-guide="elements.panel.model" onChange={(e) => setModel(e.target.value)} />
        </Field>
        {project && !disabled && row.model_qty !== null && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="secondary" disabled={busy || row.uses === "model"} style={{ minHeight: 44 }} data-guide="elements.panel.accept" onClick={() => void patch({ accept_model: true }, "The budget now uses the model quantity")}>Use the model quantity</Button>
            <Button variant="secondary" disabled={busy || row.uses === "client"} style={{ minHeight: 44 }} data-guide="elements.panel.use_client" onClick={() => void patch({ use_client: true }, "The budget now uses the client quantity")}>Use the client quantity</Button>
          </div>
        )}
        {error && <div role="alert" className={s.err}>{error}</div>}
        {notice && !error && <div role="status" className={s.ok} style={{ color: c.ink }}>{notice}</div>}
      </div>
    </SidePanel>
  );
}
