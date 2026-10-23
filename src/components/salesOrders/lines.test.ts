import { describe, expect, it } from "vitest";
import { editTotals, fromLine, fromProduct, lineProblem, linesChanged, meaningful, newEditLine, searchAccounts, searchProducts, toInput } from "./lines";
import { detailPatch } from "./detailDraft";
import { linkProblem } from "./logic";
import { line } from "./fixtures";

describe("the order line editor's rules", () => {
  it("turns a picked product into a line with its name, unit and list price", () => {
    const l = fromProduct({ id: "p1", ref: "STL-10", name: "Steel plate", uom: "Kg", list_price: 120 }, { tax_pct: "5", requested_date: "2026-11-10" });
    expect(l).toMatchObject({ product_id: "p1", description: "Steel plate (STL-10)", uom: "Kg", unit_price: "120", tax_pct: "5", requested_date: "2026-11-10" });
    expect(fromProduct({ id: "p2", ref: null, name: "Pipe", uom: null, list_price: null }).unit_price).toBe("0");
  });
  it("drops blank lines and sends numbers, with percentages clamped and empty text as null", () => {
    const rows = [{ ...newEditLine(), description: "  Plate ", qty: "2", unit_price: "10.5", discount_pct: "150", tax_pct: "-3", printed_text: "  ", requested_date: "" }, newEditLine()];
    expect(meaningful(rows)).toHaveLength(1);
    expect(toInput(rows[0])).toEqual({ product_id: null, description: "Plate", printed_text: null, qty: 2, uom: "Nos", unit_price: 10.5, discount_pct: 100, tax_pct: 0, requested_date: null });
  });
  it("says what stops a save, in plain words", () => {
    expect(lineProblem([newEditLine()])).toBe("Add at least one line");
    expect(lineProblem([{ ...newEditLine(), description: "x", qty: "0" }])).toBe("Line 1: the quantity must be more than zero");
    expect(lineProblem([{ ...newEditLine(), description: "x", qty: "1", unit_price: "-5" }])).toBe("Line 1: the price cannot be negative");
    expect(lineProblem([{ ...newEditLine(), description: "x", qty: "1", discount_pct: "120" }])).toBe("Line 1: the discount must be between 0 and 100");
    expect(lineProblem([{ ...newEditLine(), description: "x", qty: "2" }])).toBeNull();
  });
  it("estimates the totals from the lines worth sending", () => {
    const t = editTotals([{ ...newEditLine(), description: "a", qty: "10", unit_price: "100", discount_pct: "10", tax_pct: "5" }, newEditLine()]);
    expect(t).toMatchObject({ subtotal: 900, tax: 45, total: 945 });
  });
  it("sends the id of a stored line back, and none for a new row", () => {
    expect(toInput(fromLine(line({ id: "l-9" }))).id).toBe("l-9");
    expect(toInput({ ...newEditLine(), description: "x" })).not.toHaveProperty("id");
  });
  it("tells a changed set from an untouched one, ignoring row keys", () => {
    const a = [fromLine(line())];
    expect(linesChanged(a, [fromLine(line())])).toBe(false);
    expect(linesChanged(a, [{ ...a[0], qty: "11" }])).toBe(true);
    expect(linesChanged(a, [])).toBe(true);
  });
  it("finds products by name or ref, and customers by every word typed", () => {
    const products = [{ id: "1", ref: "STL-10", name: "Steel plate", uom: null, list_price: 1 }, { id: "2", ref: null, name: "Copper pipe", uom: null, list_price: 2 }];
    expect(searchProducts(products, "stl").map((p) => p.id)).toEqual(["1"]);
    expect(searchProducts(products, "  ")).toEqual([]);
    const accounts = [{ id: "a", name: "Gulf Steel LLC", address: "" }, { id: "b", name: "Al Steel Gulf Trading", address: "" }, { id: "c", name: "Other", address: "" }];
    expect(searchAccounts(accounts, "gulf steel").map((a) => a.id)).toEqual(["a", "b"]);
    expect(searchAccounts(accounts, "")).toEqual([]);
  });
});

describe("what Edit details sends", () => {
  const draft = { customer_po: " PO-1 ", requested_date: "2026-11-10", notes: "", terms: "30 days", ship_name: "Yard", ship_address: "Plot 14", bill_name: "", bill_address: "" };
  it("sends every header field while the order is editable, an empty bill-to as null", () => {
    expect(detailPatch(draft, true)).toEqual({ customer_po: "PO-1", notes: null, requested_date: "2026-11-10", terms: "30 days", ship_to: { name: "Yard", address: "Plot 14" }, bill_to: null });
  });
  it("sends only the customer PO and notes once the order is locked", () => {
    expect(detailPatch(draft, false)).toEqual({ customer_po: "PO-1", notes: null });
  });
});

describe("link check", () => {
  it("accepts https and refuses the rest in words", () => {
    expect(linkProblem("https://files.example/po.pdf")).toBeNull();
    expect(linkProblem("http://files.example/po.pdf")).toBe("Only https:// links are accepted");
    expect(linkProblem("javascript:alert(1)")).toBe("Only https:// links are accepted");
    expect(linkProblem("not a url")).toBe("That is not a web address");
    expect(linkProblem("  ")).toBe("Paste the address of the file");
  });
});
