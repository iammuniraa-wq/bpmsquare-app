import type { ObjectSpec } from "./types";

// Buildings and elements of a CONTRACT PROJECT as two Data Workbench objects (docs/design/pcbs-buildings-elements.md section 2.7; bpmsquarecore 3b-4).
// Static specs, like the tender ones: a project's lines and WBS items have no tenant-defined fields.
//
//   project_budget_lines  Export and Update only. A budget line is BORN from the tender, a quote or a revision, so Import is deliberately off. Export
//                         reads the open draft revision, else the approved one, with the real `id` (the Update key). Update changes only the element
//                         fields and the building, by `id`, and only on a DRAFT revision ("Start a revision first" otherwise). Cost, unit cost, amount
//                         and margin are on no column of any mode: nothing here is internal.
//   project_wbs_items     Export, Update and Import. The buildings and activities of a project. Import adds items (found by code, so loading a file twice
//                         adds nothing); a parent is named by its code. Update by `id` changes name, code, parent, building code and note.

export const PROJECT_BUDGET_LINES_SPEC: ObjectSpec = {
  id: "project_budget_lines",
  label: "Project budget lines",
  icon: "▤",
  description: "The element fields of a contract project's budget lines: type, code, model quantity and building. Export with real IDs, edit, and load it back with Update. Lines are made by the tender, a quote or a revision, never by a file.",
  dependsOn: [],
  fields: [
    { key: "project_ref", label: "Project", type: "ref", exportOnly: true, hint: "The project's reference (CPR-0001)" },
    { key: "revision", label: "Revision", type: "integer", exportOnly: true, hint: "The revision the line is read from: the open draft, else the approved one" },
    { key: "line_key", label: "Line key", type: "text", exportOnly: true, hint: "The line's stable key: the same line in every revision" },
    { key: "line_no", label: "Line no.", type: "integer", exportOnly: true, hint: "Position in the budget" },
    { key: "item_no", label: "Item no.", type: "text", exportOnly: true, hint: "The client's item number" },
    { key: "description", label: "Description", type: "text", exportOnly: true, hint: "The line's description" },
    { key: "unit", label: "Unit", type: "text", exportOnly: true, hint: "Unit of the quantities" },
    { key: "building_code", label: "Building", type: "text", hint: "Code of a building of this project. Update puts the line in it (the building must have no activities, or the line stays where it is)", aliases: ["building", "building code", "bldg"] },
    { key: "element_type", label: "Element type", type: "text", hint: "A code from your Element types list", aliases: ["element type", "piece type"] },
    { key: "element_code", label: "Element code", type: "text", hint: "One unique code for this line on the project", aliases: ["element code", "element id", "mark"] },
    { key: "client_qty", label: "Client quantity", type: "number", exportOnly: true, hint: "The contracted quantity, frozen when the project was made" },
    { key: "model_qty", label: "Model quantity", type: "number", hint: "What the model or the drawings say", aliases: ["model qty", "model quantity"] },
    { key: "quantity", label: "Budget quantity", type: "number", exportOnly: true, hint: "The quantity the budget carries" },
    { key: "budget_uses", label: "Budget uses", type: "text", exportOnly: true, hint: "Client or Model" },
  ],
  sampleRows: [],
};

/** What an Update file may change on a project budget line. Everything else is read-only. */
export const PROJECT_BUDGET_UPDATE_KEYS = ["element_type", "element_code", "model_qty", "building_code"] as const;

export const PROJECT_WBS_ITEMS_SPEC: ObjectSpec = {
  id: "project_wbs_items",
  label: "Project WBS items",
  icon: "▤",
  description: "The buildings and activities of a contract project: add items to an existing project, or bulk-edit name, code, parent, building code and note on items already there.",
  dependsOn: [],
  fields: [
    { key: "project_ref", label: "Project", type: "ref", required: true, hint: "The project's reference (CPR-0001)", aliases: ["project", "project ref", "project reference", "project id"] },
    { key: "code", label: "WBS code", type: "text", hint: "Your own code (1, 1.1, C-100). Empty = numbered automatically. Also what makes a second import of the same file add nothing", aliases: ["wbs", "wbs code", "code", "wbs no"] },
    { key: "name", label: "Name", type: "text", required: true, hint: "The item's name", aliases: ["wbs name", "item name", "title", "description"] },
    { key: "parent_code", label: "Parent code", type: "text", hint: "Code of the item it sits under. Empty = top level. Up to three levels", aliases: ["parent", "parent wbs", "parent code", "under"] },
    { key: "building_code", label: "Building code", type: "text", hint: "1 to 6 letters or digits (B01). Only on a top-level item; makes it a building. Empty = an ordinary item", aliases: ["building", "building code", "bldg", "bldg code"] },
    { key: "note", label: "Note", type: "longtext", hint: "Optional note, up to 1000 characters", aliases: ["notes", "remarks", "comment"] },
    { key: "lines", label: "Lines", type: "integer", exportOnly: true, hint: "Budget lines held by this item" },
  ],
  sampleRows: [
    { project_ref: "(Reference of an existing project)", code: "1", name: "Building 1", building_code: "B01" },
    { project_ref: "(Reference of an existing project)", code: "1.1", name: "Foundations", parent_code: "1" },
  ],
};

export const PROJECT_WBS_UPDATE_KEYS = ["name", "code", "parent_code", "building_code", "note"] as const;
