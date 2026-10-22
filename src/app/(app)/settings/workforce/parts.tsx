"use client";

import InfoTip from "@/components/ui/InfoTip";
import { Switch } from "../middleware/ui";
import s from "./workforce.module.css";

/** A label with its "i" on the left and a switch on the right: the one on/off row of this screen. */
export function SwitchRow({ label, info, checked, onChange, disabled }: {
  label: string; info?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className={s.switchRow}>
      <span className="bpm-label-row">
        <span className="bpm-t-label">{label}</span>
        {info ? <InfoTip label={label}>{info}</InfoTip> : null}
      </span>
      <Switch checked={checked} label={label} onChange={onChange} disabled={disabled} />
    </div>
  );
}

/** The rarely needed options of a tab, behind one "More". */
export function More({ children, label = "More" }: { children: React.ReactNode; label?: string }) {
  return (
    <details className={s.more}>
      <summary>{label}</summary>
      <div className={s.moreBody}>{children}</div>
    </details>
  );
}
