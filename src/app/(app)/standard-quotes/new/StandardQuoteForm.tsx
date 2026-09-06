"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import { documentTotal, type SelectableLine } from "@/lib/sales/lineTotals";
import StandardQuoteAttachments from "../[id]/StandardQuoteAttachments";
import DocumentLinesEditor, { newLine, lineAmount, type Line, type PrintOptions, type StandardQuoteProduct } from "@/components/sales/DocumentLinesEditor";

export type { StandardQuoteProduct };

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
  print_options?: { alternatives?: "all" | "chosen"; breaks?: "all" | "chosen" } | null;
  lines: {
    id: string;
    sl_no: string | null; description: string; uom: string | null; qty: number; rate: number; discount_pct: number;
    product_id?: string | null; pricing_document_id?: string | null;
    group_id?: string | null; group_label?: string | null; group_type?: string | null;
    break_of?: string | null; break_qty?: number | null; is_selected?: boolean | null; show_on_pdf?: boolean | null;
  }[];
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
          // Using the real, stored row id (rather than a fresh random one)
          // is what lets break_of -- another line's id, as of the last
          // save -- still resolve correctly while this session displays
          // and edits the loaded lines. See resolveLineIdsAndSelection for
          // why a fresh save can never rely on ids surviving beyond it.
          id: l.id,
          description: l.description, uom: l.uom ?? "Nos",
          qty: String(l.qty), rate: String(l.rate), discount_pct: String(l.discount_pct),
          product_id: l.product_id ?? "", pricing_document_id: l.pricing_document_id ?? "",
          group_id: l.group_id ?? "", group_label: l.group_label ?? "",
          group_type: l.group_type === "alternative" ? "alternative" : "",
          break_of: l.break_of ?? "", break_qty: l.break_qty != null ? String(l.break_qty) : "",
          is_selected: l.is_selected !== false,
          show_on_pdf: l.show_on_pdf !== false,
        }))
      : [newLine()]
  );
  // What the PDF prints for unchosen options/quantities (0118).
  const [printOptions, setPrintOptions] = useState<PrintOptions>({
    alternatives: editQuote?.print_options?.alternatives === "chosen" ? "chosen" : "all",
    breaks: editQuote?.print_options?.breaks === "chosen" ? "chosen" : "all",
  });
  // Editing an existing quote lands on its lines (the details are already
  // filled in); a new quote starts with the details.
  const [step, setStep] = useState<"details" | "lines" | "attachments">(editQuote ? "lines" : "details");
  // The pinned bar on page 2. `position: sticky` can't be used: Shell's
  // <main> has overflow-x auto, which makes it a (non-scrolling) scroll
  // container that captures sticky while the window is what scrolls. So
  // the bar is fixed by hand once its slot scrolls off the top; the slot
  // keeps the bar's height so nothing jumps.
  const pinSlotRef = useRef<HTMLDivElement>(null);
  const [pin, setPin] = useState<{ left: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (step !== "lines") { setPin(null); return; }
    const update = () => {
      const slot = pinSlotRef.current;
      if (!slot) return;
      const r = slot.getBoundingClientRect();
      if (r.top < 0) setPin((p) => (p && p.left === r.left && p.width === r.width ? p : { left: r.left, width: r.width, height: p?.height ?? slot.offsetHeight }));
      else setPin(null);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [step]);
  const [aiIntroDrafting, setAiIntroDrafting] = useState(false);
  const accountContacts = contacts.filter((ct) => ct.account_id === accountId);
  const selectableLines: (SelectableLine & { id: string })[] = lines.map((l) => ({
    id: l.id, amount: lineAmount(l), group_id: l.group_id || null, group_type: l.group_type || null,
    break_of: l.break_of || null, is_selected: l.is_selected,
  }));
  const subtotal = documentTotal(selectableLines);
  const totals = computeStandardQuoteTotals(
    subtotal,
    Math.max(0, Math.min(100, parseFloat(headerDiscountPct) || 0)),
    Math.max(0, Math.min(100, parseFloat(taxPct) || 0)),
    Math.max(0, parseFloat(shippingAmount) || 0)
  );

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
    if (!accountId) { setError("Account is required"); setStep("details"); return; }
    const cleanLines = lines.filter((l) => l.description.trim());
    if (cleanLines.length === 0) { setError("Add at least one line item"); setStep("lines"); return; }
    setError("");
    // Which alternative group / which quantity break is chosen is resolved
    // authoritatively server-side (resolveLineIdsAndSelection) from
    // local_id/break_of/group_id -- local_id is this line's own working id,
    // meaningful only within this one request, so a brand-new break and its
    // brand-new parent line can reference each other before either has a
    // real row id.
    const linePayload = cleanLines.map((l) => ({
      local_id: l.id,
      description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, discount_pct: l.discount_pct,
      product_id: l.product_id || null, pricing_document_id: l.pricing_document_id || null,
      group_id: l.group_id || null, group_label: l.group_label || null, group_type: l.group_type || null,
      break_of: l.break_of || null, break_qty: l.break_qty ? parseFloat(l.break_qty) || null : null,
      is_selected: l.is_selected,
      show_on_pdf: l.show_on_pdf,
    }));
    startTransition(async () => {
      const commercial = {
        header_discount_pct: headerDiscountPct, tax_pct: taxPct, shipping_amount: shippingAmount,
        print_options: printOptions,
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

  // Two pages (owner decision 2026-09-06): everything about the quote on
  // page 1, the line items alone on page 2 with only the essentials pinned
  // above them -- so the line editor gets the whole screen.
  function goToLines() {
    if (!accountId) { setError("Select an account first"); return; }
    setError("");
    setStep("lines");
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }
  function goToAttachments() {
    // Attachments live on the saved quote (a private bucket keyed by its id).
    if (!editQuote) { setError("Create the quote first — attachments are kept with the saved quote."); return; }
    setError("");
    setStep("attachments");
  }
  function stepTab(key: "details" | "lines" | "attachments", n: string, label: string, compact = false) {
    const active = step === key;
    return (
      <button
        type="button" onClick={() => (key === "lines" ? goToLines() : key === "attachments" ? goToAttachments() : setStep("details"))}
        title={key === "attachments" && !editQuote ? "Available once the quote is created" : undefined}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: compact ? "6px 10px" : "8px 14px", fontSize: compact ? 12.5 : 13, fontWeight: 600,
          color: active ? c.accent : c.muted, background: "none", border: "none", borderBottom: `2px solid ${active ? c.accent : "transparent"}`,
          marginBottom: -1, cursor: "pointer",
        }}
      >
        <span style={{ width: 18, height: 18, borderRadius: 999, fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", background: active ? c.accent : c.panel2, color: active ? "#fff" : c.hint }}>{n}</span>
        {label}
      </button>
    );
  }
  const errorBox = error ? (
    <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)" }}>
      {error}
    </div>
  ) : null;
  const cancelLink = (
    <Link href={editQuote ? ROUTES.standardQuote(editQuote.id) : ROUTES.standardQuotes} style={{
      display: "block", textAlign: "center", padding: "10px 0",
      borderRadius: 8, border: `1px solid ${c.line}`,
      color: c.muted, fontSize: 13, textDecoration: "none",
    }}>
      Cancel
    </Link>
  );
  const accountName = accounts.find((a) => a.id === accountId)?.name ?? "";
  const contactName = accountContacts.find((ct) => ct.id === contactId)?.name ?? "";
  const lineCount = lines.filter((l) => l.description.trim() && !l.break_of).length;

  return (
    <>
      {/* Page 2 gives the whole screen to the lines: its title, tabs and
          essentials all sit in the one pinned bar, so the page chrome
          below renders for page 1 only. */}
      {step !== "lines" && (
        <>
          <div style={{ marginBottom: 12 }}>
            <Link href={editQuote ? ROUTES.standardQuote(editQuote.id) : ROUTES.standardQuotes} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
              ← {editQuote ? editQuote.ref : "All standard quotes"}
            </Link>
          </div>
          <div style={{ marginBottom: 16 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>{editQuote ? `Edit ${editQuote.ref}` : "New Standard Quote"}</h1>
            <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>A plain quote for an account — line items, discount, tax, shipping</p>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${c.line}` }}>
            {stepTab("details", "1", "Quote details")}
            {stepTab("lines", "2", lineCount > 0 ? `Line items (${lineCount})` : "Line items")}
            {stepTab("attachments", "3", "Attachments")}
          </div>
        </>
      )}

      <form onSubmit={handleSubmit}>
        {step === "details" && (
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
            {errorBox}
            <button
              type="button" onClick={goToLines}
              style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
            >
              Next: line items →
            </button>
            {cancelLink}
          </div>
        </div>
        )}

        {step === "lines" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div ref={pinSlotRef} style={{ minHeight: pin ? pin.height : undefined }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", padding: "10px 16px", background: c.panel, border: `1px solid ${c.line}`,
            ...(pin
              ? { position: "fixed" as const, top: 0, left: pin.left, width: pin.width, zIndex: 20, borderRadius: "0 0 10px 10px", boxShadow: "0 4px 14px rgba(0,0,0,0.12)", boxSizing: "border-box" as const }
              : { borderRadius: 10, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }),
          }}>
            <Link href={editQuote ? ROUTES.standardQuote(editQuote.id) : ROUTES.standardQuotes} title={editQuote ? `Back to ${editQuote.ref}` : "All standard quotes"} style={{ fontSize: 14, color: c.muted, textDecoration: "none", whiteSpace: "nowrap" }}>←</Link>
            <div style={{ display: "flex", alignItems: "center", margin: "-10px 0" }}>
              {stepTab("details", "1", "Details", true)}
              {stepTab("lines", "2", lineCount > 0 ? `Lines (${lineCount})` : "Lines", true)}
              {stepTab("attachments", "3", "Files", true)}
            </div>
            <div style={{ width: 1, alignSelf: "stretch", background: c.line }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {editQuote ? editQuote.ref : "New Standard Quote"} · {accountName || "No account"}
              </div>
              <div style={{ fontSize: 11.5, color: c.hint, whiteSpace: "nowrap" }}>
                {contactName || "No contact"}{validUntil ? ` · valid until ${validUntil}` : ""}
                <button type="button" onClick={() => setStep("details")} style={{ marginLeft: 8, fontSize: 11.5, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Edit details</button>
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: c.hint }}>Subtotal {inr(totals.subtotal)}{totals.taxAmount > 0 ? ` · tax ${inr(totals.taxAmount)}` : ""}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: c.ink }}>Total {inr(totals.total)}</div>
              </div>
              <button
                type="submit" disabled={pending}
                style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: pending ? "wait" : "pointer", whiteSpace: "nowrap" }}
              >
                {pending ? "Saving…" : editQuote ? "Save changes" : "Create quote"}
              </button>
            </div>
          </div>
          </div>
          {errorBox}
            <section style={cardStyle}>
              <DocumentLinesEditor
                lines={lines} onChange={setLines} products={products} pricingEnabled={pricingEngineQuotesEnabled}
                accountId={accountId} accountName={accountName} documentType="standard_quote" documentId={editQuote?.id}
                taxPct={taxPct} onTaxPct={setTaxPct} printOptions={printOptions} onPrintOptions={setPrintOptions} onError={setError}
              />

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
        </div>
        )}

        {step === "attachments" && editQuote && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
          <section style={cardStyle}>
            <StandardQuoteAttachments
              quoteId={editQuote.id}
              canCreateLines
              // Lines created from a file are written to the saved quote, so
              // the form reloads from it; any unsaved edits on this form are
              // dropped -- the sentence under the button says so.
              onLinesCreated={() => { window.location.href = ROUTES.standardQuoteEdit(editQuote.id); }}
            />
            <p style={{ fontSize: 11.5, color: c.hint, margin: "10px 0 0" }}>Creating line items from a file saves them to the quote straight away and reloads this form — save any other edits first.</p>
          </section>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {errorBox}
            <button type="button" onClick={goToLines} style={{ width: "100%", padding: "12px 0", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Back to line items →
            </button>
            {cancelLink}
          </div>
        </div>
        )}
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
