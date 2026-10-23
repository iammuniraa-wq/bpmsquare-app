// Made-up, never saved data for the Order types preview, so an admin sees how a design prints without a real order.

import type { SalesOrder, SalesOrderLine } from "@/lib/salesOrders/types";

export function sampleOrder(prefix: string, currency: string): { order: SalesOrder; lines: SalesOrderLine[] } {
  const now = new Date().toISOString();
  const wanted = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const mk = (n: number, description: string, qty: number, unit: number, disc: number, printed: string | null): SalesOrderLine => ({
    id: `sample-${n}`, order_id: "sample", line_no: n, product_id: null, description, printed_text: printed, qty, uom: "Nos", unit_price: unit, discount_pct: disc, tax_pct: 5,
    line_total: qty * unit * (1 - disc / 100), requested_date: wanted, confirmed_qty: null, confirmed_date: null, availability_source: null, availability_at: null,
  });
  const lines = [mk(1, "Steel plate 10 mm", 20, 1250, 0, "Mill test certificate included with each delivery."), mk(2, "Anchor bolt set", 50, 38, 10, null)];
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const tax = subtotal * 0.05;
  const order: SalesOrder = {
    id: "sample", tenant_id: "", ref: `${prefix || "SO"}-0001`, type_id: null, origin: "bpmsquare", status: "draft", status_label: null, spine: "open", account_id: "sample", contact_id: null,
    bill_to: null, ship_to: { name: "Sample Customer, Jebel Ali yard", address: "Plot 14, Jebel Ali" }, customer_po: "PO-77123", source_type: "direct", source_id: null, opportunity_id: null,
    currency, pricing_mode: "internal", subtotal, discount_total: 0, tax_total: tax, shipping_amount: 0, total: subtotal + tax, requested_date: wanted, expected_date: null,
    notes: "Please confirm site access before delivery.", terms: "50% advance, balance on delivery.", owner_user_id: null, confirmed_at: null, custom_data: null, created_at: now, updated_at: now,
  };
  return { order, lines };
}
