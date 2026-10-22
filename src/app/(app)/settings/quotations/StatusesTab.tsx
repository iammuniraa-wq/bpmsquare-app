"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import SettingsList from "@/components/settings/SettingsList";
import { Toggle } from "@/components/settings/generalShared";
import { DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import { addStatus, canRemoveStatus, makeDefaultStatus, moveStatus, patchStatus, removeStatus, STATUS_COLOURS } from "./quotationsLogic";
import { QUOTATION_TIPS } from "./tips";
import s from "./quotations.module.css";

/** One choice of colour: the twelve presets and a free picker, as one radio group. */
function Colour({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="bpm-t-label" style={{ marginBottom: 6 }}>Colour</div>
      <div className={s.swatches} role="radiogroup" aria-label="Colour">
        {STATUS_COLOURS.map((col) => (
          <button key={col} type="button" role="radio" aria-checked={value === col} aria-label={col} className={s.swatch} style={{ background: col }} onClick={() => onChange(col)} />
        ))}
        <input type="color" className={s.custom} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Other colour" />
      </div>
    </div>
  );
}

/** Statuses: one row each (colour dot, name, where new quotes start, closed); the name opens the panel. */
export default function StatusesTab({ statuses, accent, onChange }: { statuses: QuoteStatusDef[]; accent: string; onChange: (next: QuoteStatusDef[]) => void }) {
  const [openValue, setOpenValue] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: "", color: STATUS_COLOURS[0] as string });
  const [error, setError] = useState("");
  const open = statuses.find((x) => x.value === openValue) ?? null;
  const index = open ? statuses.indexOf(open) : -1;

  const confirmAdd = () => {
    const res = addStatus(statuses, draft);
    if ("error" in res) { setError(res.error); return; }
    onChange(res.list);
    setAdding(false);
  };

  return (
    <div className={s.shell}>
      <div className={s.bar}>
        <span className={`bpm-label-row ${s.barLabel}`}><span className="bpm-t-label">Quote statuses</span><InfoTip label="Quote statuses">{QUOTATION_TIPS.statuses}</InfoTip></span>
        <Button variant="primary" onClick={() => { setAdding(true); setOpenValue(null); setDraft({ label: "", color: STATUS_COLOURS[0] }); setError(""); }}>+ New status</Button>
      </div>
      <SettingsList
        label="Quote statuses"
        headers={["Starts here", "Closed"]}
        rows={statuses.map((x) => ({
          key: x.value,
          title: <><span className={s.dot} style={{ background: x.color }} aria-hidden="true" />{x.label || "Untitled"}</>,
          label: x.label || x.value,
          cells: [x.is_initial ? "Yes" : "", x.is_closed ? "Yes" : ""],
        }))}
        onOpen={(key) => { setOpenValue(key); setAdding(false); }}
      />
      <button type="button" className={s.linkBtn} onClick={() => onChange(DEFAULT_QUOTE_STATUSES)}>Reset to defaults</button>

      {adding && (
        <SidePanel
          title="New status"
          onClose={() => setAdding(false)}
          footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" onClick={confirmAdd}>Add status</Button></>}
        >
          <Field label="Name"><Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="PO received" autoFocus /></Field>
          <Colour value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
          {error && <div role="alert" className={s.err}>{error}</div>}
        </SidePanel>
      )}

      {open && (
        <SidePanel
          title={open.label || "Status"}
          subtitle={open.value}
          onClose={() => setOpenValue(null)}
          footer={
            <>
              {!open.is_initial && <Button onClick={() => onChange(makeDefaultStatus(statuses, open.value))}>Start new quotes here</Button>}
              {canRemoveStatus(statuses, open) && <Button variant="danger" onClick={() => { onChange(removeStatus(statuses, open.value)); setOpenValue(null); }}>Remove</Button>}
              <Button variant="primary" onClick={() => setOpenValue(null)}>Done</Button>
            </>
          }
        >
          <Field label="Name"><Input value={open.label} onChange={(e) => onChange(patchStatus(statuses, open.value, { label: e.target.value }))} /></Field>
          <Colour value={open.color} onChange={(color) => onChange(patchStatus(statuses, open.value, { color }))} />
          <div className={s.switchRow}>
            <span className="bpm-label-row"><span className="bpm-t-label">Closed</span><InfoTip label="Closed">{QUOTATION_TIPS.closed}</InfoTip></span>
            <Toggle on={!!open.is_closed} onChange={(v) => onChange(patchStatus(statuses, open.value, { is_closed: v }))} accent={accent} label="Closed" />
          </div>
          <div className={s.switchRow}>
            <span className="bpm-t-label">Order</span>
            <span className={s.rowGap}>
              <Button size="sm" disabled={index <= 0} onClick={() => onChange(moveStatus(statuses, open.value, -1))}>Earlier</Button>
              <Button size="sm" disabled={index >= statuses.length - 1} onClick={() => onChange(moveStatus(statuses, open.value, 1))}>Later</Button>
            </span>
          </div>
        </SidePanel>
      )}
    </div>
  );
}
