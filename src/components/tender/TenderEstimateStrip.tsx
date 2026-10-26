"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import { ESTIMATE_TIPS } from "@/lib/tender/estimates/tips";
import type { EstimateTenderContext } from "@/lib/tender/estimates/context";
import MissingRfqButton from "./MissingRfqButton";
import { postReprice, unconfirmed } from "./quantityGuard";

// The strip at the top of an estimate that was made for a tender deal (GCC tender deals, slice 3c-1): "Tender: OPP-0011" with the way
// back, the BOQ lines this estimate prices (a build-up waiting to be used, an estimate that changed since, a line an award re-priced),
// and "Raise RFQ for missing costs". Drawn only for an estimate with a tender deal in a workspace with the edition; a standard
// estimate's page does not contain it. Costs are internal and stay on this screen.

export default function TenderEstimateStrip({ ctx, estimateId, canEdit }: { ctx: EstimateTenderContext; estimateId: string; canEdit: boolean }) {
  const router = useRouter();
  const { toast, confirm } = useFeel();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const base = `/api/opportunities/${ctx.deal.id}/tender/estimates`;
  const dealHref = `/pipeline/${ctx.deal.id}`;

  async function price(linkIds: string[], label: string) {
    if (ctx.bid_locked && !(await confirm({ title: "The bid is already in", body: "Re-pricing changes the rate on the deal's lines. The submitted bid version is kept as it was.", confirmLabel: "Re-price" }))) return;
    setBusy(label); setError("");
    try {
      const known = unconfirmed(ctx.links.filter((l) => linkIds.includes(l.link_id)).map((l) => l.quantity));
      const out = await postReprice(base + "/reprice", { link_ids: linkIds }, known, confirm);
      if (!out) return;
      const j = out.json;
      if (!out.ok) { setError(j.error ?? "Could not price the line"); return; }
      const failed = j.failed ?? [];
      if (failed.length > 0) { setError(`${failed[0].item}: ${failed[0].reason}`); return; }
      const n = j.repriced?.length ?? linkIds.length;
      toast({ text: `${n} BOQ line${n === 1 ? "" : "s"} priced from this estimate`, tone: "success" });
      router.refresh();
    } catch { setError("Network error. Try again."); } finally { setBusy(null); }
  }

  const waiting = ctx.links.filter((l) => l.waiting);
  const stale = ctx.links.filter((l) => l.stale && !l.waiting);
  const review = ctx.links.filter((l) => l.needs_review);
  return (
    <div data-guide="tender.estimate.strip" style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--panel2)", border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: c.ink, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <b>Tender: {ctx.deal.ref ?? ctx.deal.title}</b>
          <span style={{ color: c.muted }}>{ctx.deal.ref ? ctx.deal.title : ""}</span>
          <InfoTip label="Tender estimate">{ESTIMATE_TIPS.tenderStrip}</InfoTip>
        </span>
        <Link href={`${dealHref}?tab=estimates`} data-guide="tender.estimate.back" style={{ fontSize: 12.5, color: c.ink, minHeight: 44, display: "inline-flex", alignItems: "center" }}>← Back to the tender</Link>
        {ctx.links.length > 0 && <Link href={`${dealHref}?tab=boq`} data-guide="tender.estimate.to_boq" style={{ fontSize: 12.5, color: c.ink, minHeight: 44, display: "inline-flex", alignItems: "center" }}>BOQ</Link>}
      </div>

      {waiting.map((l) => (
        <div key={l.link_id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div data-guide="tender.estimate.waiting" style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center", fontSize: 12.5, color: c.ink }}>
            <span style={{ flex: "1 1 240px", overflowWrap: "anywhere" }}>Built for BOQ item {l.item} · {l.qty} {l.uom ?? ""}</span>
            {canEdit && <Button size="sm" variant="primary" loading={busy === l.link_id} onClick={() => void price([l.link_id], l.link_id)} style={{ minHeight: 44 }} data-guide="tender.estimate.use_total">Price the line from this estimate</Button>}
          </div>
          {l.quantity?.note && <div role="alert" data-guide="tender.estimate.quantity" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--amberink)", background: "var(--amberbg)", borderRadius: 6, padding: "6px 8px", overflowWrap: "anywhere" }}>{l.quantity.note}</div>}
        </div>
      ))}
      {ctx.links.filter((l) => !l.waiting && l.quantity?.status === "mismatch" && l.quantity.note).map((l) => (
        <div key={l.link_id} data-guide="tender.estimate.quantity_mismatch" style={{ fontSize: 12.5, color: "var(--amberink)", overflowWrap: "anywhere" }}>{l.item}: {l.quantity?.note}</div>
      ))}
      {stale.length > 0 && (
        <div data-guide="tender.estimate.stale" style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center", fontSize: 12.5, color: "var(--amberink)" }}>
          <b>Estimate changed, re-price {stale.length} BOQ line{stale.length === 1 ? "" : "s"}</b> <InfoTip label="Estimate changed">{ESTIMATE_TIPS.stale}</InfoTip>
          {canEdit && <Button size="sm" variant="secondary" loading={busy === "stale"} onClick={() => void price(stale.map((l) => l.link_id), "stale")} style={{ minHeight: 44 }} data-guide="tender.estimate.reprice">Re-price</Button>}
        </div>
      )}
      {review.map((l) => (
        <div key={l.link_id} data-guide="tender.estimate.review" style={{ fontSize: 12.5, color: "var(--amberink)" }}>{l.item}: {l.review_note ?? "Re-priced from a supplier award, check it"}</div>
      ))}
      {ctx.missing.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center", fontSize: 12.5 }}>
          <span data-guide="tender.estimate.missing" style={{ color: "var(--amberink)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            {ctx.missing.length} cost{ctx.missing.length === 1 ? "" : "s"} missing or older than {ctx.valid_days} days <InfoTip label="Missing costs">{ESTIMATE_TIPS.missing}</InfoTip>
          </span>
          {ctx.rfq_enabled && canEdit && !ctx.locked && <MissingRfqButton opportunityId={ctx.deal.id} estimateId={estimateId} lines={ctx.missing} originLabel={ctx.origin_label} showTip={false} />}
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--redink)" }}>{error}</div>}
    </div>
  );
}
