"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES, UOM_OPTIONS } from "@/lib/constants";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";

type QuoteOption = {
  id: string; ref: string; account_id: string; contact_id: string | null; entity_id: string | null;
  lines: { sl_no: string | null; description: string; uom: string | null; qty: number; rate: number; amount: number }[];
};

type Line = { id: string; description: string; uom: string; qty: string; rate: string };

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const fw: React.CSSProperties = { marginBottom: 16 };
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

function newLine(): Line {
  return { id: Math.random().toString(36).slice(2), description: "", uom: "Nos", qty: "1", rate: "0" };
}

export default function InvoiceForm({
  accounts, contacts, entities, quotes,
}: {
  accounts: { id: string; name: string }[];
  contacts: { id: string; name: string; account_id: string }[];
  entities: { id: string; name: string; is_default?: boolean }[];
  quotes: QuoteOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [accountId, setAccountId] = useState("");
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
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={ROUTES.invoices} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All invoices
        </Link>
      </div>

      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Invoice</h1>
          <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Bill an account, optionally from an approved quote</p>
        </div>
        <AdaptObjectDrawer objectType="invoice" objectLabel="Invoice" isAdmin={true} />
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 16px" }}>Bill to</h3>
              {accountQuotes.length > 0 && (
                <div style={fw}>
                  <label style={lbl}>From approved quote <span style={{ color: c.hint, textTransform: "none", fontWeight: 400 }}>(optional — autofills everything below)</span></label>
                  <select style={inp} value={quoteId} onChange={(e) => pickQuote(e.target.value)}>
                    <option value="">— Manual entry —</option>
                    {accountQuotes.map((q) => <option key={q.id} value={q.id}>{q.ref}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={lbl}>Account *</label>
                  <select style={inp} value={accountId} onChange={(e) => { setAccountId(e.target.value); setContactId(""); setQuoteId(""); }} required>
                    <option value="">— Select account —</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Contact</label>
                  <select style={inp} value={contactId} onChange={(e) => setContactId(e.target.value)}>
                    <option value="">— None —</option>
                    {accountContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {entities.length > 0 && (
                  <div>
                    <label style={lbl}>Issuing entity</label>
                    <select style={inp} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                      <option value="">— Select entity —</option>
                      {entities.map((e) => <option key={e.id} value={e.id}>{e.name}{e.is_default ? " (default)" : ""}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label style={lbl}>Due date</label>
                  <input style={inp} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            </section>

            <section style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: 0 }}>Line items</h3>
                <button
                  type="button"
                  onClick={() => setLines((ls) => [...ls, newLine()])}
                  style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
                >
                  + Add line
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {lines.map((line, idx) => (
                  <div key={line.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c.hint }}>Line {idx + 1}</span>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => setLines((ls) => ls.filter((l) => l.id !== line.id))} style={{ marginLeft: "auto", background: "none", border: "none", color: "#a32d2d", fontSize: 12, cursor: "pointer" }}>
                          Remove
                        </button>
                      )}
                    </div>
                    <div style={fw}>
                      <label style={lbl}>Description *</label>
                      <input style={inp} value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="What's being billed" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div>
                        <label style={lbl}>UOM</label>
                        <select style={inp} value={line.uom} onChange={(e) => updateLine(line.id, { uom: e.target.value })}>
                          {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={lbl}>Qty</label>
                        <input style={inp} type="number" min="0" step="any" value={line.qty} onChange={(e) => updateLine(line.id, { qty: e.target.value })} />
                      </div>
                      <div>
                        <label style={lbl}>Rate (₹)</label>
                        <input style={inp} type="number" min="0" step="0.01" value={line.rate} onChange={(e) => updateLine(line.id, { rate: e.target.value })} />
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12.5, color: c.muted, marginTop: 6 }}>
                      = {inr((parseFloat(line.qty) || 0) * (parseFloat(line.rate) || 0))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
                <div>
                  <label style={lbl}>Discount type</label>
                  <select style={inp} value={discountType} onChange={(e) => setDiscountType(e.target.value as "pct" | "fixed")}>
                    <option value="pct">Percent</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                </div>
                {discountType === "pct" ? (
                  <div>
                    <label style={lbl}>Discount %</label>
                    <input style={inp} type="number" min="0" max="100" step="0.1" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
                  </div>
                ) : (
                  <div>
                    <label style={lbl}>Discount (₹)</label>
                    <input style={inp} type="number" min="0" step="0.01" value={discountFixed} onChange={(e) => setDiscountFixed(e.target.value)} />
                  </div>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, gap: 24 }}>
                <div style={{ fontSize: 12.5, color: c.muted }}>Subtotal: {inr(subtotal)}</div>
                {discountAmt > 0 && <div style={{ fontSize: 12.5, color: c.muted }}>Discount: − {inr(discountAmt)}</div>}
                <div style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Net: {inr(subtotal - discountAmt)} <span style={{ fontSize: 11, fontWeight: 400, color: c.hint }}>(+ tax on print)</span></div>
              </div>
            </section>

            <section style={cardStyle}>
              <div style={fw}>
                <label style={lbl}>Notes</label>
                <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Terms</label>
                <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms…" />
              </div>
            </section>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#dc2626" }}>
                {error}
              </div>
            )}
            <button
              type="submit" disabled={pending}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
                background: c.accent, color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: pending ? "wait" : "pointer",
              }}
            >
              {pending ? "Saving…" : "Create Invoice"}
            </button>
            <Link href={ROUTES.invoices} style={{
              display: "block", textAlign: "center", padding: "10px 0",
              borderRadius: 8, border: `1px solid ${c.line}`,
              color: c.muted, fontSize: 13, textDecoration: "none",
            }}>
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </>
  );
}
