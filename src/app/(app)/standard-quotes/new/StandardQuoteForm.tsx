"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES, UOM_OPTIONS } from "@/lib/constants";
import { computeStandardQuoteTotals } from "@/lib/standardQuoteTotals";
import PriceTrace, { type PriceTraceStep } from "@/components/pricing/PriceTrace";
import { documentTotal, normalizeSelection, type SelectableLine } from "@/lib/sales/lineTotals";

type Line = {
  id: string; description: string; uom: string; qty: string; rate: string; discount_pct: string;
  /** The catalog product behind the line (0114) -- what "Price with engine" prices. */
  product_id: string;
  /** The stored pricing document behind the rate, when the engine set it. */
  pricing_document_id: string;
  /** Alternative option groups (0116, sales-engine-architecture.md §3.3):
   *  lines sharing a group_id with group_type "alternative" compete for the
   *  quote total -- only one group's lines count. "" means ungrouped. */
  group_id: string;
  group_label: string;
  group_type: "" | "alternative";
  /** Quantity break (0116, §3.4): this row prices `break_of`'s line at a
   *  different quantity ("from qty 10…"). Breaks are scoped to top-level
   *  lines only in this UI -- not to lines inside an alternative option. */
  break_of: string;
  break_qty: string;
  is_selected: boolean;
};

export type StandardQuoteProduct = { id: string; ref: string | null; name: string; uom: string | null; list_price: number | null };

// What the engine said about one line -- mirrors quotations/new/QuoteForm.tsx
// so the two forms never drift (the rate, a why chip, a floor flag, or the
// NEEDS_RFQ prompt with an inline Send RFQ).
type LinePricing =
  | { kind: "priced"; document_id: string | null; area: string; flags: LineFlag[]; trace: PriceTraceStep[]; open: boolean }
  | { kind: "needs_rfq"; product: { id: string; name: string }; missing: { path: string; considered: { source: string; status: string; reason?: string }[] }[]; message: string; cost_model: string | null }
  | { kind: "rfq_sent"; ref: string; supplier: string; redirected: boolean }
  | { kind: "rfq_draft"; ref: string; reason: string };

type LineFlag = { code: string; policy: string; floor_pct?: number; actual_pct?: number };

// Response shape of POST /api/pricing/price-lines (Sales Engine Piece A,
// docs/sales-engine-architecture.md §3.2) -- one entry per line submitted,
// keyed back by line_key so a partial failure never loses track of which
// line it belongs to.
type PriceAllResult =
  | { line_key: string; ok: true; unit_rate: number; document_id: string | null; area: string; flags: LineFlag[]; trace: PriceTraceStep[]; tax_pct: number }
  | { line_key: string; ok: false; needs_rfq: true; product: { id: string; name: string }; missing: { path: string; considered: { source: string; status: string; reason?: string }[] }[]; message: string; cost_model: string | null }
  | { line_key: string; ok: false; error: string };

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
  return {
    id: Math.random().toString(36).slice(2), description: "", uom: "Nos", qty: "1", rate: "0", discount_pct: "0",
    product_id: "", pricing_document_id: "", group_id: "", group_label: "", group_type: "",
    break_of: "", break_qty: "", is_selected: true,
  };
}

function lineAmount(l: Line): number {
  const qty = parseFloat(l.qty) || 0;
  const rate = parseFloat(l.rate) || 0;
  const discount = Math.max(0, Math.min(100, parseFloat(l.discount_pct) || 0));
  return qty * rate * (1 - discount / 100);
}

// Consecutive-or-not, every line sharing a group_id renders as one block
// (mirrors QuoteForm.tsx's editLinesToRows) -- an alternative option can
// hold more than one line item, and they always show together regardless
// of where each was inserted in the underlying array. A top-level line's
// quantity breaks (§3.4) nest under it the same way; breaks are scoped to
// top-level lines only -- a line inside an alternative option cannot have
// its own breaks in this UI.
type Row = { kind: "line"; line: Line; breaks: Line[] } | { kind: "group"; group_id: string; label: string; lines: Line[] };

function groupedRows(lines: Line[]): Row[] {
  const breaksByParent = new Map<string, Line[]>();
  for (const l of lines) {
    if (!l.break_of) continue;
    const arr = breaksByParent.get(l.break_of);
    if (arr) arr.push(l); else breaksByParent.set(l.break_of, [l]);
  }
  const rows: Row[] = [];
  const groupIndex = new Map<string, number>();
  for (const l of lines) {
    if (l.break_of) continue; // rendered nested under its parent, never standalone
    if (l.group_type === "alternative" && l.group_id) {
      let idx = groupIndex.get(l.group_id);
      if (idx === undefined) {
        idx = rows.length;
        groupIndex.set(l.group_id, idx);
        rows.push({ kind: "group", group_id: l.group_id, label: l.group_label || "Option", lines: [] });
      }
      (rows[idx] as Extract<Row, { kind: "group" }>).lines.push(l);
    } else {
      rows.push({ kind: "line", line: l, breaks: breaksByParent.get(l.id) ?? [] });
    }
  }
  return rows;
}

/** Which row of a break family (the base line, or one of its breaks) is
 *  the chosen quantity -- mirrors lineTotals.ts's own resolution so the
 *  radio state and the on-screen total never disagree. */
function chosenBreakId(line: Line, breaks: Line[]): string {
  const explicit = breaks.find((b) => b.is_selected === true);
  return explicit ? explicit.id : line.id;
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
  lines: {
    id: string;
    sl_no: string | null; description: string; uom: string | null; qty: number; rate: number; discount_pct: number;
    product_id?: string | null; pricing_document_id?: string | null;
    group_id?: string | null; group_label?: string | null; group_type?: string | null;
    break_of?: string | null; break_qty?: number | null; is_selected?: boolean | null;
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

  // Price all lines + auto re-price (Sales Engine Piece A). A line that a
  // rep has manually re-rated after the engine priced it is "overridden" --
  // no longer tracked by a pricing document, shown so nobody mistakes a
  // hand-typed number for the engine's.
  const [priceAllBusy, setPriceAllBusy] = useState(false);
  const [priceAllSummary, setPriceAllSummary] = useState<{ priced: number; needsRfq: number; failed: number } | null>(null);
  const [overriddenIds, setOverriddenIds] = useState<Set<string>>(new Set());
  const repriceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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

  // Alternative option groups (Sales Engine Piece A, §3.3). "Option A",
  // "Option B"… auto-letters the next group; a group can hold more than one
  // line item (they all count together when that option is chosen).
  function addAlternativeOption() {
    const used = new Set(lines.filter((l) => l.group_type === "alternative").map((l) => l.group_id));
    const letter = String.fromCharCode(65 + used.size);
    const groupId = Math.random().toString(36).slice(2);
    setLines((ls) => [...ls, { ...newLine(), group_id: groupId, group_label: `Option ${letter}`, group_type: "alternative" }]);
  }
  function addItemToGroup(groupId: string, groupLabel: string) {
    setLines((ls) => [...ls, { ...newLine(), group_id: groupId, group_label: groupLabel, group_type: "alternative" }]);
  }
  function removeGroup(groupId: string) {
    setLines((ls) => { const rest = ls.filter((l) => l.group_id !== groupId); return rest.length ? rest : [newLine()]; });
  }
  function renameGroup(groupId: string, label: string) {
    setLines((ls) => ls.map((l) => (l.group_id === groupId ? { ...l, group_label: label } : l)));
  }
  /** Marks every line of `groupId` selected and every other alternative
   *  group's lines not-selected -- mirrors lineTotals.ts's own resolution
   *  so the on-screen total and the radio state never disagree. */
  function chooseGroup(groupId: string) {
    setLines((ls) => ls.map((l) => (l.group_type === "alternative" && l.group_id ? { ...l, is_selected: l.group_id === groupId } : l)));
  }
  const altGroupIds = [...new Set(lines.filter((l) => l.group_type === "alternative" && l.group_id).map((l) => l.group_id))];
  const chosenGroupId = altGroupIds.find((gid) => lines.some((l) => l.group_id === gid && l.is_selected === true)) ?? altGroupIds[0] ?? null;

  // Quantity breaks (Sales Engine Piece A, §3.4): a line can offer more
  // than one quantity, each its own price ("1-9 at X, 10+ at Y"); only the
  // chosen quantity counts toward the total. Scoped to top-level lines --
  // not to lines inside an alternative option -- in this UI.
  function addBreak(parentLine: Line) {
    const existing = lines.filter((l) => l.break_of === parentLine.id);
    const nextQty = existing.length > 0
      ? Math.max(...existing.map((b) => parseFloat(b.break_qty) || 0)) + 10
      : Math.max(2, (parseFloat(parentLine.qty) || 1) + 9);
    setLines((ls) => [...ls, {
      ...newLine(), break_of: parentLine.id, break_qty: String(nextQty), qty: String(nextQty),
      description: parentLine.description, uom: parentLine.uom, product_id: parentLine.product_id, rate: parentLine.rate,
    }]);
  }
  function removeBreak(breakId: string) {
    setLines((ls) => ls.filter((l) => l.id !== breakId));
  }
  /** Marks exactly one row of a break family (the base line, or one break)
   *  selected -- mirrors lineTotals.ts's own resolution. */
  function chooseBreak(parentId: string, chosenId: string, breakIds: string[]) {
    setLines((ls) => ls.map((l) => {
      if (l.id === parentId) return { ...l, is_selected: chosenId === parentId };
      if (breakIds.includes(l.id)) return { ...l, is_selected: l.id === chosenId };
      return l;
    }));
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
      setOverriddenIds((s) => { if (!s.has(lineId)) return s; const n = new Set(s); n.delete(lineId); return n; });
      // The line rate is before tax; the header applies tax once. Fill the
      // header from the engine only when the rep has not set one.
      if ((parseFloat(taxPct) || 0) === 0 && typeof json.tax_pct === "number" && json.tax_pct > 0) setTaxPct(String(json.tax_pct));
      setLinePricing((p) => ({ ...p, [lineId]: { kind: "priced", document_id: json.document_id ?? null, area: json.area, flags: json.flags ?? [], trace: json.trace ?? [], open: false } }));
    } catch {
      setPricingErrors((p) => ({ ...p, [lineId]: "Network error — try again." }));
    } finally {
      setPricingBusyIds((p) => { const n = new Set(p); n.delete(lineId); return n; });
    }
  }

  /** Re-prices a line automatically, 600ms after its product or quantity
   *  changed, but ONLY when it already carried an engine price -- a fresh
   *  line's first price is still an explicit click (Price with engine). */
  function scheduleAutoReprice(lineId: string, productId: string, qty: string) {
    if (repriceTimers.current[lineId]) clearTimeout(repriceTimers.current[lineId]);
    repriceTimers.current[lineId] = setTimeout(() => { priceWithEngine(lineId, productId, qty); }, 600);
  }

  /** Prices every line that names a product in one call
   *  (docs/sales-engine-architecture.md §3.2) instead of one click each. */
  async function priceAllLines() {
    const targets = lines.filter((l) => l.product_id);
    if (targets.length === 0) return;
    setPriceAllBusy(true);
    setPriceAllSummary(null);
    setError("");
    setPricingBusyIds((p) => { const n = new Set(p); for (const t of targets) n.add(t.id); return n; });
    try {
      const res = await fetch("/api/pricing/price-lines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_type: "standard_quote",
          document_id: editQuote?.id || undefined,
          account_id: accountId || undefined,
          lines: targets.map((l) => ({ line_key: l.id, product_id: l.product_id, quantity: parseFloat(l.qty) || 1 })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Price all lines failed"); return; }
      let priced = 0, needsRfq = 0, failed = 0;
      let firstTaxPct: number | null = null;
      for (const r of (json.results ?? []) as PriceAllResult[]) {
        if (r.ok) {
          priced++;
          updateLine(r.line_key, { rate: String(Math.round(r.unit_rate * 100) / 100), pricing_document_id: r.document_id ?? "" });
          setOverriddenIds((s) => { if (!s.has(r.line_key)) return s; const n = new Set(s); n.delete(r.line_key); return n; });
          if (firstTaxPct === null && r.tax_pct > 0) firstTaxPct = r.tax_pct;
          setLinePricing((p) => ({ ...p, [r.line_key]: { kind: "priced", document_id: r.document_id ?? null, area: r.area, flags: r.flags ?? [], trace: r.trace ?? [], open: false } }));
        } else if ("needs_rfq" in r && r.needs_rfq) {
          needsRfq++;
          setLinePricing((p) => ({ ...p, [r.line_key]: { kind: "needs_rfq", product: r.product, missing: r.missing ?? [], message: r.message, cost_model: r.cost_model ?? null } }));
        } else {
          failed++;
          setPricingErrors((p) => ({ ...p, [r.line_key]: "error" in r ? r.error : "Pricing failed" }));
        }
      }
      if ((parseFloat(taxPct) || 0) === 0 && firstTaxPct) setTaxPct(String(firstTaxPct));
      setPriceAllSummary({ priced, needsRfq, failed });
    } catch {
      setError("Network error pricing all lines — try again.");
    } finally {
      setPriceAllBusy(false);
      setPricingBusyIds((p) => { const n = new Set(p); for (const t of targets) n.delete(t.id); return n; });
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
            <span style={{ color: c.hint }}>Priced by engine, before tax{info.area !== "default" ? ` · ${info.area}` : ""}</span>
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

  /** The product/description/uom/qty/rate/discount/amount fields for one
   *  line -- shared by an ungrouped line and every line inside an
   *  alternative option, so the two only ever differ in their outer
   *  header (Line N + Remove, vs. the option's own header). */
  function renderLineFields(line: Line) {
    return (
      <>
        {products.length > 0 && (
          <div style={fw}>
            <label style={lbl}>Product</label>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <select style={inp} value={line.product_id} onChange={(e) => {
                const hadPrice = !!line.pricing_document_id;
                chooseProduct(line.id, e.target.value);
                if (hadPrice && e.target.value) scheduleAutoReprice(line.id, e.target.value, line.qty);
              }}>
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
            <input style={inp} type="number" min="0" step="any" value={line.qty} onChange={(e) => {
              const qty = e.target.value;
              updateLine(line.id, { qty });
              if (line.product_id && line.pricing_document_id) scheduleAutoReprice(line.id, line.product_id, qty);
            }} />
          </div>
          <div>
            <label style={lbl}>Rate (₹)</label>
            <input style={inp} type="number" min="0" step="0.01" value={line.rate} onChange={(e) => {
              const rate = e.target.value;
              if (line.pricing_document_id) {
                updateLine(line.id, { rate, pricing_document_id: "" });
                setOverriddenIds((s) => new Set(s).add(line.id));
                setLinePricing((p) => { const { [line.id]: _drop, ...rest } = p; return rest; });
              } else {
                updateLine(line.id, { rate });
              }
            }} />
            {overriddenIds.has(line.id) && (
              <div style={{ fontSize: 10.5, color: c.hint, marginTop: 3 }}>Rate overridden — no longer tracked by the engine</div>
            )}
          </div>
          <div>
            <label style={lbl}>Discount %</label>
            <input style={inp} type="number" min="0" max="100" step="0.1" value={line.discount_pct} onChange={(e) => updateLine(line.id, { discount_pct: e.target.value })} />
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12.5, color: c.muted, marginTop: 6 }}>
          = {inr(lineAmount(line))}
        </div>
      </>
    );
  }

  const [aiJobDesc, setAiJobDesc] = useState("");
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiIntroDrafting, setAiIntroDrafting] = useState(false);

  const accountContacts = contacts.filter((ct) => ct.account_id === accountId);
  const selectableLines: (SelectableLine & { id: string })[] = lines.map((l) => ({
    id: l.id, amount: lineAmount(l), group_id: l.group_id || null, group_type: l.group_type || null,
    break_of: l.break_of || null, is_selected: l.is_selected,
  }));
  const subtotal = documentTotal(selectableLines);
  const rows = groupedRows(lines);
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
          ...newLine(), id: Math.random().toString(36).slice(2),
          description: l.description, uom: l.uom || "Nos", qty: l.qty || "1",
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: 0 }}>Line items</h3>
                <div style={{ display: "flex", gap: 8 }}>
                  {pricingEngineQuotesEnabled && products.length > 0 && lines.some((l) => l.product_id) && (
                    <button
                      type="button"
                      disabled={priceAllBusy}
                      onClick={priceAllLines}
                      title="Price every line that names a product, in one call"
                      style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: priceAllBusy ? "default" : "pointer", opacity: priceAllBusy ? 0.6 : 1 }}
                    >
                      {priceAllBusy ? "Pricing all…" : "⚡ Price all lines"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={addAlternativeOption}
                    title="Give the customer a choice between two or more offers -- only the one they pick counts toward the total"
                    style={{ fontSize: 12, fontWeight: 600, color: c.muted, background: "transparent", border: `1px dashed ${c.line}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
                  >
                    + Add alternative option
                  </button>
                  <button
                    type="button"
                    onClick={() => setLines((ls) => [...ls, newLine()])}
                    style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
                  >
                    + Add line
                  </button>
                </div>
              </div>
              {priceAllSummary && (
                <div style={{ fontSize: 12, color: c.muted, marginBottom: 10, padding: "6px 10px", borderRadius: 6, background: c.panel2 }}>
                  {priceAllSummary.priced} priced
                  {priceAllSummary.needsRfq > 0 ? ` · ${priceAllSummary.needsRfq} need a supplier reply` : ""}
                  {priceAllSummary.failed > 0 ? ` · ${priceAllSummary.failed} failed` : ""}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(() => { let lineNo = 0; return rows.map((row) => {
                  if (row.kind === "line") {
                    lineNo += 1;
                    const line = row.line;
                    const breaks = row.breaks;
                    const hasBreaks = breaks.length > 0;
                    const chosenId = hasBreaks ? chosenBreakId(line, breaks) : line.id;
                    const breakIds = breaks.map((b) => b.id);
                    return (
                      <div key={line.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: c.hint }}>Line {lineNo}</span>
                          {lines.length > 1 && (
                            <button type="button" onClick={() => setLines((ls) => ls.filter((l) => l.id !== line.id && l.break_of !== line.id))} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--red)", fontSize: 12, cursor: "pointer" }}>
                              Remove
                            </button>
                          )}
                        </div>
                        {hasBreaks && (
                          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 8, fontSize: 11.5, color: chosenId === line.id ? c.accent : c.hint, fontWeight: 600 }}>
                            <input type="radio" checked={chosenId === line.id} onChange={() => chooseBreak(line.id, line.id, breakIds)} />
                            Base quantity ({line.qty || "1"})
                          </label>
                        )}
                        {renderLineFields(line)}
                        {breaks.map((b) => (
                          <div key={b.id} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${c.line}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                <input type="radio" checked={chosenId === b.id} onChange={() => chooseBreak(line.id, b.id, breakIds)} />
                                <span style={{ fontSize: 11.5, fontWeight: 600, color: chosenId === b.id ? c.accent : c.hint }}>From qty</span>
                              </label>
                              <input
                                type="number" min="1" step="1" value={b.break_qty}
                                onChange={(e) => setLines((ls) => ls.map((l) => (l.id === b.id ? { ...l, break_qty: e.target.value, qty: e.target.value } : l)))}
                                style={{ ...inp, width: 70, padding: "4px 8px", fontSize: 12.5 }}
                              />
                              <button type="button" onClick={() => removeBreak(b.id)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--red)", fontSize: 12, cursor: "pointer" }}>
                                Remove break
                              </button>
                            </div>
                            {renderLineFields(b)}
                          </div>
                        ))}
                        {!line.group_type && (
                          <button type="button" onClick={() => addBreak(line)} style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                            + Add quantity break
                          </button>
                        )}
                      </div>
                    );
                  }
                  // An alternative option: one or more lines that together
                  // make up one offer -- only the chosen option's lines
                  // count toward the total (src/lib/sales/lineTotals.ts).
                  const isChosen = row.group_id === chosenGroupId;
                  return (
                    <div key={row.group_id} style={{ border: `1px solid ${isChosen ? c.accent : c.line}`, borderRadius: 8, padding: 10, background: isChosen ? c.accentbg : "transparent" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                          <input type="radio" checked={isChosen} onChange={() => chooseGroup(row.group_id)} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: isChosen ? c.accent : c.hint }}>{isChosen ? "Selected option" : "Use this option"}</span>
                        </label>
                        <input
                          value={row.label}
                          onChange={(e) => renameGroup(row.group_id, e.target.value)}
                          placeholder="Option name"
                          style={{ ...inp, width: 180, padding: "4px 8px", fontSize: 12.5, fontWeight: 600 }}
                        />
                        <button type="button" onClick={() => addItemToGroup(row.group_id, row.label)} style={{ fontSize: 11.5, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer" }}>
                          + Add item
                        </button>
                        <button type="button" onClick={() => removeGroup(row.group_id)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--red)", fontSize: 12, cursor: "pointer" }}>
                          Remove option
                        </button>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {row.lines.map((line) => (
                          <div key={line.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 10, background: c.panel }}>
                            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                              <span style={{ fontSize: 10.5, color: c.hint }}>Item</span>
                              <button type="button" onClick={() => setLines((ls) => { const rest = ls.filter((l) => l.id !== line.id); return rest.length ? rest : [newLine()]; })} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--red)", fontSize: 12, cursor: "pointer" }}>
                                Remove
                              </button>
                            </div>
                            {renderLineFields(line)}
                          </div>
                        ))}
                      </div>
                      <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 600, color: c.ink, marginTop: 8 }}>
                        Option total = {inr(row.lines.reduce((s, l) => s + lineAmount(l), 0))}
                      </div>
                    </div>
                  );
                }); })()}
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
