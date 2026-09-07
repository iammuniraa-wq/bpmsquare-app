"use client";

import { useState, useRef, useEffect } from "react";
import { c } from "@/lib/theme";
import { UOM_OPTIONS } from "@/lib/constants";
import PriceTrace, { type PriceTraceStep } from "@/components/pricing/PriceTrace";
import { useTraceDetail, useCurrency } from "@/lib/tenant-context";
import { moneyFormatter, moneyLabel } from "@/lib/currency";

// The ONE document-line editor (docs/sales-engine-architecture.md §4.5):
// Standard Quotes and Opportunities (and later Quotations) render the same
// rows, chips, details panels, add-line panel and AI drafter, so the three
// objects can never drift. The parent owns the `lines` state (it is what
// gets saved) and the header-level numbers (tax, PDF options); everything
// that is about a LINE lives here. Extracted from StandardQuoteForm.tsx
// on 2026-09-06 (Piece B) without behaviour change.

export type Line = {
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
   *  different quantity ("from qty 10…"). A line inside an alternative
   *  option can carry breaks too (0118) -- the break rows copy the
   *  parent's group fields so lineTotals.ts composes both decisions. */
  break_of: string;
  break_qty: string;
  is_selected: boolean;
  /** Rep's PDF override (0118): false hides the row from the PDF only. */
  show_on_pdf: boolean;
};

export type StandardQuoteProduct = {
  id: string; ref: string | null; name: string; uom: string | null; list_price: number | null;
  /** Category (and sub-category) -- "alternatives" in the add-line panel
   *  are other products of the same category (owner decision 2026-09-06). */
  category: string | null; sub_category: string | null;
  /** The product's own quantity breaks (0118), local or ERP-synced. */
  qty_breaks: { from: number; rate: number | null }[];
};

export type PrintOptions = { alternatives: "all" | "chosen"; breaks: "all" | "chosen" };

// What "copy from previous quotes" shows (GET /api/standard-quotes/line-history).
type HistoryItem = {
  line_id: string; quote_ref: string; quote_status: string; quoted_at: string | null; account_name: string | null;
  description: string; uom: string | null; qty: number; rate: number; discount_pct: number; amount: number;
  product_id: string | null; was_chosen: boolean;
};

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

const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
// Compact line editor: one grid row per line, the same column template for
// the header, ordinary lines and quantity-break sub-rows so columns line up.
const GRID_COLUMNS = "26px minmax(0,1fr) 68px 66px 100px 58px 104px 96px 46px";
const gridRow: React.CSSProperties = { display: "grid", gridTemplateColumns: GRID_COLUMNS, alignItems: "center", borderBottom: `1px solid ${c.line}` };
const cell: React.CSSProperties = { padding: "4px 4px", display: "flex", alignItems: "center", minWidth: 0 };
const headCell: React.CSSProperties = { padding: "6px 6px", fontSize: 10.5, fontWeight: 600, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const cinp: React.CSSProperties = { ...inp, padding: "6px 8px", fontSize: 12.5, borderRadius: 6 };
const cnum: React.CSSProperties = { ...cinp, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const amountText: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap", border: "none", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" };
const iconBtn: React.CSSProperties = { width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15, lineHeight: 1, color: c.hint, background: "none", border: "none", cursor: "pointer", padding: 0, borderRadius: 4 };

export function newLine(): Line {
  return {
    id: Math.random().toString(36).slice(2), description: "", uom: "Nos", qty: "1", rate: "0", discount_pct: "0",
    product_id: "", pricing_document_id: "", group_id: "", group_label: "", group_type: "",
    break_of: "", break_qty: "", is_selected: true, show_on_pdf: true,
  };
}

function breaksByParentOf(lines: Line[]): Map<string, Line[]> {
  const m = new Map<string, Line[]>();
  for (const l of lines) {
    if (!l.break_of) continue;
    const arr = m.get(l.break_of);
    if (arr) arr.push(l); else m.set(l.break_of, [l]);
  }
  return m;
}

export function lineAmount(l: Line): number {
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
  const breaksByParent = breaksByParentOf(lines);
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

export default function DocumentLinesEditor({
  lines, onChange, products = [], pricingEnabled = false, accountId, accountName, documentType, documentId,
  taxPct, onTaxPct, printOptions, onPrintOptions, onError,
}: {
  lines: Line[];
  onChange: React.Dispatch<React.SetStateAction<Line[]>>;
  products?: StandardQuoteProduct[];
  /** pricing_engine + pricing_engine_quotes -- resolved server-side by the page. */
  pricingEnabled?: boolean;
  accountId: string;
  accountName?: string;
  /** What the lines belong to -- the engine routes and stamps provenance by it. */
  documentType: "standard_quote" | "opportunity";
  /** The saved parent's id (undefined until it exists). */
  documentId?: string;
  /** Header tax % the engine may fill when the parent has none. */
  taxPct?: string;
  onTaxPct?: (pct: string) => void;
  /** PDF options -- only documents that print pass these. */
  printOptions?: PrintOptions;
  onPrintOptions?: (o: PrintOptions) => void;
  /** Where a document-level error goes (the parent's error box). */
  onError: (message: string) => void;
}) {
  const setLines = onChange;
  const traceDetail = useTraceDetail();
  const cur = useCurrency();
  const inr = moneyFormatter(cur, { maximumFractionDigits: 0 });
  // The add-line panel (0118, docs/sales-engine-architecture.md §3.6):
  // "+ Add line" asks where the line comes from and, for a catalog
  // product, whether to offer its quantity breaks and any alternatives.
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"catalog" | "previous" | "free">("catalog");
  const [panelProductId, setPanelProductId] = useState("");
  const [panelQty, setPanelQty] = useState("1");
  const [breakChoice, setBreakChoice] = useState<"none" | "suggested" | "own">("none");
  const [chosenBreakQtys, setChosenBreakQtys] = useState<Set<number>>(new Set());
  const [ownBreaks, setOwnBreaks] = useState("");
  const [altChoice, setAltChoice] = useState<"none" | "suggested" | "pick">("none");
  const [chosenAltIds, setChosenAltIds] = useState<Set<string>>(new Set());
  const [pickAltId, setPickAltId] = useState("");
  const [historyScope, setHistoryScope] = useState<"account" | "product">("account");
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [chosenHistoryIds, setChosenHistoryIds] = useState<Set<string>>(new Set());

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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const expand = (id: string) => setExpandedIds((s) => (s.has(id) ? s : new Set(s).add(id)));
  const repriceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // A pending re-price must not fire into an unmounted form.
  useEffect(() => () => { for (const t of Object.values(repriceTimers.current)) clearTimeout(t); }, []);
  function chooseProduct(lineId: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    setLines((ls) => {
      const parent = ls.find((l) => l.id === lineId);
      if (!parent) return ls;
      const next: Line = !p
        ? { ...parent, product_id: "", pricing_document_id: "" }
        : {
            ...parent, product_id: p.id, pricing_document_id: "",
            description: parent.description.trim() ? parent.description : p.name,
            uom: p.uom && (UOM_OPTIONS as readonly string[]).includes(p.uom) ? p.uom : parent.uom,
            rate: parseFloat(parent.rate) > 0 ? parent.rate : String(p.list_price ?? 0),
          };
      // A quantity break is the same item: it follows the parent's product.
      return ls.map((l) => (l.id === lineId ? next : l.break_of === lineId ? { ...l, product_id: next.product_id, description: next.description, uom: next.uom, pricing_document_id: "" } : l));
    });
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
  /** Marks `groupId` the chosen option and every other alternative group
   *  not-selected -- mirrors lineTotals.ts's own resolution so the
   *  on-screen total and the radio state never disagree. A break row's
   *  flag ("offered") is its own and is left alone. */
  function chooseGroup(groupId: string) {
    setLines((ls) => ls.map((l) => (l.group_type === "alternative" && l.group_id && !l.break_of ? { ...l, is_selected: l.group_id === groupId } : l)));
  }
  const altGroupIds = [...new Set(lines.filter((l) => l.group_type === "alternative" && l.group_id).map((l) => l.group_id))];
  const chosenGroupId = altGroupIds.find((gid) => lines.some((l) => l.group_id === gid && !l.break_of && l.is_selected === true)) ?? altGroupIds[0] ?? null;

  // Quantity breaks (Sales Engine Piece A, §3.4): a line can offer more
  // than one quantity, each its own price ("1-9 at X, 10+ at Y"); only the
  // chosen quantity counts toward the total. A line inside an alternative
  // option can carry them too (0118): the break copies the parent's group
  // fields so both decisions compose in lineTotals.ts.
  function breakRowFor(parent: Line, qty: number, rate?: number | null): Line {
    return {
      // is_selected on a break means "offered on the quote" (2026-09-06):
      // a new break is offered until the rep unticks it. The base quantity
      // stays what is charged either way.
      ...newLine(), break_of: parent.id, break_qty: String(qty), qty: String(qty), is_selected: true,
      description: parent.description, uom: parent.uom, product_id: parent.product_id, discount_pct: parent.discount_pct,
      rate: rate != null ? String(rate) : parent.rate,
      group_id: parent.group_id, group_label: parent.group_label, group_type: parent.group_type,
    };
  }
  function addBreak(parentLine: Line) {
    const existing = lines.filter((l) => l.break_of === parentLine.id);
    const nextQty = existing.length > 0
      ? Math.max(...existing.map((b) => parseFloat(b.break_qty) || 0)) + 10
      : Math.max(2, (parseFloat(parentLine.qty) || 1) + 9);
    setLines((ls) => [...ls, breakRowFor(parentLine, nextQty)]);
  }
  function removeBreak(breakId: string) {
    setLines((ls) => ls.filter((l) => l.id !== breakId));
  }
  /** A break's checkbox: offered on the quote (printed) or not. Never
   *  affects the total -- the base quantity is what is charged. */
  function toggleBreak(breakId: string, offered: boolean) {
    setLines((ls) => ls.map((l) => (l.id === breakId ? { ...l, is_selected: offered } : l)));
  }

  async function priceWithEngine(lineId: string, productId: string, qty: string) {
    const quantity = parseFloat(qty) || 1;
    setPricingBusyIds((p) => new Set(p).add(lineId));
    setPricingErrors((p) => { const { [lineId]: _drop, ...rest } = p; return rest; });
    try {
      const res = await fetch("/api/quotes/price-line", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, account_id: accountId || undefined, quantity, standard_quote_id: documentType === "standard_quote" ? documentId ?? "" : "" }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json.needs_rfq) {
        setLinePricing((p) => ({ ...p, [lineId]: { kind: "needs_rfq", product: json.product, missing: json.missing ?? [], message: json.message, cost_model: json.cost_model ?? null } }));
        expand(lineId);
        return;
      }
      if (!res.ok) { setPricingErrors((p) => ({ ...p, [lineId]: json.error ?? "Pricing failed" })); expand(lineId); return; }
      updateLine(lineId, { rate: String(Math.round((json.unit_rate as number) * 100) / 100), pricing_document_id: json.document_id ?? "" });
      setOverriddenIds((s) => { if (!s.has(lineId)) return s; const n = new Set(s); n.delete(lineId); return n; });
      // The line rate is before tax; the header applies tax once. Fill the
      // header from the engine only when the rep has not set one.
      if ((parseFloat(taxPct ?? "0") || 0) === 0 && typeof json.tax_pct === "number" && json.tax_pct > 0) onTaxPct?.(String(json.tax_pct));
      setLinePricing((p) => ({ ...p, [lineId]: { kind: "priced", document_id: json.document_id ?? null, area: json.area, flags: json.flags ?? [], trace: json.trace ?? [], open: false } }));
    } catch {
      setPricingErrors((p) => ({ ...p, [lineId]: "Network error — try again." }));
      expand(lineId);
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
    onError("");
    setPricingBusyIds((p) => { const n = new Set(p); for (const t of targets) n.add(t.id); return n; });
    try {
      const res = await fetch("/api/pricing/price-lines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_type: documentType,
          document_id: documentId || undefined,
          account_id: accountId || undefined,
          lines: targets.map((l) => ({ line_key: l.id, product_id: l.product_id, quantity: parseFloat(l.qty) || 1 })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { onError(json.error ?? "Price all lines failed"); return; }
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
          expand(r.line_key);
        } else {
          failed++;
          setPricingErrors((p) => ({ ...p, [r.line_key]: "error" in r ? r.error : "Pricing failed" }));
          expand(r.line_key);
        }
      }
      if ((parseFloat(taxPct ?? "0") || 0) === 0 && firstTaxPct) onTaxPct?.(String(firstTaxPct));
      setPriceAllSummary({ priced, needsRfq, failed });
    } catch {
      onError("Network error pricing all lines — try again.");
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
          standard_quote_id: documentType === "standard_quote" ? documentId ?? null : null, opportunity_id: documentType === "opportunity" ? documentId ?? null : null, cost_model_code: info.cost_model ?? undefined,
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

  // Compact line editor (owner decision 2026-09-06: "too much on screen").
  // One row per line; everything that is not a number the rep types --
  // the engine's working, a flag's explanation, the RFQ form, an error,
  // the secondary actions -- lives in a details panel under the row that
  // opens from the status chip or the chevron. It opens by itself only
  // when the line needs the rep to act (an RFQ, a failure).
  function toggleExpanded(id: string) {
    setExpandedIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function removeLine(id: string) {
    setLines((ls) => { const rest = ls.filter((l) => l.id !== id && l.break_of !== id); return rest.length ? rest : [newLine()]; });
  }

  /** A manual rate on an engine-priced line drops the pricing document
   *  and marks the line overridden (a hand-typed number must never pass
   *  for the engine's). */
  function onRateChange(line: Line, rate: string) {
    if (line.pricing_document_id) {
      updateLine(line.id, { rate, pricing_document_id: "" });
      setOverriddenIds((s) => new Set(s).add(line.id));
      setLinePricing((p) => { const { [line.id]: _drop, ...rest } = p; return rest; });
    } else {
      updateLine(line.id, { rate });
    }
  }

  function statusChip(line: Line) {
    const info = linePricing[line.id];
    const err = pricingErrors[line.id];
    if (pricingBusyIds.has(line.id)) return <span style={{ ...chip, background: c.panel2, color: c.hint }}>Pricing…</span>;
    let label = "", bg = "", ink = "", title = "";
    if (err) { label = "Failed"; bg = "var(--err-bg)"; ink = "var(--err-ink)"; title = err; }
    else if (info?.kind === "priced") {
      const block = info.flags.find((f) => f.policy === "block");
      const flag = block ?? info.flags[0];
      if (flag) {
        label = flag.code === "MARGIN_FLOOR" ? `${flag.actual_pct}% < ${flag.floor_pct}%` : flag.code;
        bg = block ? "var(--err-bg)" : "var(--amberbg)"; ink = block ? "var(--err-ink)" : "var(--amberink)";
        title = block ? "Below the margin floor — this quote can't be sent until approved" : "Check before sending";
      } else { label = "Engine"; bg = "var(--tealbg)"; ink = "var(--tealink)"; title = "Priced by the engine, before tax — open for the working"; }
    }
    else if (info?.kind === "needs_rfq") { label = "Needs RFQ"; bg = "var(--amberbg)"; ink = "var(--amberink)"; title = info.message; }
    else if (info?.kind === "rfq_sent") { label = "RFQ sent"; bg = "var(--tealbg)"; ink = "var(--tealink)"; title = `${info.ref} sent to ${info.supplier}`; }
    else if (info?.kind === "rfq_draft") { label = "RFQ draft"; bg = "var(--amberbg)"; ink = "var(--amberink)"; title = `${info.ref} saved but not sent`; }
    else if (overriddenIds.has(line.id)) { label = "Manual"; bg = c.panel2; ink = c.hint; title = "Rate overridden — no longer tracked by the engine"; }
    else if (line.pricing_document_id) {
      // Priced by the engine on an earlier save: the working isn't in this
      // session, so the chip re-prices rather than expands.
      return (
        <button type="button" onClick={() => priceWithEngine(line.id, line.product_id, line.qty)} title="Priced by the engine when last saved — click to re-price" style={{ ...chip, background: "var(--tealbg)", color: "var(--tealink)", cursor: "pointer" }}>
          Engine ↻
        </button>
      );
    }
    else if (pricingEnabled && line.product_id) {
      return (
        <button type="button" onClick={() => priceWithEngine(line.id, line.product_id, line.qty)} title="Suggest a rate from the Pricing Engine — you can still edit it" style={{ ...chip, background: c.accentbg, color: c.accent, cursor: "pointer" }}>
          ⚡ Price
        </button>
      );
    }
    else return null;
    return <button type="button" onClick={() => toggleExpanded(line.id)} title={title} style={{ ...chip, background: bg, color: ink, cursor: "pointer" }}>{label}</button>;
  }

  function detailPanel(line: Line, isBreak: boolean) {
    const info = linePricing[line.id];
    const err = pricingErrors[line.id];
    const isOpen = rfqOpenId === line.id;
    const linkBtn: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 };
    return (
      <div style={{ padding: "8px 12px 10px 34px", background: c.panel2, borderBottom: `1px solid ${c.line}`, fontSize: 11.5, lineHeight: 1.5 }}>
        {err && <div style={{ color: "var(--err-ink)", fontWeight: 600 }}>{err}</div>}
        {overriddenIds.has(line.id) && <div style={{ color: c.hint }}>Rate overridden — no longer tracked by the engine.</div>}
        {info?.kind === "priced" && (
          <>
            <div style={{ color: c.hint }}>Priced by engine, before tax{info.area !== "default" ? ` · ${info.area}` : ""}</div>
            {info.flags.map((f, i) => {
              const blocked = f.policy === "block";
              return (
                <div key={i} style={{ color: blocked ? "var(--err-ink)" : "var(--amberink)", fontWeight: 600 }}>
                  {f.code === "MARGIN_FLOOR" ? `Margin ${f.actual_pct}% is below the ${f.floor_pct}% floor` : f.code}
                  {blocked ? " — this quote can't be sent until approved" : " — check before sending"}
                </div>
              );
            })}
            {info.trace.length > 0 && (
              <div style={{ marginTop: 6, padding: 8, borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel, overflowX: "auto", maxWidth: 560 }}>
                <PriceTrace steps={info.trace} compact detailed={traceDetail} />
              </div>
            )}
          </>
        )}
        {info?.kind === "needs_rfq" && (
          <>
            <div style={{ color: "var(--amberink)", fontWeight: 600 }}>{info.message}</div>
            {info.missing[0]?.considered?.length > 0 && (
              <div style={{ color: c.hint }}>Tried: {info.missing[0].considered.map((k) => `${k.source} (${k.reason ?? k.status})`).join("; ")}</div>
            )}
            {!isOpen ? (
              <button type="button" onClick={() => openRfq(line.id)} style={{ marginTop: 6, fontSize: 11.5, fontWeight: 600, color: "#fff", background: c.accent, border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>
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
                  <button type="button" disabled={rfqBusy} onClick={() => sendRfq(line.id, line.product_id, line.qty)}
                    style={{ fontSize: 11.5, fontWeight: 600, color: "#fff", background: c.accent, border: "none", borderRadius: 6, padding: "6px 10px", cursor: rfqBusy ? "default" : "pointer", opacity: rfqBusy ? 0.6 : 1 }}>
                    {rfqBusy ? "Sending…" : "Send"}
                  </button>
                  <button type="button" onClick={() => setRfqOpenId(null)} style={{ fontSize: 11.5, color: c.muted, background: "none", border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
        {info?.kind === "rfq_sent" && (
          <div style={{ color: "var(--tealink)" }}>{info.ref} sent to {info.supplier}{info.redirected ? " (redirected to the internal inbox)" : ""}. Price again once the reply is entered under Pricing → RFQs.</div>
        )}
        {info?.kind === "rfq_draft" && (
          <div style={{ color: "var(--amberink)" }}>{info.ref} saved but not sent: {info.reason}. Send it from Pricing → RFQs.</div>
        )}
        <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
          {pricingEnabled && line.product_id && (
            <button type="button" disabled={pricingBusyIds.has(line.id)} onClick={() => priceWithEngine(line.id, line.product_id, line.qty)} style={linkBtn}>⚡ Price with engine</button>
          )}
          {!isBreak && (
            <button type="button" onClick={() => addBreak(line)} title="Offer this item at a second quantity, at its own rate — only the chosen quantity counts" style={linkBtn}>+ Add quantity break</button>
          )}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: c.muted, cursor: "pointer" }} title="Hides this row from the PDF only — it still counts if it is selected">
            <input type="checkbox" checked={line.show_on_pdf} onChange={(e) => updateLine(line.id, { show_on_pdf: e.target.checked })} style={{ margin: 0 }} />
            Show on PDF
          </label>
          <button type="button" onClick={() => toggleExpanded(line.id)} style={{ ...linkBtn, color: c.hint, fontWeight: 400 }}>Close</button>
        </div>
      </div>
    );
  }

  function rowActions(line: Line) {
    const open = expandedIds.has(line.id);
    return (
      <div style={{ ...cell, gap: 2, justifyContent: "flex-end" }}>
        <button type="button" onClick={() => toggleExpanded(line.id)} title={open ? "Hide details" : "Details"} style={{ ...iconBtn, transform: open ? "rotate(90deg)" : "none" }}>›</button>
        <button type="button" onClick={() => removeLine(line.id)} title="Remove" style={{ ...iconBtn, color: "var(--red)" }}>×</button>
      </div>
    );
  }

  function lineRow(line: Line, no: number, opts: { dim?: boolean; breaks?: Line[] }) {
    const breaks = opts.breaks ?? [];
    const product = products.find((p) => p.id === line.product_id);
    return (
      <div key={line.id}>
        <div style={{ ...gridRow, opacity: opts.dim ? 0.55 : 1 }}>
          <div style={{ ...cell, justifyContent: "center", fontSize: 11.5, color: c.hint, textDecoration: line.show_on_pdf ? "none" : "line-through" }} title={line.show_on_pdf ? undefined : "Hidden from the PDF"}>{no}</div>
          <div style={{ ...cell, gap: 4 }}>
            {products.length > 0 && (
              <select
                value={line.product_id} title={product ? `${product.ref ? `${product.ref} · ` : ""}${product.name}` : "Pick a catalog product to price it with the engine"}
                onChange={(e) => {
                  const hadPrice = !!line.pricing_document_id;
                  chooseProduct(line.id, e.target.value);
                  if (hadPrice && e.target.value) scheduleAutoReprice(line.id, e.target.value, line.qty);
                }}
                style={{ ...cinp, width: 118, flexShrink: 0, color: line.product_id ? c.ink : c.hint }}
              >
                <option value="">No product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
              </select>
            )}
            <input style={cinp} value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} placeholder="What's being quoted" />
          </div>
          <div style={cell}>
            <select style={cinp} value={line.uom} onChange={(e) => updateLine(line.id, { uom: e.target.value })}>
              {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div style={cell}>
            <input style={cnum} type="number" min="0" step="any" value={line.qty} onChange={(e) => {
              const qty = e.target.value;
              updateLine(line.id, { qty });
              if (line.product_id && line.pricing_document_id) scheduleAutoReprice(line.id, line.product_id, qty);
            }} />
          </div>
          <div style={cell}>
            <input style={cnum} type="number" min="0" step="0.01" value={line.rate} onChange={(e) => onRateChange(line, e.target.value)} />
          </div>
          <div style={cell}>
            <input style={cnum} type="number" min="0" max="100" step="0.1" value={line.discount_pct} onChange={(e) => updateLine(line.id, { discount_pct: e.target.value })} />
          </div>
          <div style={{ ...cell, justifyContent: "flex-end" }}>
            <span style={{ ...amountText, color: c.ink }}>{inr(lineAmount(line))}</span>
          </div>
          <div style={{ ...cell, overflow: "hidden" }}>{statusChip(line)}</div>
          {rowActions(line)}
        </div>
        {expandedIds.has(line.id) && detailPanel(line, false)}
        {breaks.map((b) => breakRow(line, b, !!opts.dim))}
      </div>
    );
  }

  /** A quantity break is the same item at another quantity, OFFERED on the
   *  quote to upsell (ticked = printed; the base quantity is what is
   *  charged). Only the quantity and the rate are its own (description,
   *  UOM, product and discount follow the parent -- see updateLine). */
  function breakRow(parent: Line, b: Line, dim: boolean) {
    const offered = b.is_selected;
    return (
      <div key={b.id}>
        <div style={{ ...gridRow, background: c.panel2, opacity: dim ? 0.55 : offered ? 1 : 0.6 }}>
          <div style={{ ...cell, justifyContent: "center", color: c.hint }}>↳</div>
          <div style={{ ...cell, gap: 6 }}>
            <span style={{ fontSize: 11.5, color: c.muted, whiteSpace: "nowrap" }}>From qty</span>
            <input type="number" min="1" step="1" value={b.break_qty} style={{ ...cnum, width: 68, flex: "none" }} onChange={(e) => {
              const v = e.target.value;
              updateLine(b.id, { break_qty: v, qty: v });
              if (b.product_id && b.pricing_document_id) scheduleAutoReprice(b.id, b.product_id, v);
            }} />
            <span style={{ fontSize: 11, color: c.hint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>offer at its own rate</span>
          </div>
          <div style={{ ...cell, fontSize: 11.5, color: c.hint }}>{parent.uom}</div>
          <div style={{ ...cell, justifyContent: "flex-end", fontSize: 12.5, color: c.muted, fontVariantNumeric: "tabular-nums" }}>{b.qty || "—"}</div>
          <div style={cell}>
            <input style={cnum} type="number" min="0" step="0.01" value={b.rate} onChange={(e) => onRateChange(b, e.target.value)} />
          </div>
          <div style={{ ...cell, justifyContent: "flex-end", fontSize: 11.5, color: c.hint }}>{parent.discount_pct || "0"}%</div>
          <div style={{ ...cell, justifyContent: "flex-end", gap: 6 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }} title={offered ? "Offered on the quote — untick to leave it off the PDF" : "Not on the quote — tick to offer this quantity"}>
              <input type="checkbox" checked={offered} onChange={(e) => toggleBreak(b.id, e.target.checked)} style={{ margin: 0 }} />
              <span style={{ fontSize: 10.5, color: offered ? c.accent : c.hint, fontWeight: 600 }}>offer</span>
            </label>
            <span style={{ ...amountText, color: c.muted }}>{inr(lineAmount(b))}</span>
          </div>
          <div style={{ ...cell, overflow: "hidden" }}>{statusChip(b)}</div>
          <div style={{ ...cell, gap: 2, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => toggleExpanded(b.id)} title="Details" style={{ ...iconBtn, transform: expandedIds.has(b.id) ? "rotate(90deg)" : "none" }}>›</button>
            <button type="button" onClick={() => removeBreak(b.id)} title="Remove this quantity break" style={{ ...iconBtn, color: "var(--red)" }}>×</button>
          </div>
        </div>
        {expandedIds.has(b.id) && detailPanel(b, true)}
      </div>
    );
  }

  // ---- Add-line panel (0118) ------------------------------------------
  function resetPanel() {
    setPanelProductId(""); setPanelQty("1");
    setBreakChoice("none"); setChosenBreakQtys(new Set()); setOwnBreaks("");
    setAltChoice("none"); setChosenAltIds(new Set()); setPickAltId("");
    setChosenHistoryIds(new Set());
  }

  async function loadHistory(scope: "account" | "product", productId: string) {
    setHistoryBusy(true); setHistory(null);
    try {
      const qs = scope === "account" ? `scope=account&account_id=${encodeURIComponent(accountId)}` : `scope=product&product_id=${encodeURIComponent(productId)}`;
      const res = await fetch(`/api/standard-quotes/line-history?${qs}`);
      const json = await res.json().catch(() => ({}));
      setHistory(res.ok && Array.isArray(json.items) ? (json.items as HistoryItem[]) : []);
    } catch { setHistory([]); } finally { setHistoryBusy(false); }
  }

  function nextOptionLetter(existing: Line[]): string {
    const used = new Set(existing.filter((l) => l.group_type === "alternative").map((l) => l.group_id));
    return String.fromCharCode(65 + used.size);
  }

  /** The catalog tab's "Add": the product line, its chosen quantity
   *  breaks (unselected), and -- when alternatives were picked -- one
   *  option group per product with the main product as the chosen one. */
  function commitCatalogLine() {
    const p = products.find((x) => x.id === panelProductId);
    if (!p) { onError("Pick a product first"); return; }
    onError("");
    const qty = Math.max(0, parseFloat(panelQty) || 1);
    const alts = altChoice === "none" ? [] : products.filter((x) => chosenAltIds.has(x.id) && x.id !== p.id);
    const breaks: { from: number; rate: number | null }[] =
      breakChoice === "suggested" ? p.qty_breaks.filter((b) => chosenBreakQtys.has(b.from))
      : breakChoice === "own" ? [...new Set(ownBreaks.split(/[,\s]+/).map((s) => parseFloat(s)).filter((n) => Number.isFinite(n) && n > 1))].sort((a, b) => a - b).map((from) => ({ from, rate: null }))
      : [];

    setLines((ls) => {
      const seed = ls.length === 1 && !ls[0].description.trim() && !ls[0].product_id ? [] : ls;
      const lineFor = (prod: StandardQuoteProduct, group: { id: string; label: string } | null, selected: boolean): Line => ({
        ...newLine(), product_id: prod.id, description: prod.name,
        uom: prod.uom && (UOM_OPTIONS as readonly string[]).includes(prod.uom) ? prod.uom : "Nos",
        qty: String(qty), rate: String(prod.list_price ?? 0), is_selected: selected,
        group_id: group?.id ?? "", group_label: group?.label ?? "", group_type: group ? "alternative" : "",
      });
      let letterCode = nextOptionLetter(seed).charCodeAt(0);
      const mainGroup = alts.length > 0 ? { id: Math.random().toString(36).slice(2), label: `Option ${String.fromCharCode(letterCode++)}: ${p.name}` } : null;
      const main = lineFor(p, mainGroup, true);
      const out: Line[] = [main, ...breaks.map((b) => breakRowFor(main, b.from, b.rate))];
      for (const a of alts) {
        out.push(lineFor(a, { id: Math.random().toString(36).slice(2), label: `Option ${String.fromCharCode(letterCode++)}: ${a.name}` }, false));
      }
      return [...seed, ...out];
    });
    resetPanel();
    setPanelOpen(false);
  }

  /** The previous-quotes tab's "Add selected": copies of the ticked lines
   *  (the insight -- when, to whom, how it went -- stays in the panel). */
  function commitHistoryLines() {
    const picked = (history ?? []).filter((h) => chosenHistoryIds.has(h.line_id));
    if (picked.length === 0) return;
    const known = new Set(products.map((p) => p.id));
    setLines((ls) => {
      const seed = ls.length === 1 && !ls[0].description.trim() && !ls[0].product_id ? [] : ls;
      return [...seed, ...picked.map((h) => ({
        ...newLine(), description: h.description, uom: h.uom && (UOM_OPTIONS as readonly string[]).includes(h.uom) ? h.uom : "Nos",
        qty: String(h.qty), rate: String(h.rate), discount_pct: String(h.discount_pct ?? 0),
        product_id: h.product_id && known.has(h.product_id) ? h.product_id : "",
      }))];
    });
    resetPanel();
    setPanelOpen(false);
  }

  function renderAddPanel() {
    const p = products.find((x) => x.id === panelProductId) ?? null;
    const suggestedAlts = p && p.category ? products.filter((x) => x.id !== p.id && x.category === p.category).slice(0, 8) : [];
    const tabBtn = (key: typeof panelTab, label: string, disabled = false) => (
      <button type="button" disabled={disabled} onClick={() => { setPanelTab(key); if (key === "previous" && history === null && !historyBusy) loadHistory(historyScope, panelProductId); }}
        style={{ fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 6, border: `1px solid ${panelTab === key ? c.accent : c.line}`, background: panelTab === key ? c.accentbg : "transparent", color: panelTab === key ? c.accent : c.muted, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>
        {label}
      </button>
    );
    const q = (label: string) => <div style={{ fontSize: 11.5, fontWeight: 700, color: c.ink, marginBottom: 4 }}>{label}</div>;
    const radio = (name: string, value: string, current: string, onPick: () => void, label: string, disabled = false) => (
      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: disabled ? c.hint : c.ink, cursor: disabled ? "default" : "pointer" }}>
        <input type="radio" name={name} disabled={disabled} checked={current === value} onChange={onPick} style={{ margin: 0 }} />{label}
      </label>
    );
    const primary: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#fff", background: c.accent, border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer" };
    const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
    const statusTone = (s: string) => (s === "accepted" ? "var(--tealink)" : s === "rejected" || s === "expired" ? "var(--err-ink)" : c.muted);

    return (
      <div style={{ marginTop: 10, border: `1px solid ${c.accent}`, borderRadius: 8, padding: 12, background: c.panel }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: c.ink, marginRight: 6 }}>Add a line from</span>
          {tabBtn("catalog", "Catalog", products.length === 0)}
          {tabBtn("previous", "Previous quotes")}
          {tabBtn("free", "Free text")}
          <button type="button" onClick={() => { setLines((ls) => [...ls, newLine()]); setPanelOpen(false); }} style={{ marginLeft: "auto", fontSize: 11.5, color: c.hint, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Just a blank line</button>
        </div>

        {panelTab === "catalog" && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 90px", gap: 8 }}>
              <div>
                {q("Product")}
                <select value={panelProductId} onChange={(e) => { setPanelProductId(e.target.value); setChosenBreakQtys(new Set()); setChosenAltIds(new Set()); setBreakChoice("none"); setAltChoice("none"); }} style={cinp}>
                  <option value="">Pick a product…</option>
                  {products.map((x) => <option key={x.id} value={x.id}>{x.ref ? `${x.ref} · ` : ""}{x.name}</option>)}
                </select>
              </div>
              <div>
                {q("Qty")}
                <input type="number" min="0" step="any" value={panelQty} onChange={(e) => setPanelQty(e.target.value)} style={cnum} />
              </div>
            </div>

            {p && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  {q("1. Include quantity breaks?")}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {radio("brk", "none", breakChoice, () => setBreakChoice("none"), "No — this quantity only")}
                    {radio("brk", "suggested", breakChoice, () => { setBreakChoice("suggested"); setChosenBreakQtys(new Set(p.qty_breaks.map((b) => b.from))); },
                      p.qty_breaks.length > 0 ? `Yes — the product's own breaks (${p.qty_breaks.length})` : "Yes — the product's own breaks (none defined)", p.qty_breaks.length === 0)}
                    {breakChoice === "suggested" && (
                      <div style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 3 }}>
                        {p.qty_breaks.map((b) => (
                          <label key={b.from} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: c.ink, cursor: "pointer" }}>
                            <input type="checkbox" checked={chosenBreakQtys.has(b.from)} onChange={(e) => setChosenBreakQtys((s) => { const n = new Set(s); if (e.target.checked) n.add(b.from); else n.delete(b.from); return n; })} style={{ margin: 0 }} />
                            From {b.from}{p.uom ? ` ${p.uom}` : ""} · {b.rate != null ? inr(b.rate) : "priced normally"}
                          </label>
                        ))}
                      </div>
                    )}
                    {radio("brk", "own", breakChoice, () => setBreakChoice("own"), "Yes — I'll enter the quantities")}
                    {breakChoice === "own" && (
                      <input value={ownBreaks} onChange={(e) => setOwnBreaks(e.target.value)} placeholder="e.g. 10, 50, 100" style={{ ...cinp, marginLeft: 20, width: "calc(100% - 20px)" }} />
                    )}
                  </div>
                </div>
                <div>
                  {q("2. Offer alternatives?")}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {radio("alt", "none", altChoice, () => setAltChoice("none"), "No — just this product")}
                    {radio("alt", "suggested", altChoice, () => setAltChoice("suggested"),
                      suggestedAlts.length > 0 ? `Yes — same category (${suggestedAlts.length} found)` : "Yes — same category (none found)", suggestedAlts.length === 0)}
                    {altChoice === "suggested" && (
                      <div style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 3 }}>
                        {suggestedAlts.map((a) => (
                          <label key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: c.ink, cursor: "pointer" }}>
                            <input type="checkbox" checked={chosenAltIds.has(a.id)} onChange={(e) => setChosenAltIds((s) => { const n = new Set(s); if (e.target.checked) n.add(a.id); else n.delete(a.id); return n; })} style={{ margin: 0 }} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                            <span style={{ color: c.hint }}>{a.list_price != null ? inr(a.list_price) : ""}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {radio("alt", "pick", altChoice, () => setAltChoice("pick"), "Yes — I'll pick from the catalog")}
                    {altChoice === "pick" && (
                      <div style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
                        {[...chosenAltIds].map((id) => { const a = products.find((x) => x.id === id); return a ? (
                          <div key={id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                            <span>{a.name}</span>
                            <button type="button" onClick={() => setChosenAltIds((s) => { const n = new Set(s); n.delete(id); return n; })} style={{ fontSize: 12, color: "var(--red)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>×</button>
                          </div>
                        ) : null; })}
                        <select value={pickAltId} onChange={(e) => { const id = e.target.value; if (id) setChosenAltIds((s) => new Set(s).add(id)); setPickAltId(""); }} style={cinp}>
                          <option value="">Add an alternative…</option>
                          {products.filter((x) => x.id !== p.id && !chosenAltIds.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.ref ? `${x.ref} · ` : ""}{x.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" onClick={commitCatalogLine} disabled={!p} style={{ ...primary, opacity: p ? 1 : 0.5, cursor: p ? "pointer" : "default" }}>
                Add {p ? (altChoice !== "none" && chosenAltIds.size > 0 ? `as ${chosenAltIds.size + 1} options` : "line") : "line"}
              </button>
              <span style={{ fontSize: 11.5, color: c.hint }}>Rates start from list price — use Price all afterwards for engine prices.</span>
            </div>
          </div>
        )}

        {panelTab === "previous" && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {radio("hist", "account", historyScope, () => { setHistoryScope("account"); loadHistory("account", panelProductId); }, `Quoted to ${accountName || "this account"}`)}
              {radio("hist", "product", historyScope, () => { setHistoryScope("product"); loadHistory("product", panelProductId); }, "Same product, any account", !panelProductId)}
              {historyScope === "product" && (
                <select value={panelProductId} onChange={(e) => { setPanelProductId(e.target.value); loadHistory("product", e.target.value); }} style={{ ...cinp, width: 260 }}>
                  <option value="">Pick a product…</option>
                  {products.map((x) => <option key={x.id} value={x.id}>{x.ref ? `${x.ref} · ` : ""}{x.name}</option>)}
                </select>
              )}
            </div>
            {historyBusy && <div style={{ fontSize: 12, color: c.hint }}>Looking up previous quotes…</div>}
            {!historyBusy && history && history.length === 0 && <div style={{ fontSize: 12, color: c.hint }}>Nothing quoted before{historyScope === "account" ? " to this account" : " for this product"}.</div>}
            {!historyBusy && history && history.length > 0 && (
              <div style={{ border: `1px solid ${c.line}`, borderRadius: 6, overflow: "hidden" }}>
                {history.map((h) => (
                  <label key={h.line_id} style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr) 150px 70px 90px 90px", gap: 8, alignItems: "center", padding: "5px 8px", borderBottom: `1px solid ${c.line}`, fontSize: 12, cursor: "pointer", background: chosenHistoryIds.has(h.line_id) ? c.accentbg : "transparent" }}>
                    <input type="checkbox" checked={chosenHistoryIds.has(h.line_id)} onChange={(e) => setChosenHistoryIds((s) => { const n = new Set(s); if (e.target.checked) n.add(h.line_id); else n.delete(h.line_id); return n; })} style={{ margin: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.description}{h.was_chosen ? "" : <span style={{ color: c.hint }}> · was not the chosen option</span>}</span>
                    <span style={{ color: c.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.quote_ref} · {fmtDate(h.quoted_at)}{historyScope === "product" && h.account_name ? ` · ${h.account_name}` : ""}</span>
                    <span style={{ fontWeight: 600, color: statusTone(h.quote_status), textTransform: "capitalize" }}>{h.quote_status}</span>
                    <span style={{ textAlign: "right", color: c.muted }}>{h.qty} {h.uom ?? ""}</span>
                    <span style={{ textAlign: "right", fontWeight: 600 }}>{inr(h.rate)}</span>
                  </label>
                ))}
              </div>
            )}
            <div>
              <button type="button" onClick={commitHistoryLines} disabled={chosenHistoryIds.size === 0} style={{ ...primary, opacity: chosenHistoryIds.size ? 1 : 0.5, cursor: chosenHistoryIds.size ? "pointer" : "default" }}>
                Add {chosenHistoryIds.size || ""} selected
              </button>
            </div>
          </div>
        )}

        {panelTab === "free" && (
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" onClick={() => { setLines((ls) => [...ls, newLine()]); setPanelOpen(false); }} style={primary}>Add a blank line</button>
            <span style={{ fontSize: 11.5, color: c.hint }}>Type the description, quantity and rate on the row.</span>
          </div>
        )}
      </div>
    );
  }

  const [aiJobDesc, setAiJobDesc] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);
  const rows = groupedRows(lines);
  const breaksByParent = breaksByParentOf(lines);
  /** A quantity break is the same item at another quantity, so the fields
   *  that describe the item (not its quantity or rate) follow the parent. */
  const INHERITED_BY_BREAKS = ["description", "uom", "product_id", "discount_pct"] as const;
  function updateLine(id: string, patch: Partial<Line>) {
    const inherited: Partial<Line> = {};
    for (const k of INHERITED_BY_BREAKS) if (k in patch) (inherited as Record<string, unknown>)[k] = patch[k];
    const propagate = Object.keys(inherited).length > 0;
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : propagate && l.break_of === id ? { ...l, ...inherited } : l)));
  }

  const blockedCount = lines.filter((l) => {
    const info = linePricing[l.id];
    return info?.kind === "priced" && info.flags.some((f) => f.policy === "block");
  }).length;
  function draftLinesWithAI() {
    if (!aiJobDesc.trim()) return;
    setAiDrafting(true);
    onError("");
    fetch("/api/standard-quotes/ai-draft-lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: aiJobDesc }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) { onError(json.error ?? "AI drafting failed"); return; }
        const drafted: Line[] = (json.lines as { description: string; uom: string; qty: string }[]).map((l) => ({
          ...newLine(), id: Math.random().toString(36).slice(2),
          description: l.description, uom: l.uom || "Nos", qty: l.qty || "1",
        }));
        if (drafted.length === 0) { onError("AI didn't return any line items — try a more specific description"); return; }
        setLines((ls) => (ls.length === 1 && !ls[0].description.trim() ? drafted : [...ls, ...drafted]));
      })
      .catch(() => onError("Could not reach the AI drafting service"))
      .finally(() => setAiDrafting(false));
  }

  return (
    <>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: 0 }}>Line items</h3>
      {priceAllSummary && (
        <span style={{ fontSize: 11.5, color: c.muted }}>
          {priceAllSummary.priced} priced
          {priceAllSummary.needsRfq > 0 ? ` · ${priceAllSummary.needsRfq} need a supplier reply` : ""}
          {priceAllSummary.failed > 0 ? ` · ${priceAllSummary.failed} failed` : ""}
        </span>
      )}
      {blockedCount > 0 && (
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--err-ink)" }}>{blockedCount} below the margin floor — can&apos;t be sent until approved</span>
      )}
      {pricingEnabled && products.length > 0 && lines.some((l) => l.product_id) && (
        <button
          type="button"
          disabled={priceAllBusy}
          onClick={priceAllLines}
          title="Price every line that names a product, in one call"
          style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: priceAllBusy ? "default" : "pointer", opacity: priceAllBusy ? 0.6 : 1 }}
        >
          {priceAllBusy ? "Pricing all…" : "⚡ Price all"}
        </button>
      )}
      <button
        type="button" onClick={() => setAiOpen((o) => !o)}
        title="Describe the job and let AI draft the line items"
        style={{ marginLeft: pricingEnabled && products.length > 0 && lines.some((l) => l.product_id) ? 0 : "auto", fontSize: 12, fontWeight: 600, color: aiOpen ? c.accent : c.muted, background: "none", border: `1px solid ${aiOpen ? c.accent : c.line}`, borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}
      >
        ✨ Draft with AI
      </button>
    </div>
    {aiOpen && (
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={cinp}
            autoFocus
            value={aiJobDesc}
            onChange={(e) => setAiJobDesc(e.target.value)}
            placeholder="Describe the job — e.g. install 3 split ACs and set up an annual AMC"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); draftLinesWithAI(); } }}
          />
          <button
            type="button" disabled={aiDrafting || !aiJobDesc.trim()} onClick={draftLinesWithAI}
            style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "0 14px", cursor: aiDrafting ? "wait" : "pointer" }}
          >
            {aiDrafting ? "Drafting…" : "Draft"}
          </button>
        </div>
        <p style={{ fontSize: 11, color: c.hint, margin: "4px 0 0" }}>AI suggests description, UOM and quantity — rates are left at {inr(0)} for you to price.</p>
      </div>
    )}

    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 720, border: `1px solid ${c.line}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ ...gridRow, background: c.panel2 }}>
          <div style={{ ...headCell, textAlign: "center" }}>#</div>
          <div style={headCell}>{products.length > 0 ? "Product · description" : "Description"}</div>
          <div style={headCell}>UOM</div>
          <div style={{ ...headCell, textAlign: "right" }}>Qty</div>
          <div style={{ ...headCell, textAlign: "right" }}>{moneyLabel("Rate", cur)}</div>
          <div style={{ ...headCell, textAlign: "right" }}>Disc %</div>
          <div style={{ ...headCell, textAlign: "right" }}>Amount</div>
          <div style={headCell}>Price</div>
          <div style={headCell} />
        </div>
        {(() => { let no = 0; return rows.map((row) => {
          if (row.kind === "line") { no += 1; return lineRow(row.line, no, { breaks: row.breaks }); }
          // An alternative option: one or more lines that together
          // make up one offer -- only the chosen option's lines count
          // toward the total (src/lib/sales/lineTotals.ts).
          const isChosen = row.group_id === chosenGroupId;
          const groupTotal = row.lines.reduce((s, l) => s + lineAmount(l), 0);
          return (
            <div key={row.group_id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px 5px 6px", background: isChosen ? c.accentbg : c.panel2, borderBottom: `1px solid ${c.line}`, borderLeft: `3px solid ${isChosen ? c.accent : c.line}` }}>
                <input type="radio" checked={isChosen} onChange={() => chooseGroup(row.group_id)} title="Quote this option" style={{ margin: 0 }} />
                <input
                  value={row.label} onChange={(e) => renameGroup(row.group_id, e.target.value)} placeholder="Option name"
                  style={{ ...cinp, width: 200, fontWeight: 600, background: "transparent", border: "1px solid transparent", padding: "3px 6px" }}
                />
                <span style={{ fontSize: 11.5, fontWeight: 600, color: isChosen ? c.accent : c.hint, whiteSpace: "nowrap" }}>
                  {isChosen ? "Chosen" : "Alternative — not charged"} · {inr(groupTotal)}
                </span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
                  <button type="button" onClick={() => addItemToGroup(row.group_id, row.label)} style={{ fontSize: 11.5, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>+ Item</button>
                  <button type="button" onClick={() => removeGroup(row.group_id)} style={{ fontSize: 11.5, color: "var(--red)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Remove option</button>
                </span>
              </div>
              {row.lines.map((line) => { no += 1; return lineRow(line, no, { dim: !isChosen, breaks: breaksByParent.get(line.id) ?? [] }); })}
            </div>
          );
        }); })()}
      </div>
    </div>

    {panelOpen && renderAddPanel()}

    <div style={{ display: "flex", gap: 18, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" onClick={() => { setPanelOpen((o) => !o); setPanelTab(products.length > 0 ? "catalog" : "free"); }} style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
        {panelOpen ? "− Close" : "+ Add line"}
      </button>
      <button
        type="button" onClick={addAlternativeOption}
        title="Give the customer a choice between two or more offers — only the one they pick counts toward the total"
        style={{ fontSize: 12, fontWeight: 600, color: c.muted, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}
      >
        + Alternative option
      </button>
      {printOptions && onPrintOptions && altGroupIds.length > 0 && (
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11.5, color: c.muted }} title="What the PDF prints for the options the customer did not choose — the total never changes">
          On the PDF:
          <select value={printOptions.alternatives} onChange={(e) => onPrintOptions({ ...printOptions, alternatives: e.target.value === "chosen" ? "chosen" : "all" })} style={{ ...cinp, width: "auto", padding: "3px 6px", fontSize: 11.5 }}>
            <option value="all">all options</option>
            <option value="chosen">chosen option only</option>
          </select>
        </span>
      )}
    </div>
    </>
  );
}
