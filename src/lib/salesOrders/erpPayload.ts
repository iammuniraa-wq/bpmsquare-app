import { money } from "@/lib/middleware/links";
import type { OutLine } from "@/lib/middleware/fence";
import type { OrderRow } from "./server";
import type { SalesOrderLine } from "./types";

// What the order says to an ERP in words and numbers, before any ERP's own field names come into it.

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Lines as the ERP writer reads them. Prices go as the NET unit price: discounts are folded in, as for a quote (netRate). */
export function outLines(lines: Pick<SalesOrderLine, "line_no" | "description" | "uom" | "qty" | "unit_price" | "discount_pct" | "line_total">[]): OutLine[] {
  return [...lines].sort((a, b) => a.line_no - b.line_no).map((l) => {
    const qty = Number(l.qty);
    const rate = Number(l.unit_price);
    const disc = Number(l.discount_pct);
    const net = Number.isFinite(Number(l.line_total)) && l.line_total !== null ? Number(l.line_total) : qty * rate * (1 - disc / 100);
    return { sl_no: String(l.line_no), description: l.description, uom: l.uom, qty, rate, discount_pct: disc, amount: round2(net) };
  });
}

/** The lines of text the ERP order's description carries: what the ERP cannot hold as a field, kept readable. */
export function orderNote(o: Pick<OrderRow, "customer_po" | "requested_date" | "notes" | "terms" | "tax_total" | "shipping_amount" | "total">, erpCompany: string | null = null): string[] {
  const out: string[] = [];
  // Dataverse does not let an integration set the owning business unit when it creates a row, so the company the value mapping chose
  // is recorded where the person opening the order reads it, not written to a field that would be refused.
  if (erpCompany) out.push(`ERP company: ${erpCompany}`);
  if (o.customer_po?.trim()) out.push(`Customer PO: ${o.customer_po.trim()}`);
  if (o.requested_date) out.push(`Requested delivery: ${o.requested_date}`);
  if (o.notes?.trim()) out.push(o.notes.trim().slice(0, 500));
  if (o.terms?.trim()) out.push(`Terms: ${o.terms.trim().slice(0, 500)}`);
  const bits: string[] = [];
  if (Number(o.tax_total) > 0) bits.push(`tax ${money(Number(o.tax_total))}`);
  if (Number(o.shipping_amount) > 0) bits.push(`shipping ${money(Number(o.shipping_amount))}`);
  out.push(`Total in BPMSquare: ${money(Number(o.total))}${bits.length ? ` (${bits.join(", ")})` : ""}`);
  return out;
}
