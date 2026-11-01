import { EXACT } from "@/lib/tender/boq/parse";
import type { ObjectSpec } from "./types";

// Tender BOQ lines as a Data Workbench family (bpmsquarecore 3b-4): the lines of a GCC tender's Bill of quantities, a child of the
// tender deal. Static spec like Sales Order Lines: lines have no tenant-defined fields (the table has no custom_data; a tender's
// custom fields sit on the tender itself), so there is no spec builder for the three modes to share.
//
// The header aliases are the upload's own (parse.ts EXACT), so a column the BOQ upload recognises is recognised here too.
// Cost and markup are on no column of any mode: a Data Workbench export is an Excel that gets attached and forwarded like the priced
// workbook, so it follows the same rule (boqWiring.test.ts). The rate is export-only for Update on purpose: a rate needs a source, and
// the Bill of quantities screen is the one place that sets it.
export const TENDER_BOQ_LINES_SPEC: ObjectSpec = {
  id: "tender_boq_lines",
  label: "Tender BOQ lines",
  icon: "≣",
  description: "Lines of a tender's Bill of quantities: add or revise lines of an existing tender by item number, or bulk-edit quantity, description and cost code on lines already there. Cost and markup are never in a file. Import only adds lines and updates the ones it matches by item number; it never removes a line, whatever the file leaves out.",
  dependsOn: ["opportunities"],
  fields: [
    { key: "tender_ref", label: "Tender", type: "ref", required: true, hint: "Deal ID (OPP-0044) or the tender number of an existing tender", aliases: ["tender", "tender no", "tender number", "deal", "deal id", "opportunity"] },
    { key: "item_no", label: "Item no.", type: "text", hint: "The client's item number; a revised file matches lines by it", aliases: EXACT.item_no },
    { key: "description", label: "Description", type: "text", required: true, hint: "Line description", aliases: EXACT.description },
    { key: "unit", label: "Unit", type: "text", hint: "Nos · m · m² · m³ · kg · LS", aliases: EXACT.uom },
    { key: "quantity", label: "Quantity", type: "number", required: true, hint: "Quantity in the client's file", aliases: EXACT.qty },
    { key: "cost_code", label: "Cost code", type: "text", hint: "CSI / WBS / cost code", aliases: EXACT.cost_code },
    { key: "rate", label: "Unit rate", type: "number", hint: "Only on Import: the client's own rate in the file. Our rate is set on the Bill of quantities", aliases: EXACT.rate },
    // Export-only: computed, or answered by the pricing on the Bill of quantities.
    { key: "amount", label: "Amount", type: "number", exportOnly: true, hint: "Computed quantity × rate" },
    { key: "rate_source", label: "Rate source", type: "text", exportOnly: true, hint: "boq_rate · bom · past_project · supplier · manual · estimate" },
    { key: "price_as_of", label: "Priced on", type: "date", exportOnly: true, hint: "Date of the price the rate came from" },
    { key: "status", label: "Status", type: "text", exportOnly: true, hint: "priced · unpriced · stale · removed" },
    { key: "row_no", label: "File row", type: "integer", exportOnly: true, hint: "Row in the client's workbook" },
  ],
  sampleRows: [
    { tender_ref: "(Deal ID or tender number of an existing tender)", item_no: "1.1", description: "Example description", unit: "m³", quantity: "120", cost_code: "03 30 00" },
    { tender_ref: "(Deal ID or tender number of an existing tender)", item_no: "1.2", description: "Example description 2", unit: "Nos", quantity: "4", rate: "250" },
  ],
};

/** What an Update file may change on a line. The rate is deliberately not here (see above). */
export const TENDER_BOQ_UPDATE_KEYS = ["quantity", "description", "cost_code"] as const;
