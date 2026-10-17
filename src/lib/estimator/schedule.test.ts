import { describe, it, expect, vi } from "vitest";
import {
  parseScheduleRows, parseScheduleFile, readScheduleTable, buildScheduleTemplateCsv, buildScheduleTemplateWorkbook,
  templateElementTypes, basisForUom, MAX_SCHEDULE_ROWS, MAX_SCHEDULE_BYTES, ScheduleFileError,
} from "./schedule";
import { computeEstimate } from "./compute";
import { PRECAST_VILLA_STARTER } from "./starterTemplates";
import type { EstimateTemplateBody } from "./types";

const T = PRECAST_VILLA_STARTER;
const HEADER = ["element_type", "mark", "count", "length_m", "width_m", "thickness_m", "weight_t"];
const parse = (rows: unknown[][], template: EstimateTemplateBody = T) => parseScheduleRows([HEADER, ...rows], { template });
const msgs = (r: { errors: { row: number; message: string }[] }) => r.errors.map((e) => `${e.row}: ${e.message}`).join("\n");

describe("parsing rows", () => {
  it("computes volume, weight and the quantity for the matching rule", () => {
    const r = parse([["wall_panel", "W-101", 4, 6, 3, 0.2, ""]]);
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toMatchObject({
      row: 2, element_type: "wall_panel", mark: "W-101", count: 4,
      volume_m3: 14.4, area_m2: 72, run_length_m: 24, rule_code: "ewp",
    });
    // no weight given: 14.4 m3 * the template's 2.4 t/m3 density
    expect(r.rows[0].weight_t).toBe(34.56);
    expect(r.quantities).toEqual([{ rule_code: "ewp", qty: 14.4, element_ref: "W-101", label: "W-101" }]);
  });

  it("uses a given weight (per piece) instead of density", () => {
    const t: EstimateTemplateBody = {
      ...T,
      rules: T.rules.map((r) => (r.code === "ewp" ? { ...r, uom: "t" } : r)),
    };
    const r = parse([["wall_panel", "W-1", 2, 6, 3, 0.2, 7.5]], t);
    expect(r.ok).toBe(true);
    expect(r.rows[0].weight_t).toBe(15);
    expect(r.quantities[0].qty).toBe(15);
  });

  it("accepts height_m as the third dimension and prefers thickness when both are given", () => {
    const aliasOnly = parseScheduleRows(
      [["Type", "Mark", "Qty", "Length (m)", "Width (m)", "Height (m)"], ["slab", "S1", 2, 5, 1.2, 0.2]],
      { template: T }
    );
    expect(aliasOnly.ok).toBe(true);
    expect(aliasOnly.rows[0].volume_m3).toBe(2.4);

    const both = parseScheduleRows(
      [["element_type", "length_m", "width_m", "thickness_m", "height_m"], ["slab", 5, 1.2, 0.2, 9]],
      { template: T }
    );
    expect(both.rows[0].volume_m3).toBe(1.2);
    expect(both.warnings[0].message).toMatch(/height_m is ignored/);
  });

  it("defaults count to 1, normalises element type spelling, skips blank rows", () => {
    const r = parse([["Wall Panel", "A", "", 2, 3, 0.1, ""], [], ["", "", "", "", "", "", ""], ["BEAM", "B", 1, 4, 0.3, 0.45, ""]]);
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => [x.element_type, x.count])).toEqual([["wall_panel", 1], ["beam", 1]]);
    expect(r.rows.map((x) => x.row)).toEqual([2, 5]); // sheet row numbers survive the skipped rows
  });

  it("finds the header below a title block and reads decimal commas", () => {
    const r = parseScheduleRows(
      [["Project X schedule"], [], ["element_type", "count", "length_m", "width_m", "thickness_m"], ["slab", "2", "5,5", "1.2", "0,2"]],
      { template: T }
    );
    expect(r.header_row).toBe(3);
    expect(r.ok).toBe(true);
    expect(r.rows[0].volume_m3).toBe(2.64);
    expect(r.rows[0].row).toBe(4);
  });

  it("groups totals per element type", () => {
    const r = parse([["slab", "S1", 2, 5, 1.2, 0.2, ""], ["slab", "S2", 1, 4, 1.2, 0.2, ""], ["beam", "B1", 3, 4, 0.3, 0.45, ""]]);
    const slab = r.totals.find((t) => t.element_type === "slab")!;
    expect(slab).toMatchObject({ rows: 2, pieces: 3, volume_m3: 3.36, rule_code: "slb" });
  });

  it("warns on a repeated mark within an element type", () => {
    const r = parse([["slab", "S1", 1, 5, 1.2, 0.2, ""], ["slab", "S1", 1, 5, 1.2, 0.2, ""]]);
    expect(r.ok).toBe(true);
    expect(r.warnings[0].message).toMatch(/already appears in row 2/);
  });
});

describe("row errors", () => {
  it("reports an unknown element type with the accepted list, and keeps good rows", () => {
    const r = parse([["roof_truss", "R1", 1, 5, 1, 0.1, ""], ["slab", "S1", 1, 5, 1.2, 0.2, ""]]);
    expect(r.ok).toBe(false);
    expect(msgs(r)).toMatch(/2: Unknown element type "roof_truss"\. This template accepts: wall_panel, slab/);
    expect(r.rows).toHaveLength(1);
    expect(r.quantities).toHaveLength(1);
  });

  it("validates count and dimensions", () => {
    const r = parse([
      ["slab", "A", 0, 5, 1.2, 0.2, ""],
      ["slab", "B", 1.5, 5, 1.2, 0.2, ""],
      ["slab", "C", 1, -5, 1.2, 0.2, ""],
      ["slab", "D", 1, "abc", 1.2, 0.2, ""],
      ["slab", "E", 1, 500, 1.2, 0.2, ""],
      ["slab", "F", 1, 5, 1.2, 0.2, -3],
      ["slab", "G", 20000, 5, 1.2, 0.2, ""],
    ]);
    expect(r.rows).toHaveLength(0);
    expect(r.errors.filter((e) => e.field === "count")).toHaveLength(3);
    expect(r.errors.filter((e) => e.field === "length_m")).toHaveLength(3);
    expect(r.errors.find((e) => e.field === "weight_t")).toBeTruthy();
  });

  it("rejects a row that cannot give the quantity its line needs", () => {
    const r = parse([["slab", "S1", 1, 5, "", "", ""]]); // slab line is m3; no thickness
    expect(msgs(r)).toMatch(/cannot give volume/);
    const none = parse([["slab", "S2", 1, "", "", "", ""]]);
    expect(msgs(none)).toMatch(/no dimensions or weight/);
  });

  it("rejects a line whose unit a schedule cannot feed", () => {
    const t: EstimateTemplateBody = { ...T, rules: T.rules.map((r) => (r.code === "slb" ? { ...r, uom: "load" } : r)) };
    expect(msgs(parse([["slab", "S1", 1, 5, 1.2, 0.2, ""]], t))).toMatch(/cannot feed/);
  });

  it("reports a missing header, missing dimension columns, an empty sheet and a template with no element types", () => {
    expect(msgs(parseScheduleRows([["a", "b"], [1, 2]], { template: T }))).toMatch(/No header row/);
    expect(msgs(parseScheduleRows([["element_type", "mark"], ["slab", "x"]], { template: T }))).toMatch(/no dimension or weight columns/);
    expect(msgs(parseScheduleRows([HEADER], { template: T }))).toMatch(/no data rows/);
    const none: EstimateTemplateBody = { ...T, rules: T.rules.map((r) => ({ ...r, element_type: undefined })) };
    expect(msgs(parse([["slab", 1, 1, 1, 1, 1, ""]], none))).toMatch(/declares no element types/);
  });

  it("enforces the row limit", () => {
    const rows = Array.from({ length: MAX_SCHEDULE_ROWS + 1 }, (_, i) => ["slab", `S${i}`, 1, 5, 1.2, 0.2, ""]);
    const r = parse(rows);
    expect(r.ok).toBe(false);
    expect(msgs(r)).toMatch(/limit is 2000/);
    expect(r.rows).toHaveLength(0);
  });

  it("does not treat prototype property names in the header as columns", () => {
    const r = parseScheduleRows([["element_type", "constructor", "__proto__", "length_m", "width_m", "thickness_m"], ["slab", "x", "y", 5, 1.2, 0.2]], { template: T });
    expect(r.ok).toBe(true);
    expect(r.rows[0].mark).toBeNull();
  });

  it("copes with odd cell values", () => {
    const r = parseScheduleRows(
      [HEADER, ["slab", { richText: [{ text: "S" }, { text: "1" }] }, 1, { result: 5 }, { text: "1.2" }, 0.2, null]],
      { template: T }
    );
    expect(r.ok).toBe(true);
    expect(r.rows[0].mark).toBe("S1");
    expect(r.rows[0].volume_m3).toBe(1.2);
    expect(parse([["slab", "M".repeat(61), 1, 5, 1.2, 0.2, ""]]).errors[0].field).toBe("mark");
  });
});

describe("with the compute pipeline", () => {
  it("scheduled wall panels replace the formula and flow into downstream lines", () => {
    const sched = parse([["wall_panel", "W-1", 10, 6, 3, 0.2, ""], ["wall_panel", "W-2", 2, 4, 3, 0.2, ""]]);
    expect(sched.ok).toBe(true);
    const base = computeEstimate(T, {});
    const withSchedule = computeEstimate(T, {}, { schedule: sched.quantities });
    if (!base.ok || !withSchedule.ok) throw new Error("compute failed");
    const walls = withSchedule.lines.filter((l) => l.code === "ewp");
    expect(walls.map((l) => l.element_ref)).toEqual(["W-1", "W-2"]);
    expect(walls.map((l) => l.qty)).toEqual([36, 4.8]); // 10*6*3*0.2, 2*4*3*0.2
    expect(withSchedule.lines.find((l) => l.code === "rbr")!.qty).not.toBe(base.lines.find((l) => l.code === "rbr")!.qty);
    // total volume = 36 + 4.8 + slab 42 + beam 13.5 + stairs 1.8 + boundary 14.4 + 7.2
    expect(withSchedule.lines.find((l) => l.code === "mld")!.qty).toBe(119.7);
  });
});

// exceljs is a large module; its first dynamic import can be slow on a cold cache.
vi.setConfig({ testTimeout: 30_000 });

describe("files", () => {
  it("reads CSV, including quoted fields and a UTF-8 BOM", async () => {
    const csv = '﻿element_type,mark,count,length_m,width_m,thickness_m\r\nslab,"S,1",2,5,1.2,0.2\r\n';
    const table = await readScheduleTable(new TextEncoder().encode(csv), "sched.CSV");
    const r = parseScheduleRows(table, { template: T });
    expect(r.ok).toBe(true);
    expect(r.rows[0].mark).toBe("S,1");
  });

  it("rejects an oversize file and unsupported types", async () => {
    await expect(readScheduleTable(new Uint8Array(MAX_SCHEDULE_BYTES + 1), "big.csv")).rejects.toBeInstanceOf(ScheduleFileError);
    await expect(readScheduleTable(new Uint8Array(4), "notes.pdf")).rejects.toThrow(/\.csv or \.xlsx/);
    await expect(readScheduleTable(new Uint8Array([1, 2, 3, 4]), "broken.xlsx")).rejects.toThrow(/Excel workbook/);
  });

  it("the downloadable workbook round-trips through the parser", async () => {
    const buf = await buildScheduleTemplateWorkbook(T);
    const r = await parseScheduleFile(new Uint8Array(buf), "schedule.xlsx", { template: T });
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ element_type: "wall_panel", mark: "W-101", count: 4, volume_m3: 14.4 });
  });

  it("the downloadable CSV round-trips through the parser", async () => {
    const csv = buildScheduleTemplateCsv(T);
    expect(csv.split("\r\n")[0]).toBe("element_type,mark,count,length_m,width_m,thickness_m,weight_t");
    const r = await parseScheduleFile(new TextEncoder().encode(csv), "t.csv", { template: T });
    expect(r.ok).toBe(true);
  });
});

describe("helpers", () => {
  it("maps units to measures", () => {
    expect(basisForUom("m3")).toBe("volume");
    expect(basisForUom("m³")).toBe("volume");
    expect(basisForUom("t")).toBe("weight");
    expect(basisForUom("m2")).toBe("area");
    expect(basisForUom("m")).toBe("length");
    expect(basisForUom("nr")).toBe("count");
    expect(basisForUom("kg")).toBeNull();
  });

  it("lists the element types a template accepts", () => {
    const types = templateElementTypes(T).map((t) => t.element_type);
    expect(types).toEqual(["wall_panel", "slab", "beam", "stair", "boundary_panel"]);
  });
});
