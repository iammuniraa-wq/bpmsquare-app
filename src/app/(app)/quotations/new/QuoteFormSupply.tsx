"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import type { Account, Contact } from "@/lib/types";

// ── Styles ────────────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 11px", fontSize: 13, color: c.ink,
  background: c.panel, fontFamily: "inherit", outline: "none",
};
const sel: React.CSSProperties = { ...inp, cursor: "pointer" };
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5,
};
const fw: React.CSSProperties = { marginBottom: 14 };
const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: c.muted,
  textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 14px",
};

// GST rates used in India
const GST_RATES = [0, 5, 12, 18, 28];

// Common units
const UNITS = ["Nos", "Set", "Kg", "Mtr", "Ltr", "Box", "Pair", "Job"];

type SupplyLine = {
  id: string;
  description: string;
  hsn: string;
  qty: string;
  unit: string;
  rate: string;
  gst_pct: number;
};

const newLine = (): SupplyLine => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  description: "", hsn: "", qty: "1", unit: "Nos", rate: "0", gst_pct: 18,
});

const DRAFT_KEY = "vvcrm_supply_draft";
function saveDraft(d: object) { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* noop */ } }
function loadDraft() { try { const r = sessionStorage.getItem(DRAFT_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function clearDraft() { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* noop */ } }

type Props = { accounts: Account[]; contacts: Contact[] };

export default function QuoteFormSupply({ accounts, contacts }: Props) {
  const router = useRouter();
  const today        = new Date().toISOString().slice(0, 10);
  const defaultValid = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

  const [accountId,  setAccountId]  = useState("");
  const [contactId,  setContactId]  = useState("");
  const [quoteDate,  setQuoteDate]  = useState(today);
  const [validUntil, setValidUntil] = useState(defaultValid);
  const [poNumber,   setPoNumber]   = useState("");
  const [shipTo,     setShipTo]     = useState("");
  const [notes,      setNotes]      = useState("");
  const [terms,      setTerms]      = useState("Payment: 100% advance\nDelivery: 4–6 weeks from order confirmation\nWarranty: As per OEM terms");

  const [lines, setLines] = useState<SupplyLine[]>([newLine()]);
  const [hasDraft, setHasDraft] = useState(false);
  const [savedId,  setSavedId]  = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [savePending, startSave] = useTransition();

  const quoteRef = useMemo(() => {
    const n = 200 + Math.floor(Math.random() * 50);
    return `QT-2026-${String(n).padStart(4, "0")}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore carry-over from case
  useEffect(() => {
    setHasDraft(!!sessionStorage.getItem(DRAFT_KEY));
    try {
      const raw = sessionStorage.getItem("vvcrm_quote_source");
      if (raw) {
        sessionStorage.removeItem("vvcrm_quote_source");
        const src = JSON.parse(raw);
        if (src.accountId) setAccountId(src.accountId);
      }
    } catch { /* ignore */ }
    const draft = loadDraft();
    if (!draft) return;
    if (draft.accountId)  setAccountId(draft.accountId);
    if (draft.contactId)  setContactId(draft.contactId);
    if (draft.quoteDate)  setQuoteDate(draft.quoteDate);
    if (draft.validUntil) setValidUntil(draft.validUntil);
    if (draft.poNumber)   setPoNumber(draft.poNumber);
    if (draft.shipTo)     setShipTo(draft.shipTo);
    if (draft.notes)      setNotes(draft.notes);
    if (draft.terms)      setTerms(draft.terms);
    if (Array.isArray(draft.lines) && draft.lines.length > 0) setLines(draft.lines);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save draft
  useEffect(() => {
    saveDraft({ accountId, contactId, quoteDate, validUntil, poNumber, shipTo, notes, terms, lines });
  }, [accountId, contactId, quoteDate, validUntil, poNumber, shipTo, notes, terms, lines]);

  // Line helpers
  const setLine = (id: string, field: keyof SupplyLine, value: string | number) =>
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, [field]: value } : l));

  const addLine = () => setLines((prev) => [...prev, newLine()]);

  const removeLine = (id: string) =>
    setLines((prev) => prev.length > 1 ? prev.filter((l) => l.id !== id) : prev);

  // Totals
  const parsedLines = lines.map((l) => {
    const qty  = Math.max(0, parseFloat(l.qty)  || 0);
    const rate = Math.max(0, parseFloat(l.rate) || 0);
    const base = qty * rate;
    const gst  = Math.round(base * l.gst_pct / 100 * 100) / 100;
    return { ...l, qty, rate, base, gst, total: base + gst };
  });

  const subtotal   = parsedLines.reduce((s, l) => s + l.base, 0);
  const totalGst   = parsedLines.reduce((s, l) => s + l.gst, 0);
  const grandTotal = subtotal + totalGst;

  // GST breakdown by rate
  const gstBreakdown = GST_RATES.filter((r) => r > 0).map((rate) => {
    const applicable = parsedLines.filter((l) => l.gst_pct === rate);
    const taxable    = applicable.reduce((s, l) => s + l.base, 0);
    const tax        = applicable.reduce((s, l) => s + l.gst, 0);
    return { rate, taxable, tax };
  }).filter((b) => b.taxable > 0);

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const accountContacts = contacts.filter((ct) => ct.account_id === accountId);
  const selectedAccount = accounts.find((a) => a.id === accountId);

  function handleSave() {
    setSaveError("");
    startSave(async () => {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          ref: quoteRef,
          type: "supply",
          total: grandTotal,
          valid_until: validUntil || null,
          notes,
          terms,
          meta: { ship_to: shipTo, po_number: poNumber },
          lines: parsedLines
            .filter((l) => l.description.trim())
            .map((l) => ({
              description: `${l.description}${l.hsn ? ` [HSN: ${l.hsn}]` : ""}`,
              qty: String(l.qty),
              rate: String(l.rate),
              discount_pct: 0,
              group_id: null, group_label: null, group_type: null,
            })),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setSaveError(json.error ?? "Save failed"); return; }
      clearDraft();
      setSavedId(json.id);
    });
  }

  // ── Success screen ────────────────────────────────────────────────────────

  if (savedId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "55vh", gap: 14, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: pillar.green.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: pillar.green.base }}>✓</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: c.ink }}>Draft saved</div>
        <div style={{ fontFamily: "monospace", fontSize: 15, color: c.accent, background: c.accentbg, padding: "6px 16px", borderRadius: 8 }}>{quoteRef}</div>
        <p style={{ fontSize: 13, color: c.muted, maxWidth: 340, lineHeight: 1.6 }}>
          Supply quotation saved as draft for {selectedAccount?.name ?? "the customer"}.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Link href={ROUTES.quotations} style={{ background: c.accent, color: "#fff", padding: "8px 20px", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>All quotations</Link>
          <Link href={ROUTES.quotationPrint(savedId)} target="_blank" style={{ background: pillar.teal.bg, color: pillar.teal.fg, padding: "8px 20px", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>🖨 Preview PDF</Link>
          <button onClick={() => setSavedId(null)} style={{ border: `1px solid ${c.line}`, background: c.panel, color: c.muted, padding: "8px 20px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>Edit again</button>
        </div>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link href={ROUTES.quotationNew} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>← Choose type</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: hasDraft ? 10 : 20 }}>
        <span style={{ fontSize: 22 }}>📦</span>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: c.ink, margin: 0 }}>Supply Quotation</h1>
          <div style={{ fontSize: 12, color: c.muted, marginTop: 2, fontFamily: "monospace" }}>{quoteRef} · Draft</div>
        </div>
      </div>

      {hasDraft && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 14px", fontSize: 12.5 }}>
          <span style={{ color: "#92400e" }}>⟳ Draft restored.</span>
          <button onClick={() => { clearDraft(); setHasDraft(false); }} style={{ marginLeft: "auto", fontSize: 11.5, color: "#92400e", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Discard</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,320px)", gap: 16, alignItems: "start" }} className="hub-grid">

        {/* ── Left: main form ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Customer */}
          <section style={cardStyle}>
            <div style={sectionTitle}>Customer</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }} className="fg2">
              <div style={fw}>
                <label style={lbl}>Account *</label>
                <select style={sel} value={accountId} onChange={(e) => { setAccountId(e.target.value); setContactId(""); }} required>
                  <option value="">— select account —</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div style={fw}>
                <label style={lbl}>Contact</label>
                <select style={sel} value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!accountId}>
                  <option value="">— select contact —</option>
                  {accountContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}{ct.role ? ` · ${ct.role}` : ""}</option>)}
                </select>
              </div>
            </div>
            <div style={fw}>
              <label style={lbl}>Ship to address</label>
              <textarea style={{ ...inp, minHeight: 64, resize: "vertical" }} value={shipTo}
                onChange={(e) => setShipTo(e.target.value)}
                placeholder="Delivery address (leave blank if same as account address)" />
            </div>
          </section>

          {/* Quote meta */}
          <section style={cardStyle}>
            <div style={sectionTitle}>Quotation details</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }} className="fg3">
              <div style={fw}>
                <label style={lbl}>Quote date</label>
                <input style={inp} type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
              </div>
              <div style={fw}>
                <label style={lbl}>Valid until</label>
                <input style={inp} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
              <div style={fw}>
                <label style={lbl}>Customer PO no.</label>
                <input style={inp} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="If available" />
              </div>
            </div>
          </section>

          {/* Line items */}
          <section style={cardStyle}>
            <div style={sectionTitle}>Items</div>

            {/* Header row — desktop only */}
            <div className="mob-hide" style={{
              display: "grid",
              gridTemplateColumns: "1fr 90px 70px 60px 90px 80px 90px 28px",
              gap: 6, marginBottom: 6,
            }}>
              {["Description", "HSN / SAC", "Qty", "Unit", "Rate (₹)", "GST %", "Amount", ""].map((h) => (
                <div key={h} style={{ fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</div>
              ))}
            </div>

            {lines.map((line, i) => {
              const qty  = parseFloat(line.qty)  || 0;
              const rate = parseFloat(line.rate) || 0;
              const base = qty * rate;
              const gst  = Math.round(base * line.gst_pct / 100 * 100) / 100;
              const total = base + gst;

              return (
                <div key={line.id} style={{ marginBottom: 8 }}>
                  {/* Mobile: stacked layout */}
                  <div className="mob-show" style={{ flexDirection: "column", gap: 6, padding: "10px 0", borderTop: i === 0 ? `1px solid ${c.line}` : undefined }}>
                    <input style={inp} placeholder="Description" value={line.description} onChange={(e) => setLine(line.id, "description", e.target.value)} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <input style={inp} placeholder="HSN/SAC" value={line.hsn} onChange={(e) => setLine(line.id, "hsn", e.target.value)} />
                      <select style={sel} value={line.unit} onChange={(e) => setLine(line.id, "unit", e.target.value)}>
                        {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                      <input style={inp} type="number" min={0} placeholder="Qty" value={line.qty} onChange={(e) => setLine(line.id, "qty", e.target.value)} />
                      <input style={inp} type="number" min={0} placeholder="Rate" value={line.rate} onChange={(e) => setLine(line.id, "rate", e.target.value)} />
                      <select style={sel} value={line.gst_pct} onChange={(e) => setLine(line.id, "gst_pct", Number(e.target.value))}>
                        {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 12, color: c.muted }}>
                        {fmt(base)} + {fmt(gst)} GST = <strong style={{ color: c.ink }}>{fmt(total)}</strong>
                      </div>
                      {lines.length > 1 && (
                        <button type="button" onClick={() => removeLine(line.id)} style={{ fontSize: 16, color: c.hint, background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}>×</button>
                      )}
                    </div>
                  </div>

                  {/* Desktop: grid row */}
                  <div className="mob-hide" style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 90px 70px 60px 90px 80px 90px 28px",
                    gap: 6, borderTop: i === 0 ? `1px solid ${c.line}` : undefined,
                    paddingTop: i === 0 ? 8 : 0,
                  }}>
                    <input style={inp} placeholder="Item description" value={line.description} onChange={(e) => setLine(line.id, "description", e.target.value)} />
                    <input style={inp} placeholder="e.g. 8501" value={line.hsn} onChange={(e) => setLine(line.id, "hsn", e.target.value)} />
                    <input style={inp} type="number" min={0} value={line.qty} onChange={(e) => setLine(line.id, "qty", e.target.value)} />
                    <select style={sel} value={line.unit} onChange={(e) => setLine(line.id, "unit", e.target.value)}>
                      {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <input style={inp} type="number" min={0} value={line.rate} onChange={(e) => setLine(line.id, "rate", e.target.value)} />
                    <select style={sel} value={line.gst_pct} onChange={(e) => setLine(line.id, "gst_pct", Number(e.target.value))}>
                      {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                    </select>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                      {fmt(total)}
                    </div>
                    <button type="button" onClick={() => removeLine(line.id)} disabled={lines.length === 1}
                      style={{ fontSize: 16, color: lines.length === 1 ? c.line : c.hint, background: "none", border: "none", cursor: lines.length === 1 ? "default" : "pointer", padding: 0 }}>
                      ×
                    </button>
                  </div>
                </div>
              );
            })}

            <button type="button" onClick={addLine} style={{ marginTop: 8, fontSize: 12.5, color: c.accent, background: c.accentbg, border: `1px dashed ${c.accent}60`, borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontWeight: 600 }}>
              + Add item
            </button>
          </section>

          {/* Notes & terms */}
          <section style={cardStyle}>
            <div style={sectionTitle}>Notes &amp; terms</div>
            <div style={fw}>
              <label style={lbl}>Notes to customer</label>
              <textarea style={{ ...inp, minHeight: 70, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Specific notes about this supply…" />
            </div>
            <div>
              <label style={lbl}>Terms &amp; conditions</label>
              <textarea style={{ ...inp, minHeight: 90, resize: "vertical" }} value={terms} onChange={(e) => setTerms(e.target.value)} />
            </div>
          </section>
        </div>

        {/* ── Right: summary sidebar ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Totals */}
          <section style={cardStyle}>
            <div style={sectionTitle}>Summary</div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0" }}>
              <span style={{ color: c.muted }}>Subtotal (excl. GST)</span>
              <span style={{ fontWeight: 500 }}>{fmt(subtotal)}</span>
            </div>

            {gstBreakdown.map((b) => (
              <div key={b.rate} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: c.muted }}>
                <span>GST {b.rate}% on {fmt(b.taxable)}</span>
                <span>{fmt(b.tax)}</span>
              </div>
            ))}

            {gstBreakdown.length === 0 && (
              <div style={{ fontSize: 12, color: c.hint, padding: "3px 0" }}>No GST lines yet</div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: c.ink, borderTop: `2px solid ${c.line}`, marginTop: 8, paddingTop: 8 }}>
              <span>Grand Total</span>
              <span style={{ color: c.accent }}>{fmt(grandTotal)}</span>
            </div>
            <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>GST: {fmt(totalGst)}</div>
          </section>

          {/* Save */}
          <section style={cardStyle}>
            {saveError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626", marginBottom: 12 }}>
                {saveError}
              </div>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!accountId || savePending}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 9,
                fontSize: 13.5, fontWeight: 700,
                background: accountId ? c.accent : c.line,
                color: accountId ? "#fff" : c.hint,
                border: "none", cursor: accountId && !savePending ? "pointer" : "not-allowed",
              }}
            >
              {savePending ? "Saving…" : "Save draft"}
            </button>
            <div style={{ marginTop: 10, fontSize: 11.5, color: c.hint, textAlign: "center" }}>
              {!accountId && "Select an account to save"}
            </div>
          </section>

          {/* Items count */}
          <div style={{ fontSize: 12, color: c.hint, textAlign: "center" }}>
            {lines.filter((l) => l.description.trim()).length} item{lines.filter((l) => l.description.trim()).length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>
    </>
  );
}
