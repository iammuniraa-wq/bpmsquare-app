"use client";

import { useState } from "react";
import { c } from "@/lib/theme";

/**
 * The two row shapes a settings page is built from, and the one rule they
 * share: explanatory text is available, not permanent.
 *
 * Every setting here earns a sentence or three of "what does this actually
 * do" -- correct to have written, wrong to print all at once. Twenty settings
 * with their paragraphs showing is a page nobody reads, and it is exactly what
 * pushes the control someone wants off the bottom of a phone screen. So the
 * help sits behind a "?" next to its own label, one field at a time.
 */

export const settingsLabel: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: c.muted,
  textTransform: "uppercase", letterSpacing: 0.4,
};

export const settingsInput: React.CSSProperties = {
  width: "100%", padding: "10px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};

const helpText: React.CSSProperties = {
  fontSize: 11.5, color: c.hint, marginTop: 7, lineHeight: 1.5,
  padding: "8px 10px", background: c.panel2, borderRadius: 7,
};

function HelpDot({ on, onClick, of }: { on: boolean; onClick: () => void; of: string }) {
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
  return (
    <div style={full ? { gridColumn: "1 / -1", minWidth: 0 } : { minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={settingsLabel}>{label}</span>
        {help && <HelpDot on={open} onClick={() => setOpen((v) => !v)} of={label} />}
      </div>
      {children}
      {help && open && <div style={helpText}>{help}</div>}
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
  return (
    <div style={{ padding: "12px 2px", borderTop: first ? "none" : `1px solid ${c.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, color: c.ink, fontWeight: 500 }}>{label}</span>
          {help && <HelpDot on={open} onClick={() => setOpen((v) => !v)} of={label} />}
        </div>
        <div style={{ flexShrink: 0 }}>{children}</div>
      </div>
      {help && open && <div style={helpText}>{help}</div>}
    </div>
  );
}
