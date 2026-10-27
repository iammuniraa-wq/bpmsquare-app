import { describe, expect, it } from "vitest";
import { allocateProportionally, computeVatTotals, discountHalalas, fromHalalas, mulDivRound, toHalalas, vatOnTaxable } from "./totals";
import type { EinvoiceLineInput } from "./rules";

// A small deterministic generator, so the "property" cases are the same on every run and a failure can be reproduced.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const line = (amount: number, cat: EinvoiceLineInput["vat_category"], rate: number | null, reason?: string): EinvoiceLineInput => ({
  description: "x", qty: 1, rate: amount, amount, vat_category: cat, vat_rate: rate, vat_exemption_reason: reason ?? null,
});

describe("halalas", () => {
  it("rounds half up and ignores binary noise", () => {
    expect(toHalalas(1.005)).toBe(101);
    expect(toHalalas(0.1 + 0.2)).toBe(30);
    expect(toHalalas(2.675)).toBe(268);
    expect(toHalalas(-1.005)).toBe(-101);
    expect(toHalalas(Number.NaN)).toBe(0);
    expect(fromHalalas(12345)).toBe(123.45);
  });
  it("mulDivRound is exact and rounds half up", () => {
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(1, 1, 3)).toBe(0);
    expect(mulDivRound(5, 15, 100)).toBe(1); // 0.75 -> 1
    expect(mulDivRound(10, 15, 100)).toBe(2); // 1.5 -> 2
    expect(mulDivRound(9_000_000_000_000, 1500, 10000)).toBe(1_350_000_000_000); // beyond float-safe products
  });
  it("vat on a taxable amount", () => {
    expect(vatOnTaxable(10000, 15)).toBe(1500);
    expect(vatOnTaxable(333, 15)).toBe(50); // 49.95 -> 50
    expect(vatOnTaxable(10000, 0)).toBe(0);
    expect(vatOnTaxable(10000, 2.5)).toBe(250);
  });
});

describe("the discount", () => {
  it("percent and fixed, never above the subtotal, never negative", () => {
    expect(discountHalalas({ discount_type: "pct", discount_pct: 10, discount_fixed: 0 }, 10000)).toBe(1000);
    expect(discountHalalas({ discount_type: "fixed", discount_pct: 0, discount_fixed: 25.5 }, 10000)).toBe(2550);
    expect(discountHalalas({ discount_type: "fixed", discount_pct: 0, discount_fixed: 999 }, 10000)).toBe(10000);
    expect(discountHalalas({ discount_type: "pct", discount_pct: -5, discount_fixed: 0 }, 10000)).toBe(0);
    expect(discountHalalas({ discount_type: "pct", discount_pct: 250, discount_fixed: 0 }, 10000)).toBe(10000);
  });
});

describe("allocateProportionally (largest remainder)", () => {
  it("parts add up to the total exactly", () => {
    expect(allocateProportionally(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportionally(7, [0, 0])).toEqual([0, 0]);
  });
  it("property: always sums to the total, never negative, in proportion", () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const weights = Array.from({ length: 1 + Math.floor(r() * 5) }, () => Math.floor(r() * 100000));
      const total = Math.floor(r() * 50000);
      const parts = allocateProportionally(total, weights);
      const wsum = weights.reduce((a, b) => a + b, 0);
      if (wsum === 0) { expect(parts.every((p) => p === 0)).toBe(true); continue; }
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      parts.forEach((p, k) => {
        expect(p).toBeGreaterThanOrEqual(0);
        // within one halala of the exact share
        expect(Math.abs(p - (total * weights[k]) / wsum)).toBeLessThan(1);
      });
    }
  });
});

describe("computeVatTotals", () => {
  it("one standard rate: VAT is rounded on the group's taxable amount", () => {
    // three lines of 0.33 make 0.99; 0.99 x 15% = 0.1485 -> 0.15
    const t = computeVatTotals({ discount_type: "pct", discount_pct: 0, discount_fixed: 0 }, [line(0.33, "S", 15), line(0.33, "S", 15), line(0.33, "S", 15)]);
    expect(t.groups).toHaveLength(1);
    expect(t.groups[0]).toMatchObject({ category: "S", rate: 15, net: 99, taxable: 99, vat: 15, gross: 114, lines: 3 });
    expect(t.subtotal).toBe(99);
    expect(t.vatTotal).toBe(15);
    expect(t.grandTotal).toBe(114);
  });

  it("per-line rounding can differ from the group figure; the group figure is the one used, the difference is visible", () => {
    // 0.10 x 15% = 0.015 -> 0.02 per line (3 x 2 = 6), but 0.30 x 15% = 0.045 -> 0.05 on the group
    const t = computeVatTotals({}, [line(0.1, "S", 15), line(0.1, "S", 15), line(0.1, "S", 15)]);
    expect(t.vatTotal).toBe(5);
    expect(t.lineVatSum).toBe(6);
  });

  it("mixed categories: groups by rate, reasons kept, zero rate has no VAT", () => {
    const t = computeVatTotals({}, [
      line(1000, "S", 15),
      line(200, "Z", 0, "Export of goods"),
      line(300, "E", 0, "Financial services"),
      line(50, "S", 15),
    ]);
    expect(t.groups.map((g) => `${g.category}@${g.rate}`)).toEqual(["S@15", "E@0", "Z@0"]);
    const s = t.groups.find((g) => g.category === "S")!;
    expect(s).toMatchObject({ net: 105000, vat: 15750 });
    expect(t.groups.find((g) => g.category === "Z")!.reasons).toEqual(["Export of goods"]);
    expect(t.groups.find((g) => g.category === "E")!.vat).toBe(0);
    expect(t.vatTotal).toBe(15750);
    expect(t.taxableTotal).toBe(155000);
    expect(t.grandTotal).toBe(170750);
  });

  it("the discount is split across the groups and each group's VAT follows its own taxable amount", () => {
    const t = computeVatTotals({ discount_type: "pct", discount_pct: 10, discount_fixed: 0 }, [line(1000, "S", 15), line(1000, "Z", 0, "Export")]);
    expect(t.discount).toBe(20000);
    expect(t.groups.map((g) => g.discount)).toEqual([10000, 10000]);
    expect(t.groups[0]).toMatchObject({ taxable: 90000, vat: 13500 });
    expect(t.taxableTotal).toBe(180000);
  });

  it("an uncategorised line is its own group with no VAT, so nothing is silently taxed or lost", () => {
    const t = computeVatTotals({}, [line(100, null, null), line(100, "S", 15)]);
    expect(t.groups.map((g) => g.category)).toEqual(["S", null]);
    expect(t.subtotal).toBe(20000);
    expect(t.groups.find((g) => g.category == null)!.vat).toBe(0);
  });

  it("property: subtotal - discount = taxable total, taxable + VAT = grand total, to the halala, for random invoices", () => {
    const r = rng(2026);
    const rates: [EinvoiceLineInput["vat_category"], number][] = [["S", 15], ["S", 5], ["Z", 0], ["E", 0], ["O", 0]];
    for (let i = 0; i < 400; i++) {
      const lines = Array.from({ length: 1 + Math.floor(r() * 8) }, () => {
        const [cat, rate] = rates[Math.floor(r() * rates.length)];
        return line(Math.round(r() * 1_000_000) / 100, cat, rate, cat === "S" ? undefined : "reason");
      });
      const kind = r() < 0.5 ? "pct" : "fixed";
      const inv = { discount_type: kind, discount_pct: Math.round(r() * 2500) / 100, discount_fixed: Math.round(r() * 50_000) / 100 };
      const t = computeVatTotals(inv, lines);
      const sumNet = lines.reduce((s, l) => s + toHalalas(l.amount), 0);
      expect(t.subtotal).toBe(sumNet);
      expect(t.taxableTotal).toBe(t.subtotal - t.discount);
      expect(t.groups.reduce((s, g) => s + g.taxable, 0)).toBe(t.taxableTotal);
      expect(t.groups.reduce((s, g) => s + g.discount, 0)).toBe(t.discount);
      expect(t.groups.reduce((s, g) => s + g.net, 0)).toBe(t.subtotal);
      expect(t.grandTotal).toBe(t.taxableTotal + t.vatTotal);
      expect(t.groups.reduce((s, g) => s + g.vat, 0)).toBe(t.vatTotal);
      // each group's VAT is its taxable x rate rounded once
      for (const g of t.groups) expect(g.vat).toBe(vatOnTaxable(g.taxable, g.rate ?? 0));
      // with no discount, the indicative per-line figure never drifts from the group figure by more than a halala per line
      if (t.discount === 0) expect(Math.abs(t.lineVatSum - t.vatTotal)).toBeLessThanOrEqual(lines.length);
    }
  });
});
