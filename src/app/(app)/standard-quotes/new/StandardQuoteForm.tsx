"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES, UOM_OPTIONS } from "@/lib/constants";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import PriceTrace, { type PriceTraceStep } from "@/components/pricing/PriceTrace";

type Line = {
  id: string; description: string; uom: string; qty: string; rate: string; discount_pct: string;
  /** The catalog product behind the line (0114) -- what "Price with engine" prices. */
  product_id: string;
  /** The stored pricing document behind the rate, when the engine set it. */
  pricing_document_id: string;
};

export type StandardQuoteProduct = { id: string; ref: string | null; name: string; uom: string | null; list_price: number | null };

// What the engine said about one line -- mirrors quotations/new/QuoteForm.tsx
// so the two forms never drift (the rate, a why chip, a floor flag, or the
// NEEDS_RFQ prompt with an inline Send RFQ).
type LinePricing =
  | { kind: "priced"; document_id: string | null; area: string; flags: { code: string; policy: string; floor_pct?: number; actual_pct?: number }[]; trace: PriceTraceStep[]; open: boolean }
  | { kind: "needs_rfq"; product: { id: string; name: string }; missing: { path: string; considered: { source: string; status: string; reason?: string }[] }[]; message: string; cost_model: string | null }
  | { kind: "rfq_sent"; ref: string; supplier: string; redirected: boolean }
  | { kind: "rfq_draft"; ref: string; reason: string };

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
  return { id: Math.random().toString(36).slice(2), description: "", uom: "Nos", qty: "1", rate: "0", discount_pct: "0", product_id: "", pricing_document_id: "" };
}

function lineAmount(l: Line): number {
  const qty = parseFloat(l.qty) || 0;
  const rate = parseFloat(l.rate) || 0;
  const discount = Math.max(0, Math.min(100, parseFloat(l.discount_pct) || 0));
  return qty * rate * (1 - discount / 100);
}

type EditQuote = {
  id: string;
  ref: string;
  account_id: string;
  contact_id: string | null;
  valid_until: string | null;
  inquiry_date: string | null;
  notes: string | null;
  terms: string | null;
  template_id: string | null;
  header_discount_pct: number;
  tax_pct: number;
  shipping_amount: number;
  intro_text: string | null;
  lines: { sl_no: string | null; description: string; uom: string | null; qty: number; rate: number; discount_pct: number; product_id?: string | null; pricing_document_id?: string | null }[];
};

export default function StandardQuoteForm({
  accounts, contacts, templates, editQuote, products = [], pricingEngineQuotesEnabled = false,
}: {
  accounts: { id: string; name: string }[];
  contacts: { id: string; name: string; account_id: string }[];
  templates: { id: string; name: string; is_default: boolean }[];
  editQuote?: EditQuote;
  /** Active catalog products (only when the products module is on). */
  products?: StandardQuoteProduct[];
  /** Both pricing_engine + pricing_engine_quotes tenant features -- resolved
   *  server-side by the page, never inferred here. */
  pricingEngineQuotesEnabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [accountId, setAccountId] = useState(editQuote?.account_id ?? "");
  const [contactId, setContactId] = useState(editQuote?.contact_id ?? "");
  const [validUntil, setValidUntil] = useState(editQuote?.valid_until ?? "");
  const [inquiryDate, setInquiryDate] = useState(editQuote?.inquiry_date ?? "");
  const [notes, setNotes] = useState(editQuote?.notes ?? "");
  const [terms, setTerms] = useState(editQuote?.terms ?? "");
  const [introText, setIntroText] = useState(editQuote?.intro_text ?? "");
  const [headerDiscountPct, setHeaderDiscountPct] = useState(String(editQuote?.header_discount_pct ?? 0));
  const [taxPct, setTaxPct] = useState(String(editQuote?.tax_pct ?? 0));
  const [shippingAmount, setShippingAmount] = useState(String(editQuote?.shipping_amount ?? 0));
  const [templateId, setTemplateId] = useState(
    editQuote?.template_id ?? templates.find((t) => t.is_default)?.id ?? ""
  );
  const [lines, setLines] = useState<Line[]>(
    editQuote && editQuote.lines.length > 0
      ? editQuote.lines.map((l) => ({
          id: Math.random().toString(36).slice(2),
          description: l.description, uom: l.uom ?? "Nos",
          qty: String(l.qty), rate: String(l.rate), discount_pct: String(l.discount_pct),
          product_id: l.product_id ?? "", pricing_document_id: l.pricing_document_id ?? "",
        }))
      : [newLine()]
  );

  // BPMSquare Pricing on the line (bpmsquarecore §10 doctrine: propose,
  // never silently decide) -- the engine suggests a rate, the rep still
  // reviews and saves it like any manual edit. Same flow as QuoteForm.
  const [pricingBusyIds, setPricingBusyIds] = useState<Set<string>>(new Set());
  const [pricingErrors, setPricingErrors] = useState<Record<string, string>>({});
  const [linePricing, setLinePricing] = useState<Record<string, LinePricing>>({});
  const [rfqOpenId, setRfqOpenId] = useState<string | null>(null);
  const [rfqSuppliers, setRfqSuppliers] = useState<{ id: string; name: string; email: string | null }[] | null>(null);
  const [rfqSupplierId, setRfqSupplierId] = useState("");
  const [rfqMessage, setRfqMessage] = useState("");
  const [rfqBusy, setRfqBusy] = useState(false);

  function chooseProduct(lineId: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    setLines((ls) => ls.map((l) => {
      if (l.id !== lineId) return l;
      if (!p) return { ...l, product_id: "", pricing_document_id: "" };
      return {
        ...l, product_id: p.id, pricing_document_id: "",
        description: l.description.trim() ? l.description : p.name,
        uom: p.uom && (UOM_OPTIONS as readonly string[]).includes(p.uom) ? p.uom : l.uom,
        rate: parseFloat(l.rate) > 0 ? l.rate : String(p.list_price ?? 0),
      };
    }));
    setLinePricing((prev) => { const { [lineId]: _drop, ...rest } = prev; return rest; });
  }

  async function priceWithEngine(lineId: string, productId: string, qty: string) {
    const quantity = parseFloat(qty) || 1;
    setPricingBusyIds((p) => new Set(p).add(lineId));
    setPricingErrors((p) => { const { [lineId]: _drop, ...rest } = p; return rest; });
    try {
      const res = await fetch("/api/quotes/price-line", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, account_id: accountId || undefined, quantity, standard_quote_id: editQuote?.id ?? "" }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json.needs_rfq) {
        setLinePricing((p) => ({ ...p, [lineId]: { kind: "needs_rfq", product: json.product, missing: json.missing ?? [], message: json.message, cost_model: json.cost_model ?? null } }));
        return;
      }
      if (!res.ok) { setPricingErrors((p) => ({ ...p, [lineId]: json.error ?? "Pricing failed" })); return; }
      updateLine(lineId, { rate: String(Math.round((json.unit_rate as number) * 100) / 100), pricing_document_id: json.document_id ?? "" });
      setLinePricing((p) => ({ ...p, [lineId]: { kind: "priced", document_id: json.document_id ?? null, area: json.area, flags: json.flags ?? [], trace: json.trace ?? [], open: false } }));
    } catch {
      setPricingErrors((p) => ({ ...p, [lineId]: "Network error — try again." }));
    } finally {
      setPricingBusyIds((p) => { const n = new Set(p); n.delete(lineId); return n; });
    }
  }

  async function openRfq(lineId: string) {
    setRfqOpenId(lineId); setRfqSupplierId(""); setRfqMessage("");
    if (rfqSuppliers === null) {
      try {
        const res = await fetch("/api/suppliers");
        const list = await res.json();
        setRfqSuppliers(Array.isArray(list) ? list.map((s: { id: string; name: string; email: string | null }) => ({ id: s.id, name: s.name, email: s.email })) : []);
      } catch { setRfqSuppliers([]); }
    }
  }

  async function sendRfq(lineId: string, productId: string, qty: string) {
    const info = linePricing[lineId];
    if (!info || info.kind !== "needs_rfq") return;
    if (!rfqSupplierId) { setPricingErrors((p) => ({ ...p, [lineId]: "Choose a supplier first." })); return; }
    setPricingErrors((p) => { const { [lineId]: _drop, ...rest } = p; return rest; });
    setRfqBusy(true);
    try {
      const res = await fetch("/api/pricing/rfqs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId, supplier_id: rfqSupplierId, quantity: parseFloat(qty) || 1,
          standard_quote_id: editQuote?.id ?? null, cost_model_code: info.cost_model ?? undefined,
          path: info.missing[0]?.path, message: rfqMessage || null, send: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setPricingErrors((p) => ({ ...p, [lineId]: json.error ?? "Could not create the RFQ" })); return; }
      const supplierName = rfqSuppliers?.find((s) => s.id === rfqSupplierId)?.name ?? "supplier";
      setLinePricing((p) => ({
        ...p,
        [lineId]: json.sent?.ok
          ? { kind: "rfq_sent", ref: json.ref, supplier: supplierName, redirected: Boolean(json.sent.redirected) }
          : { kind: "rfq_draft", ref: json.ref, reason: json.sent?.reason ?? "not sent" },
      }));
      setRfqOpenId(null);
    } catch {
      setPricingErrors((p) => ({ ...p, [lineId]: "Network error — try again." }));
    } finally { setRfqBusy(false); }
  }

  function pricingStatus(lineId: string, productId: string, qty: string) {
    const info = linePricing[lineId];
    if (!info) return null;
    const box: React.CSSProperties = { fontSize: 11.5, lineHeight: 1.45, marginTop: 6 };
    if (info.kind === "priced") {
      const blocked = info.flags.some((f) => f.policy === "block");
      const warned = info.flags.length > 0 && !blocked;
      return (
        <div style={box}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: c.hint }}>Priced by engine{info.area !== "default" ? ` · ${info.area}` : ""}</span>
            <button type="button" onClick={() => setLinePricing((p) => ({ ...p, [lineId]: { ...info, open: !info.open } }))}
              style={{ fontSize: 11.5, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
              {info.open ? "hide why" : "why?"}
            </button>
          </div>
          {info.flags.map((f, i) => (
            <div key={i} style={{ color: blocked ? "var(--err-ink)" : "var(--amberink)", fontWeight: 600 }}>
              {f.code === "MARGIN_FLOOR" ? `Margin ${f.actual_pct}% is below the ${f.floor_pct}% floor` : f.code}
              {blocked ? " — this quote can't be sent until approved" : warned ? " — check before sending" : ""}
            </div>
          ))}
          {info.open && (
            <div style={{ marginTop: 6, padding: 8, borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel, overflowX: "auto" }}>
              <PriceTrace steps={info.trace} compact />
            </div>
          )}
        </div>
      );
    }
    if (info.kind === "needs_rfq") {
      const isOpen = rfqOpenId === lineId;
      return (
        <div style={box}>
          <div style={{ color: "var(--amberink)", fontWeight: 600 }}>{info.message}</div>
          {info.missing[0]?.considered?.length > 0 && (
            <div style={{ color: c.hint }}>
              Tried: {info.missing[0].considered.map((k) => `${k.source} (${k.reason ?? k.status})`).join("; ")}
            </div>
          )}
          {!isOpen ? (
            <button type="button" onClick={() => openRfq(lineId)}
              style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "#fff", background: c.accent, border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>
              Send RFQ to supplier
            </button>
          ) : (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6, maxWidth: 420 }}>
              <select style={{ ...inp, fontSize: 12 }} value={rfqSupplierId} onChange={(e) => setRfqSupplierId(e.target.value)}>
                <option value="">{rfqSuppliers === null ? "Loading suppliers…" : "Choose a supplier"}</option>
                {(rfqSuppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.email ? "" : " (no email)"}</option>)}
              </select>
              <textarea style={{ ...inp, minHeight: 44, fontSize: 12 }} placeholder="Anything to add to the request (optional)" value={rfqMessage} onChange={(e) => setRfqMessage(e.target.value)} />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" disabled={rfqBusy} onClick={() => sendRfq(lineId, productId, qty)}
                  style={{ fontSize: 11.5, fontWeight: 600, color: "#fff", background: c.accent, border: "none", borderRadius: 6, padding: "6px 10px", cursor: rfqBusy ? "default" : "pointer", opacity: rfqBusy ? 0.6 : 1 }}>
                  {rfqBusy ? "Sending…" : "Send"}
                </button>
                <button type="button" onClick={() => setRfqOpenId(null)} style={{ fontSize: 11.5, color: c.muted, background: "none", border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      );
    }
    if (info.kind === "rfq_sent") {
      return <div style={{ ...box, color: "var(--tealink)" }}>{info.ref} sent to {info.supplier}{info.redirected ? " (redirected to the internal inbox)" : ""}. Price again once the reply is entered under Pricing → RFQs.</div>;
    }
    return <div style={{ ...box, color: "var(--amberink)" }}>{info.ref} saved but not sent: {info.reason}. Send it from Pricing → RFQs.</div>;
  }

  const [aiJobDesc, setAiJobDesc] = useState("");
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiIntroDrafting, setAiIntroDrafting] = useState(false);

  const accountContacts = contacts.filter((ct) => ct.account_id === accountId);
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const totals = computeStandardQuoteTotals(
    subtotal,
    Math.max(0, Math.min(100, parseFloat(headerDiscountPct) || 0)),
    Math.max(0, Math.min(100, parseFloat(taxPct) || 0)),
    Math.max(0, parseFloat(shippingAmount) || 0)
  );

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function draftLinesWithAI() {
    if (!aiJobDesc.trim()) return;
    setAiDrafting(true);
    setError("");
    fetch("/api/standard-quotes/ai-draft-lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: aiJobDesc }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) { setError(json.error ?? "AI drafting failed"); return; }
        const drafted: Line[] = (json.lines as { description: string; uom: string; qty: string }[]).map((l) => ({
          id: Math.random().toString(36).slice(2),
          description: l.description, uom: l.uom || "Nos", qty: l.qty || "1", rate: "0", discount_pct: "0", product_id: "", pricing_document_id: "",
        }));
        if (drafted.length === 0) { setError("AI didn't return any line items — try a more specific description"); return; }
        setLines((ls) => (ls.length === 1 && !ls[0].description.trim() ? drafted : [...ls, ...drafted]));
      })
      .catch(() => setError("Could not reach the AI drafting service"))
      .finally(() => setAiDrafting(false));
  }

  function draftIntroWithAI() {
    if (!accountId) { setError("Select an account first"); return; }
    const cleanLines = lines.filter((l) => l.description.trim());
    if (cleanLines.length === 0) { setError("Add at least one line item first"); return; }
    setAiIntroDrafting(true);
    setError("");
    fetch("/api/standard-quotes/ai-intro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: accountId,
        lines: cleanLines.map((l) => ({ description: l.description, qty: l.qty, rate: l.rate })),
        notes,
      }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) { setError(json.error ?? "AI drafting failed"); return; }
        setIntroText(json.intro_text ?? "");
      })
      .catch(() => setError("Could not reach the AI drafting service"))
      .finally(() => setAiIntroDrafting(false));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) { setError("Account is required"); return; }
    const cleanLines = lines.filter((l) => l.description.trim());
    if (cleanLines.length === 0) { setError("Add at least one line item"); return; }
    setError("");
    const linePayload = cleanLines.map((l) => ({
      description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, discount_pct: l.discount_pct,
      product_id: l.product_id || null, pricing_document_id: l.pricing_document_id || null,
    }));
    startTransition(async () => {
      const commercial = {
        header_discount_pct: headerDiscountPct, tax_pct: taxPct, shipping_amount: shippingAmount,
        intro_text: introText || null,
        inquiry_date: inquiryDate || null,
      };
      const res = editQuote
        ? await fetch(`/api/standard-quotes/${editQuote.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contact_id: contactId || null,
              valid_until: validUntil || null,
              notes: notes || null,
              terms: terms || null,
              template_id: templateId || null,
              lines: linePayload,
              ...commercial,
            }),
          })
        : await fetch("/api/standard-quotes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account_id: accountId,
              contact_id: contactId || null,
              valid_until: validUntil || null,
              notes: notes || null,
              terms: terms || null,
              template_id: templateId || null,
              lines: linePayload,
              ...commercial,
            }),
          });
      const json = await res.json();
      if (res.ok) router.push(ROUTES.standardQuote(editQuote ? editQuote.id : json.id));
      else setError(json.error ?? `Failed to ${editQuote ? "save" : "create"} quote`);
    });
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={editQuote ? ROUTES.standardQuote(editQuote.id) : ROUTES.standardQuotes} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← {editQuote ? editQuote.ref : "All standard quotes"}
        </Link>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>{editQuote ? `Edit ${editQuote.ref}` : "New Standard Quote"}</h1>
        <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>A plain quote for an account — line items, discount, tax, shipping</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 16px" }}>Quote for</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={lbl}>Account *</label>
                  {editQuote ? (
                    <div style={{ ...inp, background: c.panel2, color: c.muted }}>
                      {accounts.find((a) => a.id === accountId)?.name ?? "—"}
                    </div>
                  ) : (
                    <select style={inp} value={accountId} onChange={(e) => { setAccountId(e.target.value); setContactId(""); }} required>
                      <option value="">— Select account —</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label style={lbl}>Contact</label>
                  <select style={inp} value={contactId} onChange={(e) => setContactId(e.target.value)}>
                    <option value="">— None —</option>
                    {accountContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={lbl}>Inquiry date</label>
                  <input style={inp} type="date" value={inquiryDate} onChange={(e) => setInquiryDate(e.target.value)} title="When the customer asked for this quote" />
                </div>
                <div>
                  <label style={lbl}>Valid until</label>
                  <input style={inp} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Template</label>
                  <select style={inp} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    <option value="">Default layout</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_default ? " (default)" : ""}</option>)}
                  </select>
                </div>
              </div>
            </section>

            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 10px" }}>Draft line items with AI</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={inp}
                  value={aiJobDesc}
                  onChange={(e) => setAiJobDesc(e.target.value)}
                  placeholder="Describe the job — e.g. install 3 split ACs and set up an annual AMC"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); draftLinesWithAI(); } }}
                />
                <button
                  type="button" disabled={aiDrafting || !aiJobDesc.trim()} onClick={draftLinesWithAI}
                  style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 8, padding: "0 16px", cursor: aiDrafting ? "wait" : "pointer" }}
                >
                  {aiDrafting ? "Drafting…" : "✨ Draft with AI"}
                </button>
              </div>
              <p style={{ fontSize: 11.5, color: c.hint, margin: "6px 0 0" }}>
                AI suggests description, UOM, and quantity — rates are left at ₹0 for you to price.
              </p>
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
                        <button type="button" onClick={() => setLines((ls) => ls.filter((l) => l.id !== line.id))} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--red)", fontSize: 12, cursor: "pointer" }}>
                          Remove
                        </button>
                      )}
                    </div>
                    {products.length > 0 && (
                      <div style={fw}>
                        <label style={lbl}>Product</label>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <select style={inp} value={line.product_id} onChange={(e) => chooseProduct(line.id, e.target.value)}>
                            <option value="">— Free text (no product) —</option>
                            {products.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
                          </select>
                          {pricingEngineQuotesEnabled && line.product_id && (
                            <button
                              type="button"
                              disabled={pricingBusyIds.has(line.id)}
                              onClick={() => priceWithEngine(line.id, line.product_id, line.qty)}
                              title="Suggest a rate from the live Pricing Engine — you can still edit it before saving"
                              style={{
                                flexShrink: 0, fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg,
                                border: "none", borderRadius: 8, padding: "9px 12px", cursor: pricingBusyIds.has(line.id) ? "default" : "pointer",
                                opacity: pricingBusyIds.has(line.id) ? 0.6 : 1, whiteSpace: "nowrap",
                              }}
                            >
                              {pricingBusyIds.has(line.id) ? "Pricing…" : "⚡ Price with engine"}
                            </button>
                          )}
                        </div>
                        {pricingErrors[line.id] && <div style={{ fontSize: 11.5, color: "var(--err-ink)", marginTop: 4 }}>{pricingErrors[line.id]}</div>}
                        {pricingStatus(line.id, line.product_id, line.qty)}
                      </div>
                    )}
                    <div style={fw}>
                      <label style={lbl}>Description *</label>
                      <input style={inp} value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="What's being quoted" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
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
                      <div>
                        <label style={lbl}>Discount %</label>
                        <input style={inp} type="number" min="0" max="100" step="0.1" value={line.discount_pct} onChange={(e) => updateLine(line.id, { discount_pct: e.target.value })} />
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12.5, color: c.muted, marginTop: 6 }}>
                      = {inr(lineAmount(line))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ borderTop: `1px solid ${c.line}`, marginTop: 14, paddingTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <label style={lbl}>Discount %</label>
                  <input style={inp} type="number" min="0" max="100" step="0.1" value={headerDiscountPct} onChange={(e) => setHeaderDiscountPct(e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Tax %</label>
                  <input style={inp} type="number" min="0" max="100" step="0.1" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Shipping / Handling (₹)</label>
                  <input style={inp} type="number" min="0" step="0.01" value={shippingAmount} onChange={(e) => setShippingAmount(e.target.value)} />
                </div>
              </div>

              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                <TotalLine label="Subtotal" value={inr(totals.subtotal)} />
                {totals.discountAmount > 0 && <TotalLine label={`Discount (${headerDiscountPct}%)`} value={`− ${inr(totals.discountAmount)}`} />}
                {totals.taxAmount > 0 && <TotalLine label={`Tax (${taxPct}%)`} value={inr(totals.taxAmount)} />}
                {totals.shipping > 0 && <TotalLine label="Shipping" value={inr(totals.shipping)} />}
                <div style={{ fontSize: 15, fontWeight: 700, color: c.ink, marginTop: 4 }}>Total: {inr(totals.total)}</div>
              </div>
            </section>

            <section style={cardStyle}>
              <div style={fw}>
                <label style={lbl}>Notes</label>
                <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div style={fw}>
                <label style={lbl}>Terms</label>
                <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms…" />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                  <label style={{ ...lbl, marginBottom: 0 }}>Intro text (overrides the template&apos;s intro block for this quote)</label>
                  <button
                    type="button" disabled={aiIntroDrafting} onClick={draftIntroWithAI}
                    style={{ fontSize: 11.5, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: aiIntroDrafting ? "wait" : "pointer" }}
                  >
                    {aiIntroDrafting ? "Writing…" : "✨ Generate with AI"}
                  </button>
                </div>
                <textarea style={{ ...inp, minHeight: 70, resize: "vertical" }} value={introText} onChange={(e) => setIntroText(e.target.value)} placeholder="A short, personalized cover note for this quote…" />
              </div>
            </section>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {error && (
              <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)" }}>
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
              {pending ? "Saving…" : editQuote ? "Save Changes" : "Create Standard Quote"}
            </button>
            <Link href={editQuote ? ROUTES.standardQuote(editQuote.id) : ROUTES.standardQuotes} style={{
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

function TotalLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: c.muted }}>
      <span>{label}</span>
      <span style={{ minWidth: 90, textAlign: "right" }}>{value}</span>
    </div>
  );
}
