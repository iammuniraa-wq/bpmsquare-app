import type { MapRowEdit, MapRowView, MapSide, MappingDocView } from "./api";

// The Mapping tab's pure parts. A row is one BPMSquare field and the ERP field it
// fills. The person only ever changes the ERP side; the screen keeps those changes
// as `edits` (section -> row id -> ERP field name, or null for "Not sent") until Save.

export type MapEdits = Record<string, Record<string, string | null>>;

/** A standard row built from several fields is shown, never edited. */
export const isReadOnlyRow = (r: Pick<MapRowView, "standard" | "composite">): boolean => r.standard && !!r.composite;

export const NOT_SENT = "";

/** What a row shows now: the edit if there is one, else what is stored. "" = Not sent. */
export function currentErp(section: string, row: MapRowView, edits: MapEdits): string {
  const e = edits[section];
  if (e && row.id in e) return e[row.id] ?? NOT_SENT;
  return row.erp?.name ?? NOT_SENT;
}

/** Record a choice; choosing what is already stored removes the edit, so the page is clean again. */
export function setEdit(edits: MapEdits, section: string, row: MapRowView, value: string): MapEdits {
  const stored = row.erp?.name ?? NOT_SENT;
  const sec = { ...(edits[section] ?? {}) };
  if (value === stored) delete sec[row.id];
  else sec[row.id] = value === NOT_SENT ? null : value;
  const next = { ...edits, [section]: sec };
  if (Object.keys(sec).length === 0) delete next[section];
  return next;
}

export const isMapDirty = (edits: MapEdits): boolean => Object.keys(edits).length > 0;

/** One save per changed section, carrying every editable row of it (so a section is saved whole). */
export function changedSections(view: MappingDocView, edits: MapEdits): { section: string; rows: MapRowEdit[] }[] {
  return view.sections
    .filter((s) => edits[s.key] && Object.keys(edits[s.key]).length > 0)
    .map((s) => ({
      section: s.key,
      rows: s.rows.filter((r) => !isReadOnlyRow(r)).map((r) => ({ id: r.id, erp: currentErp(s.key, r, edits) || null })),
    }));
}

/** The dropdown's choices: the ERP's fields, plus the current one when the ERP list does not carry it. */
export function erpOptions(fields: readonly MapSide[], current: MapSide | null): MapSide[] {
  if (!current || fields.some((f) => f.name === current.name)) return [...fields];
  return [current, ...fields];
}

/** The one bar the tab may show. Empty when nothing is missing. */
export function missingBar(missing: readonly string[]): string | null {
  if (missing.length === 0) return null;
  return `The ERP needs ${missing.join(", ")} and nothing fills ${missing.length === 1 ? "it" : "them"} yet. Pick a field below, or reset to standard.`;
}

/** The selector: the document and where it lands, then the inbound entities. */
export function documentChoices(system: string, quoteTarget: string | null): { key: string; label: string }[] {
  return [
    { key: "quote", label: quoteTarget ? `Quote → ${system} ${quoteTarget}` : "Quote" },
    { key: "customers", label: `Customers (from ${system})` },
    { key: "contacts", label: `Contacts (from ${system})` },
    { key: "products", label: `Products (from ${system})` },
    { key: "projects", label: `Projects (from ${system})` },
  ];
}

/** A connector that only reads (SAP S/4HANA) maps what comes in, and nothing else. */
export const inboundChoices = (system: string): { key: string; label: string }[] => [
  { key: "customers", label: `Customers (from ${system})` },
  { key: "vendors", label: `Suppliers (from ${system})` },
  { key: "products", label: `Products (from ${system})` },
];

export const INBOUND_DOCUMENTS = ["customers", "contacts", "vendors", "products", "projects"] as const;
export const isInboundDocument = (key: string): boolean => (INBOUND_DOCUMENTS as readonly string[]).includes(key);

/** The field map the sample-data preview reads: BPMSquare field name -> ERP column, for the rows that have one. */
export function sampleFieldMap(view: MappingDocView): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of view.sections) for (const r of s.rows) if (r.erp) out[r.bpm.name] = r.erp.name;
  return out;
}
