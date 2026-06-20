"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data";
import type { Account, Contact, PricingItem, TextFragment, PricingCategory } from "@/lib/types";

// ── Styles ────────────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 12px", fontSize: 13, color: c.ink,
  background: c.panel, fontFamily: "inherit", outline: "none",
};
const smInp: React.CSSProperties = {
  ...inp, padding: "6px 8px", fontSize: 12,
};
const sel: React.CSSProperties = { ...inp, cursor: "pointer" };
const label: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em",
  marginBottom: 5,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: c.muted,
  textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px",
};

const ACCOUNT_TYPE_TONE: Record<Account["type"], PillarKey> = {
  prospect: "amber", oem: "purple", direct: "blue", end_customer: "teal",
};
const CAT_LABEL: Record<PricingCategory, string> = {
  labour: "Labour", material: "Materials", testing: "Testing", transport: "Transport",
};

type LineRow = { id: string; description: string; qty: string; rate: string };

type ItemRow = {
  id: string; type: string; make: string; model: string;
  serial: string; spec: string; qty: string; notes: string;
};

type Props = {
  accounts: Account[];
  contacts: Contact[];
  pricingItems: PricingItem[];
  textFragments: TextFragment[];
};

export default function QuoteForm({ accounts, contacts, pricingItems, textFragments }: Props) {
  const today        = new Date().toISOString().slice(0, 10);
  const defaultValid = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

  // Account & contact
  const [accountId, setAccountId] = useState("");
  const [contactId, setContactId] = useState("");

  // Quote meta
  const [quoteName, setQuoteName]   = useState("");
  const [quoteDate, setQuoteDate]   = useState(today);
  const [validUntil, setValidUntil] = useState(defaultValid);
  const [poNumber, setPoNumber]     = useState("");
  const [poAmount, setPoAmount]     = useState("");
  const [owner, setOwner]           = useState("VP — Admin");

  // Item / product details rows
  const [itemRows, setItemRows] = useState<ItemRow[]>([
    { id: "1", type: "", make: "", model: "", serial: "", spec: "", qty: "1", notes: "" },
  ]);

  // Line items
  const [lines, setLines] = useState<LineRow[]>([
    { id: "1", description: "", qty: "1", rate: "0" },
  ]);

  // Discount
  const [discountType, setDiscountType]   = useState<"pct" | "fixed">("pct");
  const [discountPct, setDiscountPct]     = useState("0");
  const [discountFixed, setDiscountFixed] = useState("0");

  // Notes & terms
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");

  // UI panels
  const [catalogOpen, setCatalogOpen]       = useState(false);
  const [catalogTarget, setCatalogTarget]   = useState<string | null>(null);
  const [catalogCat, setCatalogCat]         = useState<PricingCategory | "">("");
  const [fragTarget, setFragTarget]         = useState<"notes" | "terms" | null>(null);
  const [saved, setSaved]                   = useState(false);

  const quoteRef = useMemo(() => {
    const n = 160 + Math.floor(Math.random() * 30);
    return `QT-2026-${String(n).padStart(4, "0")}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountContacts = contacts.filter((ct) => ct.account_id === accountId);
  const selectedAccount = accounts.find((a) => a.id === accountId);

  const parsedLines = lines.map((l) => {
    const qty  = parseFloat(l.qty) || 0;
    const rate = parseFloat(l.rate) || 0;
    return { ...l, qty, rate, amount: qty * rate };
  });
  const subtotal   = parsedLines.reduce((s, l) => s + l.amount, 0);
  const discPct    = Math.max(0, Math.min(100, parseFloat(discountPct) || 0));
  const discAmount = discountType === "pct"
    ? Math.round(subtotal * discPct / 100)
    : Math.min(Math.round(parseFloat(discountFixed) || 0), subtotal);
  const total      = subtotal - discAmount;
  const poVal      = parseFloat(poAmount) || 0;

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  // Line item handlers
  const addLine    = () => setLines((p) => [...p, { id: String(Date.now()), description: "", qty: "1", rate: "0" }]);
  const removeLine = (id: string) => setLines((p) => p.length > 1 ? p.filter((l) => l.id !== id) : p);
  const updateLine = (id: string, field: keyof LineRow, val: string) =>
    setLines((p) => p.map((l) => l.id === id ? { ...l, [field]: val } : l));

  // Item row handlers
  const addItem    = () => setItemRows((p) => [...p, { id: String(Date.now()), type: "", make: "", model: "", serial: "", spec: "", qty: "1", notes: "" }]);
  const removeItem = (id: string) => setItemRows((p) => p.length > 1 ? p.filter((i) => i.id !== id) : p);
  const updateItem = (id: string, field: keyof ItemRow, val: string) =>
    setItemRows((p) => p.map((i) => i.id === id ? { ...i, [field]: val } : i));

  // Catalog handlers
  const openCatalog = (lineId: string) => { setCatalogTarget(lineId); setCatalogCat(""); setCatalogOpen(true); };
  const insertCatalogItem = (item: PricingItem) => {
    if (catalogTarget) { updateLine(catalogTarget, "description", item.description); updateLine(catalogTarget, "rate", String(item.rate)); }
    setCatalogOpen(false); setCatalogTarget(null);
  };
  const filteredCatalog = catalogCat ? pricingItems.filter((p) => p.category === catalogCat) : pricingItems;

  // Fragment handlers
  const insertFragment = (frag: TextFragment) => {
    if (fragTarget === "notes") setNotes((p) => p ? p + "\n\n" + frag.text : frag.text);
    if (fragTarget === "terms") setTerms((p) => p ? p + "\n\n" + frag.text : frag.text);
    setFragTarget(null);
  };
  const noteFrags  = textFragments.filter((f) => f.category === "notes");
  const termsFrags = textFragments.filter((f) => f.category === "terms");

  // ── Success screen ────────────────────────────────────────────────────────
  if (saved) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "55vh", gap: 14, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: pillar.green.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: pillar.green.base }}>✓</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: c.ink }}>Draft saved</div>
        <div style={{ fontFamily: "monospace", fontSize: 15, color: c.accent, background: c.accentbg, padding: "6px 16px", borderRadius: 8 }}>{quoteRef}</div>
        <p style={{ fontSize: 13, color: c.muted, maxWidth: 340, lineHeight: 1.6 }}>
          Saved as draft for {selectedAccount?.name ?? "the customer"}. You can review and send it from the quotations list.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Link href={ROUTES.quotations} style={{ background: c.accent, color: "#fff", padding: "8px 20px", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
            All quotations
          </Link>
          <button onClick={() => setSaved(false)} style={{ border: `1px solid ${c.line}`, background: c.panel, color: c.muted, padding: "8px 20px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
            Edit again
          </button>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link href={ROUTES.quotations} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>← Quotations</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Quotation</h1>
          <div style={{ fontSize: 12.5, color: c.muted, marginTop: 3, fontFamily: "monospace" }}>{quoteRef} · Draft</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 288px", gap: 14, alignItems: "start" }} className="hub-grid">

        {/* ── LEFT ─────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Account & Contact */}
          <section style={cardStyle}>
            <h3 style={sectionTitle}>Account & Contact</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <span style={label}>Account *</span>
                <select style={sel} value={accountId} onChange={(e) => { setAccountId(e.target.value); setContactId(""); }}>
                  <option value="">Select account…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {selectedAccount && (
                  <div style={{ display: "flex", gap: 6, marginTop: 7, alignItems: "center" }}>
                    <Pill label={ACCOUNT_TYPE_LABEL[selectedAccount.type]} tone={ACCOUNT_TYPE_TONE[selectedAccount.type]} />
                    {selectedAccount.city && <span style={{ fontSize: 11.5, color: c.muted }}>{selectedAccount.city}</span>}
                  </div>
                )}
              </div>
              <div>
                <span style={label}>Contact</span>
                <select style={{ ...sel, opacity: !accountId ? 0.5 : 1 }} value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!accountId}>
                  <option value="">{accountId ? "Select contact…" : "Choose account first"}</option>
                  {accountContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}{ct.role ? ` · ${ct.role}` : ""}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* Quote details */}
          <section style={cardStyle}>
            <h3 style={sectionTitle}>Quote details</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Row 1 — name + owner */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 190px", gap: 14 }}>
                <div>
                  <span style={label}>Quote name</span>
                  <input style={inp} value={quoteName} onChange={(e) => setQuoteName(e.target.value)} placeholder="e.g. Annual maintenance — Pump rewinding" />
                </div>
                <div>
                  <span style={label}>Created by</span>
                  <input style={inp} value={owner} onChange={(e) => setOwner(e.target.value)} />
                </div>
              </div>

              {/* Row 2 — ref + date + valid until */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                <div>
                  <span style={label}>Reference</span>
                  <input style={{ ...inp, color: c.muted, background: c.panel2 }} value={quoteRef} readOnly />
                </div>
                <div>
                  <span style={label}>Date</span>
                  <input style={inp} type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
                </div>
                <div>
                  <span style={label}>Valid until</span>
                  <input style={inp} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
              </div>

              {/* Row 3 — customer PO */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <span style={label}>Customer PO no.</span>
                  <input style={inp} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-2026-XXXX" />
                </div>
                <div>
                  <span style={label}>PO amount (₹)</span>
                  <input style={inp} type="number" min="0" step="1000" value={poAmount} onChange={(e) => setPoAmount(e.target.value)} placeholder="0" />
                </div>
              </div>

            </div>
          </section>

          {/* Item / product details */}
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h3 style={{ ...sectionTitle, margin: 0 }}>Item / Product details</h3>
                <div style={{ fontSize: 11, color: c.hint, marginTop: 3 }}>Motor · transformer · pump · generator · panel · any equipment</div>
              </div>
              <button
                onClick={addItem}
                style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", flexShrink: 0 }}
              >
                + Add item
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {itemRows.map((item, idx) => (
                <div key={item.id} style={{ borderLeft: `3px solid ${c.accent}`, borderRadius: "0 8px 8px 0", background: c.panel2, padding: "12px 14px" }}>

                  {/* Top row: # | Type | Make | Model | Serial | Qty | × */}
                  <div style={{ display: "grid", gridTemplateColumns: "20px 110px 110px 1fr 1fr 56px 28px", gap: 8, alignItems: "end", marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: c.hint, fontWeight: 600, paddingBottom: 9 }}>{idx + 1}</div>
                    <div>
                      <span style={label}>Type</span>
                      <input style={smInp} value={item.type} onChange={(e) => updateItem(item.id, "type", e.target.value)} placeholder="Motor…" />
                    </div>
                    <div>
                      <span style={label}>Make</span>
                      <input style={smInp} value={item.make} onChange={(e) => updateItem(item.id, "make", e.target.value)} placeholder="Crompton…" />
                    </div>
                    <div>
                      <span style={label}>Model / Part no.</span>
                      <input style={smInp} value={item.model} onChange={(e) => updateItem(item.id, "model", e.target.value)} placeholder="CG-3PH-7.5" />
                    </div>
                    <div>
                      <span style={label}>Serial / Tag no.</span>
                      <input style={smInp} value={item.serial} onChange={(e) => updateItem(item.id, "serial", e.target.value)} placeholder="SN-XXXXXX" />
                    </div>
                    <div>
                      <span style={label}>Qty</span>
                      <input style={{ ...smInp, textAlign: "center" }} type="number" min="1" step="1" value={item.qty} onChange={(e) => updateItem(item.id, "qty", e.target.value)} />
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      style={{ background: "none", border: "none", color: pillar.red.fg, fontSize: 18, cursor: "pointer", paddingBottom: 2, lineHeight: 1 }}
                      title="Remove item"
                    >×</button>
                  </div>

                  {/* Spec row */}
                  <div style={{ marginBottom: 8 }}>
                    <span style={label}>Specification / Rating</span>
                    <input
                      style={smInp}
                      value={item.spec}
                      onChange={(e) => updateItem(item.id, "spec", e.target.value)}
                      placeholder="e.g. 7.5 kW · 415 V · 3 Ph · 1450 rpm · Frame 132S"
                    />
                  </div>

                  {/* Fault / condition notes */}
                  <div>
                    <span style={label}>Condition / Fault description</span>
                    <textarea
                      style={{ ...smInp, resize: "vertical", minHeight: 48, lineHeight: 1.5 }}
                      value={item.notes}
                      onChange={(e) => updateItem(item.id, "notes", e.target.value)}
                      placeholder="Describe the fault, condition observed, or any additional remarks…"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Line items */}
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>Line items</h3>
              <button onClick={addLine} style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>
                + Add line
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 120px 110px 32px", gap: 8, marginBottom: 6 }}>
              {["Description", "Qty", "Rate (₹)", "Amount", ""].map((h) => (
                <div key={h} style={{ fontSize: 10.5, fontWeight: 600, color: c.hint, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {parsedLines.map((line) => (
                <div key={line.id} style={{ display: "grid", gridTemplateColumns: "1fr 60px 120px 110px 32px", gap: 8, alignItems: "start", paddingBottom: 8, borderBottom: `1px solid ${c.line}` }}>
                  <div>
                    <textarea
                      style={{ ...inp, resize: "vertical", minHeight: 58, lineHeight: 1.5 }}
                      value={line.description}
                      onChange={(e) => updateLine(line.id, "description", e.target.value)}
                      placeholder="Describe the service or item…"
                    />
                    <button onClick={() => openCatalog(line.id)} style={{ marginTop: 4, fontSize: 11, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                      ◈ From catalog
                    </button>
                  </div>
                  <input style={{ ...inp, textAlign: "center" }} type="number" min="0" step="1" value={line.qty} onChange={(e) => updateLine(line.id, "qty", e.target.value)} />
                  <input style={{ ...inp, textAlign: "right" }} type="number" min="0" step="100" value={line.rate} onChange={(e) => updateLine(line.id, "rate", e.target.value)} />
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: c.ink, textAlign: "right", paddingTop: 8 }}>{fmt(line.amount)}</div>
                  <button onClick={() => removeLine(line.id)} style={{ color: c.hint, background: "none", border: "none", fontSize: 18, cursor: "pointer", paddingTop: 6, lineHeight: 1 }} title="Remove line">×</button>
                </div>
              ))}
            </div>

            {lines.length === 0 && (
              <div style={{ textAlign: "center", padding: "24px 0", color: c.hint, fontSize: 13 }}>No lines yet — click + Add line</div>
            )}
          </section>

          {/* Notes */}
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>Notes</h3>
              <button onClick={() => setFragTarget("notes")} style={{ marginLeft: "auto", fontSize: 11.5, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>
                + Insert template
              </button>
            </div>
            <textarea style={{ ...inp, minHeight: 88, resize: "vertical", lineHeight: 1.6 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes for the customer (payment terms, special conditions, delivery notes)…" />
          </section>

          {/* Terms */}
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>Terms & Conditions</h3>
              <button onClick={() => setFragTarget("terms")} style={{ marginLeft: "auto", fontSize: 11.5, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>
                + Use preset
              </button>
            </div>
            <textarea style={{ ...inp, minHeight: 100, resize: "vertical", lineHeight: 1.6, fontFamily: "inherit" }} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Standard terms and conditions…" />
          </section>
        </div>

        {/* ── RIGHT (summary + actions) ─────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "sticky", top: 20 }}>

          {/* Summary */}
          <section style={cardStyle}>
            <h3 style={sectionTitle}>Summary</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {parsedLines.map((l, i) => l.amount > 0 && (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderTop: `1px solid ${c.line}`, color: c.muted }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{l.description || `Line ${i + 1}`}</span>
                  <span style={{ flexShrink: 0, marginLeft: 8 }}>{fmt(l.amount)}</span>
                </div>
              ))}
            </div>

            <div style={{ borderTop: `1px solid ${c.line}`, marginTop: 10, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: c.muted }}>
                <span>Subtotal</span>
                <span style={{ fontWeight: 600, color: c.ink }}>{fmt(subtotal)}</span>
              </div>

              {/* Discount — type toggle + input */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: c.muted }}>Discount</span>
                  <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${c.line}` }}>
                    {(["pct", "fixed"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setDiscountType(t)}
                        style={{
                          padding: "3px 11px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
                          background: discountType === t ? c.accent : c.panel2,
                          color: discountType === t ? "#fff" : c.muted,
                        }}
                      >
                        {t === "pct" ? "%" : "₹"}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                  {discountType === "pct" ? (
                    <>
                      <input
                        type="number" min="0" max="100" step="0.5"
                        value={discountPct}
                        onChange={(e) => setDiscountPct(e.target.value)}
                        style={{ width: 52, border: `1px solid ${c.line}`, borderRadius: 6, padding: "3px 6px", fontSize: 12, textAlign: "right", color: c.ink, fontFamily: "inherit" }}
                      />
                      <span style={{ fontSize: 11, color: c.hint }}>%</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: c.hint }}>₹</span>
                      <input
                        type="number" min="0" step="100"
                        value={discountFixed}
                        onChange={(e) => setDiscountFixed(e.target.value)}
                        style={{ width: 84, border: `1px solid ${c.line}`, borderRadius: 6, padding: "3px 6px", fontSize: 12, textAlign: "right", color: c.ink, fontFamily: "inherit" }}
                      />
                    </>
                  )}
                  <span style={{ fontWeight: 600, color: discAmount > 0 ? pillar.red.fg : c.muted, minWidth: 60, textAlign: "right" }}>
                    {discAmount > 0 ? `− ${fmt(discAmount)}` : "—"}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: pillar.green.bg, borderRadius: 9, marginTop: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: pillar.green.fg }}>Total</span>
                <span style={{ fontSize: 17, fontWeight: 800, color: pillar.green.fg }}>{fmt(total)}</span>
              </div>
            </div>
          </section>

          {/* PO status — shown only when PO data entered */}
          {(poNumber || poAmount) && (
            <section style={{ ...cardStyle, background: c.panel2, padding: "12px 14px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Customer PO</div>
              {poNumber && (
                <div style={{ fontSize: 12.5, color: c.ink, fontFamily: "monospace", marginBottom: 6 }}>{poNumber}</div>
              )}
              {poAmount && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 11.5, color: c.muted }}>PO value</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>{fmt(poVal)}</span>
                </div>
              )}
              {poAmount && total > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 6, borderTop: `1px solid ${c.line}` }}>
                  <span style={{ fontSize: 11, color: c.hint }}>Quote vs PO</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: total <= poVal ? pillar.green.fg : pillar.red.fg }}>
                    {total <= poVal ? "✓ Within PO" : `▲ Exceeds by ${fmt(total - poVal)}`}
                  </span>
                </div>
              )}
            </section>
          )}

          {/* Item summary — shown when at least one item has data */}
          {itemRows.some((i) => i.type || i.make) && (
            <section style={{ ...cardStyle, padding: "12px 14px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Items</div>
              {itemRows.filter((i) => i.type || i.make).map((item, idx) => (
                <div key={item.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "5px 0", borderTop: idx > 0 ? `1px solid ${c.line}` : "none" }}>
                  <span style={{ fontSize: 10.5, color: c.hint, fontWeight: 600, flexShrink: 0 }}>#{idx + 1}</span>
                  <span style={{ fontSize: 12, color: c.ink, fontWeight: 500 }}>{item.type || "Item"}</span>
                  {item.make && <span style={{ fontSize: 11, color: c.muted }}>· {item.make}</span>}
                  {item.qty !== "1" && <span style={{ fontSize: 11, color: c.hint, marginLeft: "auto" }}>×{item.qty}</span>}
                </div>
              ))}
            </section>
          )}

          {/* Owner chip */}
          <div style={{ fontSize: 11, color: c.hint, textAlign: "center" }}>
            Created by <span style={{ color: c.muted, fontWeight: 600 }}>{owner || "—"}</span>
          </div>

          {/* Actions */}
          <section style={cardStyle}>
            <h3 style={sectionTitle}>Actions</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => setSaved(true)}
                disabled={!accountId}
                style={{ width: "100%", padding: "10px 0", borderRadius: 9, fontSize: 13.5, fontWeight: 700, background: accountId ? c.accent : c.line, color: accountId ? "#fff" : c.hint, border: "none", cursor: accountId ? "pointer" : "not-allowed" }}
              >
                Save as draft
              </button>
              <button disabled style={{ width: "100%", padding: "9px 0", borderRadius: 9, fontSize: 13, fontWeight: 600, background: pillar.teal.bg, color: pillar.teal.fg, border: "none", cursor: "not-allowed", opacity: 0.7 }}>
                Preview PDF · Coming soon
              </button>
              <button disabled style={{ width: "100%", padding: "9px 0", borderRadius: 9, fontSize: 13, fontWeight: 600, background: c.panel2, color: c.muted, border: `1px solid ${c.line}`, cursor: "not-allowed", opacity: 0.7 }}>
                Send to customer · Coming soon
              </button>
            </div>
          </section>

          <div style={{ fontSize: 11.5, color: c.hint, textAlign: "center" }}>
            {parsedLines.filter((l) => l.amount > 0).length} of {lines.length} line{lines.length !== 1 ? "s" : ""} have values
          </div>
        </div>
      </div>

      {/* ── Catalog slide panel ─────────────────────────────────────────────── */}
      {catalogOpen && (
        <>
          <div onClick={() => setCatalogOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(14,26,40,.45)", zIndex: 998 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 400, background: c.panel, zIndex: 999, display: "flex", flexDirection: "column", boxShadow: "-6px 0 32px rgba(0,0,0,.18)" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>Pricing catalog</div>
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>Click an item to insert it into the line</div>
              </div>
              <button onClick={() => setCatalogOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 20, color: c.muted, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 6, padding: "12px 16px", borderBottom: `1px solid ${c.line}`, flexWrap: "wrap" }}>
              {(["", "labour", "material", "testing", "transport"] as const).map((cat) => (
                <button key={cat} onClick={() => setCatalogCat(cat as PricingCategory | "")} style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, background: catalogCat === cat ? c.accent : c.panel2, color: catalogCat === cat ? "#fff" : c.muted }}>
                  {cat === "" ? "All" : CAT_LABEL[cat as PricingCategory]}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {(["labour", "material", "testing", "transport"] as PricingCategory[]).filter((cat) => !catalogCat || catalogCat === cat).map((cat) => {
                const items = filteredCatalog.filter((p) => p.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat}>
                    <div style={{ padding: "8px 20px 4px", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: "0.08em" }}>{CAT_LABEL[cat]}</div>
                    {items.map((item) => (
                      <button key={item.id} onClick={() => insertCatalogItem(item)} style={{ width: "100%", textAlign: "left", padding: "10px 20px", background: "none", border: "none", cursor: "pointer", borderBottom: `1px solid ${c.line}` }} onMouseEnter={(e) => (e.currentTarget.style.background = c.panel2)} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                        <div style={{ fontSize: 12.5, color: c.ink, fontWeight: 500, lineHeight: 1.4 }}>{item.description}</div>
                        <div style={{ display: "flex", gap: 10, marginTop: 4, alignItems: "center" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: c.accent }}>₹{item.rate.toLocaleString("en-IN")}</span>
                          <span style={{ fontSize: 11, color: c.hint }}>/ {item.unit}</span>
                          {item.notes && <span style={{ fontSize: 10.5, color: c.hint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {item.notes}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Fragment picker panel ───────────────────────────────────────────── */}
      {fragTarget && (
        <>
          <div onClick={() => setFragTarget(null)} style={{ position: "fixed", inset: 0, background: "rgba(14,26,40,.45)", zIndex: 998 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 380, background: c.panel, zIndex: 999, display: "flex", flexDirection: "column", boxShadow: "-6px 0 32px rgba(0,0,0,.18)" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>{fragTarget === "notes" ? "Note templates" : "Terms presets"}</div>
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>Click to append to the text area</div>
              </div>
              <button onClick={() => setFragTarget(null)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 20, color: c.muted, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {(fragTarget === "notes" ? noteFrags : termsFrags).map((frag) => (
                <button key={frag.id} onClick={() => insertFragment(frag)} style={{ width: "100%", textAlign: "left", padding: "14px 20px", background: "none", border: "none", borderBottom: `1px solid ${c.line}`, cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.background = c.panel2)} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: c.ink, marginBottom: 5 }}>{frag.label}</div>
                  <div style={{ fontSize: 11.5, color: c.muted, lineHeight: 1.55, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{frag.text}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
