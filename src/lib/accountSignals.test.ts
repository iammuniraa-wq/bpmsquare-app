import { describe, it, expect } from "vitest";
import { isAmcActiveOn, purchasedQuoteAccounts, deriveAccountSignals } from "./accountSignals";

describe("isAmcActiveOn", () => {
  const today = "2026-10-17";
  it("needs the active status", () => {
    expect(isAmcActiveOn({ status: "draft", start_date: null, end_date: null }, today)).toBe(false);
    expect(isAmcActiveOn({ status: "expired", start_date: null, end_date: null }, today)).toBe(false);
  });
  it("treats both date bounds as inclusive and open-ended when blank", () => {
    expect(isAmcActiveOn({ status: "active", start_date: today, end_date: today }, today)).toBe(true);
    expect(isAmcActiveOn({ status: "active", start_date: null, end_date: null }, today)).toBe(true);
    expect(isAmcActiveOn({ status: "active", start_date: "2026-10-18", end_date: null }, today)).toBe(false);
    expect(isAmcActiveOn({ status: "active", start_date: null, end_date: "2026-10-16" }, today)).toBe(false);
  });
});

describe("deriveAccountSignals", () => {
  it("credits the billed account, not just the quote's, and skips lines whose product is unknown", () => {
    const purchases = purchasedQuoteAccounts(
      [{ id: "q1", account_id: "a1", outcome: "open" }],
      [{ account_id: "a2", quote_id: "q1", status: "paid" }, { account_id: "a3", quote_id: "q1", status: "cancelled" }],
    );
    const out = deriveAccountSignals({
      today: "2026-10-17", contracts: [], purchases,
      lines: [{ quote_id: "q1", product_id: "p1" }, { quote_id: "q1", product_id: "gone" }],
      products: [{ id: "p1", sku: null, name: "Pump" }],
    });
    expect(out.get("a2")?.owned_product_skus).toBe("Pump");
    expect(out.has("a1")).toBe(false);
    expect(out.has("a3")).toBe(false);
  });
});
