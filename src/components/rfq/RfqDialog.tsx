"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { RfqOriginType } from "@/lib/rfq/types";
import RfqComposer, { type ComposerLine } from "./RfqComposer";
import RfqSingleForm from "./RfqSingleForm";

// The modal around the RFQ composer. Shared by the "Request quotation"
// button (several lines) and the per-line action (one line, `single`), so
// both are born the same way and close the same way.

export type RfqCreated = { id: string; ref: string; line_ids: string[]; line_keys: (string | null)[] };

export default function RfqDialog({
  onClose, origin, originLabel, lines, title, single, onCreated, supplierTypeFilter,
}: {
  onClose: () => void;
  origin: { type: RfqOriginType; id: string | null };
  originLabel?: string | null;
  lines?: ComposerLine[];
  title?: string;
  /** Opened from one document line: the simple one-item form. */
  single?: boolean;
  onCreated?: (r: RfqCreated) => void;
  supplierTypeFilter?: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Request quotation" onClick={(e) => e.stopPropagation()} style={{ background: c.panel, borderRadius: 12, width: 760, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>{single ? "Request quotation for this item" : "Request quotation from suppliers"}</div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, color: c.hint, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 20 }}>
          {single && lines?.length === 1 ? (
            <RfqSingleForm
              origin={origin}
              originLabel={originLabel}
              line={lines[0]}
              onCancel={onClose}
              onCreated={(r) => {
                onClose();
                if (onCreated) onCreated(r);
                else router.push(`/rfqs/${r.id}`);
              }}
            />
          ) : (
            <RfqComposer
              compact
              supplierTypeFilter={supplierTypeFilter}
              origin={origin}
              originLabel={originLabel}
              initialLines={lines}
              initialTitle={title}
              onCancel={onClose}
              onCreated={(r) => {
                onClose();
                if (onCreated) onCreated(r);
                else router.push(`/rfqs/${r.id}`);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
