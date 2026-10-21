import { describe, it, expect } from "vitest";
import { parseQtyBreaks, parseQtyBreaksText, serialiseQtyBreaks, validateQtyBreaks, MAX_QTY_BREAKS } from "./qtyBreaks";

describe("parseQtyBreaks (tolerant reader)", () => {
  it("keeps well-formed breaks, sorted and de-duplicated, dropping a quantity of 0 or less", () => {
    expect(parseQtyBreaks([{ from: 50, rate: "900" }, { from: "10" }, { from: 0, rate: 5 }, { from: 10, rate: null }, { from: "x" }, { from: -3, rate: 1 }, null]))
      .toEqual([{ from: 10, rate: null }, { from: 50, rate: 900 }]);
    expect(parseQtyBreaks("nope")).toEqual([]);
    expect(parseQtyBreaks(null)).toEqual([]);
  });

  it("treats a negative rate as no rate", () => {
    expect(parseQtyBreaks([{ from: 5, rate: -2 }])).toEqual([{ from: 5, rate: null }]);
  });
});

describe("validateQtyBreaks (strict writer)", () => {
  it("accepts ascending bands with a rate or a blank rate", () => {
    expect(validateQtyBreaks([{ from: 100, rate: 390 }, { from: 200, rate: null }, { from: "500", rate: "360" }]))
      .toEqual({ ok: true, breaks: [{ from: 100, rate: 390 }, { from: 200, rate: null }, { from: 500, rate: 360 }] });
    expect(validateQtyBreaks(null)).toEqual({ ok: true, breaks: [] });
    expect(validateQtyBreaks([])).toEqual({ ok: true, breaks: [] });
  });

  it("refuses a quantity of 0 or less, a bad rate, and anything not ascending", () => {
    expect(validateQtyBreaks([{ from: 0, rate: 1 }]).ok).toBe(false);
    expect(validateQtyBreaks([{ from: -1, rate: 1 }]).ok).toBe(false);
    expect(validateQtyBreaks([{ from: 10, rate: -1 }]).ok).toBe(false);
    expect(validateQtyBreaks([{ from: 10, rate: "abc" }]).ok).toBe(false);
    expect(validateQtyBreaks([{ from: 100, rate: 1 }, { from: 50, rate: 1 }]).ok).toBe(false);
    expect(validateQtyBreaks([{ from: 100, rate: 1 }, { from: 100, rate: 2 }]).ok).toBe(false);
    expect(validateQtyBreaks("x").ok).toBe(false);
    expect(validateQtyBreaks([null]).ok).toBe(false);
  });

  it("allows 20 bands and refuses 21", () => {
    const n = (count: number) => Array.from({ length: count }, (_, i) => ({ from: i + 1, rate: 1 }));
    expect(validateQtyBreaks(n(MAX_QTY_BREAKS)).ok).toBe(true);
    expect(validateQtyBreaks(n(MAX_QTY_BREAKS + 1)).ok).toBe(false);
  });
});

describe("text form: from:rate; from:rate", () => {
  it("serialises with a blank rate left empty", () => {
    expect(serialiseQtyBreaks([{ from: 100, rate: 390 }, { from: 200, rate: null }, { from: 500, rate: 360.5 }])).toBe("100:390; 200:; 500:360.5");
    expect(serialiseQtyBreaks(null)).toBe("");
  });

  it("parses what it serialises", () => {
    const breaks = [{ from: 100, rate: 390 }, { from: 200, rate: null }, { from: 500, rate: 360.5 }];
    expect(parseQtyBreaksText(serialiseQtyBreaks(breaks))).toEqual({ ok: true, breaks });
  });

  it("is forgiving about spaces, newlines and a trailing semicolon", () => {
    expect(parseQtyBreaksText(" 100 : 390 ;\n500:360; ")).toEqual({ ok: true, breaks: [{ from: 100, rate: 390 }, { from: 500, rate: 360 }] });
    expect(parseQtyBreaksText("")).toEqual({ ok: true, breaks: [] });
    expect(parseQtyBreaksText(null)).toEqual({ ok: true, breaks: [] });
  });

  it("explains a bad cell instead of dropping it", () => {
    const noColon = parseQtyBreaksText("100 390");
    expect(noColon.ok).toBe(false);
    const down = parseQtyBreaksText("500:360; 100:390");
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.error).toMatch(/go up/);
    expect(parseQtyBreaksText("10:abc").ok).toBe(false);
  });
});
