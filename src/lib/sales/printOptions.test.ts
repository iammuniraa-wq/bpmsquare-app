import { describe, it, expect } from "vitest";
import { linesForPdf, parsePrintOptions, isDefaultPrintOptions } from "./printOptions";
import { parseQtyBreaks } from "./qtyBreaks";

const L = (id: string, extra: Record<string, unknown> = {}) => ({ id, amount: 100, ...extra });

describe("parsePrintOptions", () => {
  it("defaults anything missing or malformed to 'all'", () => {
    expect(parsePrintOptions(null)).toEqual({ alternatives: "all", breaks: "all" });
    expect(parsePrintOptions({ alternatives: "chosen", breaks: "nonsense" })).toEqual({ alternatives: "chosen", breaks: "all" });
    expect(isDefaultPrintOptions(parsePrintOptions(undefined))).toBe(true);
  });
});

describe("linesForPdf", () => {
  const alt = [
    L("a", { group_id: "g1", group_type: "alternative", is_selected: true }),
    L("b", { group_id: "g2", group_type: "alternative", is_selected: false }),
  ];
  it("prints the unchosen option only when alternatives = all", () => {
    expect(linesForPdf(alt, { alternatives: "all", breaks: "all" }).map((l) => l.id)).toEqual(["a", "b"]);
    expect(linesForPdf(alt, { alternatives: "chosen", breaks: "all" }).map((l) => l.id)).toEqual(["a"]);
  });

  const brk = [
    L("base", { is_selected: false }),
    L("b10", { break_of: "base", break_qty: 10, is_selected: true }),
    L("b50", { break_of: "base", break_qty: 50, is_selected: false }),
  ];
  it("prints unchosen quantities (including the base) only when breaks = all", () => {
    expect(linesForPdf(brk, { alternatives: "all", breaks: "all" }).map((l) => l.id)).toEqual(["base", "b10", "b50"]);
    expect(linesForPdf(brk, { alternatives: "all", breaks: "chosen" }).map((l) => l.id)).toEqual(["b10"]);
  });

  it("never prints a line the rep hid, even a charged one", () => {
    const lines = [L("x", { show_on_pdf: false }), L("y")];
    expect(linesForPdf(lines, { alternatives: "all", breaks: "all" }).map((l) => l.id)).toEqual(["y"]);
  });

  it("a break inside an unchosen option follows the alternatives rule first", () => {
    const lines = [
      L("a", { group_id: "g1", group_type: "alternative", is_selected: true }),
      L("b", { group_id: "g2", group_type: "alternative", is_selected: false }),
      L("b10", { group_id: "g2", group_type: "alternative", break_of: "b", break_qty: 10, is_selected: false }),
    ];
    expect(linesForPdf(lines, { alternatives: "chosen", breaks: "all" }).map((l) => l.id)).toEqual(["a"]);
    expect(linesForPdf(lines, { alternatives: "all", breaks: "chosen" }).map((l) => l.id)).toEqual(["a"]);
    expect(linesForPdf(lines, { alternatives: "all", breaks: "all" }).map((l) => l.id)).toEqual(["a", "b", "b10"]);
  });
});

describe("parseQtyBreaks", () => {
  it("keeps well-formed breaks, sorted, without the base quantity or duplicates", () => {
    expect(parseQtyBreaks([{ from: 50, rate: "900" }, { from: "10" }, { from: 1, rate: 5 }, { from: 10, rate: null }, { from: "x" }, null]))
      .toEqual([{ from: 10, rate: null }, { from: 50, rate: 900 }]);
    expect(parseQtyBreaks("nope")).toEqual([]);
  });
});
