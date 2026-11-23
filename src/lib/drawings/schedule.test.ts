import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { ELEMENT_READERS, findHeaderRow, ifcReader, parseCsv, readerFor, scheduleReader, suggestMap, unitInHeader, unitsToConfirm, type ReadResult } from "./schedule";

const csv = (s: string) => new TextEncoder().encode(s);
const ok = (r: ReadResult) => { if (!r.ok) throw new Error(r.error); return r; };

describe("reading a CSV", () => {
  it("handles quotes, embedded commas and semicolon files", () => {
    expect(parseCsv('Mark,Type\nP1,"Panel, wall"\nP2,"He said ""hi"""\n')).toEqual([["Mark", "Type"], ["P1", "Panel, wall"], ["P2", 'He said "hi"']]);
    expect(parseCsv("Mark;Type\nP1;Slab")).toEqual([["Mark", "Type"], ["P1", "Slab"]]);
    expect(parseCsv("﻿Mark\tType\r\nP1\tSlab\r\n")).toEqual([["Mark", "Type"], ["P1", "Slab"]]);
  });
});

describe("finding the columns", () => {
  it("suggests a map from the usual Revit schedule headers", () => {
    const m = suggestMap(["Mark", "Family and Type", "Level", "Count", "Volume (m³)", "Area (m²)", "Length (mm)", "Weight (kg)", "GlobalId", "Building"]);
    expect(m).toMatchObject({ element_code: "Mark", element_type: "Family and Type", level: "Level", qty: "Count", volume_m3: "Volume (m³)", area_m2: "Area (m²)", length_m: "Length (mm)", weight_t: "Weight (kg)", model_uid: "GlobalId", building: "Building" });
  });
  it("skips title rows to find the header", () => {
    expect(findHeaderRow([["Project X precast schedule"], [], ["Mark", "Type", "Count"], ["P1", "Slab", 2]])).toBe(2);
  });
  it("reads the unit a header states", () => {
    expect(unitInHeader("Volume (m³)", "volume")).toBe("m³");
    expect(unitInHeader("Weight [kg]", "weight")).toBe("kg");
    expect(unitInHeader("Length mm", "length")).toBe("mm");
    expect(unitInHeader("Volume", "volume")).toBeNull();
  });
});

describe("the schedule reader", () => {
  const FILE = [
    "Precast schedule,,,,,",
    "Mark,Type,Building,Count,Volume (m3),Weight (kg)",
    "WP-001,Wall panel,B1,4,2.5,6250",
    "WP-002,Wall panel,B1,2,3,",
    "SL-001,Slab,B2,1,10,25000",
    "Total,,,7,,",
    ",,,,,",
  ].join("\n");

  it("turns rows into elements, converts units, calculates a missing weight and skips the total row", async () => {
    const r = ok(await scheduleReader.read({ name: "s.csv", bytes: csv(FILE) }));
    expect(r.elements).toHaveLength(3);
    expect(r.skipped).toBe(1);
    expect(r.elements[0]).toMatchObject({ element_code: "WP-001", element_type: "Wall panel", building: "B1", qty: 4, volume_m3: 2.5, weight_t: 6.25, weight_calculated: false });
    // no weight in the file: volume x 2.5 t/m3, marked as calculated
    expect(r.elements[1]).toMatchObject({ element_code: "WP-002", weight_t: 7.5, weight_calculated: true });
    expect(r.units.weight).toEqual({ unit: "kg", assumed: false });
    expect(r.units.volume).toEqual({ unit: "m3", assumed: false });
  });

  it("a unit the file does not state is assumed and must be confirmed", async () => {
    const r = ok(await scheduleReader.read({ name: "s.csv", bytes: csv("Mark,Count,Volume\nA,1,2\n") }));
    expect(r.units.volume).toEqual({ unit: "m3", assumed: true });
    expect(unitsToConfirm(r)).toEqual(["volume"]);
    const confirmed = ok(await scheduleReader.read({ name: "s.csv", bytes: csv("Mark,Count,Volume\nA,1,2000000\n"), map: { columns: {}, units: { volume: "cm3" } } }));
    expect(confirmed.elements[0].volume_m3).toBeCloseTo(2, 6);
    expect(unitsToConfirm(confirmed)).toEqual([]);
  });

  it("a column that is not in the file is not a unit to confirm", async () => {
    const r = ok(await scheduleReader.read({ name: "s.csv", bytes: csv("Mark,Count\nA,1\n") }));
    expect(unitsToConfirm(r)).toEqual([]);
  });

  it("an explicit column map overrides the suggestion", async () => {
    const r = ok(await scheduleReader.read({ name: "s.csv", bytes: csv("Tag,Description,No\nT1,Beam,3\n"), map: { columns: { element_code: "Tag", element_type: "Description", qty: "No" } } }));
    expect(r.elements[0]).toMatchObject({ element_code: "T1", element_type: "Beam", qty: 3 });
  });

  it("refuses a file that cannot follow elements from one revision to the next", async () => {
    const r = await scheduleReader.read({ name: "s.csv", bytes: csv("Type,Count\nSlab,2\n") });
    expect(r).toMatchObject({ ok: false });
  });

  it("repeated model ids and rows with no code are skipped and said so; repeated codes warn", async () => {
    const r = ok(await scheduleReader.read({ name: "s.csv", bytes: csv("GlobalId,Mark,Count\ng1,A,1\ng1,B,1\n,,2\ng3,C,1\n,A,1\n") }));
    expect(r.elements.map((e) => e.model_uid ?? e.element_code)).toEqual(["g1", "g3", "A"]);
    expect(r.warnings.some((w) => /appears twice/.test(w.message))).toBe(true);
    expect(r.skipped).toBe(2);
  });

  it("a count of zero or text is skipped, not loaded as one piece", async () => {
    const r = ok(await scheduleReader.read({ name: "s.csv", bytes: csv("Mark,Count\nA,0\nB,x\nC,2\n") }));
    expect(r.elements.map((e) => e.element_code)).toEqual(["C"]);
  });

  it("reads an Excel workbook too", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Schedule");
    ws.addRow(["Mark", "Type", "Count", "Volume (m3)"]);
    ws.addRow(["WP-001", "Wall panel", 3, 1.5]);
    ws.addRow(["WP-002", "Wall panel", 1, { formula: "1+1", result: 2 }]);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const r = ok(await scheduleReader.read({ name: "s.xlsx", bytes: buf }));
    expect(r.sheet).toBe("Schedule");
    expect(r.elements.map((e) => [e.element_code, e.qty, e.volume_m3])).toEqual([["WP-001", 3, 1.5], ["WP-002", 1, 2]]);
  });

  it("a broken file is an error, never a crash", async () => {
    expect(await scheduleReader.read({ name: "s.xlsx", bytes: csv("not a workbook") })).toMatchObject({ ok: false });
    expect(await scheduleReader.read({ name: "s.pdf", bytes: csv("x") })).toMatchObject({ ok: false });
  });
});

describe("readers behind one interface", () => {
  it("IFC is designed but not built: it is listed as unavailable with the reason, and never reads", async () => {
    expect(ifcReader.available).toBe(false);
    expect(ifcReader.unavailableReason).toMatch(/later step/);
    expect(await ifcReader.read({ name: "m.ifc", bytes: csv("ISO-10303-21;") })).toMatchObject({ ok: false });
    expect(readerFor("model.IFC")?.id).toBe("ifc");
    expect(readerFor("s.xlsx")?.id).toBe("schedule");
    expect(readerFor("plan.pdf")).toBeNull();
    expect(ELEMENT_READERS.map((x) => x.id)).toEqual(["schedule", "ifc"]);
  });
});
