import { describe, it, expect } from "vitest";
import {
  buildBomRows, buildWbsRows, buildBomTable, buildWbsTable, tableToCsv, tableToXlsx, exportFilename,
  resolveErpProfile, ERP_EXPORT_PROFILES, GENERIC_PROFILE, DEFAULT_ERP_PROFILE,
} from "./exports";
import type { ExportLineInput } from "./exports";
import { computeEstimate } from "./compute";
import { PRECAST_VILLA_STARTER } from "./starterTemplates";

const computed = (() => {
  const r = computeEstimate(PRECAST_VILLA_STARTER, {}, { margin_pct: 15 });
  if (!r.ok) throw new Error("compute failed");
  return r.lines;
})();

describe("BOM rows (generic columns, spec 5.1)", () => {
  const rows = buildBomRows(computed);

  it("has exactly the spec columns", () => {
    expect(Object.keys(rows[0])).toEqual([
      "item_number", "description", "quantity", "unit", "group", "wbs_code", "element_ref", "unit_cost", "line_cost",
    ]);
    expect(GENERIC_PROFILE.columns.bom.map((c) => c.header)).toEqual(Object.keys(rows[0]));
  });

  it("keeps physical items and leaves labour, transport, erection and overhead to the WBS", () => {
    const wbsOnly = ["Production labour", "Transport to site (loads by weight)", "Crane mobilisation", "Erection", "Factory and yard overhead"];
    for (const d of wbsOnly) expect(rows.some((r) => r.description === d), d).toBe(false);
    expect(rows).toHaveLength(13); // 18 computed lines - 5 non-item lines
    const all = buildBomRows(computed, { include: "all" });
    expect(all).toHaveLength(computed.length);
  });

  it("quantity is the gross quantity so quantity * unit_cost = line_cost", () => {
    const wall = rows.find((r) => r.description === "External wall panels (solid precast)")!;
    expect(wall.quantity).toBe(54.384); // 52.8 net + 3% waste
    expect(wall.unit).toBe("m3");
    expect(wall.unit_cost).toBe(320);
    expect(wall.line_cost).toBe(17402.88);
    for (const r of rows) {
      expect(Math.abs((r.quantity as number) * (r.unit_cost as number) - (r.line_cost as number))).toBeLessThan(0.006);
    }
  });

  it("derives WBS codes from group order and carries groups", () => {
    const wall = rows.find((r) => String(r.description).startsWith("External wall panels"))!;
    expect(wall.group).toBe("Structure");
    expect(wall.wbs_code).toBe("1.1");
    expect(rows.find((r) => r.description === "Reinforcement steel")!.wbs_code).toBe("5.1");
  });

  it("leaves item_number blank for rate lines and uses the SKU for product lines", () => {
    expect(rows[0].item_number).toBeNull();
    const withSku = buildBomRows([
      { code: "p", sku: " PNL-200 ", description: "Panel", uom: "nr", qty: 4, unit_cost: 12.5, cost_total: 50, group: "G" },
    ]);
    expect(withSku[0].item_number).toBe("PNL-200");
  });

  it("carries the element reference from a schedule line", () => {
    const r = computeEstimate(PRECAST_VILLA_STARTER, {}, { schedule: [{ rule_code: "ewp", qty: 10, element_ref: "W-1", label: "W-1" }] });
    if (!r.ok) throw new Error("compute failed");
    const bom = buildBomRows(r.lines);
    expect(bom.find((x) => x.element_ref === "W-1")?.quantity).toBe(10.3);
  });

  it("blanks costs of unpriced lines and drops zero-quantity lines", () => {
    const rows2 = buildBomRows([
      { sku: "A", description: "unpriced", uom: "nr", qty: 2, unit_cost: null, cost_total: null, group: "G" },
      { sku: "B", description: "zero", uom: "nr", qty: 0, unit_cost: 1, cost_total: 0, group: "G" },
    ]);
    expect(rows2).toHaveLength(1);
    expect(rows2[0].unit_cost).toBeNull();
    expect(rows2[0].line_cost).toBeNull();
  });

  it("orders by sort_order and tolerates missing groups", () => {
    const lines: ExportLineInput[] = [
      { description: "second", qty: 1, sort_order: 2, sku: "x" },
      { description: "first", qty: 1, sort_order: 1, sku: "y", group: "Alpha" },
    ];
    const r = buildBomRows(lines);
    expect(r.map((x) => x.description)).toEqual(["first", "second"]);
    expect(r[1].group).toBe("Ungrouped");
    expect(r.map((x) => x.wbs_code)).toEqual(["1.1", "2.1"]);
  });
});

describe("WBS rows", () => {
  const rows = buildWbsRows(computed);

  it("emits a top-level element per group with its planned cost, then a task per line", () => {
    const groups = rows.filter((r) => r.parent === null);
    expect(groups.map((g) => [g.code, g.name, g.planned_cost])).toEqual([
      ["1", "Structure", 35695.68],
      ["2", "Envelope", 20825.76],
      ["3", "Stairs & ancillary", 4793.28],
      ["4", "Boundary wall", 7119.36],
      ["5", "Production", 73699.32],
      ["6", "Transport & erection", 49938],
      ["7", "Overhead", 17056.01],
    ]);
    const tasks = rows.filter((r) => r.parent === "1");
    expect(tasks.map((t) => t.code)).toEqual(["1.1", "1.2", "1.3"]);
    expect(tasks[0]).toMatchObject({ name: "External wall panels (solid precast)", group: "Structure", planned_cost: 17402.88 });
  });

  it("group planned costs add up to the estimate cost", () => {
    const total = rows.filter((r) => r.parent === null).reduce((a, r) => a + (r.planned_cost as number), 0);
    expect(Math.round(total * 100) / 100).toBe(209127.41);
  });

  it("depth 1 gives groups only", () => {
    expect(buildWbsRows(computed, { depth: 1 })).toHaveLength(7);
  });

  it("the WBS codes agree with the BOM's", () => {
    const wbsCodes = new Set(rows.map((r) => r.code));
    for (const b of buildBomRows(computed)) expect(wbsCodes.has(b.wbs_code as string)).toBe(true);
  });
});

describe("ERP profiles", () => {
  it("ships generic (default), dynamics365 and sap, each with a complete column set", () => {
    expect(Object.keys(ERP_EXPORT_PROFILES).sort()).toEqual(["dynamics365", "generic", "sap"]);
    const bomFields = Object.keys(buildBomRows(computed)[0]).sort();
    const wbsFields = Object.keys(buildWbsRows(computed)[0]).sort();
    for (const p of Object.values(ERP_EXPORT_PROFILES)) {
      expect(p.columns.bom.map((c) => c.field).sort(), p.key).toEqual(bomFields);
      expect(p.columns.wbs.map((c) => c.field).sort(), p.key).toEqual(wbsFields);
      expect(new Set(p.columns.bom.map((c) => c.header)).size, `${p.key} bom headers unique`).toBe(p.columns.bom.length);
      expect(new Set(p.columns.wbs.map((c) => c.header)).size, `${p.key} wbs headers unique`).toBe(p.columns.wbs.length);
    }
  });

  it("labels the ERP-specific ones as best-effort mappings to confirm", () => {
    expect(ERP_EXPORT_PROFILES.dynamics365.note).toMatch(/consultant/);
    expect(ERP_EXPORT_PROFILES.sap.note).toMatch(/consultant/);
  });

  it("names the columns for each ERP", () => {
    expect(buildBomTable(computed, ERP_EXPORT_PROFILES.dynamics365).headers).toEqual([
      "ItemNumber", "Description", "Quantity", "UnitSymbol", "LineGroup", "WBSId", "ElementReference", "CostPrice", "LineAmount",
    ]);
    expect(buildBomTable(computed, ERP_EXPORT_PROFILES.sap).headers.slice(0, 4)).toEqual(["MATNR", "MAKTX", "MENGE", "MEINS"]);
    expect(buildWbsTable(computed, ERP_EXPORT_PROFILES.sap).headers[0]).toBe("PSPNR");
  });

  it("the generic profile carries no ERP-specific naming", () => {
    const headers = [...GENERIC_PROFILE.columns.bom, ...GENERIC_PROFILE.columns.wbs].map((c) => c.header).join(" ");
    expect(headers).not.toMatch(/d365|dynamics|sap|matnr/i);
  });

  it("projects the same data under different headers", () => {
    const g = buildBomTable(computed, GENERIC_PROFILE);
    const d = buildBomTable(computed, ERP_EXPORT_PROFILES.dynamics365);
    expect(d.rows).toEqual(g.rows);
  });

  it("resolves the profile from the request, falling back to the tenant default then generic", () => {
    expect(resolveErpProfile(undefined)?.key).toBe(DEFAULT_ERP_PROFILE);
    expect(resolveErpProfile("")?.key).toBe("generic");
    expect(resolveErpProfile("SAP")?.key).toBe("sap");
    expect(resolveErpProfile(null, "dynamics365")?.key).toBe("dynamics365");
    expect(resolveErpProfile("sap", "dynamics365")?.key).toBe("sap");
    expect(resolveErpProfile("epicor")).toBeNull();
    expect(resolveErpProfile("constructor")).toBeNull();
    expect(resolveErpProfile("__proto__")).toBeNull();
  });
});

describe("CSV writer", () => {
  it("writes headers, CRLF rows, plain numbers and empty cells for null", () => {
    const csv = tableToCsv({ headers: ["a", "b", "c"], rows: [["x", 1.5, null], ["y", -2, "z"]] });
    expect(csv).toBe("a,b,c\r\nx,1.5,\r\ny,-2,z\r\n");
  });

  it("quotes commas, quotes and newlines", () => {
    const csv = tableToCsv({ headers: ["d"], rows: [['He said "hi", twice'], ["two\nlines"]] });
    expect(csv).toBe('d\r\n"He said ""hi"", twice"\r\n"two\nlines"\r\n');
  });

  it("neutralises formula-looking text but not numbers", () => {
    const csv = tableToCsv({ headers: ["d", "n"], rows: [["=SUM(A1)", -5], ["+1", 3], ["-cmd", 0], ["@x", 1], ["\tTab", 1], ["fine=ok", 2]] });
    const lines = csv.trim().split("\r\n");
    expect(lines.slice(1)).toEqual(["'=SUM(A1),-5", "'+1,3", "'-cmd,0", "'@x,1", "'\tTab,1", "fine=ok,2"]);
  });

  it("can prefix a UTF-8 BOM for Excel", () => {
    expect(tableToCsv({ headers: ["a"], rows: [] }, { bom: true }).startsWith("﻿")).toBe(true);
    expect(tableToCsv({ headers: ["a"], rows: [] }).startsWith("﻿")).toBe(false);
  });

  it("a full BOM export has one line per row plus the header", () => {
    const csv = tableToCsv(buildBomTable(computed));
    expect(csv.trim().split("\r\n")).toHaveLength(14);
    expect(csv.startsWith("item_number,description,quantity,unit,group,wbs_code,element_ref,unit_cost,line_cost\r\n")).toBe(true);
    expect(csv).toContain("External wall panels (solid precast),54.384,m3,Structure,1.1,,320,17402.88");
  });
});

describe("XLSX writer", () => {
  it("round-trips headers, text and numeric cells", async () => {
    const buf = await tableToXlsx(buildBomTable(computed, ERP_EXPORT_PROFILES.sap), "BOM / test?");
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("BOM   test");
    expect(ws.getRow(1).getCell(1).value).toBe("MATNR");
    expect(ws.rowCount).toBe(14);
    const wall = ws.getRow(2);
    expect(wall.getCell(2).value).toBe("External wall panels (solid precast)");
    expect(wall.getCell(3).value).toBe(54.384);
    expect(typeof wall.getCell(9).value).toBe("number");
  }, 30_000);
});

describe("filenames", () => {
  it("builds a safe name", () => {
    expect(exportFilename("EST-0001", "bom", "generic", "csv")).toBe("EST-0001-bom-generic.csv");
    expect(exportFilename(null, "wbs", "sap", "xlsx")).toBe("estimate-wbs-sap.xlsx");
    expect(exportFilename('EST/..\\"1"', "bom", "dynamics365", "csv")).toBe("EST-1-bom-dynamics365.csv");
  });
});
