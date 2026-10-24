import { describe, expect, it } from "vitest";
import { parseDxf, unitFromCode, plainMtext } from "./dxf";
import { arcSweepDeg, measureByLayer, measureRule, netArea, pointInPolygon, polyArea, polyLength } from "./measure";
import { MAX_DXF_BYTES } from "./model";
import { arc, circle, dxfFile, insert, line, lwpoly, mtext, rectLines, spline, text } from "./testing/dxfFixtures";

const read = (s: string) => {
  const r = parseDxf(s);
  if (!r.ok) throw new Error(r.error);
  return r.model;
};
const row = (t: ReturnType<typeof measureByLayer>, layer: string) => t.rows.find((r) => r.layer === layer)!;

describe("reading a DXF", () => {
  it("reads layers, entities and the unit", () => {
    const m = read(dxfFile({ units: 4, layers: [{ name: "FENCE", colorIndex: 3 }, { name: "NOTES", frozen: true }], entities: [line("FENCE", 0, 0, 10, 0), text("NOTES", 1, 1, 2, "North boundary")] }));
    expect(m.unit).toEqual({ code: 4, name: "millimetres", factor: 0.001 });
    expect(m.layers.map((l) => [l.name, l.hidden])).toEqual([["FENCE", false], ["NOTES", true]]);
    expect(m.layers[0].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(m.entities.map((e) => e.t)).toEqual(["line", "text"]);
    expect(m.extents).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 0 });
  });

  it("asks when the drawing does not state its units", () => {
    const m = read(dxfFile({ entities: [line("A", 0, 0, 1, 0)] }));
    expect(m.unit.factor).toBeNull();
    expect(m.warnings.join(" ")).toMatch(/does not say what its units are/);
    expect(unitFromCode(6).factor).toBe(1);
    expect(unitFromCode(0).factor).toBeNull();
    expect(unitFromCode(99).factor).toBeNull();
  });

  it("never throws: empty, binary, oversized and garbage input come back as an error sentence", () => {
    expect(parseDxf("")).toMatchObject({ ok: false });
    expect(parseDxf(Buffer.from("AutoCAD Binary DXF\r\n\x1a\x00"))).toMatchObject({ ok: false, error: expect.stringMatching(/binary DXF/) });
    expect(parseDxf(new Uint8Array(MAX_DXF_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/limit is 15 MB/) });
    expect(parseDxf("this is not a drawing at all")).toMatchObject({ ok: false });
    expect(parseDxf("  0\nSECTION\n  2\nENTITIES\n  0\nLINE\n  8\n")).toBeDefined();
  });

  it("flags curved polylines and counts what it could not read", () => {
    const m = read(dxfFile({ units: 6, entities: [lwpoly("A", [[0, 0, 0.5], [4, 0]]), spline("A"), spline("B")] }));
    expect(m.warnings.join(" ")).toMatch(/curved segments/);
    expect(m.warnings.join(" ")).toMatch(/2 spline/);
    expect(m.skipped.SPLINE).toBe(2);
  });

  it("strips MTEXT formatting", () => {
    expect(plainMtext("{\\fArial|b0;GATE}\\PType A")).toBe("GATE Type A");
    const m = read(dxfFile({ units: 6, entities: [mtext("T", 0, 0, 1, "{\\fArial;North}\\Pgate")] }));
    expect(m.entities[0]).toMatchObject({ t: "text", text: "North gate" });
  });

  it("keeps only the blocks that are inserted", () => {
    const m = read(dxfFile({ units: 6, blocks: { GATE: [line("0", 0, 0, 2, 0)], UNUSED: [line("0", 0, 0, 9, 9)] }, entities: [insert("GATES", "GATE", 5, 5)] }));
    expect(Object.keys(m.blocks)).toEqual(["GATE"]);
  });
});

describe("measuring by layer", () => {
  it("a 10 x 5 m rectangle on FENCE, drawn in millimetres, is 30 m", () => {
    const m = read(dxfFile({ units: 4, entities: rectLines("FENCE", 10_000, 5_000) }));
    const t = measureByLayer(m, m.unit.factor);
    expect(row(t, "FENCE").lengthM).toBeCloseTo(30, 9);
    expect(row(t, "FENCE").entities).toBe(4);
  });

  it("a closed polyline counts its perimeter, an open one does not close", () => {
    const m = read(dxfFile({ units: 6, entities: [lwpoly("A", [[0, 0], [10, 0], [10, 5], [0, 5]], true), lwpoly("B", [[0, 0], [10, 0], [10, 5], [0, 5]], false)] }));
    const t = measureByLayer(m, 1);
    expect(row(t, "A").lengthM).toBeCloseTo(30, 9);
    expect(row(t, "A").areaM2).toBeCloseTo(50, 9);
    expect(row(t, "B").lengthM).toBeCloseTo(25, 9);
    expect(row(t, "B").areaM2).toBe(0);
  });

  it("treats a polyline whose end meets its start as closed for area", () => {
    const m = read(dxfFile({ units: 6, entities: [lwpoly("A", [[0, 0], [4, 0], [4, 3], [0, 3], [0, 0]], false)] }));
    expect(row(measureByLayer(m, 1), "A").areaM2).toBeCloseTo(12, 9);
  });

  it("measures arcs and circles", () => {
    const m = read(dxfFile({ units: 6, entities: [arc("ARCS", 0, 0, 10, 0, 90), arc("ARCS", 0, 0, 10, 270, 90), circle("HOLES", 0, 0, 2)] }));
    const t = measureByLayer(m, 1);
    expect(row(t, "ARCS").lengthM).toBeCloseTo((Math.PI * 10) / 2 + Math.PI * 10, 6);
    expect(row(t, "HOLES").lengthM).toBeCloseTo(4 * Math.PI, 6);
    expect(row(t, "HOLES").areaM2).toBeCloseTo(4 * Math.PI, 6);
    expect(arcSweepDeg(270, 90)).toBe(180);
    expect(arcSweepDeg(0, 360)).toBe(360);
  });

  it("nets a closed shape wholly inside another on the same layer out of the area, and only then", () => {
    const outer = lwpoly("SLAB", [[0, 0], [10, 0], [10, 10], [0, 10]], true);
    const hole = lwpoly("SLAB", [[2, 2], [4, 2], [4, 4], [2, 4]], true);
    const island = lwpoly("SLAB", [[2.5, 2.5], [3.5, 2.5], [3.5, 3.5], [2.5, 3.5]], true);
    const other = lwpoly("OTHER", [[2, 2], [4, 2], [4, 4], [2, 4]], true);
    const m = read(dxfFile({ units: 6, entities: [outer, hole, other] }));
    const t = measureByLayer(m, 1);
    expect(row(t, "SLAB").areaM2).toBeCloseTo(100 - 4, 9);
    expect(row(t, "OTHER").areaM2).toBeCloseTo(4, 9);
    const nested = measureByLayer(read(dxfFile({ units: 6, entities: [outer, hole, island] })), 1);
    expect(row(nested, "SLAB").areaM2).toBeCloseTo(100 - 4 + 1, 9);
    // Partly overlapping shapes are not netted.
    const overlap = lwpoly("SLAB", [[8, 8], [12, 8], [12, 12], [8, 12]], true);
    expect(row(measureByLayer(read(dxfFile({ units: 6, entities: [outer, overlap] })), 1), "SLAB").areaM2).toBeCloseTo(116, 9);
  });

  it("counts block inserts by name (an array insert counts rows x columns)", () => {
    const ents = [insert("GATES", "GATE", 0, 0), insert("GATES", "GATE", 10, 0), insert("GATES", "gate", 20, 0), insert("GATES", "GATE", 30, 0), insert("POSTS", "POST", 0, 5, { cols: 3, rows: 2 })];
    const t = measureByLayer(read(dxfFile({ units: 6, blocks: { GATE: [line("0", 0, 0, 2, 0)], POST: [line("0", 0, 0, 0, 1)] }, entities: ents })), 1);
    expect(row(t, "GATES").blocks).toEqual({ GATE: 4 });
    expect(row(t, "POSTS").blocks).toEqual({ POST: 6 });
  });

  it("leaves metres empty while the unit is unknown, but keeps the drawing-unit numbers", () => {
    const m = read(dxfFile({ entities: [line("A", 0, 0, 7, 0)] }));
    const t = measureByLayer(m);
    expect(t.factor).toBeNull();
    expect(row(t, "A")).toMatchObject({ length: 7, lengthM: null, areaM2: null });
    expect(measureByLayer(m, 0.5).rows[0].lengthM).toBe(3.5);
  });

  it("is safe with block and layer names that are also object property names", () => {
    const m = read(dxfFile({ units: 6, blocks: { constructor: [line("0", 0, 0, 1, 0)] }, entities: [insert("__proto__", "constructor", 0, 0), insert("__proto__", "constructor", 1, 0)] }));
    const t = measureByLayer(m, 1);
    expect(row(t, "__proto__").blocks).toEqual({ constructor: 2 });
  });
});

describe("measuring one rule of the layer map", () => {
  const model = read(dxfFile({ units: 4, entities: [...rectLines("Fence", 10_000, 5_000), ...rectLines("FENCE-2", 1_000, 1_000), insert("Gates", "Gate-D", 0, 0), insert("Gates", "Gate-D", 5, 0), insert("Gates", "Gate-S", 9, 0), lwpoly("Slab", [[0, 0], [2000, 0], [2000, 1000], [0, 1000]], true)], blocks: { "Gate-D": [line("0", 0, 0, 1, 0)], "Gate-S": [line("0", 0, 0, 1, 0)] } }));
  const table = measureByLayer(model, model.unit.factor);

  it("sums lengths over the named layers, ignoring case", () => {
    expect(measureRule(table, { input: "len", measure: "length_m", layers: ["FENCE", "fence-2"] })).toMatchObject({ value: 34, matched: expect.arrayContaining(["Fence", "FENCE-2"]) });
    expect(measureRule(table, { input: "len", measure: "length_m", layers: ["fence"] }).value).toBeCloseTo(30, 9);
  });
  it("measures area from closed shapes in square metres", () => {
    expect(measureRule(table, { input: "a", measure: "area_m2", layers: ["slab"] }).value).toBeCloseTo(2, 9);
  });
  it("counts the named blocks, or every block on the layers", () => {
    expect(measureRule(table, { input: "g", measure: "count", blocks: ["gate-d"] })).toMatchObject({ value: 2, matched: ["Gates"] });
    expect(measureRule(table, { input: "g", measure: "count", layers: ["Gates"] }).value).toBe(3);
    expect(measureRule(table, { input: "g", measure: "count", blocks: ["NOPE"] }).value).toBeNull();
  });
  it("says so when the layer is not in the drawing, or has nothing of that kind", () => {
    const missing = measureRule(table, { input: "len", measure: "length_m", layers: ["BOUNDARY"] });
    expect(missing.value).toBeNull();
    expect(missing.absent).toEqual(["BOUNDARY"]);
    expect(missing.note).toMatch(/No layer BOUNDARY/);
    expect(measureRule(table, { input: "a", measure: "area_m2", layers: ["Fence"] }).note).toMatch(/closed/);
  });
  it("a rule's own scale replaces the drawing's units; unknown units without one give no number", () => {
    expect(measureRule(table, { input: "len", measure: "length_m", layers: ["Fence"], scale: 0.01 }).value).toBeCloseTo(300, 9);
    const unknown = measureByLayer(read(dxfFile({ entities: [line("A", 0, 0, 10, 0)] })));
    expect(measureRule(unknown, { input: "len", measure: "length_m", layers: ["A"] })).toMatchObject({ value: null, note: expect.stringMatching(/units/) });
    expect(measureRule(unknown, { input: "len", measure: "length_m", layers: ["A"], scale: 0.001 }).value).toBeCloseTo(0.01, 12);
    expect(measureRule(unknown, { input: "a", measure: "area_m2", layers: ["A"], scale: 2 }).note).toMatch(/closed/);
  });
});

describe("geometry helpers", () => {
  it("polyLength, polyArea, pointInPolygon, netArea", () => {
    const sq: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
    expect(polyLength(sq, true)).toBe(8);
    expect(polyLength(sq, false)).toBe(6);
    expect(polyArea(sq)).toBe(4);
    expect(pointInPolygon([1, 1], sq)).toBe(true);
    expect(pointInPolygon([3, 1], sq)).toBe(false);
    expect(netArea([])).toBe(0);
  });
});
