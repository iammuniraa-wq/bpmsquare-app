"use client";

import Link from "next/link";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { ageText, rowsText, type CostingItem } from "@/lib/tender/costing/rules";
import { COSTING_TIPS, type CostingTipKey } from "@/lib/tender/costing/tips";
import MissingRfqButton from "../MissingRfqButton";
import s from "../BoqRows.module.css";

// The Costing list on a desktop: one table, one line per estimate or RFQ (Type, Reference, the BOQ rows it prices, State, Cost, Age and the
// actions). The phone keeps CostingRow cards. Costs are internal; this tab is for people who may see Estimates or RFQs.

const money = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function Head({ label, tip, num }: { label: string; tip?: CostingTipKey; num?: boolean }) {
  return (
    <th scope="col" className={num ? s.num : undefined}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>{label}{tip && <InfoTip label={label}>{COSTING_TIPS[tip]}</InfoTip>}</span>
    </th>
  );
}

export default function CostSourcesTable({ items, opportunityId, today, canEdit, canAward, rfqsOn, onOpenBoq, onCompare, onPriceRows, onReprice, onPriceAwarded, onRfqCreated, busy, comparingId }: {
  items: readonly CostingItem[];
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
  onRfqCreated?: () => void;
  busy?: boolean;
  comparingId?: string | null;
}) {
  return (
    <div className={s.wrap} data-guide="costing.table">
      <table className={s.table}>
        <thead>
          <tr>
            <Head label="Type" tip="tab" /><th scope="col">Reference</th><Head label="Prices BOQ rows" tip="priceRows" /><Head label="State" tip="state" />
            <Head label="Cost" tip="total" num /><Head label="Age" tip="age" /><th scope="col"><span className="bpm-sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isEstimate = item.kind === "estimate";
            const name = isEstimate ? `${item.ref ? `${item.ref} · ` : ""}${item.name}` : `${item.ref ? `${item.ref} · ` : ""}${item.title}`;
            const href = isEstimate ? `/estimates/${item.id}` : `/rfqs/${item.id}`;
            const when = isEstimate ? `Changed ${ageText(item.updated_at, today)}` : `Raised ${ageText(item.created_at, today)}`;
            return (
              <tr key={`${item.kind}:${item.id}`} data-guide={isEstimate ? "costing.estimate" : "costing.rfq"} aria-selected={comparingId === item.id}>
                <td><StatusPill label={isEstimate ? "Estimate" : "RFQ"} tone={isEstimate ? "blue" : "purple"} /></td>
                <td className={s.desc}>
                  <Link href={href} data-guide="costing.open" style={{ fontWeight: 700, color: "inherit", minHeight: 44, display: "inline-flex", alignItems: "center", overflowWrap: "anywhere" }}>{name}</Link>
                  {!isEstimate && item.origin === "estimate" && <div className={s.muted}>{item.origin_label ?? "from an estimate"}</div>}
                  {isEstimate && item.rfqs.length > 0 && (
                    <div data-guide="costing.estimate.rfqs" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {item.rfqs.map((r) => (
                        <button key={r.id} type="button" onClick={() => onCompare(r.id)} data-guide="costing.estimate.rfq_chip"
                          style={{ minHeight: 44, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--panel2)", color: "var(--ink)", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {r.ref ?? "RFQ"} <span style={{ color: "var(--muted)" }}>{r.status_label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </td>
                <td data-guide="costing.rows">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                    <b>{rowsText(item.rows)}</b>
                    {item.rows.count > 0 && onOpenBoq && <Button variant="quiet" size="sm" onClick={onOpenBoq} style={{ minHeight: 44 }} data-guide="costing.rows.open">open</Button>}
                  </span>
                </td>
                <td data-guide="costing.state"><StatusPill label={item.state.label} tone={item.state.tone} /></td>
                <td className={s.num} data-guide="costing.total">
                  {!isEstimate && <span className={s.muted}>{item.total_is_awarded ? "Awarded " : "Best "}</span>}
                  <b>{money(isEstimate ? item.cost_total : item.total)}</b>
                  {isEstimate && item.currency ? <span className={s.muted}> {item.currency}</span> : null}
                </td>
                <td data-guide="costing.age" className={s.muted} style={{ whiteSpace: "nowrap" }}>{when}</td>
                <td>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
                    {isEstimate ? (
                      <>
                        <Button variant="secondary" size="sm" href={href} style={{ minHeight: 44 }} data-guide="costing.estimate.open">Open</Button>
                        {canEdit && !item.locked && (
                          <Button variant="secondary" size="sm" onClick={() => onPriceRows(item.id)} disabled={busy} style={{ minHeight: 44 }} data-guide="costing.estimate.price_rows">Add rows</Button>
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
