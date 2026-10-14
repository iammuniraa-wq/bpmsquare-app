import "server-only";
import ExcelJS from "exceljs";
import type { SupplierView } from "./compose";
import type { ResponseInput } from "./rules";

// The Excel reply sheet attached to every RFQ email. One row per line, the
// line's id in a hidden first column so an upload matches rows by real id
// (bpmsquarecore §3), never by description. The supplier fills the yellow
// columns; anything else on the sheet is ignored on upload.

const COLS = [
  { key: "id", header: "Line ID (do not edit)", width: 4 },
  { key: "sl", header: "#", width: 5 },
  { key: "description", header: "Item", width: 42 },
  { key: "spec", header: "Specification", width: 30 },
  { key: "qty", header: "Qty", width: 9 },
  { key: "uom", header: "UOM", width: 8 },
  { key: "unit_price", header: "Unit price", width: 13 },
  { key: "currency", header: "Currency", width: 10 },
  { key: "lead_time_days", header: "Lead time (days)", width: 15 },
  { key: "moq", header: "Min. order qty", width: 14 },
  { key: "valid_until", header: "Valid until (YYYY-MM-DD)", width: 22 },
  { key: "no_quote", header: "Can't quote (Y)", width: 14 },
  { key: "note", header: "Note", width: 30 },
] as const;

const INPUT_KEYS = new Set(["unit_price", "currency", "lead_time_days", "moq", "valid_until", "no_quote", "note"]);

export async function buildReplySheet(v: SupplierView): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = v.tenantName;
  const ws = wb.addWorksheet(v.ref.slice(0, 31));
  ws.columns = COLS.map((c) => ({ key: c.key, width: c.width }));

  ws.addRow([`${v.tenantName} — request for quotation ${v.ref}: ${v.title}`]);
  ws.getRow(1).font = { bold: true, size: 12 };
  ws.addRow([v.respondBy ? `Please reply by ${v.respondBy}. Fill the yellow columns and send this file back.` : "Fill the yellow columns and send this file back."]);
  ws.addRow([]);
  const header = ws.addRow(COLS.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E8C" } }; });

  for (const l of v.lines) {
    const row = ws.addRow({
      id: l.id, sl: l.sl_no, description: l.description, spec: l.spec ?? "", qty: l.qty ?? "", uom: l.uom ?? "",
      unit_price: "", currency: "", lead_time_days: "", moq: "", valid_until: "", no_quote: "", note: "",
    });
    COLS.forEach((c, i) => {
      if (INPUT_KEYS.has(c.key)) {
        const cell = row.getCell(i + 1);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF5CC" } };
      }
    });
  }
  ws.getColumn(1).hidden = true;
  ws.views = [{ state: "frozen", ySplit: 4 }];
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.result !== undefined) return cellText(o.result as ExcelJS.CellValue);
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (typeof o.text === "string") return o.text;
    return "";
  }
  return String(v).trim();
}

/** Rows from a returned sheet, keyed by the hidden line id. Rows whose id
 *  isn't one of `validLineIds` are dropped -- the sheet is untrusted input
 *  and may have been edited or come from a different RFQ. */
export async function parseReplySheet(buffer: Buffer, validLineIds: Set<string>): Promise<ResponseInput[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  let headerRow = 0;
  ws.eachRow((row, n) => {
    if (!headerRow && cellText(row.getCell(1).value).toLowerCase().startsWith("line id")) headerRow = n;
  });
  if (!headerRow) return [];
  const out: ResponseInput[] = [];
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const get = (key: (typeof COLS)[number]["key"]) => cellText(row.getCell(COLS.findIndex((c) => c.key === key) + 1).value);
    const id = get("id");
    if (!validLineIds.has(id)) return;
    const noQuote = /^(y|yes|x|true|1)$/i.test(get("no_quote"));
    out.push({
      rfq_line_id: id,
      status: noQuote ? "no_quote" : undefined,
      unit_price: get("unit_price"),
      currency: get("currency"),
      lead_time_days: get("lead_time_days"),
      moq: get("moq"),
      valid_until: get("valid_until"),
      note: get("note"),
    });
  });
  return out;
}
