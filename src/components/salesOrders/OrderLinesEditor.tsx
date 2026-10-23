"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Textarea } from "@/components/ui/Input";
import type { PricingMode } from "@/lib/salesOrders/types";
import { editTotals, fromProduct, lineAmount, newEditLine, searchProducts, type EditLine, type PickProduct } from "./lines";
import { fmtMoney } from "./money";
import { ORDER_TIPS } from "./tips";
import s from "./salesOrders.module.css";

/**
 * The order's line editor. Not the quote line editor on purpose: that one carries alternatives, quantity breaks, RFQs
 * and engine pricing, none of which an order has. A line here is item, quantity, unit price, discount, tax, the date
 * wanted and the text that prints under it. Add lines by searching the catalog or typing a free line.
 */
export default function OrderLinesEditor({ lines, onChange, products, currency, pricingMode, defaults, idPrefix = "ol" }: {
  lines: EditLine[];
  onChange: (next: EditLine[]) => void;
  products: PickProduct[];
  currency: string;
  /** Only "external" locks the price fields (the ERP supplies them); null = not known yet. */
  pricingMode: PricingMode | null;
  defaults: { tax_pct?: string; requested_date?: string };
  idPrefix?: string;
}) {
  const [query, setQuery] = useState("");
  const [openText, setOpenText] = useState<Set<string>>(new Set());
  const found = searchProducts(products, query);
  const priceLocked = pricingMode === "external";
  const totals = editTotals(lines);

  const patch = (key: string, p: Partial<EditLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const add = (l: EditLine) => {
    const onlyBlank = lines.length === 1 && lines[0].description.trim() === "" && lines[0].product_id === "";
    onChange(onlyBlank ? [l] : [...lines, l]);
  };

  return (
    <div data-guide="sales_order.lines_editor">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
        {products.length > 0 && (
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the catalog to add a line"
              aria-label="Search the catalog"
              data-guide="sales_order.product_search"
              style={{ minHeight: 44 }}
            />
            {found.length > 0 && (
              <div className={s.pickResults} role="listbox" aria-label="Catalog results">
                {found.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={s.pickItem}
                    onClick={() => { add(fromProduct(p, defaults)); setQuery(""); }}
                  >
                    <span>{p.name}{p.ref ? <span className={s.muted}> · {p.ref}</span> : null}</span>
                    <span className={s.muted}>{p.list_price !== null ? fmtMoney(p.list_price, currency) : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <Button variant="secondary" onClick={() => add(newEditLine(defaults))} data-guide="sales_order.add_line" style={{ minHeight: 44 }}>+ Add line</Button>
      </div>

      <div style={{ marginTop: 10 }}>
        {lines.map((l, i) => {
          const id = `${idPrefix}-${l.key}`;
          return (
            <div key={l.key} className={s.editRow} role="group" aria-label={`Line ${i + 1}`}>
              <div className={s.editMain}>
                <div>
                  <label htmlFor={`${id}-d`}>Item</label>
                  <Input id={`${id}-d`} data-guide="sales_order.line_item" value={l.description} onChange={(e) => patch(l.key, { description: e.target.value })} placeholder="What is being sold" />
                </div>
                <div style={{ paddingTop: 20 }}>
                  <Button
                    variant="quiet" size="sm" iconOnly aria-label={`Remove line ${i + 1}`} data-guide="sales_order.remove_line"
                    onClick={() => onChange(lines.length === 1 ? [newEditLine(defaults)] : lines.filter((x) => x.key !== l.key))}
                  >×</Button>
                </div>
              </div>
              <div className={s.editNums}>
                <div><label htmlFor={`${id}-q`}>Qty</label><Input id={`${id}-q`} data-guide="sales_order.line_qty" type="number" inputMode="decimal" min="0" step="any" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} /></div>
                <div><label htmlFor={`${id}-u`}>Unit</label><Input id={`${id}-u`} data-guide="sales_order.line_unit" value={l.uom} onChange={(e) => patch(l.key, { uom: e.target.value })} /></div>
                <div><label htmlFor={`${id}-p`}>Unit price</label><Input id={`${id}-p`} data-guide="sales_order.line_price" type="number" inputMode="decimal" min="0" step="any" value={l.unit_price} disabled={priceLocked} onChange={(e) => patch(l.key, { unit_price: e.target.value })} /></div>
                <div><label htmlFor={`${id}-x`}>Disc. %</label><Input id={`${id}-x`} data-guide="sales_order.line_discount" type="number" inputMode="decimal" min="0" max="100" step="any" value={l.discount_pct} disabled={priceLocked} onChange={(e) => patch(l.key, { discount_pct: e.target.value })} /></div>
                <div><label htmlFor={`${id}-t`}>Tax %</label><Input id={`${id}-t`} data-guide="sales_order.line_tax" type="number" inputMode="decimal" min="0" max="100" step="any" value={l.tax_pct} disabled={priceLocked} onChange={(e) => patch(l.key, { tax_pct: e.target.value })} /></div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                  <label htmlFor={`${id}-r`} style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--hint)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Wanted by</label>
                  <Input id={`${id}-r`} data-guide="sales_order.line_wanted" type="date" value={l.requested_date} onChange={(e) => patch(l.key, { requested_date: e.target.value })} />
                </div>
                <div className={s.num} style={{ fontWeight: 700, fontSize: 14 }}>{priceLocked ? "Priced by the ERP" : fmtMoney(lineAmount(l), currency)}</div>
              </div>
              <div>
                <span className="bpm-label-row">
                  <button
                    type="button" className={s.linkBtn} aria-expanded={openText.has(l.key)} data-guide="sales_order.printed_text"
                    onClick={() => setOpenText((cur) => { const next = new Set(cur); if (next.has(l.key)) next.delete(l.key); else next.add(l.key); return next; })}
                  >{openText.has(l.key) || l.printed_text ? "−" : "+"} Printed text</button>
                  <InfoTip label="Printed text">{ORDER_TIPS.printedText}</InfoTip>
                </span>
                {(openText.has(l.key) || l.printed_text !== "") && (
                  <Textarea data-guide="sales_order.line_printed" value={l.printed_text} onChange={(e) => patch(l.key, { printed_text: e.target.value })} aria-label={`Printed text for line ${i + 1}`} style={{ minHeight: 64, marginTop: 4 }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!priceLocked && (
        <div className={s.totals} aria-live="polite">
          <span>Subtotal {fmtMoney(totals.subtotal, currency)}</span>
          {totals.tax > 0 && <span>Tax {fmtMoney(totals.tax, currency)}</span>}
          <span className={s.totalsBig}>Total {fmtMoney(totals.total, currency)}</span>
        </div>
      )}
    </div>
  );
}
