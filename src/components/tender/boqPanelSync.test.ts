import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// EST-09: the BOQ line panel stays open while an estimate part is replaced or the last link is removed. Its Cost / unit and Rate inputs are
// state seeded from the row, so without following the row they kept showing the old part's cost until the page was reloaded.

const src = readFileSync(path.resolve(__dirname, "BoqRowPanel.tsx"), "utf8");

describe("the BOQ line panel follows the row after a re-price", () => {
  it("Cost / unit is set again whenever the row's cost or its source changes", () => {
    expect(src).toMatch(/useEffect\(\(\) => \{ setCost\(row\.unit_cost != null \? numText\(row\.unit_cost\) : ""\); \}, \[row\.unit_cost, row\.price_source\]\);/);
  });

  it("Rate is set again whenever the row's rate or priced state changes", () => {
    expect(src).toMatch(/useEffect\(\(\) => \{ setRate\(row\.priced \? numText\(row\.rate\) : ""\); \}, \[row\.rate, row\.priced\]\);/);
  });

  it("the panel is told to reload after a link is replaced or removed, and the table reads the same row", () => {
    const est = readFileSync(path.resolve(__dirname, "BoqEstimates.tsx"), "utf8");
    expect(est).toMatch(/onChanged\(\);\s*return true;/);
    const tab = readFileSync(path.resolve(__dirname, "BoqTab.tsx"), "utf8");
    expect(tab).toContain("const openRow = openId ? data.lines.find(");
    expect(tab).toMatch(/void reloadAfterSave<State>\(base, \(fresh\) => \{ setData\(fresh\)/);
    expect(tab).toContain("void loadEstimates();");
  });
});
