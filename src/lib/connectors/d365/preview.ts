// Preview table rules for the Dynamics 365 connector -- pure, client-safe.
//
// A preview returns five raw rows exactly as Dynamics sends them: dozens of
// columns, most of them empty or Microsoft plumbing. The screen shows what the
// field map fills first (titled with the BPMSquare field it fills), and keeps
// the raw columns behind "Show all fields" with the empty and internal ones
// left out.

type Row = Record<string, unknown>;

/** Column names that are plumbing, not business data. */
const INTERNAL_PREFIX = ["_", "@", "timezone", "utcconversion", "importsequence", "entityimage"];
const INTERNAL_EXACT = new Set(["versionnumber", "overriddencreatedon", "exchangerate", "processid", "stageid", "traversedpath"]);

export function isInternalColumn(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes("@odata") || n.endsWith("_base")) return true;
  return INTERNAL_EXACT.has(n) || INTERNAL_PREFIX.some((p) => n.startsWith(p));
}

export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

export function cellText(v: unknown): string {
  if (isEmptyValue(v)) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export type MappedColumn = { target: string; source: string; found: boolean };

export type PreviewColumns = {
  /** What the field map fills: the BPMSquare field and the Dynamics column it reads. */
  mapped: MappedColumn[];
  /** Raw columns worth showing under "Show all fields". */
  raw: string[];
  /** Raw columns left out because they are empty in every sample row or internal. */
  hidden: number;
};

export function previewColumns(rows: Row[], fieldMap: Record<string, string>): PreviewColumns {
  const present = new Set(rows.flatMap((r) => Object.keys(r)));
  const mapped: MappedColumn[] = Object.entries(fieldMap)
    .filter(([target, source]) => target && source)
    .map(([target, source]) => ({ target, source, found: present.has(source) }));
  const mappedSources = new Set(mapped.map((m) => m.source));
  const raw: string[] = [];
  let hidden = 0;
  for (const name of present) {
    if (mappedSources.has(name)) continue;
    if (isInternalColumn(name) || rows.every((r) => isEmptyValue(r[name]))) { hidden += 1; continue; }
    raw.push(name);
  }
  return { mapped, raw, hidden };
}
