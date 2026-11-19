"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { RfqOriginType } from "@/lib/rfq/types";
import { sendOutcome } from "@/lib/rfq/sendOutcome";
import RfqComposer, { type ComposerLine } from "./RfqComposer";
import RfqSingleForm from "./RfqSingleForm";
import { RfqSendOutcome } from "./RfqSendNotices";
import type { RfqCreated } from "./submitRfq";

// The modal around the RFQ composer. Shared by the "Request quotation"
// button (several lines) and the per-line action (one line, `single`), so
// both are born the same way and close the same way.

export type { RfqCreated };

export default function RfqDialog({
  onClose, origin, originLabel, lines, title, single, onCreated, supplierTypeFilter, supplierSource,
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
  /** A tender deal's supplier list: the client's approved group when it has one. */
  supplierSource?: string;
}) {
  const router = useRouter();
  // The RFQ exists but the send did not reach everyone: the dialog stays open and says so, instead of closing as if it had worked.
  const [unsent, setUnsent] = useState<RfqCreated | null>(null);

  const finish = useCallback((r: RfqCreated) => {
    onClose();
    if (onCreated) onCreated(r);
    else router.push(`/rfqs/${r.id}`);
  }, [onClose, onCreated, router]);

  // Closing after the RFQ was created still tells the caller, so the record behind the dialog shows the new draft.
  const close = useCallback(() => {
    if (!unsent) { onClose(); return; }
    onClose();
    onCreated?.(unsent);
  }, [unsent, onClose, onCreated]);

  const created = (r: RfqCreated) => {
    if (sendOutcome(r.ref, r.sent, r.sendRequested === true)) setUnsent(r);
    else finish(r);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const outcome = unsent ? sendOutcome(unsent.ref, unsent.sent, true) : null;

  return (
    <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Request quotation" onClick={(e) => e.stopPropagation()} style={{ background: c.panel, borderRadius: 12, width: 760, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>{single ? "Request quotation for this item" : "Request quotation from suppliers"}</div>
          <button type="button" aria-label="Close" onClick={close} style={{ background: "none", border: "none", fontSize: 18, color: c.hint, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 20 }}>
          {unsent && outcome ? (
            <RfqSendOutcome rfq={unsent} outcome={outcome} onStay={onCreated ? close : undefined} />
          ) : single && lines?.length === 1 ? (
            <RfqSingleForm
              origin={origin}
              originLabel={originLabel}
              line={lines[0]}
              onCancel={onClose}
              onCreated={created}
            />
          ) : (
            <RfqComposer
              compact
              supplierTypeFilter={supplierTypeFilter}
              supplierSource={supplierSource}
              origin={origin}
              originLabel={originLabel}
              initialLines={lines}
              initialTitle={title}
              onCancel={onClose}
              onCreated={created}
            />
          )}
        </div>
      </div>
    </div>
  );
}
