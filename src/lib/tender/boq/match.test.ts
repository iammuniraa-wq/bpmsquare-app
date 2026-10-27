import { describe, expect, it } from "vitest";
import { MIN_SCORE, STRONG_SCORE, bandFor, createMatcher, suggestProducts, tokens, type MatchProduct } from "./match";

const P = (id: string, name: string, sku: string | null = null, uom: string | null = null): MatchProduct => ({ id, name, sku, uom });

const catalog = [
  P("gate100", "Gate valve 100mm DN100", "GV-100", "Nos"),
  P("gate50", "Gate valve 50mm DN50", "GV-050", "Nos"),
  P("pipe", "HDPE pipe PN10 110mm", "HD-110", "Mtr"),
  P("fence", "Chain link fence 2.4m high", "CLF-24", "Mtr"),
  P("paint", "Epoxy paint grey", "EP-GR", "Ltr"),
];

describe("matching a BOQ line to a product", () => {
  it("an exact SKU in the cost code is a strong match at 100, whatever the description says", () => {
    const [top] = suggestProducts({ description: "Item per drawing 7", cost_code: "gv 100" }, catalog);
    expect(top.product_id).toBe("gate100");
    expect(top.score).toBe(100);
    expect(top.band).toBe("strong");
    expect(top.reason).toMatch(/SKU/);
  });

  it("ignores spaces, case and punctuation when comparing a SKU", () => {
    expect(suggestProducts({ description: "x", cost_code: "GV-100" }, catalog)[0].product_id).toBe("gate100");
    expect(suggestProducts({ description: "x", cost_code: "g v 1 0 0" }, catalog)[0].product_id).toBe("gate100");
  });

  it("a SKU written inside the description is strong", () => {
    const [top] = suggestProducts({ description: "Supply of HD-110 for the main line" }, catalog);
    expect(top.product_id).toBe("pipe");
    expect(top.band).toBe("strong");
  });

  it("a description that says the same thing as the name is strong; the unit adds a small bonus on top", () => {
    const without = suggestProducts({ description: "Supply and install gate valve 100mm DN100" }, catalog)[0];
    const withUnit = suggestProducts({ description: "Supply and install gate valve 100mm DN100", uom: "no" }, catalog)[0];
    expect(without.product_id).toBe("gate100");
    expect(without.band).toBe("strong");
    expect(withUnit.score).toBe(without.score + 5);
    expect(withUnit.reason).toMatch(/same unit/);
  });

  it("a partial description is a possible match, not a strong one", () => {
    const [top] = suggestProducts({ description: "Chain link fence, galvanised" }, catalog);
    expect(top.product_id).toBe("fence");
    expect(top.band).toBe("possible");
    expect(top.score).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(top.score).toBeLessThan(STRONG_SCORE);
  });

  it("the same words with a different size never read as strong, and rank below the product with the right size", () => {
    const found = suggestProducts({ description: "Gate valve 80mm DN80" }, catalog);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) expect(f.band).toBe("possible");
    const right = suggestProducts({ description: "Gate valve 50mm DN50" }, catalog);
    expect(right[0].product_id).toBe("gate50");
    expect(right[1].product_id).toBe("gate100");
    expect(right[0].score).toBeGreaterThan(right[1].score);
  });

  it("the unit alone never makes a match: below the threshold the line gets nothing", () => {
    expect(suggestProducts({ description: "Mobilisation and demobilisation", uom: "Nos" }, catalog)).toEqual([]);
    expect(suggestProducts({ description: "Valve", uom: "Nos" }, catalog)).toEqual([]);
    expect(suggestProducts({ description: "" }, catalog)).toEqual([]);
    expect(suggestProducts({ description: "anything" }, [])).toEqual([]);
  });

  it("offers at most three, best first, and each product once", () => {
    const many = [P("a", "Steel pipe 100mm"), P("b", "Steel pipe 100mm heavy"), P("c", "Steel pipe 100mm class B"), P("d", "Steel pipe 100mm class C"), P("e", "Pipe")];
    const found = suggestProducts({ description: "Steel pipe 100mm" }, many);
    expect(found).toHaveLength(3);
    expect(new Set(found.map((f) => f.product_id)).size).toBe(3);
    expect(found.map((f) => f.score)).toEqual([...found.map((f) => f.score)].sort((x, y) => y - x));
    expect(suggestProducts({ description: "Steel pipe 100mm" }, many, 1)).toHaveLength(1);
  });

  it("equal scores keep the catalog order, every time", () => {
    const twins = [P("first", "Cable tray 300mm"), P("second", "Cable tray 300mm"), P("third", "Cable tray 300mm")];
    const a = suggestProducts({ description: "Cable tray 300mm" }, twins).map((s) => s.product_id);
    const b = suggestProducts({ description: "Cable tray 300mm" }, twins).map((s) => s.product_id);
    expect(a).toEqual(["first", "second", "third"]);
    expect(b).toEqual(a);
  });

  it("a SKU hit beats a name hit on another product", () => {
    const found = suggestProducts({ description: "Gate valve 100mm DN100", cost_code: "GV-050" }, catalog);
    expect(found[0].product_id).toBe("gate50");
    expect(found[0].score).toBe(100);
    expect(found.some((f) => f.product_id === "gate100")).toBe(true);
  });

  it("bands split at the strong threshold", () => {
    expect(bandFor(STRONG_SCORE)).toBe("strong");
    expect(bandFor(STRONG_SCORE - 1)).toBe("possible");
  });

  it("a matcher built once answers many lines the same as a one-off call", () => {
    const m = createMatcher(catalog);
    for (const d of ["Gate valve 100mm DN100", "Epoxy paint grey two coats", "HDPE pipe 110mm"]) {
      expect(m({ description: d })).toEqual(suggestProducts({ description: d }, catalog));
    }
  });

  it("reads units and plurals sensibly", () => {
    expect(tokens("Supply & install 100mm gate valves")).toEqual(["100", "mm", "gate", "valve"]);
    expect(tokens("DN100")).toEqual(["dn", "100"]);
  });

  it("carries no cost or price: a suggestion is an id, a score, a band and a reason", () => {
    const [top] = suggestProducts({ description: "Gate valve 100mm DN100" }, catalog);
    expect(Object.keys(top).sort()).toEqual(["band", "product_id", "reason", "score"]);
  });
});
