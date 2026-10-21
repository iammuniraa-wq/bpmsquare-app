"use client";

import { c } from "@/lib/theme";
import { typeLabel } from "@/lib/typeScale";
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
 * The "i" is the shared InfoTip (popover on desktop, bottom sheet on a phone),
 * shown to every workspace.
 */

export const settingsLabel: React.CSSProperties = typeLabel;

export const settingsInput: React.CSSProperties = {
  width: "100%", padding: "10px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};

/** A labelled control. `help` sits behind the "i" beside the label. */
export function SettingsField({
  label, help, full = false, children,
}: {
  label: string;
  help?: React.ReactNode;
  /** Span the whole grid row -- for a control that needs the width. */
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={full ? { gridColumn: "1 / -1", minWidth: 0 } : { minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 6 }}>
        <span style={settingsLabel}>{label}</span>
        {help && <InfoTip label={label}>{help}</InfoTip>}
      </div>
      {children}
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
  return (
    <div style={{ padding: "12px 2px", borderTop: first ? "none" : `1px solid ${c.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 0 }}>
          <span style={typeLabel}>{label}</span>
          {help && <InfoTip label={label}>{help}</InfoTip>}
        </div>
        <div style={{ flexShrink: 0 }}>{children}</div>
      </div>
    </div>
  );
}
