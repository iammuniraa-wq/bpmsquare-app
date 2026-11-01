// Every explanation on the Data Workbench screens, held to the InfoTip limit (two sentences, 160 characters) by
// tips.test.ts. The screens never print these as running text (bpmsquarecore 6b). Per-object notes live in the catalog
// (src/lib/import/catalog.ts) so a new object brings its own.

export const DW_TIPS = {
  page: "Bring records in from Excel or CSV, take them out, or correct many at once. Templates always match your field setup.",
  modeOff: "This object cannot be used in this mode.",
} as const;
