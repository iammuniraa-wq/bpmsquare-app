import type { ObjectSpec } from "./types";

// A tender's WBS items as a Data Workbench family (bpmsquarecore 3b-4; docs/design/wbs.md section 5): the work breakdown of a GCC tender, a
// child of the tender deal. Static spec like Tender BOQ lines (an item has no tenant-defined fields; a tender's custom fields sit on the
// tender itself).
//
// Import ADDS items to an existing tender (so an ERP's WBS can be pasted in). Items are found by their code, so loading the same file twice
// adds nothing the second time; a row without a code is always a new, auto-numbered item. Which BOQ lines sit in an item is the BOQ lines
// object's WBS code column, not this one. Update changes name, code, parent, owner and note by the item's own Record ID.
// The Export-only columns are the rolled-up figures, client amounts only (a WBS item carries no price of its own and no cost).
export const TENDER_WBS_ITEMS_SPEC: ObjectSpec = {
  id: "tender_wbs_items",
  label: "Tender WBS items",
  icon: "▤",
  description: "The WBS (work breakdown) of a tender: add items to an existing tender, or bulk-edit name, code, parent, owner and note on items already there. Which BOQ lines sit in an item is set with the WBS code on Tender BOQ lines.",
  dependsOn: ["opportunities"],
  fields: [
    { key: "tender_ref", label: "Tender", type: "ref", required: true, hint: "Deal ID (OPP-0044) or the tender number of an existing tender", aliases: ["tender", "tender no", "tender number", "deal", "deal id", "opportunity"] },
    { key: "code", label: "WBS code", type: "text", hint: "Your own code (1, 1.1, C-100). Empty = numbered automatically. Also what makes a second import of the same file add nothing", aliases: ["wbs", "wbs code", "code", "wbs no", "wbs number"] },
    { key: "name", label: "Name", type: "text", required: true, hint: "The item's name", aliases: ["wbs name", "item name", "title", "description"] },
    { key: "parent_code", label: "Parent code", type: "text", hint: "Code of the item it sits under. Empty = top level. Up to three levels", aliases: ["parent", "parent wbs", "parent code", "under"] },
    { key: "owner_email", label: "Owner (email)", type: "email", hint: "Email of the employee who runs this part. Optional while bidding", aliases: ["owner", "owner email", "responsible", "manager"] },
    { key: "note", label: "Note", type: "longtext", hint: "Optional note, up to 1000 characters", aliases: ["notes", "remarks", "comment"] },
    // Export-only: the roll-up of the item's lines and sub-items.
    { key: "lines", label: "Lines", type: "integer", exportOnly: true, hint: "BOQ lines in this item and its sub-items; a split line counts once for each share" },
    { key: "shared_lines", label: "Shared lines", type: "integer", exportOnly: true, hint: "Shares of split lines among them" },
    { key: "client_amount", label: "Client amount", type: "number", exportOnly: true, hint: "Rolled up from its lines and sub-items; a split line counts by its share" },
  ],
  sampleRows: [
    { tender_ref: "(Deal ID or tender number of an existing tender)", code: "1", name: "Civil works" },
    { tender_ref: "(Deal ID or tender number of an existing tender)", code: "1.1", name: "Earthworks", parent_code: "1" },
  ],
};

/** What an Update file may change on an item. The tender is the parent and is not moved by a file. */
export const TENDER_WBS_UPDATE_KEYS = ["name", "code", "parent_code", "owner_email", "note"] as const;
