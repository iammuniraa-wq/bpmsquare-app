import type { ObjectSpec } from "./types";

// Sales Order Lines as their own Data Workbench family (bpmsquarecore 3b-4), the child of the Sales Orders header
// object -- the same split Standard Quotes / Standard Quote Lines make, for the same reason: a new order's lines cannot
// name a header that does not exist yet, so the header file creates orders and this one adds to orders that exist. Once a
// line exists its own Record ID is the contract (section 3); the order's ID is only how a NEW line finds its parent.
//
// Static spec rather than field-config: lines have never been tenant-customizable. What a file can do to a line follows
// the same edit rule as the screen (orderEditable): lines of a draft order made here, not yet accepted by an ERP.
// Availability (confirmed quantity and date) is computed from master data or comes from the ERP, so it is export-only.
export const SALES_ORDER_LINES_SPEC: ObjectSpec = {
  id: "sales_order_lines",
  label: "Sales Order Lines",
  icon: "≣",
  description: "Line items on a sales order: add lines to a draft order, or bulk-edit text, quantity, price, discount and tax on lines of draft orders",
  dependsOn: ["sales_orders"],
  fields: [
    { key: "sales_order_ref", label: "Order", type: "ref", required: true, hint: "Order ID of a draft sales order, e.g. SO-0042 — must already exist", aliases: ["order", "order id", "order ref", "sales order", "so"] },
    { key: "description", label: "Description", type: "text", required: true, hint: "Line item description", aliases: ["item", "particulars", "line item"] },
    { key: "printed_text", label: "Printed text", type: "longtext", hint: "Extra text that prints under the line on the PDF", aliases: ["print text", "line text", "specification"] },
    { key: "uom", label: "UOM", type: "text", hint: "Nos · Job · Set · Mtr · Kg", aliases: ["unit", "units"] },
    { key: "qty", label: "Qty", type: "number", hint: "Quantity — defaults to 1", aliases: ["quantity", "nos"] },
    { key: "unit_price", label: "Unit price", type: "number", hint: "Price per unit before discount and tax", aliases: ["rate", "price", "unit rate"] },
    { key: "discount_pct", label: "Discount %", type: "number", hint: "Line discount 0-100", aliases: ["item discount"] },
    { key: "tax_pct", label: "Tax %", type: "number", hint: "Tax on this line 0-100", aliases: ["vat", "vat %", "gst", "gst %"] },
    { key: "requested_date", label: "Wanted by", type: "date", hint: "Date the customer wants this line, YYYY-MM-DD", aliases: ["requested date", "delivery date", "need by"] },
    // Export-only: computed, or answered by master data / the ERP.
    { key: "line_no", label: "Line", type: "integer", exportOnly: true, hint: "Position on the order" },
    { key: "line_total", label: "Line total", type: "number", exportOnly: true, hint: "Computed qty × price − discount, before tax" },
    { key: "confirmed_qty", label: "Confirmed qty", type: "number", exportOnly: true, hint: "Quantity that can be delivered, from master data or the ERP" },
    { key: "confirmed_date", label: "Confirmed date", type: "date", exportOnly: true, hint: "Date it can be delivered" },
    { key: "availability_source", label: "Availability from", type: "text", exportOnly: true, hint: "erp or master" },
  ],
  sampleRows: [
    { sales_order_ref: "(Order ID of an existing draft order)", description: "Example description", uom: "Nos", qty: "1", unit_price: "1000", discount_pct: "0", tax_pct: "5" },
    { sales_order_ref: "(Order ID of an existing draft order)", description: "Example description 2", printed_text: "Printed under the line", uom: "Job", qty: "2", unit_price: "500", discount_pct: "5", tax_pct: "5" },
  ],
};

export const SALES_ORDER_LINE_TEXT_KEYS = ["description", "printed_text", "uom"] as const;
/** Money and percentage fields: recomputed into line_total and the order's totals. */
export const SALES_ORDER_LINE_NUMBER_KEYS = ["qty", "unit_price", "discount_pct", "tax_pct"] as const;
