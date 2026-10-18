import { describe, expect, it } from "vitest";
import { computeEstimate } from "./compute";
import type { ComputeSuccess } from "./compute";
import { PRECAST_VILLA_STARTER } from "./starterTemplates";
import { buildCostAllocator, marksForRef, parseMarkRanges, pieceSizeLabel, pieceWeightT, rangesCover } from "./pieceInfo";
import type { AllocLine } from "./pieceInfo";

const r = computeEstimate(PRECAST_VILLA_STARTER, null, { margin_pct: 18, vat_pct: 15 }) as ComputeSuccess;
const pieces = r.model!.pieces;
const lines: AllocLine[] = r.lines.map((l) => ({ code: l.code, description: l.description, uom: l.uom, element_ref: l.element_ref, cost_total: l.cost_total }));

describe("parseMarkRanges", () => {
  it("reads ranges, single marks and ignores junk", () => {
    expect(parseMarkRanges("EW-01..EW-40, PR-03, nope, SL-09..SL-02, EW-01..PR-04")).toEqual([
      { code: "EW", from: 1, to: 40 },
      { code: "PR", from: 3, to: 3 },
      { code: "SL", from: 2, to: 9 },
    ]);
    expect(parseMarkRanges(null)).toEqual([]);
    expect(parseMarkRanges("")).toEqual([]);
  });
});

describe("marksForRef", () => {
  it("returns exactly the pieces of the range, and matches the stored element_ref of every piece line", () => {
    const ew = lines.find((l) => l.code === "ew")!;
    const marks = marksForRef(ew.element_ref, pieces);
    expect(marks.length).toBe(pieces.filter((p) => p.code === "EW").length);
    expect(marks.every((m) => m.startsWith("EW-"))).toBe(true);
    const sl = lines.find((l) => l.code === "sl")!;
    expect(marksForRef(sl.element_ref, pieces).length).toBe(pieces.filter((p) => p.code === "SL").length);
  });
  it("a mark outside the range or another family is not covered", () => {
    const ranges = parseMarkRanges("EW-02..EW-03");
    expect(rangesCover(ranges, { id: "EW-01", code: "EW" })).toBe(false);
    expect(rangesCover(ranges, { id: "EW-02", code: "EW" })).toBe(true);
    expect(rangesCover(ranges, { id: "PR-02", code: "PR" })).toBe(false);
    expect(marksForRef("EW-02..EW-03", [])).toEqual([]);
    expect(marksForRef(null, pieces)).toEqual([]);
  });
});

describe("piece facts", () => {
  it("formats size and weight", () => {
    expect(pieceSizeLabel({ kind: "panel", dims: { w: 2.34, h: 3, t: 0.2 } })).toBe("2.34 × 3.00 × 0.20");
    expect(pieceSizeLabel({ kind: "plank", dims: { w: 1.2, h: 0.2, t: 6 } })).toBe("6.00 × 1.20 × 0.20");
    expect(pieceWeightT({ vol: 2 }, 2.4)).toBeCloseTo(4.8, 9);
  });
});

describe("buildCostAllocator", () => {
  const alloc = buildCostAllocator(pieces, lines);
  const totalCost = lines.reduce((a, l) => a + (l.cost_total ?? 0), 0);

  it("allocates the whole estimate cost over the pieces", () => {
    const sum = pieces.reduce((a, p) => a + alloc(p).cost, 0);
    expect(sum).toBeCloseTo(totalCost, 4);
    expect(pieces.reduce((a, p) => a + alloc(p).share, 0)).toBeCloseTo(1, 6);
  });

  it("names the largest family line as the BOM line, and bigger pieces cost more in a family", () => {
    const ew = pieces.filter((p) => p.code === "EW");
    const a = alloc(ew[0]);
    expect(a.line?.code).toBe("ew");
    const [small, big] = [...ew].sort((x, y) => x.vol - y.vol).filter((_, i, arr) => i === 0 || i === arr.length - 1);
    if (big.vol > small.vol) expect(alloc(big).cost).toBeGreaterThan(alloc(small).cost);
  });

  it("insulation is shared by face area: a panel with no area gets none of it", () => {
    const ins = lines.filter((l) => l.code === "ins");
    const only = buildCostAllocator(pieces, ins);
    const noArea = pieces.find((p) => p.code === "SL")!;
    expect(only(noArea).cost).toBe(0);
    expect(pieces.filter((p) => p.code === "EW").reduce((a, p) => a + only(p).cost, 0)).toBeCloseTo(ins[0].cost_total!, 4);
  });

  it("handles no pieces, no lines and null costs", () => {
    expect(buildCostAllocator([], lines)({ id: "X-01", code: "X", vol: 1 })).toEqual({ cost: 0, share: 0, line: null });
    expect(buildCostAllocator(pieces, [])(pieces[0]).cost).toBe(0);
    const nulls = buildCostAllocator(pieces, [{ ...lines[0], cost_total: null }]);
    expect(nulls(pieces[0]).cost).toBe(0);
  });
});
