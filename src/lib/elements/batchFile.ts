// A model comparison arriving as an Excel or CSV file (docs/design/pcbs-buildings-elements.md section 2.5): the grid of a sheet becomes the rows of the
// connector's batch shape, so the same checks (parseBatch) judge a file and a connector post. Pure.

export type GridCell = string | number | null | undefined;

const norm = (v: GridCell) => String(v ?? "").trim().toLowerCase().replace(/[_\-.\/]+/g, " ").replace(/\s+/g, " ");
const text = (v: GridCell): string => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : v.trim());

const HEADERS: Record<string, string[]> = {
  building: ["building", "building code", "building no", "bldg", "bldg code", "area", "block", "building area"],
  building_name: ["building name", "area name", "block name"],
  element_type: ["element type", "type", "piece type", "element class", "element kind"],
  element_code: ["element code", "element id", "element no", "mark", "piece mark", "code"],
  qty: ["qty", "quantity", "model qty", "model quantity", "count"],
  unit: ["unit", "uom"],
  drawing_no: ["drawing no", "drawing number", "drawing", "dwg no", "dwg"],
  drawing_rev: ["drawing rev", "drawing revision", "revision", "rev"],
};

export type FileRows = { ok: true; rows: Record<string, unknown>[]; skipped: number } | { ok: false; error: string };

/**
 * The first row (of the first 15) that names a quantity and an element type or code is the header. A column called just "Building" or "Area" is
 * a code when the cell is 1 to 6 letters or digits and a name otherwise. Empty rows are skipped; a row without a quantity is left for parseBatch
 * to refuse (with its number).
 */
export function gridToBatchRows(grid: readonly (readonly GridCell[])[], maxRows = 5000): FileRows {
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const cells = (grid[r] ?? []).map(norm);
    const at = (key: string) => cells.findIndex((c) => HEADERS[key].includes(c));
    const qty = at("qty");
    const type = at("element_type");
    const code = at("element_code");
    if (qty < 0 || (type < 0 && code < 0)) continue;
    const cols = { building: at("building"), building_name: at("building_name"), type, code, qty, unit: at("unit"), dno: at("drawing_no"), drev: at("drawing_rev") };
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    for (let i = r + 1; i < grid.length; i++) {
      const line = grid[i] ?? [];
      const get = (c: number) => (c >= 0 ? text(line[c]) : "");
      if (![cols.building, cols.type, cols.code, cols.qty].some((c) => c >= 0 && get(c))) { skipped++; continue; }
      if (rows.length >= maxRows) return { ok: false, error: `A comparison holds up to ${maxRows} rows` };
      const b = get(cols.building);
      const isCode = /^[A-Za-z0-9]{1,6}$/.test(b);
      rows.push({
        building_code: b && isCode ? b : undefined,
        building_name: get(cols.building_name) || (b && !isCode ? b : undefined),
        element_type: get(cols.type) || undefined,
        element_code: get(cols.code) || undefined,
        qty: line[cols.qty] === undefined || line[cols.qty] === null ? "" : line[cols.qty],
        unit: get(cols.unit) || undefined,
        drawing_no: get(cols.dno) || undefined,
        drawing_rev: get(cols.drev) || undefined,
      });
    }
    return rows.length ? { ok: true, rows, skipped } : { ok: false, error: "The file has a header but no rows" };
  }
  return { ok: false, error: "Add a header row with Element type (or Element code) and Quantity columns" };
}
