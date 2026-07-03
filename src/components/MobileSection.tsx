"use client";

import { useState } from "react";
import { c } from "@/lib/theme";

/**
 * On mobile: collapsible accordion section with a + / − toggle.
 * On desktop: renders children directly (no wrapper needed — caller wraps in cardStyle).
 * Pass `defaultOpen` to expand on mount.
 */
export default function MobileSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      background: c.panel,
      border: `1px solid ${c.line}`,
      borderRadius: 12,
      overflow: "hidden",
    }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between",
          padding: "13px 16px",
          background: "none", border: "none", cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>{title}</span>
        <span style={{
          width: 24, height: 24, borderRadius: 6,
          background: open ? c.accent : c.line,
          color: open ? "#fff" : c.muted,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, fontWeight: 300, lineHeight: 1, flexShrink: 0,
          transition: "background .15s",
        }}>
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${c.line}` }}>
          <div style={{ height: 14 }} />
          {children}
        </div>
      )}
    </div>
  );
}
