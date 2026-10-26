import { describe, it, expect } from "vitest";
import {
  RATE_LIMITS, classifyRateLabel, csvToGrid, detectRateColumns, detectRateLayout, extractRates, parseSheetDate, rateFileKind,
} from "./parse";
import type { RateRow } from "./parse";
import {
  MAX_DECISIONS, parseDecisions, planApply, planRows, summarise, unitKey, updatePatch, withDefaults,
} from "./plan";
import type { CatalogueProduct, PlanContext, PreviewRow } from "./plan";
import {
  FILTER_LABEL, changeCount, countFilters, defaultChoices, filterRows, setUnmatched, toDecisions,
} from "./view";
import { RATE_SHEET_TIPS } from "./tips";
import { tipTextProblems } from "@/lib/infoTip";
import { ILLUSTRATIVE_DESCRIPTION, productRowFor, starterCatalogue } from "../starterCatalogue";

// The rate-sheet import: reading a supplier's sheet, matching it to the catalogue, staleness, and exactly what each choice writes.
// "Today" is 2026-10-26 throughout, the workspace works in SAR and a price older than 180 days is stale.

const CTX: PlanContext = { today: "2026-10-26", sheet_date: "2026-10-26", currency: "SAR", validity_days: 180 };

const prod = (over: Partial<CatalogueProduct> & { id: string; name: string }): CatalogueProduct => ({
  sku: null, uom: null, cost_price: null, cost_price_as_of: null, description: null, custom_data: null, status: "active", ...over,
});
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const row = (over: Partial<RateRow> & { row_no: number; name: string }): RateRow => ({
  sku: null, uom: null, rate: 10, currency: null, supplier: null, note: null, as_of: null, date_unreadable: false, currency_unreadable: false, ...over,
});

describe("finding the header", () => {
  it("reads the usual names, with a title block above and currency or brackets in the labels", () => {
    const grid = [
      ["Gulf Pipes Trading LLC", null, null, null],
      ["Price list October 2026", null, null, null],
      [null, null, null, null],
      ["Item Code", "Description", "UOM", "Unit Rate (SAR)", "Valid From", "Remarks"],
      ["GP-100", "Steel pipe DN300", "m", 340, "2026-10-01", "Quote Q-77"],
    ];
    const layout = detectRateLayout(grid);
    expect(layout.headerRow).toBe(4);
    expect(layout.map).toEqual({ sku: 1, name: 2, uom: 3, rate: 4, as_of: 5, note: 6 });
  });

  it("accepts a sheet with a SKU and a rate only, and one with a name and a rate only", () => {
    expect(detectRateLayout([["SKU", "Price"], ["A-1", 5]]).map).toEqual({ sku: 1, rate: 2 });
    expect(detectRateLayout([["Material", "Cost"], ["Sand", 5]]).map).toEqual({ name: 1, rate: 2 });
  });

  it("finds no header in a sheet without a rate column or without an item column", () => {
    expect(detectRateLayout([["Description", "Qty"], ["Sand", 5]]).headerRow).toBeNull();
    expect(detectRateLayout([["Rate", "Qty"], [5, 5]]).headerRow).toBeNull();
    expect(detectRateLayout([]).headerRow).toBeNull();
  });

  it("each field uses one column, the strongest name first", () => {
    const m = detectRateColumns(["Item", "Item Name", "Price", "Unit Price"]).map;
    expect(m).toEqual({ name: 1, rate: 3 });   // equal strength: the leftmost column wins, and a column is used once
  });

  it("classifies a few labels", () => {
    expect(classifyRateLabel("  Unit of Measure ").map((h) => h.field)).toEqual(["uom"]);
    expect(classifyRateLabel("Supplier Name").map((h) => h.field)).toEqual(["supplier"]);
    expect(classifyRateLabel("Price date").map((h) => h.field)).toEqual(["as_of"]);
    expect(classifyRateLabel("Notes")).toEqual([{ field: "note", strength: 2 }]);
    expect(classifyRateLabel("")).toEqual([]);
  });
});

describe("dates", () => {
  it("reads ISO, day-first, month names and an Excel serial", () => {
    expect(parseSheetDate("2026-10-15")).toBe("2026-10-15");
    expect(parseSheetDate("15/10/2026")).toBe("2026-10-15");
    expect(parseSheetDate("15-10-26")).toBe("2026-10-15");
    expect(parseSheetDate("15.10.2026")).toBe("2026-10-15");
    expect(parseSheetDate("10/15/2026")).toBe("2026-10-15");   // the day cannot be 10/15, so it is month first
    expect(parseSheetDate("05/10/2026")).toBe("2026-10-05");   // ambiguous: day first
    expect(parseSheetDate("15 Oct 2026")).toBe("2026-10-15");
    expect(parseSheetDate("October 15, 2026")).toBe("2026-10-15");
    expect(parseSheetDate(46310)).toBe("2026-10-15");           // 46023 = 2026-01-01, plus 273 days to 1 October, plus 14
    expect(parseSheetDate("46310")).toBe("2026-10-15");
  });
  it("is null for empty or impossible dates", () => {
    expect(parseSheetDate(null)).toBeNull();
    expect(parseSheetDate("")).toBeNull();
    expect(parseSheetDate("2026-13-40")).toBeNull();
    expect(parseSheetDate("31/02/2026")).toBeNull();
    expect(parseSheetDate("soon")).toBeNull();
    expect(parseSheetDate(12)).toBeNull();
    expect(parseSheetDate("1999-01-01")).toBeNull();
  });
});

describe("reading the rows", () => {
  const header = ["SKU", "Item", "Unit", "Rate", "Currency", "Supplier", "As of", "Source"];
  const read = (rows: (string | number | null)[][]) => extractRates([header, ...rows], 1, detectRateColumns(header).map);

  it("keeps an item with a rate, and says why every other line was left out", () => {
    const r = read([
      ["S-1", "Steel pipe DN300", "m", "1,250.50", "sar", "Gulf Pipes", "15/10/2026", "Quote 7"],
      [null, "PIPES", null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ["S-2", "Free sample", "nr", 0, null, null, null, null],
      ["S-3", "Mistake", "nr", -4, null, null, null, null],
      ["S-4", "Absurd", "nr", 5e12, null, null, null, null],
      [null, null, "m", 12, null, null, null, null],
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ row_no: 2, sku: "S-1", name: "Steel pipe DN300", uom: "m", rate: 1250.5, currency: "SAR", supplier: "Gulf Pipes", note: "Quote 7", as_of: "2026-10-15" });
    expect(r.skipped.map((s) => [s.row_no, s.reason])).toEqual([
      [3, "No rate (a heading?)"], [5, "Rate out of range"], [6, "Rate out of range"], [7, "Rate out of range"], [8, "Not an item"],
    ]);
  });

  it("flags an unreadable date and an unreadable currency instead of guessing", () => {
    const r = read([["A-1", "Sand", "m3", 50, "Riyal", null, "next week", null]]);
    expect(r.rows[0]).toMatchObject({ as_of: null, date_unreadable: true, currency: null, currency_unreadable: true });
  });

  it("an item with only a SKU is named by it", () => {
    const r = read([["A-9", null, "nr", 5, null, null, null, null]]);
    expect(r.rows[0].name).toBe("A-9");
  });

  it("stops at the row limit and says so", () => {
    const many = Array.from({ length: RATE_LIMITS.maxRows + 5 }, (_, i) => [`S-${i}`, `Item ${i}`, "nr", 1, null, null, null, null] as (string | number | null)[]);
    const r = read(many);
    expect(r.rows).toHaveLength(RATE_LIMITS.maxRows);
    expect(r.truncated).toBe(true);
    expect(r.skipped).toHaveLength(5);
  });

  it("caps the length of every text it keeps", () => {
    const r = read([["S".repeat(300), "N".repeat(500), "U".repeat(60), 1, null, "X".repeat(400), null, "Y".repeat(400)]]);
    expect(r.rows[0].sku!.length).toBe(RATE_LIMITS.maxSku);
    expect(r.rows[0].name.length).toBe(RATE_LIMITS.maxName);
    expect(r.rows[0].uom!.length).toBe(RATE_LIMITS.maxUom);
    expect(r.rows[0].supplier!.length).toBe(RATE_LIMITS.maxText);
    expect(r.rows[0].note!.length).toBe(RATE_LIMITS.maxText);
  });
});

describe("files", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  it("allows .xlsx that is a zip and .csv that is text, nothing else", () => {
    expect(rateFileKind("list.xlsx", bytes(0x50, 0x4b, 3, 4, 0))).toBe("xlsx");
    expect(rateFileKind("LIST.CSV", new TextEncoder().encode("a,b\n1,2"))).toBe("csv");
    expect(rateFileKind("list.xlsx", new TextEncoder().encode("not a zip"))).toEqual({ error: "That is not an Excel workbook (.xlsx)." });
    expect(rateFileKind("list.csv", bytes(97, 0, 98))).toEqual({ error: "That does not look like a CSV text file." });
    expect(rateFileKind("list.xls", bytes(1, 2, 3, 4))).toMatchObject({ error: expect.stringContaining(".xls") });
    for (const name of ["list.pdf", "list.exe", "list.xlsx.exe", "list", "list.html", "list.svg"]) {
      expect(rateFileKind(name, bytes(0x50, 0x4b, 3, 4)), name).toEqual({ error: "Upload an Excel (.xlsx) or CSV file." });
    }
  });

  it("reads a semicolon CSV with a byte-order mark into the same grid an Excel sheet gives", () => {
    const grid = csvToGrid("﻿Item;Rate;Unit\r\nSand;12,5;m3\r\n");
    expect(grid[0]).toEqual(["Item", "Rate", "Unit"]);
    expect(detectRateLayout(grid).map).toEqual({ name: 1, rate: 2, uom: 3 });
  });
});

describe("matching rows to the catalogue", () => {
  const PRODUCTS: CatalogueProduct[] = [
    prod({ id: ID(1), name: "Steel pipe DN300 (illustrative)", sku: "EST-PIPE-STEEL-300", uom: "m", cost_price: 340, custom_data: { illustrative: true } }),
    prod({ id: ID(2), name: "Isolation valve DN300 (gate or butterfly)", sku: "EST-VLV-300", uom: "nr", cost_price: 3100, cost_price_as_of: "2026-01-02" }),
    prod({ id: ID(3), name: "Gravel surface reinstatement", sku: "EST-REIN-GRAVEL", uom: "m2", cost_price: 38 }),
    prod({ id: ID(4), name: "Retired item", sku: "OLD-1", uom: "nr", status: "inactive" }),
  ];
  const plan = (rows: RateRow[], ctx: Partial<PlanContext> = {}) => planRows(rows, PRODUCTS, { ...CTX, ...ctx });

  it("the SKU is exact, and an exact match is updated without asking", () => {
    const [r] = plan([row({ row_no: 2, name: "Whatever the supplier calls it", sku: "est-pipe-steel-300", uom: "Mtr", rate: 355 })]);
    expect(r.status).toBe("exact");
    expect(r.default_action).toBe("update");
    expect(r.default_product_id).toBe(ID(1));
    expect(r.suggestions[0]).toMatchObject({ product_id: ID(1), score: 100, current_rate: 340, illustrative: true });
  });

  it("the same name is exact once the illustrative suffix is ignored", () => {
    const [r] = plan([row({ row_no: 2, name: "Steel Pipe DN300", uom: "m" })]);
    expect(r.status).toBe("exact");
    expect(r.suggestions[0].reason).toBe("Same name");
  });

  it("a close name is strong, a vague one is only possible and waits for a choice, an unknown one has no match", () => {
    const [strong, possible, none] = plan([
      row({ row_no: 2, name: "Gravel surface reinstatement works", uom: "m2" }),
      row({ row_no: 3, name: "Isolation valve" }),
      row({ row_no: 4, name: "Stainless steel kitchen sink" }),
    ]);
    expect(strong.status).toBe("strong");
    expect(strong.default_action).toBe("update");
    expect(possible.status).toBe("possible");
    expect(possible.default_action).toBe("skip");
    expect(none.status).toBe("none");
    expect(none.suggestions).toEqual([]);
    expect(none.default_action).toBe("skip");
  });

  it("an inactive item is never offered", () => {
    const [r] = plan([row({ row_no: 2, name: "Retired item", sku: "OLD-1" })]);
    expect(r.suggestions.find((s) => s.product_id === ID(4))).toBeUndefined();
  });

  it("a different unit is not applied without a person looking (a rate per 100 m is not a rate per m)", () => {
    const [r] = plan([row({ row_no: 2, name: "Steel pipe DN300", uom: "100 m", rate: 34000 })]);
    expect(r.status).toBe("exact");
    expect(r.unit_differs).toBe(true);
    expect(r.default_action).toBe("skip");
    expect(r.reason).toContain("unit differs");
  });

  it("units that are the same thing in other words are the same unit", () => {
    for (const [a, b] of [["Sqm", "m2"], ["m²", "m2"], ["Nos", "nr"], ["pcs", "Nr"], ["Mtr", "m"], ["cu.m", "m3"], ["kgs", "kg"]]) expect(unitKey(a), `${a} / ${b}`).toBe(unitKey(b));
    expect(unitKey("m")).not.toBe(unitKey("m2"));
    expect(unitKey("")).toBe("");
  });

  it("a sheet in another currency is not applied, an unreadable currency too", () => {
    const [eur, bad, none] = plan([
      row({ row_no: 2, name: "Steel pipe DN300", currency: "EUR" }),
      row({ row_no: 3, name: "Steel pipe DN300", currency_unreadable: true }),
      row({ row_no: 4, name: "Steel pipe DN300", currency: "SAR" }),
    ]);
    expect(eur.status).toBe("blocked");
    expect(eur.reason).toContain("EUR");
    expect(eur.default_action).toBe("skip");
    expect(bad.status).toBe("blocked");
    expect(none.status).toBe("exact");
    expect(plan([row({ row_no: 2, name: "Steel pipe DN300", currency: "EUR" })], { currency: null })[0].status).toBe("exact");
  });

  it("the same item twice: the first is used, the repeat is not applied", () => {
    const rows = plan([row({ row_no: 2, name: "Steel pipe DN300", sku: "X-100" }), row({ row_no: 5, name: "Steel pipe DN300 again", sku: "x 100" })]);
    expect(rows[0].default_action).toBe("update");
    expect(rows[1].status).toBe("duplicate");
    expect(rows[1].reason).toContain("row 2");
  });

  it("two different rows for one catalogue item: only the first is updated by default", () => {
    const rows = plan([row({ row_no: 2, name: "Steel pipe DN300", sku: "A-1" }), row({ row_no: 3, name: "Steel pipe, DN300 (coated)", sku: "A-2" })]);
    expect(rows[0].default_action).toBe("update");
    expect(rows[1].default_action).toBe("skip");
    expect(rows[1].reason).toContain("Row 2 already updates");
  });

  describe("stale prices", () => {
    it("a price older than the validity days is stale, with the days in words; it is still importable", () => {
      const [old, fresh, noDate, future] = plan([
        row({ row_no: 2, name: "Steel pipe DN300", as_of: "2026-01-01" }),
        row({ row_no: 3, name: "Gravel surface reinstatement", as_of: "2026-09-01" }),
        row({ row_no: 4, name: "Isolation valve DN300" }),
        row({ row_no: 5, name: "Steel pipe DN300 b", sku: "B-2", as_of: "2027-01-01" }),
      ]);
      expect(old.stale).toBe(true);
      expect(old.stale_text).toBe("stale, 298 days old");   // 31+28+31+30+31+30+31+31+30 = 273 days to 1 October, plus 25
      expect(old.default_action).toBe("update");
      expect(fresh.stale).toBe(false);
      expect(fresh.stale_text).toBeNull();
      expect(noDate.as_of_used).toBe("2026-10-26");
      expect(noDate.stale).toBe(false);
      expect(future.as_of_used).toBe("2026-10-26");         // a date in the future is not a price date: the sheet's date is used
    });

    it("the limit is the workspace's: 30 days makes September stale, 700 makes January fresh", () => {
      expect(plan([row({ row_no: 2, name: "Steel pipe DN300", as_of: "2026-09-01" })], { validity_days: 30 })[0].stale).toBe(true);
      expect(plan([row({ row_no: 2, name: "Steel pipe DN300", as_of: "2026-01-01" })], { validity_days: 700 })[0].stale).toBe(false);
    });

    it("the sheet's own date decides for rows without one", () => {
      const [r] = plan([row({ row_no: 2, name: "Steel pipe DN300" })], { sheet_date: "2025-12-01" });
      expect(r.as_of_used).toBe("2025-12-01");
      expect(r.stale).toBe(true);
    });
  });
});

describe("what a choice writes", () => {
  const illustrative = prod({
    id: ID(1), name: "Steel pipe DN300 (illustrative)", sku: "EST-PIPE-STEEL-300", uom: "m", cost_price: 340, description: ILLUSTRATIVE_DESCRIPTION,
    custom_data: { est_kind: "pipe_supply", pipe_dn: "300", illustrative: true, cost_source: "Illustrative placeholder" },
  });
  const edited = prod({ id: ID(2), name: "Valve DN300", sku: "V-300", uom: "nr", cost_price: 3000, cost_price_as_of: "2026-03-01", custom_data: { cost_source: "Quote Q-1", cost_supplier: "Old Co" } });
  const products = [illustrative, edited];
  const preview = (rows: RateRow[]): PreviewRow[] => planRows(rows, products, CTX);

  it("an update sets the rate and its date, clears the illustrative mark, and keeps what it replaces", () => {
    const rows = preview([row({ row_no: 2, name: "Steel pipe DN300", rate: 355.5, uom: "m", supplier: "Gulf Pipes", note: "Quote Q-77", as_of: "2026-10-01" })]);
    const { patch, changes } = updatePatch(illustrative, rows[0], "gulf.xlsx", "2026-10-26");
    expect(patch.cost_price).toBe(355.5);
    expect(patch.cost_price_as_of).toBe("2026-10-01");
    expect(patch.name).toBe("Steel pipe DN300");
    expect(patch.description).toBeNull();
    const custom = patch.custom_data as Record<string, unknown>;
    expect(custom.illustrative).toBeUndefined();
    expect(custom).toMatchObject({ est_kind: "pipe_supply", pipe_dn: "300", cost_source: "Quote Q-77", cost_supplier: "Gulf Pipes" });
    expect(custom.previous_cost).toEqual({ cost_price: 340, as_of: null, source: "Illustrative placeholder", supplier: null, replaced_on: "2026-10-26" });
    expect(custom.rate_sheet).toEqual({ file: "gulf.xlsx", row: 2, imported_on: "2026-10-26" });
    expect(changes.map((c) => c.field)).toEqual(["cost_price", "cost_price_as_of", "cost source", "cost supplier", "illustrative", "name", "description"]);
    expect(changes[0]).toEqual({ field: "cost_price", from: 340, to: 355.5 });
  });

  it("an update of an edited item keeps its name and tags, and remembers the old supplier and date", () => {
    const rows = preview([row({ row_no: 2, name: "Valve DN300", sku: "V-300", rate: 3200, uom: "nr", as_of: "2026-10-10" })]);
    const { patch } = updatePatch(edited, rows[0], "p.csv", "2026-10-26");
    expect(patch.name).toBeUndefined();
    expect(patch.description).toBeUndefined();
    const custom = patch.custom_data as Record<string, unknown>;
    expect(custom.cost_source).toBe("Rate sheet p.csv");
    expect(custom.cost_supplier).toBeUndefined();
    expect(custom.previous_cost).toEqual({ cost_price: 3000, as_of: "2026-03-01", source: "Quote Q-1", supplier: "Old Co", replaced_on: "2026-10-26" });
  });

  it("the same rate, date and source again changes nothing", () => {
    const first = preview([row({ row_no: 2, name: "Valve DN300", sku: "V-300", rate: 3200, uom: "nr", as_of: "2026-10-10", note: "Q-2" })]);
    const { patch } = updatePatch(edited, first[0], "p.csv", "2026-10-26");
    const after = { ...edited, cost_price: 3200, cost_price_as_of: "2026-10-10", custom_data: patch.custom_data as Record<string, unknown> };
    const again = planRows([row({ row_no: 2, name: "Valve DN300", sku: "V-300", rate: 3200, uom: "nr", as_of: "2026-10-10", note: "Q-2" })], [after], CTX);
    const plan = planApply({ rows: again, decisions: withDefaults(again, []), products: [after], fileName: "p.csv", today: "2026-10-26" });
    expect(plan.writes).toEqual([]);
    expect(plan.outcomes[0].outcome).toBe("unchanged");
  });

  it("without decisions the exact and strong matches are updated and nothing else is touched", () => {
    const rows = preview([
      row({ row_no: 2, name: "Steel pipe DN300", rate: 350, uom: "m" }),
      row({ row_no: 3, name: "Stainless sink", rate: 900 }),
    ]);
    const plan = planApply({ rows, decisions: withDefaults(rows, []), products, fileName: "f.xlsx", today: "2026-10-26" });
    expect(plan.writes.map((w) => [w.kind, w.row.row_no])).toEqual([["update", 2]]);
    expect(summarise(plan.outcomes)).toEqual({ updated: 1, added: 0, unchanged: 0, skipped: 1, errors: 0, stale: 0 });
  });

  it("add as a new item writes a product with the rate, the date and the source, and no illustrative mark", () => {
    const rows = preview([row({ row_no: 2, name: "Stainless sink", sku: "SNK-1", uom: "nr", rate: 900, supplier: "Kitchen Co", as_of: "2026-10-05" })]);
    const plan = planApply({ rows, decisions: [{ row: 2, action: "add" }], products, fileName: "f.xlsx", today: "2026-10-26" });
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ kind: "add", insert: { name: "Stainless sink", sku: "SNK-1", uom: "nr", cost_price: 900, cost_price_as_of: "2026-10-05", status: "active" } });
    expect((plan.writes[0] as unknown as { insert: { custom_data: Record<string, unknown> } }).insert.custom_data).toEqual({
      cost_source: "Rate sheet f.xlsx", cost_supplier: "Kitchen Co", rate_sheet: { file: "f.xlsx", row: 2 },
    });
  });

  it("refuses to add a SKU the catalogue already has, and says which row", () => {
    const rows = preview([row({ row_no: 2, name: "Another pipe", sku: "est-pipe-steel-300", rate: 1 }), row({ row_no: 3, name: "New thing", sku: "NEW-1" }), row({ row_no: 4, name: "New thing two", sku: "new-1" })]);
    const plan = planApply({ rows, decisions: [{ row: 2, action: "add" }, { row: 3, action: "add" }, { row: 4, action: "add" }], products, fileName: "f.xlsx", today: "2026-10-26" });
    expect(plan.outcomes.map((o) => o.outcome)).toEqual(["error", "added", "error"]);
    expect(plan.outcomes[0].message).toContain("SKU already exists");
    expect(plan.writes).toHaveLength(1);
  });

  it("an update to a product that is not in this catalogue is refused, and two rows cannot update one item", () => {
    const rows = preview([row({ row_no: 2, name: "A", sku: "Z-1" }), row({ row_no: 3, name: "B", sku: "Z-2" }), row({ row_no: 4, name: "C", sku: "Z-3" })]);
    const plan = planApply({
      rows, products, fileName: "f.xlsx", today: "2026-10-26",
      decisions: [{ row: 2, action: "update", product_id: ID(99) }, { row: 3, action: "update", product_id: ID(1) }, { row: 4, action: "update", product_id: ID(1) }],
    });
    expect(plan.outcomes.map((o) => o.outcome)).toEqual(["error", "updated", "error"]);
    expect(plan.outcomes[0].message).toBe("That item is not in this catalogue.");
    expect(plan.outcomes[2].message).toBe("Row 3 already updates this item.");
  });

  it("a blocked or repeated row cannot be applied however it is chosen", () => {
    const rows = preview([row({ row_no: 2, name: "Steel pipe DN300", currency: "USD" }), row({ row_no: 3, name: "Valve", sku: "D-1" }), row({ row_no: 4, name: "Valve", sku: "D-1" })]);
    const plan = planApply({
      rows, products, fileName: "f.xlsx", today: "2026-10-26",
      decisions: [{ row: 2, action: "update", product_id: ID(1) }, { row: 4, action: "add" }],
    });
    expect(plan.outcomes[0].outcome).toBe("error");
    expect(plan.outcomes[2].outcome).toBe("error");
    expect(plan.writes).toEqual([]);
  });

  it("counts the stale rows it imported", () => {
    const rows = preview([row({ row_no: 2, name: "Steel pipe DN300", uom: "m", as_of: "2026-01-01" }), row({ row_no: 3, name: "Valve DN300", sku: "V-300", uom: "nr", as_of: "2026-10-01" })]);
    const plan = planApply({ rows, decisions: withDefaults(rows, []), products, fileName: "f.xlsx", today: "2026-10-26" });
    expect(summarise(plan.outcomes)).toMatchObject({ updated: 2, stale: 1 });
  });
});

describe("the choices in a request", () => {
  it("accepts a list of known actions, one per row, the last one winning", () => {
    expect(parseDecisions([{ row: 2, action: "skip" }, { row: 2, action: "add" }, { row: 3, action: "update", product_id: ID(1) }])).toEqual([
      { row: 2, action: "add" }, { row: 3, action: "update", product_id: ID(1) },
    ]);
  });
  it("rejects anything else: an unknown action, a row that is not a number, a product id that is not an id, too many", () => {
    for (const bad of [
      "x", {}, [{ row: 0, action: "skip" }], [{ row: 1.5, action: "skip" }], [{ row: 2, action: "delete" }], [{ row: 2, action: "update" }],
      [{ row: 2, action: "update", product_id: "not-a-uuid" }], [{ row: 2, action: "update", product_id: "1; drop table products" }], [null],
      Array.from({ length: MAX_DECISIONS + 1 }, (_, i) => ({ row: i + 1, action: "skip" })),
    ]) expect(parseDecisions(bad), JSON.stringify(bad).slice(0, 60)).toBeNull();
  });
});

describe("the screen's view of a preview", () => {
  const PRODUCTS = [prod({ id: ID(1), name: "Steel pipe DN300", sku: "P-300", uom: "m", cost_price: 340 })];
  const rows = planRows([
    row({ row_no: 2, name: "Steel pipe DN300", uom: "m" }),
    row({ row_no: 3, name: "Brand new thing" }),
    row({ row_no: 4, name: "Other new thing" }),
    row({ row_no: 5, name: "Steel pipe DN300", currency: "USD" }),
  ], PRODUCTS, CTX);

  it("groups rows by what the person has to do and counts them", () => {
    expect(countFilters(rows)).toEqual({ choose: 2, ready: 1, not_applied: 1, all: 4 });
    expect(filterRows(rows, "choose").map((r) => r.row_no)).toEqual([3, 4]);
    expect(filterRows(rows, "all")).toHaveLength(4);
    expect(FILTER_LABEL.choose).toBe("Need a choice");
  });

  it("starts from the defaults, and 'add every unmatched' touches only rows with no match", () => {
    const start = defaultChoices(rows);
    expect(start).toEqual({ 2: `update:${ID(1)}`, 3: "skip", 4: "skip", 5: "skip" });
    expect(changeCount(start)).toBe(1);
    const all = setUnmatched(rows, start, "add");
    expect(all).toEqual({ 2: `update:${ID(1)}`, 3: "add", 4: "add", 5: "skip" });
    expect(changeCount(all)).toBe(3);
    expect(setUnmatched(rows, all, "skip")[3]).toBe("skip");
  });

  it("turns the choices into the request body and back through the same checks the server applies", () => {
    const d = toDecisions(setUnmatched(rows, defaultChoices(rows), "add"));
    expect(parseDecisions(d)).toHaveLength(4);
    expect(d.find((x) => x.row === 2)).toEqual({ row: 2, action: "update", product_id: ID(1) });
  });
});

describe("the explanations and the starter list", () => {
  it("every tip is within the limit: two sentences, 160 characters", () => {
    for (const [k, text] of Object.entries(RATE_SHEET_TIPS)) expect(tipTextProblems(text), k).toEqual([]);
  });

  it("an illustrative starter item matches its own name in a sheet and is replaced like any other", () => {
    const item = starterCatalogue().find((i) => i.sku === "EST-PIPE-STEEL-300")!;
    const p = productRowFor(item);
    const product = prod({ id: ID(1), name: p.name, sku: p.sku, uom: p.uom, cost_price: p.cost_price, description: p.description, custom_data: p.custom_data });
    const rows = planRows([row({ row_no: 2, name: item.name, uom: "m", rate: 399 })], [product], CTX);
    expect(rows[0].status).toBe("exact");
    expect(rows[0].suggestions[0].illustrative).toBe(true);
    const { patch } = updatePatch(product, rows[0], "x.csv", "2026-10-26");
    expect(patch.name).toBe(item.name);
    expect((patch.custom_data as Record<string, unknown>).illustrative).toBeUndefined();
  });
});
