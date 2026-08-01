import type { ObjectSpec } from "./types";

// Quote Lines as their own Data Workbench object -- separate from the
// combined header+line quotes file (which stays as the single-file path for
// CREATING a quote, since a new quote's lines can't reference a header id
// that doesn't exist yet). Once a quote exists, its lines behave like any
// other child record: import adds new lines to an existing quote (by ref),
// export lists every line with its owning quote, and update bulk-edits
// existing lines by their own Record ID -- the general pattern for any
// future parent/child object family (account team, involved parties, ...),
// not something special-cased to quotes.
//
// Same fixed-shape reasoning as QUOTE_LINE_FIELDS in registrySchema.ts:
// quote lines have never been tenant-customizable, so this is a static
// spec rather than routed through the field-config machinery.
export const QUOTE_LINES_SPEC: ObjectSpec = {
  id: "quote_lines",
  label: "Quote Lines",
  icon: "≣",
  description: "Individual line items on a quote — add lines to an existing quote, or bulk-edit qty/rate/description on lines already there",
  dependsOn: ["quotes"],
  fields: [
    { key: "quote_ref", label: "Quote", type: "ref", required: true, hint: "Quote ID the line belongs to, e.g. QT-2026-0042 — must already exist", aliases: ["quote", "quote id", "quote ref", "quotation"] },
    { key: "sl_no", label: "S.No", type: "text", hint: "Optional serial label shown on the printed quote, e.g. 1 · 1a · A", aliases: ["sl no", "sl.no", "s.no", "sno", "serial no", "serial"] },
    { key: "description", label: "Description", type: "text", required: true, hint: "Line item description", aliases: ["item", "particulars", "work description", "line item"] },
    { key: "uom", label: "UOM", type: "text", hint: "Nos · Job · Set · Mtr · Kg", aliases: ["unit", "units"] },
    { key: "qty", label: "Qty", type: "number", hint: "Quantity — defaults to 1", aliases: ["quantity", "nos"] },
    { key: "rate", label: "Rate", type: "number", hint: "Rate in INR", aliases: ["price", "unit price", "unit rate"] },
    { key: "discount_pct", label: "Discount %", type: "number", hint: "Line discount 0-100", aliases: ["item discount"] },
    // Export-only: computed, or set through the quote form's structured UI
    // rather than free CSV text — same restriction QUOTE_LINE_FIELDS already
    // applies to the combined quotes file.
    { key: "amount", label: "Amount", type: "number", exportOnly: true, hint: "Computed qty × rate − discount" },
    { key: "category", label: "Category", type: "text", exportOnly: true, hint: "labour · material · testing · transport" },
    { key: "deduction", label: "Deduction", type: "number", exportOnly: true, hint: "Material deduction amount" },
    { key: "group", label: "Group", type: "text", exportOnly: true, hint: "Group / option label this line belongs to" },
  ],
  sampleRows: [
    { quote_ref: "(ref of an existing quote)", description: "Example description", uom: "Nos", qty: "1", rate: "1000", discount_pct: "0" },
    { quote_ref: "(ref of an existing quote)", description: "Example description 2", uom: "Job", qty: "2", rate: "500", discount_pct: "5" },
  ],
};
