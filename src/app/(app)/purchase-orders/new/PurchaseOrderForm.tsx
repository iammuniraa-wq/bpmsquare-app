"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { useCurrency } from "@/lib/tenant-context";
import { moneyFormatter, moneyLabel } from "@/lib/currency";
import { ROUTES, UOM_OPTIONS } from "@/lib/constants";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";

type InventoryOption = { id: string; sku: string | null; name: string; uom: string; unit_cost: number | null };

type Line = {
  id: string;
  inventory_item_id: string | null;
  description: string;
  uom: string;
  qty_ordered: string;
  rate: string;
};

function newLine(): Line {
  return { id: Math.random().toString(36).slice(2), inventory_item_id: null, description: "", uom: "Nos", qty_ordered: "1", rate: "0" };
}

export default function PurchaseOrderForm({
  suppliers, quotes, cases, items,
}: {
  suppliers: { id: string; name: string }[];
  quotes: { id: string; ref: string }[];
  cases: { id: string; ref: string }[];
  items: InventoryOption[];
}) {
  const cur = useCurrency();
  const inr = moneyFormatter(cur, { maximumFractionDigits: 0 });
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function pickInventoryItem(id: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) { updateLine(id, { inventory_item_id: null }); return; }
    updateLine(id, {
      inventory_item_id: item.id,
      description: item.sku ? `${item.name} (${item.sku})` : item.name,
      uom: item.uom,
      rate: item.unit_cost != null ? String(item.unit_cost) : "0",
    });
  }

  const total = lines.reduce((s, l) => s + (parseFloat(l.qty_ordered) || 0) * (parseFloat(l.rate) || 0), 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) { setError("Supplier is required"); return; }
    const cleanLines = lines.filter((l) => l.description.trim());
    if (cleanLines.length === 0) { setError("Add at least one line item"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: supplierId,
          quote_id: quoteId || null,
          case_id: caseId || null,
          order_date: orderDate || null,
          expected_date: expectedDate || null,
          notes: notes || null,
          terms: terms || null,
          lines: cleanLines.map((l) => ({
            inventory_item_id: l.inventory_item_id,
            description: l.description,
            uom: l.uom,
            qty_ordered: l.qty_ordered,
            rate: l.rate,
          })),
        }),
      });
      const json = await res.json();
      if (res.ok) router.push(ROUTES.purchaseOrder(json.id));
      else setError(json.error ?? "Failed to create purchase order");
    });
  }

  return (
    <ObjectFormPage
      backHref={ROUTES.purchaseOrders}
      backLabel="All purchase orders"
      title="New Purchase Order"
      subtitle="Order stock from a supplier"
      headerAction={<AdaptObjectDrawer objectType="purchase_order" objectLabel="Purchase Order" isAdmin={true} />}
      onSubmit={handleSubmit}
      saving={pending}
      saveLabel="Save"
      error={error}
      maxWidth={980}
    >
      <Card title="Order details" padding={18}>
        <div className="fg2">
          <Field label="Supplier" required>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">— Select supplier —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Order date">
            <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </Field>
          <Field label="Linked quote" hint="Optional">
            <Select value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
              <option value="">— None —</option>
              {quotes.map((q) => <option key={q.id} value={q.id}>{q.ref}</option>)}
            </Select>
          </Field>
          <Field label="Linked case" hint="Optional">
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">— None —</option>
              {cases.map((cs) => <option key={cs.id} value={cs.id}>{cs.ref}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Expected delivery date">
          <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Terms" style={{ marginBottom: 0 }}>
          <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms, delivery conditions…" />
        </Field>
      </Card>

      <Card
        title="Line items"
        padding={18}
        action={<Button variant="quiet" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>+ Add line</Button>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {lines.map((line, idx) => (
            <div key={line.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: c.hint }}>Line {idx + 1}</span>
                {lines.length > 1 && (
                  <span style={{ marginLeft: "auto" }}>
                    <Button variant="quiet" size="sm" onClick={() => setLines((ls) => ls.filter((l) => l.id !== line.id))}>Remove</Button>
                  </span>
                )}
              </div>
              <Field label="From inventory" hint="Optional — autofills below">
                <Select value={line.inventory_item_id ?? ""} onChange={(e) => pickInventoryItem(line.id, e.target.value)}>
                  <option value="">— Free-text line —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.sku ? `${i.name} (${i.sku})` : i.name}</option>)}
                </Select>
              </Field>
              <Field label="Description" required>
                <Input value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="What's being ordered" />
              </Field>
              <div className="fg3">
                <Field label="UOM" style={{ marginBottom: 0 }}>
                  <Select value={line.uom} onChange={(e) => updateLine(line.id, { uom: e.target.value })}>
                    {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                </Field>
                <Field label="Qty" style={{ marginBottom: 0 }}>
                  <Input type="number" min="0" step="any" value={line.qty_ordered} onChange={(e) => updateLine(line.id, { qty_ordered: e.target.value })} />
                </Field>
                <Field label={moneyLabel("Rate", cur)} style={{ marginBottom: 0 }}>
                  <Input type="number" min="0" step="0.01" value={line.rate} onChange={(e) => updateLine(line.id, { rate: e.target.value })} />
                </Field>
              </div>
              <div style={{ textAlign: "right", fontSize: 12.5, color: c.muted, marginTop: 6 }}>
                = {inr((parseFloat(line.qty_ordered) || 0) * (parseFloat(line.rate) || 0))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Total: {inr(total)}</div>
        </div>
      </Card>
    </ObjectFormPage>
  );
}
