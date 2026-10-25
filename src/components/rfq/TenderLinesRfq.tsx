"use client";

import { c } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { RFQ_TIPS } from "@/lib/rfq/tips";
import CreateRfqButton from "./CreateRfqButton";
import type { ComposerLine } from "./RfqComposer";

// "Request supplier prices" on a tender deal's Lines tab (GCC tender deals, slice 3b). The deal page mounts it only when the
// workspace has both the gcc_tender and rfq flags and the deal is a tender; it opens the ordinary RFQ form with the deal's
// lines ticked, the client's item numbers on them, and a vendors / subcontractors filter on the supplier list. Disabled while
// the lines have unsaved edits, because the RFQ is made from the saved lines.

export default function TenderLinesRfq({ opportunityId, originLabel, lines, dirty }: { opportunityId: string; originLabel: string; lines: ComposerLine[]; dirty: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <CreateRfqButton
        origin={{ type: "opportunity", id: opportunityId }}
        originLabel={originLabel}
        lines={lines}
        title="Supplier prices for the tender"
        label="Request supplier prices"
        supplierTypeFilter
        disabled={dirty || lines.length === 0}
        guideId="tender.lines.rfq"
        buttonStyle={{ minHeight: 36, color: c.ink }}
      />
      <InfoTip label="requesting supplier prices">{dirty ? RFQ_TIPS.saveFirst : RFQ_TIPS.tenderRfq}</InfoTip>
    </span>
  );
}
