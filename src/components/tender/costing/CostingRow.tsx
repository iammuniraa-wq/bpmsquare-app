"use client";

import Link from "next/link";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { ageText, rowsText, type CostingItem } from "@/lib/tender/costing/rules";
import { COSTING_TIPS } from "@/lib/tender/costing/tips";
import MissingRfqButton from "../MissingRfqButton";

// One line of the Costing list: an estimate or an RFQ, with the BOQ rows it prices, its state, its total and its age. Wrapping flex rows,
// no table, so a phone and a desktop share one markup. Every control is 44 px tall. Costs and totals are internal; this tab is for people
// who may see Estimates or RFQs.

const money = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function CostingRow({ item, opportunityId, today, canEdit, canAward, rfqsOn, onOpenBoq, onCompare, onPriceRows, onReprice, onPriceAwarded, onRfqCreated, busy, comparing }: {
  item: CostingItem;
  opportunityId: string;
  today: string;
  canEdit: boolean;
  canAward: boolean;
  rfqsOn: boolean;
  onOpenBoq?: () => void;
  onCompare: (rfqId: string) => void;
  onPriceRows: (estimateId: string) => void;
  onReprice: (estimateId: string) => void;
  onPriceAwarded: (rfqId: string) => void;
  /** An RFQ was raised for this estimate's missing costs: the list reloads and the person stays on Costing. */
  onRfqCreated?: () => void;
  busy?: boolean;
  comparing?: boolean;
}) {
  const isEstimate = item.kind === "estimate";
  const name = isEstimate ? `${item.ref ? `${item.ref} · ` : ""}${item.name}` : `${item.ref ? `${item.ref} · ` : ""}${item.title}`;
  const href = isEstimate ? `/estimates/${item.id}` : `/rfqs/${item.id}`;
  const when = isEstimate ? `Changed ${ageText(item.updated_at, today)}` : `Raised ${ageText(item.created_at, today)}`;
  return (
    <div data-guide={isEstimate ? "costing.estimate" : "costing.rfq"} style={{ borderTop: `1px solid ${c.line}`, padding: "10px 0", display: "flex", flexDirection: "column", gap: 6, background: comparing ? "var(--panel2)" : undefined }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center" }}>
        <StatusPill label={isEstimate ? "Estimate" : "RFQ"} tone={isEstimate ? "blue" : "purple"} />
        <Link href={href} data-guide="costing.open" style={{ fontWeight: 700, fontSize: 13, color: c.ink, minHeight: 44, display: "inline-flex", alignItems: "center", overflowWrap: "anywhere", flex: "1 1 200px" }}>{name}</Link>
        <span data-guide="costing.state"><StatusPill label={item.state.label} tone={item.state.tone} /></span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", alignItems: "center", fontSize: 12.5, color: c.ink }}>
        <span data-guide="costing.rows" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: c.muted }}>Prices</span> <b>{rowsText(item.rows)}</b>
          {item.rows.count > 0 && onOpenBoq && <Button variant="quiet" size="sm" onClick={onOpenBoq} style={{ minHeight: 44 }} data-guide="costing.rows.open">open</Button>}
        </span>
        <span data-guide="costing.total" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: c.muted }}>{isEstimate ? "Cost" : item.total_is_awarded ? "Awarded" : "Best"}</span>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(isEstimate ? item.cost_total : item.total)}</b>
          {isEstimate && item.currency ? <span style={{ color: c.hint }}>{item.currency}</span> : null}
          <InfoTip label="Total">{COSTING_TIPS.total}</InfoTip>
        </span>
        <span data-guide="costing.age" style={{ color: c.hint }}>{when}</span>
        {!isEstimate && item.origin === "estimate" && <span style={{ color: c.hint }}>{item.origin_label ?? "from an estimate"}</span>}
      </div>

      {isEstimate && item.rfqs.length > 0 && (
        <div data-guide="costing.estimate.rfqs" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 12.5 }}>
          <span style={{ color: c.muted }}>RFQs</span>
          {item.rfqs.map((r) => (
            <button key={r.id} type="button" onClick={() => onCompare(r.id)} data-guide="costing.estimate.rfq_chip"
              style={{ minHeight: 44, padding: "0 10px", borderRadius: 999, border: `1px solid ${c.line}`, background: "var(--panel2)", color: c.ink, fontSize: 12.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {r.ref ?? "RFQ"} <span style={{ color: c.muted }}>{r.status_label}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {isEstimate ? (
          <>
            <Button variant="secondary" size="sm" href={href} style={{ minHeight: 44 }} data-guide="costing.estimate.open">Open</Button>
            {canEdit && !item.locked && (
              <Button variant="secondary" size="sm" onClick={() => onPriceRows(item.id)} disabled={busy} style={{ minHeight: 44 }} data-guide="costing.estimate.price_rows">
                Add rows
              </Button>
            )}
            {canEdit && item.stale_link_ids.length > 0 && (
              <Button variant="primary" size="sm" onClick={() => onReprice(item.id)} disabled={busy} style={{ minHeight: 44 }} data-guide="costing.estimate.reprice">
                Re-price {item.stale_link_ids.length} row{item.stale_link_ids.length === 1 ? "" : "s"}
              </Button>
            )}
            {rfqsOn && canEdit && item.missing_count > 0 && !item.locked && (
              <MissingRfqButton opportunityId={opportunityId} estimateId={item.id} showTip={false} guideId="costing.estimate.rfq" onCreated={onRfqCreated} />
            )}
          </>
        ) : (
          <>
            {item.status !== "draft" && item.status !== "cancelled" && (
              <Button variant={canAward ? "primary" : "secondary"} size="sm" onClick={() => onCompare(item.id)} style={{ minHeight: 44 }} data-guide="costing.rfq.compare">
                {canAward ? "Compare and award" : "Compare"}
              </Button>
            )}
            <Button variant="secondary" size="sm" href={href} style={{ minHeight: 44 }} data-guide="costing.rfq.open">Open RFQ</Button>
            {canAward && item.awarded_unpriced > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Button variant="secondary" size="sm" onClick={() => onPriceAwarded(item.id)} disabled={busy} style={{ minHeight: 44 }} data-guide="costing.rfq.price_awarded">
                  Price {item.awarded_unpriced} awarded row{item.awarded_unpriced === 1 ? "" : "s"}
                </Button>
                <InfoTip label="Price awarded rows">{COSTING_TIPS.awardedUnpriced}</InfoTip>
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
