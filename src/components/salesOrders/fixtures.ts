// Fixtures for the Sales Order screen tests: one confirmed order made here from a quote, with a short line and a late line.

import type { SalesOrder, SalesOrderLine, SalesOrderType } from "@/lib/salesOrders/types";
import type { Attachment, ErpDocument, OrderDetail } from "@/lib/salesOrders/client";

export const order = (over: Partial<SalesOrder> = {}): SalesOrder => ({
  id: "o1", tenant_id: "t1", ref: "SO-0001", type_id: "ty1", origin: "bpmsquare", status: "draft", status_label: null, spine: "open",
  account_id: "a1", contact_id: "c1", bill_to: null, ship_to: { name: "Gulf Steel, Jebel Ali yard", address: "Plot 14, Jebel Ali" },
  customer_po: "PO-77123", source_type: "standard_quote", source_id: "sq1", opportunity_id: null, currency: "AED", pricing_mode: "internal",
  subtotal: 10000, discount_total: 0, tax_total: 500, shipping_amount: 0, total: 10500, requested_date: "2026-11-10", expected_date: null,
  notes: null, terms: null, owner_user_id: null, confirmed_at: null, custom_data: null, created_at: "2026-10-20T08:00:00Z", updated_at: "2026-10-20T08:00:00Z",
  ...over,
});

export const line = (over: Partial<SalesOrderLine> = {}): SalesOrderLine => ({
  id: "l1", order_id: "o1", line_no: 1, product_id: "p1", description: "Steel plate 10 mm", printed_text: null, qty: 10, uom: "Nos", unit_price: 1000,
  discount_pct: 0, tax_pct: 5, line_total: 10000, requested_date: "2026-11-10", confirmed_qty: null, confirmed_date: null, availability_source: null, availability_at: null,
  ...over,
});

export const type = (over: Partial<SalesOrderType> = {}): SalesOrderType => ({
  id: "ty1", tenant_id: "t1", name: "Standard order", prefix: "SO", pricing_mode: "internal",
  template: { blocks: [], accent_color: null, logo_position: "left" }, rules: [], is_default: true, active: true, sort_order: 0, ...over,
});

export const delivery = (over: Partial<ErpDocument> = {}): ErpDocument => ({ id: "d1", kind: "delivery", number: "DL-9001", date: "2026-11-08", amount: null, status: "Delivered", delivered: true, ...over });
export const invoice = (over: Partial<ErpDocument> = {}): ErpDocument => ({ id: "i1", kind: "invoice", number: "INV-5001", date: "2026-11-09", amount: 5250, status: "Open", delivery_id: "d1", ...over });

export const attachment = (over: Partial<Attachment> = {}): Attachment => ({
  id: "f1", order_id: "o1", kind: "customer_po", type: "file", name: "po-77123.pdf", ref: "t1/o1/po.pdf", size_bytes: 51200,
  created_by: "u1", created_at: "2026-10-21T09:00:00Z", created_by_name: "Asha", href: null, ...over,
});

export const detail = (over: Partial<OrderDetail> = {}): OrderDetail => ({
  order: order(), lines: [line()], type: type(), account: { id: "a1", name: "Gulf Steel LLC", phone: "+971500000000", email: "buy@gulfsteel.example" },
  contact: { id: "c1", name: "Omar Haddad", phone: "+971500000001" }, source: { type: "standard_quote", id: "sq1", ref: "SQ-2026-0012" },
  erpLinked: false, erpAvailable: false, erpDocuments: [], erpLink: null, customerNote: null, erpSendBlocker: null, erpChecks: [], erpTransfers: [], erpChecksPending: false, permissions: null, lockReason: null, pricingLabel: null, ...over,
});

export const ROUTES_STUB = {
  standardQuote: (id: string) => `/standard-quotes/${id}`, quotation: (id: string) => `/quotations/${id}`,
  deal: (id: string) => `/pipeline/${id}`, order: (id: string) => `/sales-orders/${id}`,
};
