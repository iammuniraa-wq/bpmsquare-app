import Link from "next/link";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import type { ErpDocument, OrderDetail } from "@/lib/salesOrders/client";
import { fmtDate } from "./logic";
import { fmtMoney } from "./money";
import { ORDER_TIPS } from "./tips";
import s from "./salesOrders.module.css";

function Docs({ title, docs, currency }: { title: string; docs: ErpDocument[]; currency: string }) {
  return (
    <div>
      <div className={s.partyLabel} style={{ marginBottom: 6 }}>{title}</div>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th scope="col">Number</th><th scope="col">Date</th><th scope="col" className={s.num}>Amount</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.href ? <Link href={d.href} style={{ color: "var(--so-accent, var(--accent))", fontWeight: 600 }}>{d.number ?? d.id}</Link> : (d.number ?? "—")}</td>
                <td>{fmtDate(d.date)}</td>
                <td className={s.num}>{d.amount !== null ? fmtMoney(d.amount, currency) : "—"}</td>
                <td>{d.status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The ERP tab ships as a shell in SO1: the ERP id line and empty states until a connector link exists. Deliveries and
 * invoices (read from the ERP, nothing editable) draw as soon as the server sends them; the transfer log waits for SO3.
 * Everything about the connection itself lives on the Integration middleware page; this tab only links to it.
 */
export default function ErpTab({ detail, currency, externalLine, middlewareHref }: {
  detail: OrderDetail;
  currency: string;
  /** The server-rendered ERP id line (ExternalRecordSlot), or nothing. */
  externalLine: React.ReactNode;
  /** Where an admin sets the ERP up; null hides the link (not an admin, or the middleware is off). */
  middlewareHref: string | null;
}) {
  const deliveries = detail.erpDocuments.filter((d) => d.kind === "delivery");
  const invoices = detail.erpDocuments.filter((d) => d.kind === "invoice");
  const any = detail.erpLinked || detail.erpDocuments.length > 0;

  return (
    <div className={s.overview} data-guide="sales_order.erp">
      <Card padding={16}>
        <div className="bpm-label-row" style={{ marginBottom: 8 }}>
          <span className="bpm-t-section">ERP id</span>
          <InfoTip label="ERP id">{ORDER_TIPS.erpId}</InfoTip>
        </div>
        <div className={s.erpId}>
          {externalLine}
          {!any && <span className="bpm-t-help">Not in an ERP</span>}
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

      <Card padding={16}>
        <div className="bpm-label-row" style={{ marginBottom: 8 }}>
          <span className="bpm-t-section">Deliveries and invoices</span>
          <InfoTip label="Deliveries and invoices">{ORDER_TIPS.deliveries}</InfoTip>
        </div>
        {detail.erpDocuments.length === 0 ? (
          <EmptyState title="No deliveries or invoices" text="They appear here when your ERP reports them for this order." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {deliveries.length > 0 && <Docs title="Deliveries" docs={deliveries} currency={currency} />}
            {invoices.length > 0 && <Docs title="Invoices" docs={invoices} currency={currency} />}
          </div>
        )}
      </Card>
    </div>
  );
}
