"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import FormFooter from "@/components/ui/FormFooter";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { ROUTES } from "@/lib/constants";
import { setUnsavedGuard, useUnsavedChangesGuard } from "@/lib/unsavedChanges";
import { createOrder } from "@/lib/salesOrders/client";
import type { PricingMode } from "@/lib/salesOrders/types";
import { lineProblem, meaningful, newEditLine, toInput, type EditLine, type PickAccount, type PickProduct } from "./lines";
import CustomerPicker from "./CustomerPicker";
import OrderLinesEditor from "./OrderLinesEditor";
import { ORDER_TIPS } from "./tips";
import s from "./salesOrders.module.css";

export type FormType = { id: string; name: string; is_default: boolean; pricing_mode: PricingMode };
export type FormContact = { id: string; name: string; account_id: string };

/**
 * New sales order: customer, contact, type (automatic by default) and lines; the date wanted and the customer PO are
 * one step away, everything else (ship-to, notes) sits behind More and defaults from the customer. An order made from a
 * quote does not use this screen: "Create sales order" on the quote copies it.
 */
export default function SalesOrderForm({ accounts, contacts, types, products, currency }: {
  accounts: PickAccount[];
  contacts: FormContact[];
  types: FormType[];
  products: PickProduct[];
  currency: string;
}) {
  const router = useRouter();
  const [account, setAccount] = useState<PickAccount | null>(null);
  const [contactId, setContactId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [po, setPo] = useState("");
  const [wanted, setWanted] = useState("");
  const [shipName, setShipName] = useState("");
  const [shipAddress, setShipAddress] = useState("");
  const [shipTouched, setShipTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<EditLine[]>([newEditLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const pickedType = types.find((t) => t.id === typeId) ?? null;
  const snapshot = JSON.stringify({ account: account?.id, contactId, typeId, po, wanted, shipName, shipAddress, notes, lines: lines.map(({ key: _k, ...r }) => r) });
  const [initial] = useState(snapshot);
  const dirty = !saved && snapshot !== initial;
  useUnsavedChangesGuard(dirty, { body: "This order has not been created yet. If you leave now what you typed will be lost." });

  function pickAccount(a: PickAccount | null) {
    setAccount(a);
    setContactId("");
    if (a && !shipTouched) { setShipName(a.name); setShipAddress(a.address); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!account) { setError("Choose the customer first"); return; }
    const problem = lineProblem(lines);
    if (problem) { setError(problem); return; }
    setError("");
    setBusy(true);
    const res = await createOrder({
      account_id: account.id,
      contact_id: contactId || null,
      type_id: typeId || undefined,
      customer_po: po.trim() || null,
      requested_date: wanted || null,
      currency,
      notes: notes.trim() || null,
      ship_to: shipName.trim() ? { name: shipName.trim(), address: shipAddress.trim() || null } : null,
      lines: meaningful(lines).map(toInput),
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setSaved(true);
    setUnsavedGuard(null);
    router.push(ROUTES.salesOrder(res.data.id));
  }

  const accountContacts = account ? contacts.filter((c) => c.account_id === account.id) : [];

  return (
    <div className={s.formShell}>
      <div><Link href={ROUTES.salesOrders} className="bpm-backlink">← All sales orders</Link></div>
      <PageHeader title="New sales order" />
      <form onSubmit={submit} className="bpm-form-page" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card padding={18}>
            <div className={s.formGrid}>
              <Field label="Customer" required info={ORDER_TIPS.customer} htmlFor="so-customer">
                <CustomerPicker id="so-customer" accounts={accounts} value={account} onPick={pickAccount} />
              </Field>
              <Field label="Contact" htmlFor="so-contact">
                <Select id="so-contact" value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!account} data-guide="sales_order.contact">
                  <option value="">— None —</option>
                  {accountContacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Order type" info={ORDER_TIPS.type} htmlFor="so-type">
                <Select id="so-type" value={typeId} onChange={(e) => setTypeId(e.target.value)} data-guide="sales_order.type_select">
                  <option value="">Automatic</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_default ? " (default)" : ""}</option>)}
                </Select>
              </Field>
              <Field label="Customer PO" info={ORDER_TIPS.customerPo} htmlFor="so-po">
                <Input id="so-po" value={po} onChange={(e) => setPo(e.target.value)} data-guide="sales_order.po" />
              </Field>
              <Field label="Requested date" info={ORDER_TIPS.requestedDate} htmlFor="so-wanted">
                <Input id="so-wanted" type="date" value={wanted} onChange={(e) => { setWanted(e.target.value); setLines((ls) => ls.map((l) => (l.requested_date === "" || l.requested_date === wanted ? { ...l, requested_date: e.target.value } : l))); }} data-guide="sales_order.wanted" />
              </Field>
            </div>
            <details className={s.more}>
              <summary>More</summary>
              <div className={s.formGrid} style={{ paddingTop: 8 }}>
                <Field label="Ship to" info={ORDER_TIPS.shipTo} htmlFor="so-shipname">
                  <Input id="so-shipname" value={shipName} onChange={(e) => { setShipName(e.target.value); setShipTouched(true); }} placeholder="Name" />
                </Field>
                <Field label="Ship-to address" htmlFor="so-shipaddr">
                  <Textarea id="so-shipaddr" value={shipAddress} onChange={(e) => { setShipAddress(e.target.value); setShipTouched(true); }} style={{ minHeight: 60 }} />
                </Field>
                <Field label="Notes" htmlFor="so-notes">
                  <Textarea id="so-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </div>
            </details>
          </Card>

          <Card padding={16}>
            <OrderLinesEditor
              lines={lines}
              onChange={setLines}
              products={products}
              currency={currency}
              pricingMode={pickedType?.pricing_mode ?? null}
              defaults={{ requested_date: wanted }}
              idPrefix="new"
            />
          </Card>
        </div>

        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)", marginTop: 14 }}>{error}</div>}
        <FormFooter cancelHref={ROUTES.salesOrders} saving={busy} saveLabel="Create order" left={dirty ? <span className="bpm-t-help" style={{ color: "var(--amberink)", fontWeight: 600 }}>Unsaved changes</span> : undefined} />
      </form>
    </div>
  );
}
