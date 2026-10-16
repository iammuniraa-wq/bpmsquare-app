"use client";

import { useState, useTransition, useMemo } from "react";
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

type QuoteOption = {
  id: string; ref: string; account_id: string; contact_id: string | null; entity_id: string | null;
  lines: { sl_no: string | null; description: string; uom: string | null; qty: number; rate: number; amount: number }[];
};

type Line = { id: string; description: string; uom: string; qty: string; rate: string };

function newLine(): Line {
  return { id: Math.random().toString(36).slice(2), description: "", uom: "Nos", qty: "1", rate: "0" };
}

export default function InvoiceForm({
  accounts, contacts, entities, quotes, defaultAccountId,
}: {
  accounts: { id: string; name: string }[];
  contacts: { id: string; name: string; account_id: string }[];
  entities: { id: string; name: string; is_default?: boolean }[];
  quotes: QuoteOption[];
  /** Set when arriving from an account page (it passes ?account_id=) --
   *  prefills the account and is where Cancel returns to instead of the
   *  unfiltered invoices list. */
  defaultAccountId?: string | null;
}) {
  const cur = useCurrency();
  const inr = moneyFormatter(cur, { maximumFractionDigits: 0 });
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [contactId, setContactId] = useState("");
  const [entityId, setEntityId] = useState(entities.find((e) => e.is_default)?.id ?? "");
  const [quoteId, setQuoteId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [discountType, setDiscountType] = useState<"pct" | "fixed">("pct");
  const [discountPct, setDiscountPct] = useState("0");
  const [discountFixed, setDiscountFixed] = useState("0");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);

  const accountContacts = contacts.filter((ct) => ct.account_id === accountId);
  const accountQuotes = useMemo(() => quotes.filter((q) => !accountId || q.account_id === accountId), [quotes, accountId]);

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function pickQuote(id: string) {
    setQuoteId(id);
    const quote = quotes.find((q) => q.id === id);
    if (!quote) return;
    setAccountId(quote.account_id);
    if (quote.contact_id) setContactId(quote.contact_id);
    if (quote.entity_id) setEntityId(quote.entity_id);
    if (quote.lines.length > 0) {
      setLines(quote.lines.map((l) => ({
        id: Math.random().toString(36).slice(2),
        description: l.description, uom: l.uom ?? "Nos",
        qty: String(l.qty), rate: String(l.rate),
      })));
    }
  }

  const subtotal = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0), 0);
  const discountAmt = discountType === "pct" ? Math.round(subtotal * (parseFloat(discountPct) || 0) / 100) : (parseFloat(discountFixed) || 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) { setError("Account is required"); return; }
    const cleanLines = lines.filter((l) => l.description.trim());
    if (cleanLines.length === 0) { setError("Add at least one line item"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          contact_id: contactId || null,
          entity_id: entityId || null,
          quote_id: quoteId || null,
          due_date: dueDate || null,
          discount_type: discountType,
          discount_pct: discountPct,
          discount_fixed: discountFixed,
          notes: notes || null,
          terms: terms || null,
          lines: cleanLines.map((l) => ({ description: l.description, uom: l.uom, qty: l.qty, rate: l.rate })),
        }),
      });
      const json = await res.json();
      if (res.ok) router.push(ROUTES.invoice(json.id));
      else setError(json.error ?? "Failed to create invoice");
    });
  }

  return (
    <ObjectFormPage
      backHref={defaultAccountId ? ROUTES.account(defaultAccountId) : ROUTES.invoices}
      backLabel={defaultAccountId ? "Back to account" : "All invoices"}
      title="New Invoice"
      subtitle="Bill an account, optionally from an approved quote"
      headerAction={<AdaptObjectDrawer objectType="invoice" objectLabel="Invoice" isAdmin={true} />}
      onSubmit={handleSubmit}
      saving={pending}
      saveLabel="Save"
      error={error}
      maxWidth={980}
    >
      <Card title="Bill to" padding={18}>
        {accountQuotes.length > 0 && (
          <Field label="From approved quote" hint="Optional — autofills everything below">
            <Select value={quoteId} onChange={(e) => pickQuote(e.target.value)}>
              <option value="">— Manual entry —</option>
              {accountQuotes.map((q) => <option key={q.id} value={q.id}>{q.ref}</option>)}
            </Select>
          </Field>
        )}
        <div className="fg2">
          <Field label="Account" required>
            <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); setContactId(""); setQuoteId(""); }} required>
              <option value="">— Select account —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Contact">
            <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">— None —</option>
              {accountContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
            </Select>
          </Field>
          {entities.length > 0 && (
            <Field label="Issuing entity">
              <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                <option value="">— Select entity —</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name}{e.is_default ? " (default)" : ""}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
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
              <Field label="Description" required>
                <Input value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="What's being billed" />
              </Field>
              <div className="fg3">
                <Field label="UOM" style={{ marginBottom: 0 }}>
                  <Select value={line.uom} onChange={(e) => updateLine(line.id, { uom: e.target.value })}>
                    {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                </Field>
                <Field label="Qty" style={{ marginBottom: 0 }}>
                  <Input type="number" min="0" step="any" value={line.qty} onChange={(e) => updateLine(line.id, { qty: e.target.value })} />
                </Field>
                <Field label={moneyLabel("Rate", cur)} style={{ marginBottom: 0 }}>
                  <Input type="number" min="0" step="0.01" value={line.rate} onChange={(e) => updateLine(line.id, { rate: e.target.value })} />
                </Field>
              </div>
              <div style={{ textAlign: "right", fontSize: 12.5, color: c.muted, marginTop: 6 }}>
                = {inr((parseFloat(line.qty) || 0) * (parseFloat(line.rate) || 0))}
              </div>
            </div>
          ))}
        </div>
        <div className="fg3" style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
          <Field label="Discount type" style={{ marginBottom: 0 }}>
            <Select value={discountType} onChange={(e) => setDiscountType(e.target.value as "pct" | "fixed")}>
              <option value="pct">Percent</option>
              <option value="fixed">Fixed amount</option>
            </Select>
          </Field>
          {discountType === "pct" ? (
            <Field label="Discount %" style={{ marginBottom: 0 }}>
              <Input type="number" min="0" max="100" step="0.1" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
            </Field>
          ) : (
            <Field label={moneyLabel("Discount", cur)} style={{ marginBottom: 0 }}>
              <Input type="number" min="0" step="0.01" value={discountFixed} onChange={(e) => setDiscountFixed(e.target.value)} />
            </Field>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", marginTop: 12, gap: 24 }}>
          <div style={{ fontSize: 12.5, color: c.muted }}>Subtotal: {inr(subtotal)}</div>
          {discountAmt > 0 && <div style={{ fontSize: 12.5, color: c.muted }}>Discount: − {inr(discountAmt)}</div>}
          <div style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Net: {inr(subtotal - discountAmt)} <span style={{ fontSize: 11, fontWeight: 400, color: c.hint }}>(+ tax on print)</span></div>
        </div>
      </Card>

      <Card padding={18}>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Terms" style={{ marginBottom: 0 }}>
          <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms…" />
        </Field>
      </Card>
    </ObjectFormPage>
  );
}
