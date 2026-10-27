"use client";

import { c } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { RFQ_TIPS } from "@/lib/rfq/tips";
import CreateRfqButton from "./CreateRfqButton";
import type { ComposerLine } from "./RfqComposer";
import { tenderSupplierSource } from "./useRfqSuppliers";

// "Request supplier prices" on a tender deal's Lines tab (GCC tender deals, slice 3b). The deal page mounts it only when the
// workspace has both the gcc_tender and rfq flags and the deal is a tender; it opens the ordinary RFQ form with the deal's
// lines ticked, the client's item numbers on them, and a vendors / subcontractors filter on the supplier list. Disabled while
// the lines have unsaved edits, because the RFQ is made from the saved lines. It is the tender deal's ONE supplier-price button:
// the editor's own "Request quotation" is not drawn on a tender deal. The count is the lines that start ticked because they have
// no price yet, the same rule that button used.

/** How many lines the form starts with ticked because they are unpriced and not already on an RFQ; 0 when every line is priced (a price check). */
export function unpricedStartingLines(lines: readonly ComposerLine[]): number {
  const anyUnpriced = lines.some((l) => !l.linked_ref && !!l.hint);
  return anyUnpriced ? lines.filter((l) => l.include).length : 0;
}

export default function TenderLinesRfq({ opportunityId, originLabel, lines, dirty }: { opportunityId: string; originLabel: string; lines: ComposerLine[]; dirty: boolean }) {
  const n = unpricedStartingLines(lines);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <CreateRfqButton
        origin={{ type: "opportunity", id: opportunityId }}
        originLabel={originLabel}
        lines={lines}
        title="Supplier prices for the tender"
        label={n > 0 ? `Request supplier prices (${n})` : "Request supplier prices"}
        supplierTypeFilter
        supplierSource={tenderSupplierSource(opportunityId)}
        disabled={dirty || lines.length === 0}
        guideId="tender.lines.rfq"
        buttonStyle={{ minHeight: 44, color: c.ink }}
      />
      <InfoTip label="requesting supplier prices">{dirty ? RFQ_TIPS.saveFirst : RFQ_TIPS.tenderRfq}</InfoTip>
    </span>
  );
}
