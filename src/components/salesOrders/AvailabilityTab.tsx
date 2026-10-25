import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import type { SalesOrderLine } from "@/lib/salesOrders/types";
import { availabilityRows, type ErpStock, availabilityStatus, fmtDate, fmtDateTime, lastChecked, rowNote, tagText, type AvailRow } from "./logic";
import { ORDER_TIPS } from "./tips";
import s from "./salesOrders.module.css";

const noteClass = (r: AvailRow) => (r.state === "short" ? s.stateShort : r.state === "late" ? s.stateLate : r.state === "ok" ? s.stateOk : s.muted);

function Tag({ r }: { r: AvailRow }) {
  const { tag } = r;
  return (
    <span>
      <span className={`${s.tag} ${tag.kind === "erp" ? s.tagErp : tag.kind === "master" ? s.tagMaster : s.tagNone}`} data-source={tag.kind}>{tagText(tag)}</span>
      {tag.kind === "erp" && tag.detail && <div className={s.pairSub}>{tag.detail}</div>}
    </span>
  );
}

const asked = (l: SalesOrderLine) => (
  <span className={s.pair}>
    <span>{l.qty}{l.uom ? ` ${l.uom}` : ""}</span>
    <span className={s.pairSub}>by {fmtDate(l.requested_date)}</span>
  </span>
);
const confirmed = (l: SalesOrderLine) => (
  <span className={s.pair}>
    <span>{l.confirmed_qty === null ? "—" : `${l.confirmed_qty}${l.uom ? ` ${l.uom}` : ""}`}</span>
    <span className={s.pairSub}>{l.confirmed_date ? `on ${fmtDate(l.confirmed_date)}` : "no date"}</span>
  </span>
);

/**
 * Availability: what was asked and wanted-by, against what is confirmed and when (the SAP schedule-line idea), with the
 * source of every value tagged: ERP (read-only, with the time it was fetched) or Master data (an estimate). One tab, one
 * rule; no bars anywhere else. A stale banner appears when lines changed since the last check.
 */
export default function AvailabilityTab({ lines, canRefresh, refreshing, onRefresh, erpStock }: {
  lines: SalesOrderLine[];
  /** The ERP's stock figure per line id, from the last Check with ERP; absent or empty until one has run. */
  erpStock?: Map<string, ErpStock>;
  canRefresh: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const rows = availabilityRows(lines);
  const status = availabilityStatus(lines);
  const checked = lastChecked(lines);
  const showStock = !!erpStock && erpStock.size > 0;
  const stockCell = (l: SalesOrderLine) => {
    const f = erpStock?.get(l.id);
    if (!f) return <span className={s.muted}>—</span>;
    return (
      <span>
        <span className={`${s.tag} ${s.tagErp}`} data-source="erp">ERP</span>{" "}
        <span>{f.onHand === null ? "no figure" : `${f.onHand}${l.uom ? ` ${l.uom}` : ""} on hand`}</span>
        <div className={s.pairSub}>{f.stale ? "out of date" : `checked ${fmtDateTime(f.checkedAt)}`}</div>
      </span>
    );
  };

  return (
    <div className={s.overview} data-guide="sales_order.availability">
      {status === "stale" && (
        <div className={s.banner} role="status" data-guide="sales_order.stale">
          <span>Lines changed since the last check, so these dates may be out of date.</span>
          {canRefresh && <Button size="sm" variant="secondary" loading={refreshing} onClick={onRefresh} data-guide="sales_order.stale_refresh">Refresh</Button>}
        </div>
      )}

      <Card padding={0}>
        <div className={s.availHead} style={{ padding: "14px 16px 0" }}>
          <span className="bpm-label-row">
            <span className="bpm-t-section">Availability</span>
            <InfoTip label="Availability">{ORDER_TIPS.availability}</InfoTip>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {checked && status !== "stale" && <span className="bpm-t-help">Checked {fmtDateTime(checked)}</span>}
            {canRefresh && lines.length > 0 && (
              <Button variant="secondary" loading={refreshing} onClick={onRefresh} data-guide="sales_order.availability_refresh">{status === "unchecked" ? "Check availability" : "Refresh"}</Button>
            )}
          </span>
        </div>

        {lines.length === 0 ? (
          <div style={{ padding: "0 0 8px" }}><div style={{ padding: "26px 24px", textAlign: "center" }} className="bpm-t-help">Add lines to see availability.</div></div>
        ) : (
          <>
            <div className={s.tableOnly}>
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr><th scope="col">Item</th><th scope="col">Asked</th><th scope="col">Confirmed</th><th scope="col">Result</th><th scope="col">Source</th>{showStock && <th scope="col">ERP stock</th>}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.line.id} data-state={r.state}>
                        <td>{r.line.description}</td>
                        <td>{asked(r.line)}</td>
                        <td>{confirmed(r.line)}</td>
                        <td className={noteClass(r)}>{rowNote(r)}</td>
                        <td><Tag r={r} /></td>
                        {showStock && <td data-guide="sales_order.erp_stock">{stockCell(r.line)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className={s.cards} style={{ padding: 12 }}>
              {rows.map((r) => (
                <div key={r.line.id} className={s.card} data-state={r.state}>
                  <div className={s.cardTitle}>{r.line.description}</div>
                  <dl className={s.cardGrid}>
                    <dt>Asked</dt><dd>{asked(r.line)}</dd>
                    <dt>Confirmed</dt><dd>{confirmed(r.line)}</dd>
                    <dt>Result</dt><dd className={noteClass(r)}>{rowNote(r)}</dd>
                    <dt>Source</dt><dd><Tag r={r} /></dd>
                    {showStock && <><dt>ERP stock</dt><dd>{stockCell(r.line)}</dd></>}
                  </dl>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
