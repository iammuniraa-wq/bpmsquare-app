"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { patchOrder, type OrderDetail, type PatchOrderBody } from "@/lib/salesOrders/client";
import { ORDER_TIPS } from "./tips";
import { detailPatch, type DetailDraft } from "./detailDraft";
import s from "./salesOrders.module.css";

/**
 * "Edit details": the header fields Overview deliberately does not show as a form. On a draft made here every field is
 * open; on a confirmed order made here only the customer PO and notes (the annotatable fields) are.
 */
export default function EditDetailsPanel({ detail, editable, onClose, onSaved }: {
  detail: OrderDetail;
  /** orderEditable: everything open. Otherwise only customer PO and notes. */
  editable: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { order } = detail;
  const [d, setD] = useState<DetailDraft>({
    customer_po: order.customer_po ?? "", requested_date: order.requested_date ?? "", notes: order.notes ?? "", terms: order.terms ?? "",
    ship_name: order.ship_to?.name ?? "", ship_address: order.ship_to?.address ?? "", bill_name: order.bill_to?.name ?? "", bill_address: order.bill_to?.address ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (p: Partial<DetailDraft>) => setD((cur) => ({ ...cur, ...p }));

  async function save() {
    const body: PatchOrderBody = detailPatch(d, editable);
    setBusy(true); setError("");
    const res = await patchOrder(order.id, body);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onSaved();
  }

  return (
    <SidePanel
      title="Edit details"
      subtitle={order.ref}
      onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()} data-guide="sales_order.details_save">Save</Button></>}
    >
      <Field label="Customer PO" info={ORDER_TIPS.customerPo} htmlFor="so-po">
        <Input id="so-po" data-guide="sales_order.details_po" value={d.customer_po} onChange={(e) => set({ customer_po: e.target.value })} autoFocus />
      </Field>
      {editable && (
        <>
          <Field label="Requested date" info={ORDER_TIPS.requestedDate} htmlFor="so-rd">
            <Input id="so-rd" data-guide="sales_order.details_wanted" type="date" value={d.requested_date} onChange={(e) => set({ requested_date: e.target.value })} />
          </Field>
          <Field label="Ship to" info={ORDER_TIPS.shipTo} htmlFor="so-sn">
            <Input id="so-sn" data-guide="sales_order.details_ship_name" value={d.ship_name} onChange={(e) => set({ ship_name: e.target.value })} placeholder="Name" />
          </Field>
          <Field label="Ship-to address" htmlFor="so-sa">
            <Textarea id="so-sa" data-guide="sales_order.details_ship_address" value={d.ship_address} onChange={(e) => set({ ship_address: e.target.value })} style={{ minHeight: 60 }} />
          </Field>
        </>
      )}
      <details className={s.more}>
        <summary>More</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 }}>
          {editable && (
            <>
              <Field label="Bill to" hint="Leave empty if it is the customer" htmlFor="so-bn">
                <Input id="so-bn" data-guide="sales_order.details_bill_name" value={d.bill_name} onChange={(e) => set({ bill_name: e.target.value })} placeholder="Name" />
              </Field>
              <Field label="Bill-to address" htmlFor="so-ba">
                <Textarea id="so-ba" data-guide="sales_order.details_bill_address" value={d.bill_address} onChange={(e) => set({ bill_address: e.target.value })} style={{ minHeight: 60 }} />
              </Field>
              <Field label="Terms" htmlFor="so-terms">
                <Textarea id="so-terms" data-guide="sales_order.details_terms" value={d.terms} onChange={(e) => set({ terms: e.target.value })} placeholder="Payment terms…" />
              </Field>
            </>
          )}
          <Field label="Notes" htmlFor="so-notes">
            <Textarea id="so-notes" data-guide="sales_order.details_notes" value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      </details>
      {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>}
    </SidePanel>
  );
}
