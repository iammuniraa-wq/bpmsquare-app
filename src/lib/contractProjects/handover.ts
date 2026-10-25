import { budgetTotals, plannedMargin } from "./budget";
import { REVISION_STATUS_LABEL, PROJECT_STATUS_LABEL, type BudgetLine, type ProjectRow, type RevisionRow } from "./types";

// The handover workbook (slice 5a): the stand-in for "send the project and budget to ePROMIS" until the connection exists (5b). It is
// INTERNAL: it carries cost and margin and goes only to the person who downloads it from the project, never to a customer. Three
// sheets: the project, the budget by line with its resource and cost code, and the material list (the BOM view of the Material lines).

export type HandoverInput = {
  project: ProjectRow;
  accountName: string | null;
  managerName: string | null;
  revision: RevisionRow;
  lines: BudgetLine[];
  /** code -> name, for the resource levels and the cost codes the lines use. */
  resourceNames: ReadonlyMap<string, string>;
  costCodeNames: ReadonlyMap<string, string>;
};

const MATERIAL = "11";

export async function buildHandoverWorkbook(input: HandoverInput): Promise<Buffer> {
  const { default: Excel } = await import("exceljs");
  const wb = new Excel.Workbook();
  wb.creator = "BPMSquare";
  const { project: p, revision: rev, lines } = input;
  const totals = budgetTotals(lines);
  const margin = plannedMargin(p.contract_value, totals.total);
  const bold = { bold: true } as const;

  const sp = wb.addWorksheet("Project");
  sp.columns = [{ width: 28 }, { width: 60 }];
  const rows: [string, string | number | null][] = [
    ["Project", p.name], ["Reference", p.ref], ["Status", PROJECT_STATUS_LABEL[p.status]], ["Customer", input.accountName],
    ["Manager", input.managerName], ["Planned start", p.planned_start], ["Planned end", p.planned_end],
    ["Currency", p.currency], ["Contract value", p.contract_value],
    ["Budget revision", `${rev.rev_no === 0 ? "Baseline" : `Revision ${rev.rev_no}`} (${REVISION_STATUS_LABEL[rev.status]})`],
    ["Budget total", totals.total], ["Reserve included", totals.reserve], ["Planned margin", margin.amount], ["Planned margin %", margin.pct],
    ["ERP system", p.erp_system], ["ERP id", p.erp_id],
    ["Internal", "Contains cost and margin. Not for customers."],
  ];
  for (const [k, v] of rows) { const r = sp.addRow([k, v ?? ""]); r.getCell(1).font = bold; }

  const sb = wb.addWorksheet("Budget");
  sb.columns = [
    { header: "#", width: 6 }, { header: "Resource code", width: 14 }, { header: "Resource", width: 22 }, { header: "Cost code", width: 14 }, { header: "Cost code name", width: 30 },
    { header: "WBS", width: 14 }, { header: "Description", width: 48 }, { header: "Qty", width: 12 }, { header: "Unit", width: 10 },
    { header: "Unit cost", width: 14 }, { header: "Amount", width: 16 }, { header: "Cost known", width: 12 }, { header: "Reserve", width: 10 }, { header: "Source", width: 40 },
  ];
  sb.getRow(1).font = bold;
  sb.views = [{ state: "frozen", ySplit: 1 }];
  for (const l of lines) {
    sb.addRow([
      l.line_no, l.resource_code ?? "", l.resource_code ? input.resourceNames.get(l.resource_code) ?? "" : "", l.cost_code ?? "",
      l.cost_code ? input.costCodeNames.get(l.cost_code) ?? "" : "", l.wbs ?? "", l.description, l.qty, l.unit ?? "", l.unit_cost, l.amount,
      l.cost_known ? "Yes" : "Estimated", l.reserve ? "Yes" : "", l.source_ref ?? "",
    ]);
  }
  const total = sb.addRow(["", "", "", "", "", "", "Total", "", "", "", totals.total]);
  total.font = bold;
  for (const col of [8, 10, 11]) sb.getColumn(col).numFmt = "#,##0.00";

  const sm = wb.addWorksheet("Materials (BOM)");
  sm.columns = [{ header: "#", width: 6 }, { header: "Cost code", width: 14 }, { header: "Description", width: 52 }, { header: "Qty", width: 12 }, { header: "Unit", width: 10 }, { header: "WBS", width: 14 }];
  sm.getRow(1).font = bold;
  sm.views = [{ state: "frozen", ySplit: 1 }];
  let n = 0;
  for (const l of lines.filter((x) => x.resource_code === MATERIAL)) sm.addRow([++n, l.cost_code ?? "", l.description, l.qty, l.unit ?? "", l.wbs ?? ""]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
