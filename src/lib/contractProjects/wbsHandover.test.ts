import { describe, expect, it } from "vitest";
import { buildHandoverWorkbook } from "./handover";
import { splitListText } from "@/lib/wbs/screen";
import type { BudgetLine, ProjectRow, RevisionRow, WorkPackageRow } from "./types";

// The handover Excel with a WBS (docs/design/wbs.md slice 4): a "WBS item" column that lists a split line's shares, and a WBS sheet with a row
// per item and a row under it for every part of a split line.

const K = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, "0")}`;
const line = (n: number, over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: `i${n}`, line_key: K(n), line_no: n, resource_code: "11", cost_code: "03", wbs: `2.${n}`, description: `Line ${n}`, qty: 10, unit: "m", unit_cost: 100, amount: 1000, cost_known: true,
  source_ref: null, reserve: false, committed: null, actual: null, allocated: true, client_rate: 120, client_amount: 1200, source_line_id: null, ...over,
});
const item = (id: string, code: string, parent: string | null, over: Partial<WorkPackageRow> = {}): WorkPackageRow => ({
  id, code, name: `Name ${code}`, owner_employee_id: null, owner_name: null, allocated_cost: null, sort_order: Number(code.replace(/\D/g, "")) * 10, note: null, line_keys: [], parent_id: parent, line_parts: [], ...over,
});

const project = { id: "p", tenant_id: "t", ref: "CPR-0001", name: "Fence", account_id: null, source_opportunity_id: null, status: "active", contract_value: 500000, currency: "SAR", planned_start: null, planned_end: null, manager_id: null, erp_system: null, erp_id: null, allocation_basis: "package", custom_data: null, created_by: null, created_at: "", updated_at: "" } as unknown as ProjectRow;
const revision = { id: "r", project_id: "p", rev_no: 0, status: "approved", justification_code: null, justification_text: null, created_by: null, created_at: "", approved_by: null, approved_at: null, locked_at: null, total: 0 } as RevisionRow;

const STAIR = line(1, { wbs: "2.4", description: "Steel access stair", qty: 337.1, client_amount: 141582 });
const LINES = [STAIR, line(2, { description: "Handrail", client_amount: 8000 }), line(3, { description: "Gate", client_amount: 500 })];
const PACKAGES = [
  item("steel", "1", null, { name: "Steel" }),
  item("fab", "1.1", "steel", { name: "Fabrication", owner_name: "Sara Khan", line_keys: [K(2)], line_parts: [{ line_key: K(1), share_pct: 60 }], allocated_cost: 5000 }),
  item("gal", "1.2", "steel", { name: "Galvanising", line_parts: [{ line_key: K(1), share_pct: 15 }] }),
  item("ere", "2", null, { name: "Erection", line_parts: [{ line_key: K(1), share_pct: 25 }] }),
];

async function open(packages: WorkPackageRow[] | undefined) {
  const buf = await buildHandoverWorkbook({
    project, accountName: "Aramco", managerName: "Sara", revision, resourceNames: new Map([["11", "Material"]]), costCodeNames: new Map([["03", "Concrete"]]), lines: LINES, packages,
  });
  const { default: Excel } = await import("exceljs");
  const wb = new Excel.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}
const rowOf = (ws: import("exceljs").Worksheet, n: number) => (ws.getRow(n).values as unknown[]).slice(1);
/** A cell as text; an empty cell reads back as "" or as nothing depending on how it was written. */
const txt = (ws: import("exceljs").Worksheet, row: number, col: number) => String(ws.getRow(row).getCell(col).value ?? "");

describe("the handover workbook with a WBS", () => {
  it("has a WBS sheet after the Budget, and calls the client's number Item no. and the tree WBS item", async () => {
    const wb = await open(PACKAGES);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Project", "Budget", "WBS", "Materials (BOM)"]);
    const head = rowOf(wb.getWorksheet("Budget")!, 1);
    expect(head[5]).toBe("Item no.");
    expect(head[12]).toBe("WBS item");
    expect(head).not.toContain("Work package");
    expect(head).not.toContain("WBS");
    expect(rowOf(wb.getWorksheet("Materials (BOM)")!, 1)[5]).toBe("Item no.");
  });

  it("prints a split line's shares in the WBS item column, a whole line's code, and nothing for a line in no item", async () => {
    const sb = (await open(PACKAGES)).getWorksheet("Budget")!;
    expect(sb.getRow(2).getCell(13).value).toBe("1.1 60 % · 1.2 15 % · 2 25 %");
    expect(sb.getRow(3).getCell(13).value).toBe("1.1");
    expect(txt(sb, 4, 13)).toBe("");
    // the other columns keep their places
    expect(sb.getRow(2).getCell(6).value).toBe("2.4");
    expect(sb.getRow(2).getCell(12).value).toBe("Yes");
  });

  it("shows what a share leaves unassigned after an item was removed", async () => {
    const sb = (await open([item("fab", "1.1", null, { line_parts: [{ line_key: K(1), share_pct: 60 }] })])).getWorksheet("Budget")!;
    expect(sb.getRow(2).getCell(13).value).toBe("1.1 60 % · 40 % unassigned");
  });

  it("the WBS sheet has an item per row with its roll-up, and a row under it for every part of a split line", async () => {
    const sw = (await open(PACKAGES)).getWorksheet("WBS")!;
    expect(rowOf(sw, 1)).toEqual(["WBS", "Name", "Parent", "Owner", "Client amount", "Allocated", "Lines", "Share %", "Qty", "Unit"]);
    // 1 Steel (rolls up 1.1 and 1.2)
    expect([1, 2, 3].map((c) => txt(sw, 2, c))).toEqual(["1", "Steel", ""]);
    expect(sw.getRow(2).getCell(5).value).toBeCloseTo(8000 + 141582 * 0.75, 2);
    expect(sw.getRow(2).getCell(7).value).toBe(3);
    // 1.1 Fabrication: parent code, owner, allocated, then its part of the stair
    expect([1, 2, 3, 4].map((c) => txt(sw, 3, c))).toEqual(["1.1", "  Fabrication", "1", "Sara Khan"]);
    expect(sw.getRow(3).getCell(6).value).toBe(5000);
    expect(txt(sw, 4, 1)).toBe("1.1");
    expect(txt(sw, 4, 2)).toBe("    2.4 Steel access stair");
    expect(sw.getRow(4).getCell(5).value).toBe(84949.2);
    expect(sw.getRow(4).getCell(8).value).toBe(60);
    expect(sw.getRow(4).getCell(9).value).toBe(202.26);
    expect(txt(sw, 4, 10)).toBe("m");
  });

  it("the parts of a split line add up to the whole line across the sheet", async () => {
    const sw = (await open(PACKAGES)).getWorksheet("WBS")!;
    const parts: { share: number; amount: number; qty: number }[] = [];
    sw.eachRow((r, n) => { if (n > 1 && r.getCell(8).value != null) parts.push({ share: Number(r.getCell(8).value), amount: Number(r.getCell(5).value), qty: Number(r.getCell(9).value) }); });
    expect(parts.map((p) => p.share)).toEqual([60, 15, 25]);
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(141582, 2);
    expect(parts.reduce((s, p) => s + p.qty, 0)).toBeCloseTo(337.1, 3);
  });

  it("without a WBS the file is as before: three sheets and an empty WBS item column", async () => {
    for (const none of [undefined, []]) {
      const wb = await open(none);
      expect(wb.worksheets.map((w) => w.name)).toEqual(["Project", "Budget", "Materials (BOM)"]);
      expect(txt(wb.getWorksheet("Budget")!, 2, 13)).toBe("");
    }
  });
});

describe("the list a split line prints as", () => {
  it("is one string on every file: the code alone for a whole line, code and percent for each part", () => {
    expect(splitListText([{ code: "2.1", share_pct: 100 }])).toBe("2.1");
    expect(splitListText([{ code: "2.1", share_pct: 60 }, { code: "2.2", share_pct: 15 }, { code: "2.3", share_pct: 25 }])).toBe("2.1 60 % · 2.2 15 % · 2.3 25 %");
    expect(splitListText([{ code: "2.1", share_pct: 33.3333 }, { code: "2.2", share_pct: 66.6667 }])).toBe("2.1 33.3333 % · 2.2 66.6667 %");
    expect(splitListText([])).toBe("");
    expect(splitListText([], 100)).toBe("");
  });
});
