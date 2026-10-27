import { roundMoney, PACKAGE_KIND_LABEL, type PackageKind } from "./rules";

// The buy-out handover workbook: what goes to ePROMIS or the ERP team so they can raise the purchase order or the subcontract order there (this
// product raises none). One awarded package: the supplier, the lines with their quantities, the AWARDED rates, the cost codes, the project and
// the round it was awarded on. It is INTERNAL: it goes only to the person who downloads it, never through a public link. It deliberately holds NO
// budget, NO cost from the bid and NO markup: the buyer's own margin is not the ERP team's business, only what we agreed to pay.

export type HandoverLine = {
  no: number;
  item: string | null;
  cost_code: string | null;
  cost_code_name: string | null;
  description: string;
  qty: number;
  unit: string | null;
  /** The awarded rate per unit, in the workspace currency. */
  rate: number;
};

export type PackageHandoverInput = {
  project: { ref: string | null; name: string; currency: string | null };
  clientName: string | null;
  pkg: { ref: string | null; name: string; kind: PackageKind };
  supplier: { name: string; ref: string | null; email: string | null; phone: string | null };
  round: { rfq_ref: string | null; round: number; supplier_quote_ref: string | null };
  awarded_at: string | null;
  awarded_by: string | null;
  lines: HandoverLine[];
};

export const lineTotal = (l: Pick<HandoverLine, "qty" | "rate">): number => roundMoney(l.qty * l.rate);

export function handoverTotal(lines: readonly Pick<HandoverLine, "qty" | "rate">[]): number {
  return roundMoney(lines.reduce((s, l) => s + lineTotal(l), 0));
}

export function handoverFileName(pkgRef: string | null): string {
  return `${(pkgRef ?? "package").replace(/[^A-Za-z0-9._-]/g, "") || "package"}-handover.xlsx`;
}

export async function buildPackageHandoverWorkbook(input: PackageHandoverInput): Promise<Buffer> {
  const { default: Excel } = await import("exceljs");
  const wb = new Excel.Workbook();
  wb.creator = "BPMSquare";
  const bold = { bold: true } as const;
  const total = handoverTotal(input.lines);

  const sp = wb.addWorksheet("Order");
  sp.columns = [{ width: 28 }, { width: 60 }];
  const rows: [string, string | number | null][] = [
    ["Project", input.project.name], ["Project reference", input.project.ref], ["Client", input.clientName],
    ["Package", input.pkg.name], ["Package reference", input.pkg.ref], ["Kind", PACKAGE_KIND_LABEL[input.pkg.kind]],
    ["Supplier", input.supplier.name], ["Supplier reference", input.supplier.ref], ["Supplier email", input.supplier.email], ["Supplier phone", input.supplier.phone],
    ["Quotation round", `Round ${input.round.round}${input.round.rfq_ref ? ` (${input.round.rfq_ref})` : ""}`], ["Supplier quote reference", input.round.supplier_quote_ref],
    ["Awarded on", input.awarded_at ? input.awarded_at.slice(0, 10) : null], ["Awarded by", input.awarded_by],
    ["Currency", input.project.currency], ["Total", total],
    ["Note", "Awarded prices. The purchase or subcontract order is raised in the ERP."],
  ];
  for (const [k, v] of rows) { const r = sp.addRow([k, v ?? ""]); r.getCell(1).font = bold; }

  const sl = wb.addWorksheet("Lines");
  sl.columns = [
    { header: "#", width: 6 }, { header: "Item", width: 14 }, { header: "Cost code", width: 14 }, { header: "Cost code name", width: 30 },
    { header: "Description", width: 52 }, { header: "Qty", width: 12 }, { header: "Unit", width: 10 }, { header: "Awarded rate", width: 16 }, { header: "Amount", width: 16 },
  ];
  sl.getRow(1).font = bold;
  sl.views = [{ state: "frozen", ySplit: 1 }];
  for (const l of input.lines) sl.addRow([l.no, l.item ?? "", l.cost_code ?? "", l.cost_code_name ?? "", l.description, l.qty, l.unit ?? "", l.rate, lineTotal(l)]);
  const sum = sl.addRow(["", "", "", "", "Total", "", "", "", total]);
  sum.font = bold;
  for (const col of [6, 8, 9]) sl.getColumn(col).numFmt = "#,##0.00";

  return Buffer.from(await wb.xlsx.writeBuffer());
}
