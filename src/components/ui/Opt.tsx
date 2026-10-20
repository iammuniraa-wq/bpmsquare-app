"use client";

import InfoTip from "./InfoTip";

/**
 * One option in a studio panel: the label (with its "i", when it has an explanation) above the control. Replaces
 * the per-studio copies that printed a hint line under every option. `hint` is only for a constraint of a few
 * words ("PNG, JPG, WebP · max 2 MB"), never an explanation.
 */
export function Opt({ label, info, hint, htmlFor, children }: {
  label: string;
  info?: React.ReactNode;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bpm-opt">
      <div className="bpm-label-row">
        {htmlFor ? <label className="bpm-opt-label" htmlFor={htmlFor}>{label}</label> : <span className="bpm-opt-label">{label}</span>}
        {info ? <InfoTip label={label}>{info}</InfoTip> : null}
      </div>
      {children}
      {hint ? <span className="bpm-opt-hint">{hint}</span> : null}
    </div>
  );
}

/** A tick-box option. The "i" sits after the text, outside the <label>, so a click on it never toggles the box. */
export function CheckOpt({ label, info, checked, disabled, onChange }: {
  label: string;
  info?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="bpm-label-row bpm-opt-check">
      <label>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {info ? <InfoTip label={label}>{info}</InfoTip> : null}
    </div>
  );
}
