import ExcelJS from "exceljs";

// The daily register of approved site expenses for Finance: one row per expense, the document reference that must travel into the ERP journal
// line (our SEX-#### reference) first. Day 1 of the first client is Excel; a live push to the ERP is a later piece (the interface stays these
// stored fields and the "sent" mark). Nothing here posts anything: Finance reads the file and posts in the ERP.

export type RegisterRow = {
  ref: string;
  project_ref: string | null;
  project_name: string;
  expense_date: string;
  category: string;
  erp_category: string | null;
  resource_code: string | null;
  cost_code: string | null;
  wbs_code: string | null;
  cost_line: string | null;
  vendor: string | null;
  invoice_ref: string | null;
  currency: string;
  amount: number;
  amount_project_ccy: number | null;
  vat_amount: number | null;
  paid_by: string;
  document_state: string;
  submitted_by: string;
  approved_by: string;
  approved_at: string | null;
  note: string | null;
};

export const REGISTER_COLUMNS: { key: keyof RegisterRow; header: string; width: number; numFmt?: string }[] = [
  { key: "ref", header: "Document reference", width: 18 },
  { key: "project_ref", header: "Project", width: 12 },
  { key: "project_name", header: "Project name", width: 28 },
  { key: "expense_date", header: "Expense date", width: 13 },
  { key: "category", header: "Category", width: 18 },
  { key: "erp_category", header: "ERP category", width: 14 },
  { key: "resource_code", header: "Resource", width: 10 },
  { key: "cost_code", header: "Cost code", width: 12 },
  { key: "wbs_code", header: "WBS", width: 12 },
  { key: "cost_line", header: "Cost line", width: 30 },
  { key: "vendor", header: "Vendor", width: 26 },
  { key: "invoice_ref", header: "Invoice number", width: 16 },
  { key: "currency", header: "Currency", width: 9 },
  { key: "amount", header: "Amount", width: 13, numFmt: "#,##0.00" },
  { key: "amount_project_ccy", header: "Amount in project currency", width: 16, numFmt: "#,##0.00" },
  { key: "vat_amount", header: "VAT", width: 11, numFmt: "#,##0.00" },
  { key: "paid_by", header: "Paid by", width: 13 },
  { key: "document_state", header: "Document", width: 16 },
  { key: "submitted_by", header: "Entered by", width: 20 },
  { key: "approved_by", header: "Approved by", width: 20 },
  { key: "approved_at", header: "Approved", width: 18 },
  { key: "note", header: "Note", width: 30 },
];

/** Text that Excel would run as a formula is written as text (the 2026-07-25 audit: every export neutralises =, +, - and @). */
export const safeCell = (v: unknown): unknown => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export async function buildRegisterWorkbook(rows: readonly RegisterRow[], meta: { generated: string; tenantName: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.tenantName;
  const sheet = wb.addWorksheet("Site expenses");
  sheet.columns = REGISTER_COLUMNS.map((c) => ({ width: c.width }));
  REGISTER_COLUMNS.forEach((c, i) => { if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt; });
  const title = sheet.addRow([`Approved site expenses for posting, ${meta.generated}. Our reference travels in the journal line's document reference. Nothing here is posted.`]);
  title.font = { bold: true };
  sheet.mergeCells(title.number, 1, title.number, REGISTER_COLUMNS.length);
  const head = sheet.addRow(REGISTER_COLUMNS.map((c) => c.header));
  head.font = { bold: true };
  head.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF3" } }; });
  for (const r of rows) sheet.addRow(REGISTER_COLUMNS.map((c) => safeCell(r[c.key])));
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
