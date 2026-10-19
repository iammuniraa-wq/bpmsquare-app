"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { RfqOriginType } from "@/lib/rfq/types";
import RfqDialog from "./RfqDialog";
import { rfqLineActionState } from "./lineAction";

// "Request quotation" for ONE document line, as a small link-style action.
// Used where a line is shown read-only (the Quotation detail page); the
// editable line grid (Standard Quotes, Deals) has its own cell for it. The
// composer opens with just this line: item, quantity and a source_line_id so
// the new RFQ line is stamped onto it.

export default function LineRfqButton({
  origin, originLabel, line,
}: {
  origin: { type: RfqOriginType; id: string };
  originLabel: string;
  line: { id: string; description: string; uom?: string | null; qty?: number | string | null; product_id?: string | null };
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const state = rfqLineActionState({ documentId: origin.id, lineId: line.id, description: line.description });
  if (!state.eligible) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Ask suppliers for a price on this line"
        style={{ marginTop: 3, background: "none", border: "none", padding: 0, fontSize: 11, fontWeight: 600, color: c.accent, cursor: "pointer", textDecoration: "underline" }}>
        Request quotation
      </button>
      {open && (
        <RfqDialog
          single
          onClose={() => setOpen(false)}
          origin={origin}
          originLabel={originLabel}
          lines={[{ source_line_id: line.id, product_id: line.product_id ?? null, description: line.description, uom: line.uom ?? "Nos", qty: line.qty ?? 1 }]}
          onCreated={() => { setOpen(false); router.refresh(); }}
        />
      )}
    </>
  );
}
