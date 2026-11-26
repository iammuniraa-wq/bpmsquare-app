import { describe, expect, it } from "vitest";
import { RATING_FORMULA, RATING_WEIGHTS, computeRating, ratingText } from "./rating";
import { NOW, SID, history } from "./fixtures";

const rate = (supplierId: string, h = history()) => computeRating({ supplierId, now: NOW, ...h });
const comp = (r: ReturnType<typeof rate>, id: string) => r.basis.components.find((c) => c.id === id)!;

describe("our rating", () => {
  it("the weights add up to 100, and the formula is printed with them", () => {
    expect(Object.values(RATING_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(RATING_FORMULA).toMatch(/price against the others 30%/);
    expect(RATING_FORMULA).toMatch(/at least 3/);
  });

  it("a supplier that answers fast, quotes everything, is cheapest and states validity scores 4.75, worked by hand", () => {
    // response 1.0 x 20, speed (20 h) 1.0 x 10, completeness 12/12 x 15, price (cheapest everywhere) 1.0 x 30,
    // awards (3 of 12 lines = 25%, doubled = 0.5) x 10, validity 12/12 x 15  => (20+10+15+30+5+15)/100 x 5 = 4.75
    const r = rate(SID.wadi);
    expect(r.basis.rfqs).toBe(6);
    expect(r.basis.enough).toBe(true);
    expect(r.value).toBe(4.75);
    expect(comp(r, "awards").score).toBe(0.5);
    expect(comp(r, "price").detail).toMatch(/12 lines/);
    expect(ratingText(r.value)).toBe("4.8");
  });

  it("a dearer, slower supplier that does not state validity scores lower, worked by hand", () => {
    // Arkan: response 1, speed 90 h = 1 - (90-24)/144 = 0.5417, completeness 1, awards 0, validity 0,
    // price: Wadi is cheaper on every line, so 1 of 2 others is cheaper (0.5) on 11 lines, and on the first line of RFQ 1, which Tihama
    // also quoted, 1 of 3 is cheaper (0.667): (11 x 0.5 + 0.667) / 12 = 0.5139
    // => (20 + 5.417 + 15 + 30 x 0.5139 + 0 + 0)/100 x 5 = 2.79
    const r = rate(SID.arkan);
    expect(comp(r, "speed").score).toBeCloseTo(0.542, 2);
    expect(comp(r, "price").score).toBeCloseTo(0.514, 3);
    expect(comp(r, "validity").score).toBe(0);
    expect(r.value).toBeCloseTo(2.79, 2);
    expect(r.value as number).toBeLessThan(rate(SID.wadi).value as number);
  });

  it("fewer than 3 RFQs: no rating, the sample size is shown, and the figures are still there", () => {
    const r = rate(SID.tihama);
    expect(r.value).toBeNull();
    expect(r.basis.enough).toBe(false);
    expect(r.basis.rfqs).toBe(2);
    expect(comp(r, "response").detail).toMatch(/1 replied and 1 declined of 2 requests/);
  });

  it("a supplier never asked has no rating and no components with data", () => {
    const r = rate(SID.sahra);
    expect(r.value).toBeNull();
    expect(r.basis.rfqs).toBe(0);
    expect(r.basis.components.every((c) => c.score === null)).toBe(true);
  });

  it("RFQs older than 24 months are not counted", () => {
    const h = history();
    for (const r of h.rfqSuppliers) if (r.supplier_id === SID.wadi) r.sent_at = "2024-01-05T00:00:00Z";
    expect(rate(SID.wadi, h).basis.rfqs).toBe(0);
  });

  it("a decline counts half and silence counts nothing", () => {
    const h = history();
    h.rfqSuppliers.push({ id: "x1", rfq_id: "rfq-3", supplier_id: SID.tihama, status: "sent", sent_at: "2026-09-01T00:00:00Z", replied_at: null });
    const r = rate(SID.tihama, h);
    expect(r.basis.rfqs).toBe(3);
    expect(comp(r, "response").score).toBeCloseTo((1 + 0.5) / 3, 3);
    expect(r.value).not.toBeNull();
  });

  it("price competitiveness needs at least two comparable lines, otherwise it drops out and the rest are re-weighted", () => {
    const h = history();
    const keep = h.rfqSuppliers.filter((r) => ["rfq-1", "rfq-2", "rfq-3"].includes(r.rfq_id) && (r.supplier_id === SID.wadi || r.id === "rfq-1-tihama"));
    const lines = h.lines.filter((l) => ["rfq-1", "rfq-2", "rfq-3"].includes(l.rfq_id));
    const ids = new Set(keep.map((r) => r.id));
    const responses = h.responses.filter((r) => ids.has(r.rfq_supplier_id));
    const few = computeRating({ supplierId: SID.wadi, now: NOW, rfqSuppliers: keep, lines, responses });
    expect(comp(few, "price").score).toBeNull();
    expect(comp(few, "price").detail).toMatch(/only 1 line/);
    expect(few.value).not.toBeNull();
  });

  it("the speed component is full marks within a day and zero after a week", () => {
    const mk = (hours: number) => {
      const h = history();
      for (const r of h.rfqSuppliers) if (r.supplier_id === SID.wadi) r.replied_at = new Date(Date.parse(r.sent_at as string) + hours * 3_600_000).toISOString();
      return comp(rate(SID.wadi, h), "speed").score;
    };
    expect(mk(10)).toBe(1);
    expect(mk(24 * 8)).toBe(0);
    expect(mk(96)).toBeCloseTo(0.5, 2);
  });
});
