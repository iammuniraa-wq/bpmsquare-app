import { describe, it, expect } from "vitest";
import { pickCurrentSupplier, currentNote, currentDescription, newestFirst, type Candidate } from "./currentSupplierRank";

const cand = (supplier_id: string, as_of: string | null, unit_price: number | null = null, currency: string | null = null): Candidate => ({ supplier_id, as_of, unit_price, currency });
const all = new Set(["A", "B", "C"]);

describe("pickCurrentSupplier", () => {
  it("prefers the supplier set on the product over any history", () => {
    const p = pickCurrentSupplier({ preferred: "C", awards: [cand("A", "2026-09-01")], purchaseOrders: [cand("B", "2026-10-01")], active: all });
    expect(p).toMatchObject({ supplier_id: "C", source: "product", as_of: null, unit_price: null });
  });
  it("tells when the preferred supplier last won, with the price", () => {
    const p = pickCurrentSupplier({ preferred: "A", awards: [cand("A", "2026-06-01", 10, "USD"), cand("A", "2026-09-01", 12, "USD"), cand("B", "2026-10-01", 1)], purchaseOrders: [], active: all });
    expect(p).toMatchObject({ supplier_id: "A", source: "product", as_of: "2026-09-01", unit_price: 12, currency: "USD" });
  });
  it("falls to the most recent award when the product has no (active) preference", () => {
    const awards = [cand("A", "2026-05-01", 9), cand("B", "2026-08-01", 7, "EUR")];
    expect(pickCurrentSupplier({ preferred: null, awards, purchaseOrders: [cand("C", "2026-10-01")], active: all }))
      .toMatchObject({ supplier_id: "B", source: "award", as_of: "2026-08-01", unit_price: 7, currency: "EUR" });
    expect(pickCurrentSupplier({ preferred: "Z", awards, purchaseOrders: [], active: new Set(["A", "B"]) }))
      .toMatchObject({ supplier_id: "B", source: "award" });
  });
  it("falls to the most recent purchase order after awards", () => {
    const p = pickCurrentSupplier({ preferred: null, awards: [], purchaseOrders: [cand("A", "2026-01-01", 5), cand("C", "2026-07-01", 6)], active: all });
    expect(p).toMatchObject({ supplier_id: "C", source: "purchase_order", unit_price: 6 });
  });
  it("skips inactive or foreign suppliers at every step, then gives none", () => {
    const active = new Set(["A"]);
    expect(pickCurrentSupplier({ preferred: "B", awards: [cand("B", "2026-09-01")], purchaseOrders: [cand("A", "2026-02-01")], active }))
      .toMatchObject({ supplier_id: "A", source: "purchase_order" });
    expect(pickCurrentSupplier({ preferred: "B", awards: [cand("C", "2026-09-01")], purchaseOrders: [cand("B", "2026-02-01")], active })).toBeNull();
    expect(pickCurrentSupplier({ preferred: null, awards: [], purchaseOrders: [], active: all })).toBeNull();
  });
  it("sorts dated candidates newest first and undated last", () => {
    const sorted = [cand("A", null), cand("B", "2026-01-01"), cand("C", "2026-03-01")].sort(newestFirst).map((x) => x.supplier_id);
    expect(sorted).toEqual(["C", "B", "A"]);
  });
});

describe("currentNote", () => {
  const fmt = (s: string) => s.slice(0, 10);
  it("words each source", () => {
    expect(currentNote({ source: "award", as_of: "2026-08-12T10:00:00Z", unit_price: 41.5, currency: "USD" }, fmt)).toBe("last awarded 2026-08-12 at 41.5 USD");
    expect(currentNote({ source: "purchase_order", as_of: "2026-07-01", unit_price: null, currency: null }, fmt)).toBe("last purchase order 2026-07-01");
    expect(currentNote({ source: "product", as_of: null, unit_price: null, currency: null }, fmt)).toBe("");
  });
});

describe("currentDescription", () => {
  const fmt = (s: string) => s.slice(0, 10);
  it("names the source the way the composer shows it", () => {
    expect(currentDescription({ source: "product", as_of: null, unit_price: null, currency: null }, fmt)).toBe("Preferred supplier");
    expect(currentDescription({ source: "product", as_of: "2026-08-12", unit_price: 3, currency: null }, fmt)).toBe("Preferred supplier · last awarded 2026-08-12 at 3");
    expect(currentDescription({ source: "award", as_of: "2026-08-12", unit_price: null, currency: null }, fmt)).toBe("Last awarded 2026-08-12");
    expect(currentDescription({ source: "purchase_order", as_of: "2026-07-01", unit_price: null, currency: null }, fmt)).toBe("Last purchase order 2026-07-01");
  });
});
