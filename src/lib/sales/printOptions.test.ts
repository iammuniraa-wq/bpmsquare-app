import { describe, it, expect } from "vitest";
import { linesForPdf, parsePrintOptions, isDefaultPrintOptions } from "./printOptions";
import { parseQtyBreaks } from "./qtyBreaks";

const L = (id: string, extra: Record<string, unknown> = {}) => ({ id, amount: 100, ...extra });
const ALL = { alternatives: "all" as const, breaks: "all" as const };
const CHOSEN = { alternatives: "chosen" as const, breaks: "all" as const };

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
    expect(linesForPdf(alt, ALL).map((l) => l.id)).toEqual(["a", "b"]);
    expect(linesForPdf(alt, CHOSEN).map((l) => l.id)).toEqual(["a"]);
  });

  it("prints the base line and every OFFERED break, never an unticked one", () => {
    const brk = [
      L("base", { is_selected: false }), // legacy flag from the old chosen-break model: the base still prints
      L("b10", { break_of: "base", break_qty: 10, is_selected: true }),
      L("b50", { break_of: "base", break_qty: 50, is_selected: false }),
      L("b100", { break_of: "base", break_qty: 100 }), // absent = offered
    ];
    expect(linesForPdf(brk, ALL).map((l) => l.id)).toEqual(["base", "b10", "b100"]);
    expect(linesForPdf(brk, { alternatives: "all", breaks: "chosen" }).map((l) => l.id)).toEqual(["base", "b10", "b100"]); // `breaks` no longer applies
  });

  it("never prints a line the rep hid, even a charged one", () => {
    const lines = [L("x", { show_on_pdf: false }), L("y")];
    expect(linesForPdf(lines, ALL).map((l) => l.id)).toEqual(["y"]);
  });

  it("an offered break inside an unchosen option follows the option", () => {
    const lines = [
      L("a", { group_id: "g1", group_type: "alternative", is_selected: true }),
      L("a2", { group_id: "g1", group_type: "alternative", break_of: "a", break_qty: 2, is_selected: true }),
      L("a5", { group_id: "g1", group_type: "alternative", break_of: "a", break_qty: 5, is_selected: true, show_on_pdf: false }),
      L("b", { group_id: "g2", group_type: "alternative", is_selected: false }),
      L("b10", { group_id: "g2", group_type: "alternative", break_of: "b", break_qty: 10, is_selected: true }),
    ];
    expect(linesForPdf(lines, CHOSEN).map((l) => l.id)).toEqual(["a", "a2"]);
    expect(linesForPdf(lines, ALL).map((l) => l.id)).toEqual(["a", "a2", "b", "b10"]);
  });
});

describe("parseQtyBreaks", () => {
  it("keeps well-formed breaks, sorted, without the base quantity or duplicates", () => {
    expect(parseQtyBreaks([{ from: 50, rate: "900" }, { from: "10" }, { from: 1, rate: 5 }, { from: 10, rate: null }, { from: "x" }, null]))
      .toEqual([{ from: 10, rate: null }, { from: 50, rate: 900 }]);
    expect(parseQtyBreaks("nope")).toEqual([]);
  });
});
