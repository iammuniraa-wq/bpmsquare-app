"use client";

import { c } from "@/lib/theme";

// The small dialog the RFQ detail screen and its comparison share (reply entry, award, add suppliers).

export default function RfqModal({ title, onClose, children, width = 640 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ background: c.panel, borderRadius: 12, width, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: c.ink }}>{title}</div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, color: c.hint, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}
