"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { useFeel } from "@/components/FeelProvider";
import { putLines, type OrderDetail } from "@/lib/salesOrders/client";
import { fmtDate } from "./logic";
import { fmtMoney } from "./money";
import { fromLine, lineProblem, linesChanged, meaningful, newEditLine, toInput, type EditLine, type PickProduct } from "./lines";
import OrderLinesEditor from "./OrderLinesEditor";
import s from "./salesOrders.module.css";

function Printed({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <details className={s.printed}>
      <summary>Printed text</summary>
      <div className={s.printedText}>{text}</div>
    </details>
  );
}

/**
 * Lines: a real table of item, quantity, unit price, discount and line total, each with its printed text one tap away.
 * Editable only while `editable` (the one rule, orderEditable); otherwise read-only. A phone gets cards, not a
 * sideways-scrolling table.
 */
export default function LinesTab({ detail, currency, editable, products, onSaved, onDirty }: {
  detail: OrderDetail;
  currency: string;
  editable: boolean;
  products: PickProduct[];
  onSaved: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const { order, lines } = detail;
  const { toast } = useFeel();
  const defaults = { tax_pct: lines[0] ? String(lines[0].tax_pct) : "0", requested_date: order.requested_date ?? "" };
  const original = lines.length > 0 ? lines.map(fromLine) : [newEditLine(defaults)];
  const [draft, setDraft] = useState<EditLine[]>(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = editable && linesChanged(draft, original);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  async function save() {
    const problem = lineProblem(draft);
    if (problem) { setError(problem); return; }
    setError("");
    setSaving(true);
    const res = await putLines(order.id, meaningful(draft).map(toInput));
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    toast({ text: "Lines saved. Availability will be checked again.", tone: "success" });
    onSaved();
  }

  if (editable) {
    return (
      <Card padding={16}>
        <OrderLinesEditor lines={draft} onChange={setDraft} products={products} currency={currency} pricingMode={order.pricing_mode} defaults={defaults} />
        {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)", marginTop: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          {dirty && <span className="bpm-t-help" style={{ color: "var(--amberink)", fontWeight: 600 }}>Unsaved changes</span>}
          <Button disabled={!dirty || saving} onClick={() => { setDraft(original); setError(""); }} data-guide="sales_order.lines_discard">Discard</Button>
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()} data-guide="sales_order.lines_save">Save lines</Button>
        </div>
      </Card>
    );
  }

  if (lines.length === 0) {
    return <Card padding={0}><EmptyState title="No lines on this order" text="Lines appear here once they are added, or once the ERP sends them." /></Card>;
  }

  return (
    <Card padding={0}>
      <div className={s.tableOnly}>
        <div className={s.tableWrap}>
          <table className={s.table} data-guide="sales_order.lines">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className={s.num}>Qty</th>
                <th scope="col" className={s.num}>Unit price</th>
                <th scope="col" className={s.num}>Discount</th>
                <th scope="col" className={s.num}>Line total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div>{l.description}</div>
                    {l.requested_date && <div className={s.muted} style={{ fontSize: 12 }}>Wanted by {fmtDate(l.requested_date)}</div>}
                    <Printed text={l.printed_text} />
                  </td>
                  <td className={s.num}>{l.qty}{l.uom ? ` ${l.uom}` : ""}</td>
                  <td className={s.num}>{fmtMoney(l.unit_price, currency)}</td>
                  <td className={s.num}>{l.discount_pct > 0 ? `${l.discount_pct}%` : "—"}</td>
                  <td className={s.num} style={{ fontWeight: 600 }}>{fmtMoney(l.line_total, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={s.cards} style={{ padding: 12 }}>
        {lines.map((l) => (
          <div key={l.id} className={s.card}>
            <div className={s.cardTitle}>{l.description}</div>
            <dl className={s.cardGrid}>
              <dt>Qty</dt><dd>{l.qty}{l.uom ? ` ${l.uom}` : ""}</dd>
              <dt>Unit price</dt><dd>{fmtMoney(l.unit_price, currency)}</dd>
              <dt>Discount</dt><dd>{l.discount_pct > 0 ? `${l.discount_pct}%` : "—"}</dd>
              <dt>Line total</dt><dd style={{ fontWeight: 700 }}>{fmtMoney(l.line_total, currency)}</dd>
            </dl>
            <Printed text={l.printed_text} />
          </div>
        ))}
      </div>

      <div className={s.totals} style={{ padding: "0 16px 14px" }}>
        {order.subtotal > 0 && <span>Subtotal {fmtMoney(order.subtotal, currency)}</span>}
        {order.discount_total > 0 && <span>Discount −{fmtMoney(order.discount_total, currency)}</span>}
        {order.tax_total > 0 && <span>Tax {fmtMoney(order.tax_total, currency)}</span>}
        {order.shipping_amount > 0 && <span>Shipping {fmtMoney(order.shipping_amount, currency)}</span>}
        <span className={s.totalsBig}>Total {fmtMoney(order.total, currency)}</span>
      </div>
    </Card>
  );
}
