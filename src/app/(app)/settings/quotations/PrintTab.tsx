"use client";

import InfoTip from "@/components/ui/InfoTip";
import { EQUIPMENT_FIELDS, nameplateOpen, NAMEPLATE_FIELDS, togglePrintField, type PrintField } from "./quotationsLogic";
import { QUOTATION_TIPS } from "./tips";
import s from "./quotations.module.css";

function Chips({ label, fields, picked, onToggle }: { label: string; fields: PrintField[]; picked: string[]; onToggle: (value: string) => void }) {
  return (
    <div className={s.fieldChips} role="group" aria-label={label}>
      {fields.map((f) => (
        <button key={f.value} type="button" className={s.fieldChip} aria-pressed={picked.includes(f.value)} onClick={() => onToggle(f.value)}>{f.label}</button>
      ))}
    </div>
  );
}

/** Print: which equipment fields appear in a printed quote. Motor nameplate fields stay folded until one is in use. */
export default function PrintTab({ fields, customFields, onChange }: { fields: string[]; customFields: PrintField[]; onChange: (next: string[]) => void }) {
  const toggle = (value: string) => onChange(togglePrintField(fields, value));
  return (
    <div className={s.shell}>
      <div className={s.card}>
        <span className="bpm-label-row"><span className="bpm-t-label">Equipment details on a printed quote</span><InfoTip label="Equipment details">{QUOTATION_TIPS.print}</InfoTip></span>
        <Chips label="Equipment fields" fields={[...EQUIPMENT_FIELDS, ...customFields]} picked={fields} onToggle={toggle} />
        <details className={s.more} open={nameplateOpen(fields) || undefined}>
          <summary>Motor nameplate</summary>
          <div className={s.moreBody}>
            <Chips label="Motor nameplate fields" fields={NAMEPLATE_FIELDS} picked={fields} onToggle={toggle} />
          </div>
        </details>
      </div>
    </div>
  );
}
