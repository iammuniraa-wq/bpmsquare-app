import { describe, it, expect } from "vitest";
import { mapSheetColumns, sheetToLines, lineDedupKey } from "./spreadsheetLines";

const sheet = (headers: string[], rows: string[][]) => ({ headers, rows, rowNumbers: rows.map((_, i) => i + 2), format: "csv" as const });

describe("mapSheetColumns", () => {
  it("matches the usual Indian quote headers, case-insensitively, with prefixes", () => {
    expect(mapSheetColumns(["S.No", "Particulars", "UOM", "Qty (Nos)", "Rate (INR)", "Disc %", "Item Code"]))
      .toEqual({ description: 1, uom: 2, qty: 3, rate: 4, discount_pct: 5, product_key: 6 });
  });
});

describe("sheetToLines", () => {
  it("turns rows into lines, skipping blanks, tolerating ₹ and thousands separators", () => {
    const out = sheetToLines(sheet(["Description", "Unit", "Quantity", "Price"], [
      ["Motor rewinding", "Job", "2", "₹19,681.20"],
      ["", "", "", ""],
      ["Wire rope", "Mtr", "", "334.95"],
    ]));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.skipped).toBe(1);
    expect(out.lines).toEqual([
      { row: 2, description: "Motor rewinding", uom: "Job", qty: 2, rate: 19681.2, discount_pct: 0, product_key: null },
      { row: 4, description: "Wire rope", uom: "Mtr", qty: 1, rate: 334.95, discount_pct: 0, product_key: null },
    ]);
  });

  it("refuses a sheet with no description or product column, naming what it saw", () => {
    const out = sheetToLines(sheet(["Date", "Amount"], [["2026-01-01", "5"]]));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("Date, Amount");
  });

  it("a product-only row uses the product key as its description until the caller resolves it", () => {
    const out = sheetToLines(sheet(["SKU", "Qty"], [["PRD-0007", "3"]]));
    expect(out.ok && out.lines[0]).toMatchObject({ description: "PRD-0007", product_key: "PRD-0007", qty: 3 });
  });
});

describe("lineDedupKey", () => {
  it("prefers the product, else the normalised description", () => {
    expect(lineDedupKey({ product_id: "p1", description: "x" })).toBe("p:p1");
    expect(lineDedupKey({ description: "  Motor   Rewinding " })).toBe(lineDedupKey({ description: "motor rewinding" }));
  });
});
