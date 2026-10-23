import type { ObjectSpec } from "./types";

// Standard Quote Lines as their own Data Workbench family (bpmsquarecore 3b-4), the child of the
// Standard Quotes header object -- the same split Quotes / Quote Lines already make, and for the
// same reason: a new quote's lines cannot name a header that does not exist yet, so the header
// file creates quotes and this one adds to quotes that exist. Once a line exists its own Record ID
// is the contract (section 3); the quote's ID is only how a NEW line finds its parent.
//
// Static spec rather than field-config: lines have never been tenant-customizable.
//
// What a file can and cannot do to a line is narrower than the quote form on purpose. Groups,
// quantity breaks and engine prices carry the pricing rules (which line counts toward the total,
// the margin floor), so those are export-only here; money fields of a line the pricing engine
// priced are changed on the quote, where the guardrails run again (see update/standard_quote_lines).
export const STANDARD_QUOTE_LINES_SPEC: ObjectSpec = {
  id: "standard_quote_lines",
  label: "Standard Quote Lines",
  icon: "≣",
  description: "Line items on a standard quote: add lines to a draft quote, or bulk-edit text, quantity, rate and discount on lines of draft quotes",
  dependsOn: ["standard_quotes"],
  fields: [
    { key: "standard_quote_ref", label: "Quote", type: "ref", required: true, hint: "Quote ID of a draft standard quote, e.g. SQ-2026-0042 — must already exist", aliases: ["quote", "quote id", "quote ref", "standard quote", "sq"] },
    { key: "sl_no", label: "S.No", type: "text", hint: "Optional serial label shown on the printed quote, e.g. 1 · 1a · A. Left blank on import, the next number is used", aliases: ["sl no", "sl.no", "s.no", "sno", "serial no", "serial"] },
    { key: "description", label: "Description", type: "text", required: true, hint: "Line item description", aliases: ["item", "particulars", "line item"] },
    { key: "uom", label: "UOM", type: "text", hint: "Nos · Job · Set · Mtr · Kg", aliases: ["unit", "units"] },
    { key: "qty", label: "Qty", type: "number", hint: "Quantity — defaults to 1", aliases: ["quantity", "nos"] },
    { key: "rate", label: "Rate", type: "number", hint: "Rate per unit", aliases: ["price", "unit price", "unit rate"] },
    { key: "discount_pct", label: "Discount %", type: "number", hint: "Line discount 0-100", aliases: ["item discount"] },
    // Export-only: computed, or set through the quote form's structured UI.
    { key: "amount", label: "Amount", type: "number", exportOnly: true, hint: "Computed qty × rate − discount" },
    { key: "group", label: "Option / group", type: "text", exportOnly: true, hint: "Alternative option label this line belongs to" },
    { key: "selected", label: "Counts toward total", type: "boolean", exportOnly: true, hint: "false for an option that was not chosen" },
  ],
  sampleRows: [
    { standard_quote_ref: "(Quote ID of an existing draft quote)", description: "Example description", uom: "Nos", qty: "1", rate: "1000", discount_pct: "0" },
    { standard_quote_ref: "(Quote ID of an existing draft quote)", description: "Example description 2", uom: "Job", qty: "2", rate: "500", discount_pct: "5" },
  ],
};

/** The columns of a standard_quote_lines row a file may write, in Import and Update. */
export const STANDARD_QUOTE_LINE_TEXT_KEYS = ["sl_no", "description", "uom"] as const;
/** Money fields: recomputed into `amount`, and refused on a line the pricing engine priced. */
export const STANDARD_QUOTE_LINE_MONEY_KEYS = ["qty", "rate", "discount_pct"] as const;
