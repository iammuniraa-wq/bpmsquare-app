import type { MasterFlags, MasterKind } from "./types";

// Reading a code list from a file (Settings > Contract projects), pure: a CSV or Excel sheet with code, name and optionally a parent
// becomes rows to store, plus a plain list of what was refused or looked doubtful. The file is the interim source until the lists are
// pulled from ePROMIS (slice 5b); the same table receives both.

export type Cell = string | number | null | undefined;
export type MasterImportRow = { code: string; name: string; parent_code: string | null; flags: MasterFlags; row: number };
export type ImportNote = { row: number; message: string };
export type ParsedMasters = { rows: MasterImportRow[]; problems: ImportNote[]; warnings: ImportNote[] };

export const MASTER_IMPORT_LIMITS = { maxRows: 20_000, maxBytes: 5 * 1024 * 1024, codeLength: 40, nameLength: 200 } as const;

const norm = (v: Cell) => String(v ?? "").trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
const cellText = (v: Cell): string => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : v.trim());

const CODE_HEADERS = ["code", "cost code", "resource code", "resource", "id", "number", "no", "reason code"];
const NAME_HEADERS = ["name", "description", "title", "resource name", "cost code name", "reason", "text"];
const PARENT_HEADERS = ["parent", "parent code", "related head", "group", "division", "parent id"];
const FLAG_HEADERS: Record<keyof MasterFlags, string[]> = {
  link_to_inventory: ["link to inventory", "inventory"],
  budget_validation: ["budget validation", "validate budget"],
  revenue_side: ["revenue", "revenue side", "income"],
};

const truthy = (v: Cell) => ["yes", "y", "true", "1", "x"].includes(norm(v));

type Columns = { code: number; name: number; parent: number; flags: Partial<Record<keyof MasterFlags, number>> };

function findHeader(grid: readonly (readonly Cell[])[]): { row: number; cols: Columns } | null {
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const cells = (grid[r] ?? []).map(norm);
    const code = cells.findIndex((c) => CODE_HEADERS.includes(c));
    if (code < 0) continue;
    const name = cells.findIndex((c, i) => i !== code && NAME_HEADERS.includes(c));
    if (name < 0) continue;
    const parent = cells.findIndex((c, i) => i !== code && i !== name && PARENT_HEADERS.includes(c));
    const flags: Columns["flags"] = {};
    for (const key of Object.keys(FLAG_HEADERS) as (keyof MasterFlags)[]) {
      const at = cells.findIndex((c) => FLAG_HEADERS[key].includes(c));
      if (at >= 0) flags[key] = at;
    }
    return { row: r, cols: { code, name, parent, flags } };
  }
  return null;
}

/**
 * grid[r][c], 0-based, row 0 the first row of the sheet. `existing` holds the codes the workspace already has for this kind, so a
 * parent that is not in the file but is already stored still counts as known. Row numbers in notes are the sheet's own (1-based).
 */
export function parseMasterGrid(grid: readonly (readonly Cell[])[], kind: MasterKind, existing: ReadonlySet<string> = new Set()): ParsedMasters {
  const problems: ImportNote[] = [];
  const warnings: ImportNote[] = [];
  const header = findHeader(grid);
  if (!header) {
    return { rows: [], problems: [{ row: 1, message: "Add a header row with a Code column and a Name column" }], warnings };
  }
  const { cols } = header;
  const rows: MasterImportRow[] = [];
  const firstSeen = new Map<string, number>();

  for (let r = header.row + 1; r < grid.length; r++) {
    const line = grid[r] ?? [];
    const sheetRow = r + 1;
    const code = cellText(line[cols.code]);
    const name = cellText(line[cols.name]);
    const parent = cols.parent >= 0 ? cellText(line[cols.parent]) : "";
    if (!code && !name && !parent) continue;
    if (rows.length + problems.length >= MASTER_IMPORT_LIMITS.maxRows) {
      problems.push({ row: sheetRow, message: `Stopped here: a file holds up to ${MASTER_IMPORT_LIMITS.maxRows} rows` });
      break;
    }
    if (!code) { problems.push({ row: sheetRow, message: "No code" }); continue; }
    if (code.length > MASTER_IMPORT_LIMITS.codeLength) { problems.push({ row: sheetRow, message: `Code ${code.slice(0, 12)}... is longer than ${MASTER_IMPORT_LIMITS.codeLength} characters` }); continue; }
    if (!name) { problems.push({ row: sheetRow, message: `Code ${code} has no name` }); continue; }
    if (name.length > MASTER_IMPORT_LIMITS.nameLength) { problems.push({ row: sheetRow, message: `Name of ${code} is longer than ${MASTER_IMPORT_LIMITS.nameLength} characters` }); continue; }
    const dup = firstSeen.get(code.toLowerCase());
    if (dup !== undefined) { problems.push({ row: sheetRow, message: `Code ${code} is already on row ${dup}; the first one is kept` }); continue; }
    if (parent && parent.toLowerCase() === code.toLowerCase()) { problems.push({ row: sheetRow, message: `Code ${code} cannot be its own parent` }); continue; }
    firstSeen.set(code.toLowerCase(), sheetRow);

    const flags: MasterFlags = {};
    if (kind === "resource") {
      for (const key of Object.keys(cols.flags) as (keyof MasterFlags)[]) {
        const at = cols.flags[key];
        if (at !== undefined && truthy(line[at])) flags[key] = true;
      }
    }
    rows.push({ code, name, parent_code: parent ? parent.slice(0, MASTER_IMPORT_LIMITS.codeLength) : null, flags, row: sheetRow });
  }

  // Parents: known if they are in this file or already stored; an unknown parent is dropped with a note rather than refusing a row
  // (a typo in one parent code must not take its children down with it). A loop (A under B under A) is refused.
  const parentOf = new Map(rows.map((x) => [x.code.toLowerCase(), x.parent_code?.toLowerCase() ?? null]));
  const looped = new Set<string>();
  for (const x of rows) {
    let at = x.parent_code?.toLowerCase() ?? null;
    for (let step = 0; at && step <= rows.length; step++) {
      if (at === x.code.toLowerCase()) { looped.add(x.code.toLowerCase()); break; }
      at = parentOf.get(at) ?? null;
    }
  }
  const known = new Set([...rows.filter((x) => !looped.has(x.code.toLowerCase())).map((x) => x.code.toLowerCase()), ...[...existing].map((x) => x.toLowerCase())]);
  const kept: MasterImportRow[] = [];
  for (const x of rows) {
    if (looped.has(x.code.toLowerCase())) { problems.push({ row: x.row, message: `Code ${x.code} is its own ancestor (its parents loop back to it)` }); continue; }
    if (x.parent_code && !known.has(x.parent_code.toLowerCase())) {
      warnings.push({ row: x.row, message: `Parent ${x.parent_code} of ${x.code} is not in the file or your list; stored without a parent` });
      kept.push({ ...x, parent_code: null });
    } else kept.push(x);
  }
  problems.sort((a, b) => a.row - b.row);
  warnings.sort((a, b) => a.row - b.row);
  return { rows: kept, problems, warnings };
}
