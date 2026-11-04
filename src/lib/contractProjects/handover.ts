import type ExcelJS from "exceljs";
import { divideByShares, SHARE_TOLERANCE } from "@/lib/wbs/tree";
import { splitListText } from "@/lib/wbs/screen";
import { allocationView, type AllocationView } from "./allocation";
import { budgetTotals, plannedMargin } from "./budget";
import { REVISION_STATUS_LABEL, PROJECT_STATUS_LABEL, type BudgetLine, type ProjectRow, type RevisionRow, type WorkPackageRow } from "./types";

// The handover workbook (slice 5a): the stand-in for "send the project and budget to ePROMIS" until the connection exists (5b). It is
// INTERNAL: it carries cost and margin and goes only to the person who downloads it from the project, never to a customer. Sheets: the
// project, the budget by line with its resource, cost code and WBS item (a split line prints `2.1 60 % · 2.2 15 % · 2.3 25 %`), the WBS
// itself (an item per row with its roll-up, and a row under it for every part of a split line), and the material list (the BOM view of the
// Material lines). The client's own item number is the "Item no." column; "WBS" always means the project's tree.

export type HandoverInput = {
  project: ProjectRow;
  accountName: string | null;
  managerName: string | null;
  revision: RevisionRow;
  lines: BudgetLine[];
  /** code -> name, for the resource levels and the cost codes the lines use. */
  resourceNames: ReadonlyMap<string, string>;
  costCodeNames: ReadonlyMap<string, string>;
  /** The project's WBS items (with their lines and the parts of split lines). Absent or empty: no WBS column content and no WBS sheet. */
  packages?: readonly WorkPackageRow[];
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
    { header: "Item no.", width: 14 }, { header: "Description", width: 48 }, { header: "Qty", width: 12 }, { header: "Unit", width: 10 },
    { header: "Unit cost", width: 14 }, { header: "Amount", width: 16 }, { header: "Allocated", width: 12 }, { header: "WBS item", width: 30 }, { header: "Reserve", width: 10 }, { header: "Source", width: 40 },
  ];
  sb.getRow(1).font = bold;
  sb.views = [{ state: "frozen", ySplit: 1 }];

  const packages = input.packages ?? [];
  const view = packages.length > 0 ? allocationView(p, lines, packages, null) : null;
  const remainderOf = new Map((view?.unassigned ?? []).filter((u) => u.split).map((u) => [u.line_key, u.remainder_pct]));
  const wbsOf = new Map((view?.lineRows ?? []).map((r) => [r.line_key, splitListText(r.wbs, remainderOf.get(r.line_key) ?? 0)]));
  for (const l of lines) {
    sb.addRow([
      l.line_no, l.resource_code ?? "", l.resource_code ? input.resourceNames.get(l.resource_code) ?? "" : "", l.cost_code ?? "",
      l.cost_code ? input.costCodeNames.get(l.cost_code) ?? "" : "", l.wbs ?? "", l.description, l.qty, l.unit ?? "", l.unit_cost, l.amount,
      l.allocated ? "Yes" : "No", wbsOf.get(l.line_key) ?? "", l.reserve ? "Yes" : "", l.source_ref ?? "",
    ]);
  }
  const total = sb.addRow(["", "", "", "", "", "", "Total", "", "", "", totals.total]);
  total.font = bold;
  for (const col of [8, 10, 11]) sb.getColumn(col).numFmt = "#,##0.00";

  if (view) addWbsSheet(wb, view.wbsRows, view.lineRows, lines, packages);

  const sm = wb.addWorksheet("Materials (BOM)");
  sm.columns = [{ header: "#", width: 6 }, { header: "Cost code", width: 14 }, { header: "Description", width: 52 }, { header: "Qty", width: 12 }, { header: "Unit", width: 10 }, { header: "Item no.", width: 14 }];
  sm.getRow(1).font = bold;
  sm.views = [{ state: "frozen", ySplit: 1 }];
  let n = 0;
  for (const l of lines.filter((x) => x.resource_code === MATERIAL)) sm.addRow([++n, l.cost_code ?? "", l.description, l.qty, l.unit ?? "", l.wbs ?? ""]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * The WBS sheet: one row per item in tree order (its roll-up: client amount, allocated cost and lines, sub-items included), and under an item one row
 * for every part of a split line it holds, with the share, the quantity and the client amount of that part. Whole lines are not repeated here: the
 * Budget sheet's "WBS item" column already says where each one sits.
 */
function addWbsSheet(wb: ExcelJS.Workbook, wbsRows: AllocationView["wbsRows"], lineRows: AllocationView["lineRows"], lines: readonly BudgetLine[], packages: readonly WorkPackageRow[]) {
  const bold = { bold: true } as const;
  const sw = wb.addWorksheet("WBS");
  sw.columns = [
    { header: "WBS", width: 14 }, { header: "Name", width: 44 }, { header: "Parent", width: 14 }, { header: "Owner", width: 22 }, { header: "Client amount", width: 16 },
    { header: "Allocated", width: 14 }, { header: "Lines", width: 8 }, { header: "Share %", width: 10 }, { header: "Qty", width: 12 }, { header: "Unit", width: 10 },
  ];
  sw.getRow(1).font = bold;
  sw.views = [{ state: "frozen", ySplit: 1 }];
  const codeOf = new Map(packages.map((p) => [p.id, p.code]));
  const lineByKey = new Map(lines.map((l) => [l.line_key, l]));

  const partsByCode = new Map<string, { line: BudgetLine; share: number; qty: number; amount: number | null }[]>();
  for (const r of lineRows) {
    const line = lineByKey.get(r.line_key);
    if (!line) continue;
    const shares = r.wbs.map((x) => x.share_pct);
    const qtys = divideByShares(line.qty, shares, 3);
    const amounts = line.client_amount === null ? null : divideByShares(line.client_amount, shares);
    r.wbs.forEach((x, i) => {
      if (x.share_pct >= 100 - SHARE_TOLERANCE) return;
      partsByCode.set(x.code, [...(partsByCode.get(x.code) ?? []), { line, share: x.share_pct, qty: qtys[i], amount: amounts ? amounts[i] : null }]);
    });
  }

  for (const r of wbsRows) {
    const row = sw.addRow([r.code, `${"  ".repeat(r.depth - 1)}${r.name}`, r.parent_id ? codeOf.get(r.parent_id) ?? "" : "", r.owner_name ?? "", r.rolled.client_amount, r.rolled.allocated, r.rolled.line_count]);
    row.font = bold;
    for (const part of partsByCode.get(r.code) ?? []) {
      sw.addRow([r.code, `${"  ".repeat(r.depth)}${part.line.wbs ?? `#${part.line.line_no}`} ${part.line.description}`, "", "", part.amount, "", "", part.share, part.qty, part.line.unit ?? ""]);
    }
  }
  for (const col of [5, 6]) sw.getColumn(col).numFmt = "#,##0.00";
}
