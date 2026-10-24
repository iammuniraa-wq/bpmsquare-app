import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import type { ErpDocument, OrderDetail } from "@/lib/salesOrders/client";
import { fmtDate, fmtDateTime, statusLabel, statusTone, type Tone } from "./logic";
import { fmtMoney } from "./money";
import { ORDER_TIPS } from "./tips";
import s from "./salesOrders.module.css";

/** One word-colour per document spine; the ERP's own wording is what the chip says. */
const DOC_TONE: Record<string, Tone> = { paid: "green", delivered: "green", open: "amber", closed: "blue", cancelled: "red" };

function Docs({ title, docs, currency, empty, delivery }: { title: string; docs: ErpDocument[]; currency: string; empty: string; delivery?: boolean }) {
  return (
    <div data-guide={delivery ? "sales_order.erp_deliveries" : "sales_order.erp_invoices"}>
      <div className={s.partyLabel} style={{ marginBottom: 6 }}>{title}</div>
      {docs.length === 0 ? (
        <p className="bpm-t-help" style={{ margin: 0 }}>{empty}</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Number</th><th scope="col">Date</th>{!delivery && <th scope="col">Due</th>}<th scope="col" className={s.num}>Amount</th><th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.href ? <a href={d.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--so-accent, var(--accent))", fontWeight: 600 }}>{d.number ?? d.id}</a> : (d.number ?? "—")}</td>
                  <td>{fmtDate(d.date)}</td>
                  {!delivery && <td>{fmtDate(d.due)}</td>}
                  <td className={s.num}>{d.amount !== null ? fmtMoney(d.amount, d.currency || currency) : "—"}</td>
                  <td>{d.status ? <StatusPill label={d.status} tone={DOC_TONE[d.spine ?? ""] ?? "blue"} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The ERP tab: the ERP number and status with when they were last read, a Refresh, then the invoices and deliveries the
 * ERP reported (read-only). Everything about the connection itself lives on the Integration middleware page; this tab only
 * links to it. Deliveries stay empty until a connector returns them (Finance & Operations and SAP deliveries are later).
 */
export default function ErpTab({ detail, currency, externalLine, middlewareHref, onRefresh, refreshing }: {
  detail: OrderDetail;
  currency: string;
  /** The server-rendered ERP id line (ExternalRecordSlot), or nothing. */
  externalLine: React.ReactNode;
  /** Where an admin sets the ERP up; null hides the link (not an admin, or the middleware is off). */
  middlewareHref: string | null;
  /** Ask the ERP again about this order; absent when the order is not in an ERP. */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { order } = detail;
  const deliveries = detail.erpDocuments.filter((d) => d.kind === "delivery");
  const invoices = detail.erpDocuments.filter((d) => d.kind === "invoice");
  const inErp = detail.erpLinked || order.origin === "erp";
  const number = detail.erpLink?.number ?? (order.origin === "erp" ? order.ref : null);
  const read = detail.erpLink?.checkedAt ?? detail.erpLink?.syncedAt ?? null;

  return (
    <div className={s.overview} data-guide="sales_order.erp">
      <Card padding={16}>
        <div className="bpm-label-row" style={{ marginBottom: 8 }}>
          <span className="bpm-t-section">ERP</span>
          <InfoTip label="ERP">{ORDER_TIPS.erpId}</InfoTip>
        </div>
        <div className={s.erpId}>
          {externalLine}
          {!inErp && <span className="bpm-t-help">Not in an ERP</span>}
        </div>
        {inErp && (
          <div className={s.facts} style={{ marginTop: 12 }}>
            <div className={s.fact} data-guide="sales_order.erp_number">
              <div className={s.factLabel}>ERP number</div>
              <div className={s.factValue}>{number ?? "—"}</div>
            </div>
            <div className={s.fact} data-guide="sales_order.erp_status">
              <div className={s.factLabel}>ERP status</div>
              <div className={s.factValue}>{order.status_label ? <StatusPill label={statusLabel(order)} tone={statusTone(order)} /> : "—"}</div>
            </div>
            <div className={s.fact} data-guide="sales_order.erp_synced">
              <div className={s.factLabel}>Last read</div>
              <div className={s.factSub}>{read ? fmtDateTime(read) : "Not yet"}</div>
              {onRefresh && <Button size="sm" loading={refreshing} onClick={onRefresh} data-guide="sales_order.erp_refresh">Refresh</Button>}
            </div>
          </div>
        )}
      </Card>

      <Card padding={16}>
        <div className="bpm-label-row" style={{ marginBottom: 8 }}>
          <span className="bpm-t-section">Invoices and deliveries</span>
          <InfoTip label="Invoices and deliveries">{ORDER_TIPS.deliveries}</InfoTip>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Docs title="Invoices" docs={invoices} currency={currency} empty="Invoices from Dynamics 365 appear here. Nothing yet." />
          <Docs title="Deliveries" docs={deliveries} currency={currency} delivery empty="Deliveries come from F&O or SAP, which are not connected." />
        </div>
      </Card>

      <Card padding={16}>
        <div className="bpm-label-row" style={{ marginBottom: 8 }}>
          <span className="bpm-t-section">Transfer log</span>
          <InfoTip label="Transfer log">{ORDER_TIPS.transfer}</InfoTip>
        </div>
        <EmptyState
          title="Nothing sent yet"
          text="Checks and transfers to your ERP will be logged here."
          action={middlewareHref ? <Button href={middlewareHref} data-guide="sales_order.erp_setup">Set up your ERP</Button> : undefined}
        />
      </Card>
    </div>
  );
}
