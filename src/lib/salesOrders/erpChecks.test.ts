import { describe, expect, it } from "vitest";
import {
  checkWord, checksByKind, compareCredit, comparePrice, compareStock, confirmNeeded, failedChecksText, isStale, quantityHash, sendReadiness, shapeCheck,
  type CreditFacts, type ErpCheckView, type HashLine,
} from "./erpChecks";

const ok = <T>(value: T) => ({ ok: true as const, value });
const facts = (over: Partial<CreditFacts> = {}): CreditFacts => ({ creditOnHold: false, creditLimit: 10000, openOrdersTotal: 2000, openOrdersCapped: false, ...over });
const credit = (read: ReturnType<typeof ok<CreditFacts>> | { ok: false; reason: string } | null, over: { customerLinked?: boolean; orderTotal?: number } = {}) =>
  compareCredit({ customerLinked: over.customerLinked ?? true, read, orderTotal: over.orderTotal ?? 1000, currency: "USD" });

describe("credit", () => {
  it("passes within the limit", () => {
    expect(credit(ok(facts()))).toMatchObject({ kind: "credit", status: "passed", detail: { exposure: 3000, credit_limit: 10000 } });
  });
  it("warns close to the limit, fails over it, and says 'at least' when the open orders were capped", () => {
    expect(credit(ok(facts({ openOrdersTotal: 8500 })))).toMatchObject({ status: "warning" });
    const over = credit(ok(facts({ openOrdersTotal: 9500, openOrdersCapped: true })));
    expect(over.status).toBe("failed");
    expect(over.message).toContain("at least");
  });
  it("fails on a credit hold whatever the limit", () => {
    expect(credit(ok(facts({ creditOnHold: true })))).toMatchObject({ status: "failed", message: expect.stringContaining("credit hold") });
  });
  it("passes with no limit set, warns when the ERP returned no credit fields at all", () => {
    expect(credit(ok(facts({ creditLimit: null })))).toMatchObject({ status: "passed" });
    expect(credit(ok(facts({ creditLimit: 0 })))).toMatchObject({ status: "passed" });
    expect(credit(ok({ creditOnHold: undefined, creditLimit: undefined, openOrdersTotal: 0, openOrdersCapped: false }))).toMatchObject({ status: "warning" });
  });
  it("warns for a customer not in the ERP and is not_run when the ERP could not be read", () => {
    expect(credit(null, { customerLinked: false })).toMatchObject({ status: "warning", message: expect.stringContaining("not in the ERP yet") });
    expect(credit({ ok: false, reason: "the ERP did not answer" })).toMatchObject({ status: "not_run", message: expect.stringContaining("did not answer") });
  });
});

const pline = (over: Record<string, unknown> = {}) => ({
  lineId: "l1", lineNo: 1, description: "Pump", unitPrice: 100, hasProduct: true, productLinked: true,
  erp: ok({ price: 100, source: "price_list" as const }), ...over,
});
const price = (lines: ReturnType<typeof pline>[]) => comparePrice({ lines: lines as never, currency: "USD" });

describe("price", () => {
  it("passes when every product line matches (within half a percent)", () => {
    expect(price([pline(), pline({ lineId: "l2", lineNo: 2, unitPrice: 100.3 })])).toMatchObject({ status: "passed" });
  });
  it("a difference is a warning, never a failure, and names the line", () => {
    const r = price([pline({ unitPrice: 90 })]);
    expect(r.status).toBe("warning");
    expect(r.message).toContain("priced differently");
    expect(r.message).toContain("Pump");
    expect((r.detail as { lines: { state: string }[] }).lines[0].state).toBe("differs");
  });
  it("warns for a product not in the ERP or without an ERP price; a free-text line is skipped", () => {
    expect(price([pline({ productLinked: false, erp: null })])).toMatchObject({ status: "warning", message: expect.stringContaining("not in the ERP yet") });
    expect(price([pline({ erp: ok({ price: null, source: "product" }) })])).toMatchObject({ status: "warning", message: expect.stringContaining("no ERP price") });
    expect(price([pline(), pline({ lineId: "w", hasProduct: false, productLinked: false, erp: null })])).toMatchObject({ status: "passed" });
  });
  it("is not_run with nothing to compare, or when every price was unreadable", () => {
    expect(price([])).toMatchObject({ status: "not_run" });
    expect(price([pline({ hasProduct: false, productLinked: false, erp: null })])).toMatchObject({ status: "not_run" });
    expect(price([pline({ erp: { ok: false, reason: "the ERP did not answer" } })])).toMatchObject({ status: "not_run", message: expect.stringContaining("did not answer") });
  });
});

const sline = (over: Record<string, unknown> = {}) => ({
  lineId: "l1", lineNo: 1, description: "Pump", qty: 4, uom: "Nos", hasProduct: true, productLinked: true, erp: ok({ onHand: 10 }), ...over,
});
const stock = (lines: ReturnType<typeof sline>[]) => compareStock({ lines: lines as never });

describe("stock", () => {
  it("passes when every line is covered and carries the ERP figure per line", () => {
    const r = stock([sline()]);
    expect(r).toMatchObject({ status: "passed" });
    expect((r.detail as { lines: { line_id: string; on_hand: number }[] }).lines[0]).toMatchObject({ line_id: "l1", on_hand: 10 });
  });
  it("fails when a line asks for more than the ERP has on hand", () => {
    const r = stock([sline({ qty: 12 })]);
    expect(r.status).toBe("failed");
    expect(r.message).toContain("12 asked, 10 on hand");
  });
  it("warns for an unlinked product or a missing figure", () => {
    expect(stock([sline({ productLinked: false, erp: null })])).toMatchObject({ status: "warning", message: expect.stringContaining("not in the ERP yet") });
    expect(stock([sline({ erp: ok({ onHand: null }) })])).toMatchObject({ status: "warning", message: expect.stringContaining("no stock figure") });
  });
  it("is not_run for no product lines or an unreadable ERP", () => {
    expect(stock([sline({ hasProduct: false, productLinked: false, erp: null })])).toMatchObject({ status: "not_run" });
    expect(stock([sline({ erp: { ok: false, reason: "the ERP refused the connection" } })])).toMatchObject({ status: "not_run" });
  });
});

describe("out of date", () => {
  const order = { account_id: "a1", currency: "USD", shipping_amount: 0 };
  const lines: HashLine[] = [{ line_no: 1, product_id: "p1", qty: 2, unit_price: 100, discount_pct: 0, tax_pct: 18 }, { line_no: 2, product_id: null, qty: 1, unit_price: 5, discount_pct: 0, tax_pct: 0 }];
  it("the fingerprint ignores order, text and anything the checks do not read", () => {
    expect(quantityHash(order, lines)).toBe(quantityHash(order, [...lines].reverse()));
    expect(quantityHash(order, lines)).toHaveLength(16);
  });
  it("changes with a quantity, a price, a product, the customer or shipping", () => {
    const base = quantityHash(order, lines);
    expect(quantityHash(order, [{ ...lines[0], qty: 3 }, lines[1]])).not.toBe(base);
    expect(quantityHash(order, [{ ...lines[0], unit_price: 99 }, lines[1]])).not.toBe(base);
    expect(quantityHash(order, [{ ...lines[0], product_id: "p2" }, lines[1]])).not.toBe(base);
    expect(quantityHash({ ...order, account_id: "a2" }, lines)).not.toBe(base);
    expect(quantityHash({ ...order, shipping_amount: 9 }, lines)).not.toBe(base);
  });
  it("a result is stale only when its stored fingerprint differs; a sample with none never is", () => {
    const h = quantityHash(order, lines);
    expect(isStale({ quantity_hash: h }, h)).toBe(false);
    expect(isStale({ quantity_hash: "other" }, h)).toBe(true);
    expect(isStale({ quantity_hash: null }, h)).toBe(false);
    expect(shapeCheck({ kind: "credit", status: "passed", message: "x", detail: null, checked_at: "2026-10-24T10:00:00Z", quantity_hash: "old" }, h)).toMatchObject({ stale: true });
    expect(shapeCheck({ kind: "bogus", status: "passed", message: null, detail: null, checked_at: "x", quantity_hash: null }, h)).toBeNull();
  });
});

const view = (kind: ErpCheckView["kind"], status: ErpCheckView["status"], over: Partial<ErpCheckView> = {}): ErpCheckView =>
  ({ kind, status, message: `${kind} ${status}.`, detail: null, checked_at: "2026-10-24T10:00:00Z", stale: false, ...over });

describe("what must be confirmed before sending", () => {
  it("needs nothing when all three are current passes", () => {
    expect(confirmNeeded([view("credit", "passed"), view("price", "passed"), view("stock", "passed")])).toEqual({ needed: false, items: [] });
  });
  it("lists every check that is not a current pass: never run, out of date, warning, failed, not run", () => {
    const r = confirmNeeded([view("credit", "failed"), view("price", "passed", { stale: true })]);
    expect(r.needed).toBe(true);
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toContain("Credit: failed");
    expect(r.items[1]).toContain("Price: out of date");
    expect(r.items[2]).toBe("Stock: not checked yet");
    expect(confirmNeeded([view("credit", "warning"), view("price", "not_run"), view("stock", "passed")]).items).toHaveLength(2);
  });
  it("words: Out of date beats the stored status, Not checked before the first run", () => {
    expect(checkWord(view("credit", "passed", { stale: true }))).toBe("Out of date");
    expect(checkWord(null)).toBe("Not checked");
    expect(checkWord(view("credit", "failed"))).toBe("Failed");
    expect(checksByKind([view("stock", "passed")]).credit).toBeNull();
  });
  it("the Overview banner names only current failures", () => {
    expect(failedChecksText([view("credit", "failed"), view("stock", "failed", { stale: true }), view("price", "warning")])).toBe("The ERP check for credit failed.");
    expect(failedChecksText([view("credit", "failed"), view("stock", "failed")])).toBe("The ERP checks for credit and stock failed.");
    expect(failedChecksText([view("credit", "passed")])).toBeNull();
  });
});

describe("may this order be sent", () => {
  const base = { origin: "bpmsquare", status: "draft", erpLinked: false, hasAccount: true, customerLinked: true, lineCount: 2, allQuantitiesPositive: true };
  it("is open for a draft or confirmed order with a linked customer and lines", () => {
    expect(sendReadiness(base)).toBeNull();
    expect(sendReadiness({ ...base, status: "confirmed" })).toBeNull();
  });
  it("says why not", () => {
    expect(sendReadiness({ ...base, origin: "erp" })).toMatch(/comes from the ERP/);
    expect(sendReadiness({ ...base, status: "cancelled" })).toMatch(/cancelled/);
    expect(sendReadiness({ ...base, erpLinked: true })).toMatch(/already in the ERP/);
    expect(sendReadiness({ ...base, customerLinked: false })).toMatch(/not in the ERP yet/);
    expect(sendReadiness({ ...base, lineCount: 0 })).toMatch(/at least one line/);
    expect(sendReadiness({ ...base, allQuantitiesPositive: false })).toMatch(/quantity/);
  });
  it("a check asks less: an unlinked customer is a warning there, not a refusal", () => {
    expect(sendReadiness({ ...base, customerLinked: false, forCheck: true })).toBeNull();
    expect(sendReadiness({ ...base, lineCount: 0, forCheck: true })).toMatch(/at least one line/);
  });
});
