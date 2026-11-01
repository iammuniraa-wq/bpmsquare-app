// Every explanation on the Data Workbench screens, held to the InfoTip limit (two sentences, 160 characters) by
// tips.test.ts. The screens never print these as running text (bpmsquarecore 6b). Per-object notes live in the catalog
// (src/lib/import/catalog.ts) so a new object brings its own.

export const DW_TIPS = {
  page: "Bring records in from Excel or CSV, take them out, or correct many at once. Templates always match your field setup.",
  modeOff: "This object cannot be used in this mode.",
  required: "Everything else is optional. A field you do not map is left empty.",
  requiredUpdate: "Everything else stays as it is unless you map it.",
  needsExport: "Update matches rows by Record ID. Export the records first, change the values, then upload that file.",
  ownColumns: "Your own column names are fine. You match them to fields in the next step.",
  template: "The template has example rows and every column this import understands. Replace the examples with your data.",
  extract: "AI reads the records from a PDF, Word, Excel or CSV document. You review the rows before anything is imported.",
  map: "Pick the field each column fills. Columns set to don't import are left alone, so extra columns are fine.",
  reviewImport: "Rows with problems are left out. Everything else is imported.",
  reviewUpdate: "Rows with problems are left out. Everything else updates the matching record.",
  extractReview: "Fix anything wrong before continuing. Nothing is imported yet.",
  exportColumns: "Record ID is always included. It is what lets you re-upload this file under Update.",
  exportFilters: "Only rows matching every filter are exported. Leave empty to export everything.",
} as const;

/** "Needs Accounts first": the dependency chip's explanation, with the object's own name. */
export function needsFirstTip(label: string, count: number): string {
  return `${label} links to ${count === 1 ? "that object" : "those objects"} by name, so ${count === 1 ? "it" : "they"} must already be in the workspace.`;
}
