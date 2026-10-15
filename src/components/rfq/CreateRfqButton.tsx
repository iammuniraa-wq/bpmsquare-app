"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { RfqOriginType } from "@/lib/rfq/types";
import RfqComposer, { type ComposerLine } from "./RfqComposer";
import { btnGhost } from "./rfqUi";

// "Request quotation" on any record: opens the RFQ form prefilled with what
// the record knows, and lands on the new RFQ (or hands its ids back to the
// caller, e.g. a quote editor that wants to remember which RFQ line each of
// its lines became).

export default function CreateRfqButton({
  origin, originLabel, lines, title, label = "Request quotation", onCreated, buttonStyle,
}: {
  origin: { type: RfqOriginType; id: string | null };
  originLabel?: string | null;
  lines?: ComposerLine[];
  title?: string;
  label?: string;
  onCreated?: (r: { id: string; ref: string; line_ids: string[]; line_keys: (string | null)[] }) => void;
  buttonStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button type="button" style={{ ...btnGhost, ...buttonStyle }} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div role="dialog" aria-label="Request quotation" onClick={(e) => e.stopPropagation()} style={{ background: c.panel, borderRadius: 12, width: 760, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>Request quotation from suppliers</div>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} style={{ background: "none", border: "none", fontSize: 18, color: c.hint, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: 20 }}>
              <RfqComposer
                compact
                origin={origin}
                originLabel={originLabel}
                initialLines={lines}
                initialTitle={title}
                onCancel={() => setOpen(false)}
                onCreated={(r) => {
                  setOpen(false);
                  if (onCreated) onCreated(r);
                  else router.push(`/rfqs/${r.id}`);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
