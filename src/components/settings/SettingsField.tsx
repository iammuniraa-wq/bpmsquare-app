"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { typeLabel, typeHelp } from "@/lib/typeScale";
import { useTenant } from "@/lib/tenant-context";
import InfoTip from "@/components/ui/InfoTip";

/**
 * The two row shapes a settings page is built from, and the one rule they
 * share: explanatory text is available, not permanent.
 *
 * Every setting here earns a sentence or three of "what does this actually
 * do" -- correct to have written, wrong to print all at once. Twenty settings
 * with their paragraphs showing is a page nobody reads, and it is exactly what
 * pushes the control someone wants off the bottom of a phone screen. So the
 * help sits behind an "i" next to its own label, one field at a time.
 *
 * The "i" is the shared InfoTip (popover on desktop, bottom sheet on a phone).
 * It is switched on per workspace -- the demo workspace and Nova workspaces
 * first (owner, 2026-10-20: "demo tenant first") -- so a workspace that has
 * not been moved over keeps the old "?" that opens a grey box under the field.
 * When every workspace has moved, delete LegacyHelpDot and `useInfoTip`.
 */

export const settingsLabel: React.CSSProperties = typeLabel;

export const settingsInput: React.CSSProperties = {
  width: "100%", padding: "10px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};

const helpText: React.CSSProperties = {
  ...typeHelp, marginTop: 7,
  padding: "8px 10px", background: c.panel2, borderRadius: 7,
};

/** True when this workspace gets the shared "i" instead of the legacy "?". */
function useInfoTip(): boolean {
  const tenant = useTenant();
  return tenant?.is_demo === true || tenant?.features?.next_experience === true;
}

function LegacyHelpDot({ on, onClick, of }: { on: boolean; onClick: () => void; of: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={on}
      aria-label={`What "${of}" does`}
      title={`What "${of}" does`}
      style={{
        flexShrink: 0, width: 17, height: 17, borderRadius: 999, padding: 0, cursor: "pointer",
        fontSize: 10.5, fontWeight: 700, lineHeight: 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: `1px solid ${on ? "var(--tenant-accent, #378ADD)" : c.line}`,
        background: on ? "var(--tenant-accent, #378ADD)" : "transparent",
        color: on ? "#fff" : c.hint,
      }}
    >
      ?
    </button>
  );
}

/** A labelled control. `help` is revealed by the "?" beside the label. */
export function SettingsField({
  label, help, full = false, children,
}: {
  label: string;
  help?: React.ReactNode;
  /** Span the whole grid row -- for a control that needs the width. */
  full?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const tip = useInfoTip();
  return (
    <div style={full ? { gridColumn: "1 / -1", minWidth: 0 } : { minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: tip ? 0 : 6, marginBottom: 6 }}>
        <span style={settingsLabel}>{label}</span>
        {help && (tip ? <InfoTip label={label}>{help}</InfoTip> : <LegacyHelpDot on={open} onClick={() => setOpen((v) => !v)} of={label} />)}
      </div>
      {children}
      {help && !tip && open && <div style={helpText}>{help}</div>}
    </div>
  );
}

/**
 * A switch (or small input) on the right, its name on the left.
 *
 * The control keeps a fixed lane so a column of these lines up, and the text
 * beside it wraps rather than pushing the control off a narrow screen.
 */
export function SettingsRow({
  label, help, first = false, children,
}: {
  label: string;
  help?: React.ReactNode;
  /** Suppresses the divider on the first row of a stack. */
  first?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const tip = useInfoTip();
  return (
    <div style={{ padding: "12px 2px", borderTop: first ? "none" : `1px solid ${c.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: tip ? 0 : 6 }}>
          <span style={typeLabel}>{label}</span>
          {help && (tip ? <InfoTip label={label}>{help}</InfoTip> : <LegacyHelpDot on={open} onClick={() => setOpen((v) => !v)} of={label} />)}
        </div>
        <div style={{ flexShrink: 0 }}>{children}</div>
      </div>
      {help && !tip && open && <div style={helpText}>{help}</div>}
    </div>
  );
}
