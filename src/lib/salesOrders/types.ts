// The Sales Order contract shared by the data layer and the screens (docs/design/sales-order.md, "Build spec SO1").
// Both sides code against this file; change it only together.

/** The spine the status engine understands; the label is the workspace's / the ERP's own word. */
export type OrderSpine = "open" | "in_progress" | "completed" | "cancelled";

/** SO1 statuses of an order made in BPMSquare. ERP-fed statuses (SO2) arrive as `status_label` with a spine. */
export const ORDER_STATUSES = ["draft", "confirmed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderOrigin = "bpmsquare" | "erp";
export type OrderSourceType = "standard_quote" | "quotation" | "opportunity" | "lead" | "email" | "order" | "direct" | "erp";
export type PricingMode = "internal" | "external";

export type OrderParty = { name: string; address?: string | null; contact?: string | null; phone?: string | null; email?: string | null; tax_id?: string | null };

export type SalesOrderType = {
  id: string;
  tenant_id: string;
  name: string;
  /** Numbering prefix: refs are `<prefix>-0001`, counted per workspace and prefix. */
  prefix: string;
  pricing_mode: PricingMode;
  /** Same block model as standard_quote_templates (blocks, accent_color, logo_position). */
  template: { blocks: unknown[]; accent_color?: string | null; logo_position?: "left" | "center" | "right" };
  /** First match wins: [{ field: "customer_group" | "region" | "source_type", equals: string }]. Empty = never auto-selected. */
  rules: { field: string; equals: string }[];
  is_default: boolean;
  active: boolean;
  sort_order: number;
};

export type SalesOrderLine = {
  id: string;
  order_id: string;
  line_no: number;
  product_id: string | null;
  description: string;
  /** Prints on the PDF under the line. */
  printed_text: string | null;
  qty: number;
  uom: string | null;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
  line_total: number;
  requested_date: string | null;
  /** Availability. `availability_source` says where the two confirmed values came from. */
  confirmed_qty: number | null;
  confirmed_date: string | null;
  availability_source: "erp" | "master" | null;
  availability_at: string | null;
};

export type SalesOrder = {
  id: string;
  tenant_id: string;
  ref: string;
  type_id: string | null;
  origin: OrderOrigin;
  status: OrderStatus;
  /** The ERP's own wording when the ERP owns the status (SO2); null otherwise. */
  status_label: string | null;
  spine: OrderSpine;
  /** Null only for an order read from the ERP whose customer has no Account here yet (see erp_customer_name). */
  account_id: string | null;
  /** The customer's name as the ERP gave it; set on ERP orders, null on orders made here. */
  erp_customer_name?: string | null;
  contact_id: string | null;
  /** Null = same as the sold-to account. */
  bill_to: OrderParty | null;
  ship_to: OrderParty | null;
  customer_po: string | null;
  source_type: OrderSourceType;
  source_id: string | null;
  opportunity_id: string | null;
  currency: string;
  pricing_mode: PricingMode;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  shipping_amount: number;
  total: number;
  requested_date: string | null;
  /** Latest confirmed date across the lines; derived, never typed. */
  expected_date: string | null;
  notes: string | null;
  terms: string | null;
  owner_user_id: string | null;
  confirmed_at: string | null;
  custom_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

/**
 * The one rule for "may this order still be edited": made here, still a draft, and not accepted by an ERP.
 * `erpLinked` is true when a connector_links row exists for the order. PATCH, the UI and the API all call this.
 */
export function orderEditable(o: Pick<SalesOrder, "origin" | "status">, erpLinked: boolean): boolean {
  return o.origin === "bpmsquare" && o.status === "draft" && !erpLinked;
}

/** Notes, attachments and links stay open on a confirmed order made here; nothing else does. */
export function orderAnnotatable(o: Pick<SalesOrder, "origin" | "status">): boolean {
  return o.origin === "bpmsquare" && o.status !== "cancelled";
}

/** A draft that was never sent to an ERP may be deleted; nothing else. */
export function orderDeletable(o: Pick<SalesOrder, "origin" | "status">, erpLinked: boolean): boolean {
  return orderEditable(o, erpLinked);
}

export type OrderAttachment = {
  id: string;
  order_id: string;
  kind: "customer_po" | "drawing" | "other";
  type: "file" | "link";
  name: string;
  /** Storage path for a file, URL for a link. */
  ref: string;
  size_bytes: number | null;
  created_by: string | null;
  created_at: string;
};

/** The path across the top of the page. */
export const ORDER_PATH = ["Draft", "Confirmed", "Delivered", "Invoiced", "Paid"] as const;
