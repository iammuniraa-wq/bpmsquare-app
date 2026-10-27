"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import CreateRfqButton from "@/components/rfq/CreateRfqButton";
import type { ComposerLine } from "@/components/rfq/RfqComposer";
import { ESTIMATE_TIPS } from "@/lib/tender/estimates/tips";

// "Raise RFQ for missing costs" (GCC tender deals, slice 3c-1): opens the ordinary RFQ form with the estimate's cost lines that have no
// unit cost or one older than the RFQ price validity. The form goes to any number of suppliers (no minimum). The origin is the
// estimate, the deal is only the context in its label. Lines come in as props (the estimate page already has them) or are fetched
// from the deal's missing-costs list, so the Estimates tab and the BOQ Prices tab stay light until someone asks.

export type MissingEstimate = { id: string; ref: string | null; name: string; count: number; origin_label: string; lines: ComposerLine[] };

export default function MissingRfqButton({ opportunityId, estimateId, lines, originLabel, label = "Raise RFQ for missing costs", showTip = true, guideId = "tender.estimate.rfq", onCreated }: {
  opportunityId: string; estimateId: string;
  /** Given by a page that already has them; otherwise fetched. */
  lines?: ComposerLine[]; originLabel?: string;
  label?: string; showTip?: boolean; guideId?: string;
  /** When given, the person stays on this screen after the RFQ is made (the caller reloads); otherwise the new RFQ opens. */
  onCreated?: () => void;
}) {
  const [found, setFound] = useState<MissingEstimate | null>(null);
  useEffect(() => {
    if (lines) return;
    let live = true;
    fetch(`/api/opportunities/${opportunityId}/tender/estimates/missing`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j) setFound(((j.estimates ?? []) as MissingEstimate[]).find((e) => e.id === estimateId) ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, [lines, opportunityId, estimateId]);

  const rows = lines ?? found?.lines ?? [];
  const labelText = originLabel ?? found?.origin_label ?? "Estimate";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <CreateRfqButton
        origin={{ type: "estimate", id: estimateId }}
        originLabel={labelText}
        lines={rows}
        title={`Costs missing in ${labelText}`}
        label={rows.length > 0 ? `${label} (${rows.length})` : label}
        supplierTypeFilter
        disabled={rows.length === 0}
        guideId={guideId}
        onCreated={onCreated ? () => onCreated() : undefined}
        buttonStyle={{ minHeight: 44, color: c.ink }}
      />
      {showTip && <InfoTip label="raising an RFQ for missing costs">{ESTIMATE_TIPS.missingRfq}</InfoTip>}
    </span>
  );
}
