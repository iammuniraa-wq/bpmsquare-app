import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { parseDelimited } from "@/lib/import/parse";
import { budgetTotals, cleanDraftLines, diffRevisions, lineAmount, plannedMargin, unknownCodes } from "./budget";
import { contractProjectSettings, contractValueFor, estimateUnitCost, mapTenderToBudget, type BoqInfo, type DealLine } from "./fromTender";
import { parseMasterGrid } from "./masters";
import { askMessage, askProblem, canDecide, decidersFor, justificationProblem, outcomeMessage, requestReason, tenderSettings, approverIds } from "./approval";
import { buildHandoverWorkbook } from "./handover";
import { PROJECT_TIPS } from "./tips";
import { JUSTIFICATION_SEEDS, MASTERFORMAT_DIVISIONS, MASTERFORMAT_SECTIONS, MATERIAL_GROUP_SEEDS, RESOURCE_SEEDS, type BudgetLine, type ProjectRow, type RevisionRow } from "./types";

const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: "i", line_key: "k1", line_no: 1, resource_code: "11", cost_code: "03", wbs: null, description: "Concrete", qty: 10, unit: "m3", unit_cost: 100, amount: 1000,
  cost_known: true, source_ref: null, reserve: false, committed: null, actual: null, ...over,
});

describe("budget arithmetic", () => {
  it("a line amount is quantity times unit cost to 2 places", () => {
    expect(lineAmount(3, 2.5)).toBe(7.5);
    expect(lineAmount(7, 0.1234)).toBe(0.86);
    expect(lineAmount(0, 50)).toBe(0);
  });

  it("totals, reserve, estimated lines and the split by resource", () => {
    const t = budgetTotals([
      line({ amount: 1000 }), line({ amount: 500, resource_code: "31", cost_code: null }),
      line({ amount: 200, cost_known: false, reserve: true }), line({ amount: 50, resource_code: null }),
    ]);
    expect(t.total).toBe(1750);
    expect(t.reserve).toBe(200);
    expect(t.estimatedCount).toBe(1);
    expect(t.estimatedAmount).toBe(200);
    expect(t.noCostCodeCount).toBe(1);
    expect(t.noResourceCount).toBe(1);
    expect(t.byResource.find((r) => r.code === "11")?.amount).toBe(1200);
    expect(t.byResource.map((r) => r.code)).toEqual(["", "11", "31"]);
  });

  it("planned margin is contract value less budget, as a share of the contract value", () => {
    expect(plannedMargin(1000, 800)).toEqual({ amount: 200, pct: 20 });
    expect(plannedMargin(1000, 1200)).toEqual({ amount: -200, pct: -20 });
    expect(plannedMargin(0, 100).pct).toBeNull();
  });
});

describe("the shape of a saved set of lines", () => {
  it("accepts a good line and fills the defaults", () => {
    const r = cleanDraftLines([{ description: "  Pipe  ", qty: "2", unit_cost: "10.5" }]);
    expect(r.ok && r.lines[0]).toMatchObject({ description: "Pipe", qty: 2, unit_cost: 10.5, cost_known: true, reserve: false, resource_code: null });
  });

  it("refuses a missing description, a negative number, a huge line, a bad key and a repeated key, naming the row", () => {
    expect(cleanDraftLines([{ description: "ok" }, { description: "" }])).toMatchObject({ ok: false, row: 2 });
    expect(cleanDraftLines([{ description: "x", qty: -1 }])).toMatchObject({ ok: false, row: 1 });
    expect(cleanDraftLines([{ description: "x", unit_cost: "abc" }])).toMatchObject({ ok: false });
    expect(cleanDraftLines([{ description: "x", qty: 999_999_999, unit_cost: 999_999_999 }])).toMatchObject({ ok: false });
    expect(cleanDraftLines([{ description: "x", line_key: "nope" }])).toMatchObject({ ok: false });
    const k = "11111111-1111-4111-8111-111111111111";
    expect(cleanDraftLines([{ description: "a", line_key: k }, { description: "b", line_key: k }])).toMatchObject({ ok: false });
    expect(cleanDraftLines("lines")).toMatchObject({ ok: false });
  });

  it("never believes an amount that is sent", () => {
    const r = cleanDraftLines([{ description: "x", qty: 2, unit_cost: 5, amount: 99999 }]);
    expect(r.ok && Object.keys(r.lines[0])).not.toContain("amount");
  });

  it("lists the codes the workspace's lists do not hold", () => {
    expect(unknownCodes([{ resource_code: "11", cost_code: "03" }, { resource_code: "99", cost_code: "ZZ" }, { resource_code: null, cost_code: null }], new Set(["11"]), new Set(["03"]))).toEqual({ resource: ["99"], cost_code: ["ZZ"] });
  });
});

describe("the difference between two revisions", () => {
  it("matches on line_key: added, removed, changed, unchanged, and the change in total", () => {
    const before = [line({ line_key: "a", amount: 100, unit_cost: 10, qty: 10 }), line({ line_key: "b", amount: 50 }), line({ line_key: "c", amount: 20 })];
    const after = [line({ line_key: "a", amount: 120, unit_cost: 12, qty: 10 }), line({ line_key: "c", amount: 20 }), line({ line_key: "d", amount: 30 })];
    const d = diffRevisions(before, after);
    expect(d.added.map((l) => l.line_key)).toEqual(["d"]);
    expect(d.removed.map((l) => l.line_key)).toEqual(["b"]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].fields).toEqual(["unit_cost", "amount"]);
    expect(d.unchanged).toBe(1);
    expect(d.totalBefore).toBe(170);
    expect(d.totalAfter).toBe(170);
    expect(d.delta).toBe(0);
  });

  it("reports the delta as an amount and a percentage", () => {
    const d = diffRevisions([line({ amount: 100 })], [line({ amount: 150 })]);
    expect(d.delta).toBe(50);
    expect(d.deltaPct).toBe(50);
    expect(diffRevisions([], [line()]).deltaPct).toBeNull();
  });
});

describe("making a budget from a won tender", () => {
  const deal = (over: Partial<DealLine> = {}): DealLine => ({ id: "d1", sl_no: "1.1", description: "Chain link fence", uom: "m", qty: 100, rate: 200, discount_pct: 0, is_selected: true, break_of: null, ...over });
  const info = (over: Partial<BoqInfo> = {}): BoqInfo => ({ item_no: "1.1", cost_code: "32 31 13", unit_cost: null, price_source: null, price_source_ref: null, ...over });
  const codes = new Set(["32 31 13", "03 30 00"]);

  it("a recorded cost is kept and known; no cost is the rate less the default margin and is marked estimated", () => {
    const known = mapTenderToBudget({ lines: [deal()], boq: new Map([["d1", info({ unit_cost: 120, price_source: "supplier", price_source_ref: "RFQ-0004" })]]), costCodes: codes, defaultMarginPct: 15 });
    expect(known.lines[0]).toMatchObject({ unit_cost: 120, cost_known: true });
    expect(known.estimated).toBe(0);
    expect(known.lines[0].source_ref).toContain("RFQ-0004");

    const guess = mapTenderToBudget({ lines: [deal()], boq: new Map([["d1", info()]]), costCodes: codes, defaultMarginPct: 15 });
    expect(guess.lines[0]).toMatchObject({ unit_cost: 170, cost_known: false });
    expect(guess.estimated).toBe(1);
    expect(guess.lines[0].source_ref).toContain("Estimated");
  });

  it("the discount comes off the rate before the margin, and a rate of zero estimates to zero", () => {
    expect(estimateUnitCost(200, 10, 15)).toBe(153);
    expect(estimateUnitCost(0, 0, 15)).toBe(0);
    expect(estimateUnitCost(100, 0, 500)).toBe(5); // margin is capped at 95
  });

  it("starts every line as Material, keeps the item number as the WBS and copies quantity and unit", () => {
    const m = mapTenderToBudget({ lines: [deal()], boq: new Map([["d1", info()]]), costCodes: codes, defaultMarginPct: 15 });
    expect(m.lines[0]).toMatchObject({ resource_code: "11", wbs: "1.1", qty: 100, unit: "m", reserve: false, line_key: null });
  });

  it("uses the BOQ's cost code only when the workspace's list holds it (case and spacing aside); otherwise leaves it blank and says so", () => {
    const ok = mapTenderToBudget({ lines: [deal()], boq: new Map([["d1", info({ cost_code: " 32 31 13 " })]]), costCodes: codes, defaultMarginPct: 15 });
    expect(ok.lines[0].cost_code).toBe("32 31 13");
    const no = mapTenderToBudget({ lines: [deal()], boq: new Map([["d1", info({ cost_code: "99 99 99" })]]), costCodes: codes, defaultMarginPct: 15 });
    expect(no.lines[0].cost_code).toBeNull();
    expect(no.unmappedCodes).toEqual(["99 99 99"]);
    expect(no.lines[0].source_ref).toContain("not in your cost codes");
  });

  it("leaves out lines that are not selected and quantity-break rows", () => {
    const m = mapTenderToBudget({ lines: [deal(), deal({ id: "d2", is_selected: false }), deal({ id: "d3", break_of: "d1" })], boq: new Map(), costCodes: codes, defaultMarginPct: 15 });
    expect(m.lines).toHaveLength(1);
    expect(m.skipped).toBe(2);
  });

  it("the contract value is the awarded value when recorded, else the deal's amount", () => {
    expect(contractValueFor({ awardValue: 900, dealAmount: 1000 })).toBe(900);
    expect(contractValueFor({ awardValue: null, dealAmount: 1000 })).toBe(1000);
    expect(contractValueFor({ awardValue: 0, dealAmount: undefined })).toBe(0);
  });

  it("the default margin is 15 unless the workspace set one, and is kept in range", () => {
    expect(contractProjectSettings(null).defaultMarginPct).toBe(15);
    expect(contractProjectSettings({ contract_projects: { default_margin_pct: 20 } }).defaultMarginPct).toBe(20);
    expect(contractProjectSettings({ contract_projects: { default_margin_pct: 500 } }).defaultMarginPct).toBe(95);
    expect(contractProjectSettings({ contract_projects: { default_margin_pct: 0 } }).defaultMarginPct).toBe(0);
  });
});

describe("reading a code list from a file", () => {
  const grid = (rows: (string | number | null)[][]) => rows;

  it("reads code, name and parent under a header row, wherever the header sits", () => {
    const r = parseMasterGrid(grid([["Cost codes"], [], ["Code", "Name", "Parent"], ["03", "Concrete", null], ["03 30 00", "Cast-in-Place Concrete", "03"]]), "cost_code");
    expect(r.problems).toEqual([]);
    expect(r.rows.map((x) => [x.code, x.parent_code])).toEqual([["03", null], ["03 30 00", "03"]]);
    expect(r.rows[1].row).toBe(5);
  });

  it("accepts a parent that is later in the file or already stored; drops an unknown parent with a note and keeps the row", () => {
    const r = parseMasterGrid(grid([["code", "name", "parent code"], ["a1", "Child", "a0"], ["a0", "Top", null], ["b1", "Orphan", "zz"], ["c1", "Stored parent", "old"]]), "cost_code", new Set(["old"]));
    expect(r.rows.find((x) => x.code === "a1")?.parent_code).toBe("a0");
    expect(r.rows.find((x) => x.code === "b1")?.parent_code).toBeNull();
    expect(r.rows.find((x) => x.code === "c1")?.parent_code).toBe("old");
    expect(r.warnings.map((w) => w.row)).toEqual([4]);
    expect(r.problems).toEqual([]);
  });

  it("refuses duplicates (the first is kept), a missing code or name, its own parent, a loop and over-long values", () => {
    const r = parseMasterGrid(grid([
      ["code", "name", "parent"],
      ["x1", "One", null], ["X1", "Again", null], ["", "No code", null], ["x2", "", null], ["x3", "Self", "x3"],
      ["l1", "Loop A", "l2"], ["l2", "Loop B", "l1"], ["y".repeat(41), "Long", null], ["ok", "Fine", null],
    ]), "cost_code");
    expect(r.rows.map((x) => x.code)).toEqual(["x1", "ok"]);
    const messages = r.problems.map((p) => p.message).join(" | ");
    expect(messages).toContain("already on row 2");
    expect(messages).toContain("No code");
    expect(messages).toContain("has no name");
    expect(messages).toContain("own parent");
    expect(messages).toContain("its own ancestor");
    expect(messages).toContain("longer than 40");
    expect(r.problems).toHaveLength(7);
  });

  it("numeric codes read as text, and flags are read for resource levels only", () => {
    const g = grid([["Code", "Name", "Budget validation", "Revenue"], [1105, "Metals", "yes", null], [91, "Revenue", null, "Y"]]);
    const res = parseMasterGrid(g, "resource");
    expect(res.rows[0]).toMatchObject({ code: "1105", flags: { budget_validation: true } });
    expect(res.rows[1].flags).toEqual({ revenue_side: true });
    expect(parseMasterGrid(g, "cost_code").rows[0].flags).toEqual({});
  });

  it("says what is wrong when there is no header", () => {
    expect(parseMasterGrid(grid([["03", "Concrete"]]), "cost_code").problems[0].message).toContain("header row");
  });

  it("reads a CSV the same way, quoted commas included", () => {
    const rows = parseDelimited('Code,Name,Parent\n03,"Concrete, general",\n03 30 00,Cast-in-Place Concrete,03\n');
    const r = parseMasterGrid(rows, "cost_code");
    expect(r.rows.map((x) => x.name)).toEqual(["Concrete, general", "Cast-in-Place Concrete"]);
    expect(r.rows[1].parent_code).toBe("03");
  });
});

describe("the starter lists", () => {
  it("are the eight resource levels the owner showed, with the income side marked", () => {
    expect(RESOURCE_SEEDS.map((r) => r.code)).toEqual(["11", "21", "31", "32", "41", "51", "91", "92"]);
    expect(RESOURCE_SEEDS.filter((r) => r.flags.revenue_side).map((r) => r.code)).toEqual(["91", "92"]);
  });

  it("add material sub-groups under 11 that mirror the divisions (11 + division number)", () => {
    const codes = MATERIAL_GROUP_SEEDS.map((g) => g.code);
    for (const c of ["1103", "1105", "1106", "1107", "1108", "1109", "1131", "1132", "1133"]) expect(codes).toContain(c);
    expect(MATERIAL_GROUP_SEEDS.every((g) => g.parent === "11")).toBe(true);
    expect(MATERIAL_GROUP_SEEDS.find((g) => g.code === "1105")?.name).toBe("Metals");
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("hold the MasterFormat divisions and the sections the demo BOQ uses, each under its division", () => {
    expect(MASTERFORMAT_DIVISIONS).toHaveLength(35);
    const divs = new Set(MASTERFORMAT_DIVISIONS.map((d) => d.code));
    expect(MASTERFORMAT_SECTIONS.map((s) => s.code)).toEqual(["01 50 00", "01 71 23", "03 30 00", "31 23 16", "32 31 13"]);
    for (const s of MASTERFORMAT_SECTIONS) expect(divs.has(s.parent), s.code).toBe(true);
    expect(JUSTIFICATION_SEEDS.map((j) => j.code)).toContain("other");
  });
});

describe("approval rules", () => {
  const draft = { status: "draft" as const, rev_no: 0, justification_code: null, justification_text: null };

  it("a baseline needs lines, a resource on each line and someone else to approve", () => {
    expect(askProblem({ revision: draft, lineCount: 0, linesWithoutResource: 0, deciders: ["boss"], projectClosed: false })).toContain("at least one");
    expect(askProblem({ revision: draft, lineCount: 3, linesWithoutResource: 2, deciders: ["boss"], projectClosed: false })).toContain("no resource");
    expect(askProblem({ revision: draft, lineCount: 3, linesWithoutResource: 0, deciders: [], projectClosed: false })).toContain("No one else");
    expect(askProblem({ revision: draft, lineCount: 3, linesWithoutResource: 0, deciders: ["boss"], projectClosed: false })).toBeNull();
    expect(askProblem({ revision: draft, lineCount: 3, linesWithoutResource: 0, deciders: ["boss"], projectClosed: true })).toContain("closed");
    expect(askProblem({ revision: { ...draft, status: "pending" }, lineCount: 3, linesWithoutResource: 0, deciders: ["boss"], projectClosed: false })).toContain("already waiting");
    expect(askProblem({ revision: { ...draft, status: "approved" }, lineCount: 3, linesWithoutResource: 0, deciders: ["boss"], projectClosed: false })).toContain("Only a draft");
  });

  it("a later revision needs a reason, and the reason Other needs a note", () => {
    expect(justificationProblem({ rev_no: 0, justification_code: null, justification_text: null })).toBeNull();
    expect(justificationProblem({ rev_no: 1, justification_code: null, justification_text: null })).toContain("Choose why");
    expect(justificationProblem({ rev_no: 1, justification_code: "other", justification_text: " " })).toContain("needs a note");
    expect(justificationProblem({ rev_no: 1, justification_code: "other", justification_text: "Client added a bay" })).toBeNull();
    expect(justificationProblem({ rev_no: 2, justification_code: "scope_change", justification_text: null })).toBeNull();
  });

  it("reuses the tender approvers: chosen members, else admins; the asker cannot decide unless the workspace allows it", () => {
    const settings = tenderSettings({ tender: { approvers: ["boss", "gone"] } });
    const approvers = approverIds(settings, ["asker", "boss", "admin"], ["admin"]);
    expect(approvers).toEqual(["boss"]);
    expect(canDecide("boss", approvers, "asker", false)).toBe(true);
    expect(canDecide("boss", approvers, "boss", false)).toBe(false);
    expect(canDecide("boss", approvers, "boss", true)).toBe(true);
    expect(decidersFor(approvers, "boss", false)).toEqual([]);
    expect(approverIds(tenderSettings(null), ["asker", "admin"], ["admin"])).toEqual(["admin"]);
  });

  it("the request and the outcome read in plain words", () => {
    expect(requestReason({ rev_no: 0, justification_code: null, justification_text: null }, null, 12500, "SAR")).toBe("Baseline budget, SAR 12,500");
    expect(requestReason({ rev_no: 2, justification_code: "price_change", justification_text: "Steel up" }, "Price change", 900, null)).toBe("Revision 2, 900: Price change: Steel up");
    const m = askMessage({ project: "Fence", ref: "CPR-0001", proposer: "Sara", revNo: 0, reason: "Baseline budget", link: "https://x.test/p" });
    expect(m.subject).toContain("the baseline budget for CPR-0001 Fence");
    expect(m.text).toContain("https://x.test/p");
    expect(outcomeMessage({ project: "Fence", ref: null, decider: "Boss", revNo: 1, approved: false, comment: "Too high", link: null }).text).toContain("back in draft");
  });
});

describe("the explanations", () => {
  it.each(Object.entries(PROJECT_TIPS))("%s fits behind an i", (_key, text) => {
    expect(tipTextProblems(text)).toEqual([]);
  });
});

describe("the handover workbook", () => {
  const project = { id: "p", tenant_id: "t", ref: "CPR-0001", name: "Fence", account_id: null, source_opportunity_id: null, status: "active", contract_value: 5000, currency: "SAR", planned_start: null, planned_end: null, manager_id: null, erp_system: null, erp_id: null, custom_data: null, created_by: null, created_at: "", updated_at: "" } as ProjectRow;
  const revision = { id: "r", project_id: "p", rev_no: 0, status: "approved", justification_code: null, justification_text: null, created_by: null, created_at: "", approved_by: null, approved_at: null, locked_at: null, total: 1500 } as RevisionRow;

  it("has the project, the budget lines with resource and cost code names, a total and the material list", async () => {
    const buf = await buildHandoverWorkbook({
      project, accountName: "Aramco", managerName: "Sara", revision, resourceNames: new Map([["11", "Material"], ["31", "Man Power"]]), costCodeNames: new Map([["03", "Concrete"]]),
      lines: [line({ amount: 1000 }), line({ line_key: "k2", line_no: 2, resource_code: "31", cost_code: null, description: "Labour", amount: 500, unit_cost: 50, qty: 10, cost_known: false })],
    });
    const { default: Excel } = await import("exceljs");
    const wb = new Excel.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Project", "Budget", "Materials (BOM)"]);
    const sp = wb.getWorksheet("Project")!;
    const cells = new Map<string, unknown>();
    sp.eachRow((r) => cells.set(String(r.getCell(1).value), r.getCell(2).value));
    expect(cells.get("Customer")).toBe("Aramco");
    expect(cells.get("Budget total")).toBe(1500);
    expect(cells.get("Planned margin")).toBe(3500);
    const sb = wb.getWorksheet("Budget")!;
    expect(sb.getRow(2).getCell(3).value).toBe("Material");
    expect(sb.getRow(2).getCell(5).value).toBe("Concrete");
    expect(sb.getRow(3).getCell(12).value).toBe("Estimated");
    expect(sb.getRow(4).getCell(11).value).toBe(1500);
    const sm = wb.getWorksheet("Materials (BOM)")!;
    expect(sm.rowCount).toBe(2);
    expect(sm.getRow(2).getCell(3).value).toBe("Concrete");
  });
});
