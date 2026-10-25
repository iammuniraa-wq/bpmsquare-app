import { describe, expect, it } from "vitest";
import { linesVersion, naturalCompare, sortDealLines } from "./dealLines";
import { orderByBoq } from "@/lib/tender/boq/lineSync";
import { editorUom, uomChoices } from "./uom";
import { UOM_OPTIONS } from "@/lib/constants";

describe("the order of a deal's lines", () => {
  it("sorts item numbers as numbers, so 1.10 follows 1.9", () => {
    const lines = ["1.10", "1.2", "1.1", "1.9", "2", "10", "1"].map((sl_no) => ({ sl_no }));
    expect(sortDealLines(lines).map((l) => l.sl_no)).toEqual(["1", "1.1", "1.2", "1.9", "1.10", "2", "10"]);
  });

  it("is stable for equal or missing numbers, and a standard deal's plain 1..N is unchanged", () => {
    const lines = [{ sl_no: null, d: "a" }, { sl_no: "", d: "b" }, { sl_no: "1", d: "c" }];
    expect(sortDealLines(lines).map((l) => l.d)).toEqual(["a", "b", "c"]);
    expect(naturalCompare("9", "10")).toBeLessThan(0);
  });

  it("the BOQ order puts file rows first in the file's sequence, and lines added by hand after them", () => {
    const rows = new Map([["a", 14], ["b", 8], ["c", 11]]);
    const lines = [{ id: "x" }, { id: "a" }, { id: "b" }, { id: "c" }];
    expect(orderByBoq(lines, rows).map((l) => l.id)).toEqual(["b", "c", "a", "x"]);
    expect(orderByBoq(lines, new Map()).map((l) => l.id)).toEqual(["x", "a", "b", "c"]);
  });
});

describe("the fingerprint of the saved lines", () => {
  const base = { id: "l1", description: "Pipe", uom: "m", qty: 10, rate: 5, discount_pct: 0, amount: 50 };
  it("is the same for the same lines in any order, and changes when a line is priced, replaced, reworded or removed", () => {
    const other = { ...base, id: "l2", description: "Valve" };
    const v = linesVersion([base, other]);
    expect(linesVersion([other, base])).toBe(v);
    expect(linesVersion([{ ...base, rate: 6, amount: 60 }, other])).not.toBe(v);
    expect(linesVersion([{ ...base, id: "l3" }, other])).not.toBe(v);
    expect(linesVersion([{ ...base, description: "Pipe, steel" }, other])).not.toBe(v);
    expect(linesVersion([base])).not.toBe(v);
  });

  it("reads numbers the way the database and the JSON do", () => {
    expect(linesVersion([{ ...base, qty: "10.00", rate: "5", amount: "50.0" }])).toBe(linesVersion([base]));
  });
});

describe("units in the Lines editor", () => {
  it("maps obvious synonyms to the option that means the same, only where the list has one", () => {
    expect(editorUom("no")).toBe("Nos");
    expect(editorUom("NO.")).toBe("Nos");
    expect(editorUom("m")).toBe("Mtr");
    expect(editorUom("lot")).toBe("Lot");
    expect(editorUom("kg")).toBe("Kg");
    expect(editorUom("Mtr")).toBe("Mtr");
  });

  it("keeps a unit that has no equivalent, as written, instead of turning it into Nos", () => {
    expect(editorUom("m3")).toBe("m3");
    expect(editorUom("sq.m")).toBe("sq.m");
    expect(editorUom("  m2 ")).toBe("m2");
    expect(editorUom(null)).toBe("Nos");
    expect(editorUom("")).toBe("Nos");
  });

  it("offers the line's own unit as an extra choice when it is not in the list, and nothing extra when it is", () => {
    expect(uomChoices("m3")).toEqual([...UOM_OPTIONS, "m3"]);
    expect(uomChoices("Mtr")).toEqual([...UOM_OPTIONS]);
  });

  it("the Lines editor builds its unit list from the line's own value", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/sales/DocumentLinesEditor.tsx", "utf8");
    expect(src).toMatch(/uomChoices\(line\.uom\)\.map/);
  });
});
