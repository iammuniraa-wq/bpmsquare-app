import { describe, expect, it } from "vitest";
import {
  answerAge, awardDecision, buildComparison, chaseInfo, cleanReason, coverage, daysBetween, lowestByLine, needsFx, responseValidity, supplierTotal,
  type CompareResponse,
} from "./comparison";

const TODAY = "2026-10-26";

let n = 0;
const resp = (over: Partial<CompareResponse> & Pick<CompareResponse, "rfq_supplier_id" | "rfq_line_id">): CompareResponse => ({
  id: `r${++n}`, status: "quoted", unit_price: 100, fx_rate: null, currency: "SAR", lead_time_days: null, moq: null, valid_until: "2026-12-31",
  note: null, submitted_at: "2026-10-20T08:00:00Z", ...over,
});

describe("responseValidity", () => {
  it("a validity date is valid through that day and expired after it", () => {
    expect(responseValidity({ valid_until: "2026-10-26", submitted_at: "2026-01-01T00:00:00Z" }, TODAY)).toBe("ok");
    expect(responseValidity({ valid_until: "2026-10-25", submitted_at: "2026-10-01T00:00:00Z" }, TODAY)).toBe("expired");
  });
  it("without a validity date an answer is stale once older than the workspace limit (180 days by default)", () => {
    expect(responseValidity({ valid_until: null, submitted_at: "2026-05-01T00:00:00Z" }, TODAY)).toBe("ok"); // 178 days
    expect(responseValidity({ valid_until: null, submitted_at: "2026-04-01T00:00:00Z" }, TODAY)).toBe("stale"); // 208 days
    expect(responseValidity({ valid_until: null, submitted_at: "2026-09-01T00:00:00Z" }, TODAY, 30)).toBe("stale");
  });
  it("a stated validity date beats age: an old answer that is still within its validity is fine", () => {
    expect(responseValidity({ valid_until: "2027-03-01", submitted_at: "2025-01-01T00:00:00Z" }, TODAY)).toBe("ok");
  });
});

describe("lowest valid price per line", () => {
  it("is the lowest landed price among valid answers; an expired cheaper one is never the benchmark", () => {
    const rs = [
      resp({ rfq_supplier_id: "a", rfq_line_id: "L1", unit_price: 90, valid_until: "2026-09-30" }), // cheapest but expired
      resp({ rfq_supplier_id: "b", rfq_line_id: "L1", unit_price: 110 }),
      resp({ rfq_supplier_id: "c", rfq_line_id: "L1", unit_price: 105 }),
    ];
    const { valid, any } = lowestByLine(rs, TODAY);
    expect(valid.get("L1")?.landed).toBe(105);
    expect(any.get("L1")?.landed).toBe(90);
  });
  it("uses the exchange rate and ignores no-quotes and zero prices", () => {
    const rs = [
      resp({ rfq_supplier_id: "a", rfq_line_id: "L1", unit_price: 30, currency: "USD", fx_rate: 3.75 }), // 112.5
      resp({ rfq_supplier_id: "b", rfq_line_id: "L1", unit_price: 111 }),
      resp({ rfq_supplier_id: "c", rfq_line_id: "L1", status: "no_quote", unit_price: null }),
      resp({ rfq_supplier_id: "d", rfq_line_id: "L1", unit_price: 0 }),
    ];
    expect(lowestByLine(rs, TODAY).valid.get("L1")?.landed).toBe(111);
  });
  it("a line with no valid answer has no valid benchmark but still has a lowest of any", () => {
    const rs = [resp({ rfq_supplier_id: "a", rfq_line_id: "L1", unit_price: 80, valid_until: "2026-01-01" })];
    const { valid, any } = lowestByLine(rs, TODAY);
    expect(valid.has("L1")).toBe(false);
    expect(any.get("L1")?.landed).toBe(80);
  });
});

describe("awardDecision: when a reason is needed", () => {
  const line = [
    resp({ id: "low", rfq_supplier_id: "a", rfq_line_id: "L1", unit_price: 100 }),
    resp({ id: "mid", rfq_supplier_id: "b", rfq_line_id: "L1", unit_price: 120 }),
    resp({ id: "tie", rfq_supplier_id: "c", rfq_line_id: "L1", unit_price: 100 }),
    resp({ id: "old", rfq_supplier_id: "d", rfq_line_id: "L1", unit_price: 70, valid_until: "2026-09-01" }),
    resp({ id: "stale", rfq_supplier_id: "e", rfq_line_id: "L1", unit_price: 60, valid_until: null, submitted_at: "2026-02-01T00:00:00Z" }),
  ];
  it("the lowest valid price needs none, and neither does an exact tie with it", () => {
    expect(awardDecision("low", line, TODAY).notLowest).toBe(false);
    expect(awardDecision("tie", line, TODAY).notLowest).toBe(false);
  });
  it("a dearer price needs one, and says so as 'higher'", () => {
    const d = awardDecision("mid", line, TODAY);
    expect(d).toMatchObject({ notLowest: true, why: "higher", lowestValid: 100, landed: 120 });
  });
  it("an expired or stale answer needs one even when it is the cheapest on the line", () => {
    expect(awardDecision("old", line, TODAY)).toMatchObject({ notLowest: true, why: "expired", validity: "expired" });
    expect(awardDecision("stale", line, TODAY)).toMatchObject({ notLowest: true, why: "stale", validity: "stale" });
  });
  it("when nothing on the line is valid, the cheapest answer is the benchmark", () => {
    const dead = [
      resp({ id: "x", rfq_supplier_id: "a", rfq_line_id: "L2", unit_price: 50, valid_until: "2026-01-01" }),
      resp({ id: "y", rfq_supplier_id: "b", rfq_line_id: "L2", unit_price: 70, valid_until: "2026-01-01" }),
    ];
    expect(awardDecision("x", dead, TODAY).notLowest).toBe(false);
    expect(awardDecision("y", dead, TODAY).notLowest).toBe(true);
  });
  it("the exchange rate the buyer types decides whether a foreign quote is the lowest", () => {
    const fx = [
      resp({ id: "usd", rfq_supplier_id: "a", rfq_line_id: "L3", unit_price: 30, currency: "USD", fx_rate: null }),
      resp({ id: "sar", rfq_supplier_id: "b", rfq_line_id: "L3", unit_price: 105 }),
    ];
    expect(awardDecision("usd", fx, TODAY, 180, 3.75).notLowest).toBe(true); // 112.5 against 105
    expect(awardDecision("usd", fx, TODAY, 180, 3).notLowest).toBe(false); // 90 against 105
  });
  it("an unknown answer id decides nothing", () => {
    expect(awardDecision("nope", line, TODAY)).toMatchObject({ notLowest: false, landed: null });
  });
});

describe("the reason text", () => {
  it("is trimmed and needs at least three characters", () => {
    expect(cleanReason("  Closer to site  ")).toBe("Closer to site");
    expect(cleanReason("ok")).toBeNull();
    expect(cleanReason("   ")).toBeNull();
    expect(cleanReason(42)).toBeNull();
    expect(cleanReason("x".repeat(1500))?.length).toBe(1000);
  });
});

describe("coverage and totals", () => {
  const lines = [{ id: "L1", qty: 10 }, { id: "L2", qty: 2 }, { id: "L3", qty: null }];
  const mine = [
    resp({ rfq_supplier_id: "a", rfq_line_id: "L1", unit_price: 5 }),
    resp({ rfq_supplier_id: "a", rfq_line_id: "L2", status: "no_quote", unit_price: null }),
    resp({ rfq_supplier_id: "a", rfq_line_id: "L3", unit_price: 7 }),
  ];
  it("covers N of M counts only quoted lines", () => {
    expect(coverage(["L1", "L2", "L3"], mine)).toEqual({ quoted: 2, total: 3 });
  });
  it("totals quantity times landed price for the quoted lines, a missing quantity counting as 1", () => {
    expect(supplierTotal(lines, mine)).toBe(57); // 10*5 + 1*7
  });
  it("a foreign quote totals at the exchange rate", () => {
    expect(supplierTotal([{ id: "L1", qty: 2 }], [resp({ rfq_supplier_id: "a", rfq_line_id: "L1", unit_price: 10, currency: "USD", fx_rate: 3.75 })])).toBe(75);
  });
});

describe("small helpers", () => {
  it("needsFx: a foreign quote with no rate typed yet", () => {
    expect(needsFx({ currency: "USD", fx_rate: null }, "SAR")).toBe(true);
    expect(needsFx({ currency: "USD", fx_rate: 3.75 }, "SAR")).toBe(false);
    expect(needsFx({ currency: "sar", fx_rate: null }, "SAR")).toBe(false);
    expect(needsFx({ currency: null, fx_rate: null }, "SAR")).toBe(false);
  });
  it("answerAge reads in plain words", () => {
    expect(answerAge("2026-10-26T01:00:00Z", TODAY)).toBe("today");
    expect(answerAge("2026-10-23T00:00:00Z", TODAY)).toBe("3 d ago");
    expect(answerAge("2026-10-05T00:00:00Z", TODAY)).toBe("3 wk ago");
    expect(answerAge("2026-03-26T00:00:00Z", TODAY)).toBe("7 mo ago");
  });
  it("daysBetween is signed and whole", () => {
    expect(daysBetween("2026-10-20", "2026-10-26")).toBe(6);
    expect(daysBetween("2026-10-26", "2026-10-20")).toBe(-6);
  });
});

describe("chaseInfo: the next reminder for a supplier who has not answered", () => {
  it("is the day before the deadline, then the day after", () => {
    expect(chaseInfo({ reminder_count: 0, last_reminded_at: null }, "2026-10-28", 2, TODAY)).toEqual({ date: "2026-10-27", overdue: false });
    expect(chaseInfo({ reminder_count: 1, last_reminded_at: "2026-10-27T04:00:00Z" }, "2026-10-28", 2, "2026-10-27")).toEqual({ date: "2026-10-29", overdue: false });
  });
  it("is overdue once the reminders are used up and the deadline has passed", () => {
    expect(chaseInfo({ reminder_count: 2, last_reminded_at: "2026-10-25T00:00:00Z" }, "2026-10-24", 2, TODAY)).toEqual({ date: "2026-10-24", overdue: true });
  });
  it("has nothing to say with no deadline or no reminders left before it", () => {
    expect(chaseInfo({ reminder_count: 0, last_reminded_at: null }, null, 2, TODAY)).toEqual({ date: null, overdue: false });
    expect(chaseInfo({ reminder_count: 2, last_reminded_at: null }, "2026-11-10", 2, TODAY)).toEqual({ date: null, overdue: false });
  });
});

describe("buildComparison", () => {
  const lines = [{ id: "L1", qty: 4 }, { id: "L2", qty: 1 }];
  const suppliers = [
    { id: "a", status: "replied" as const, reminder_count: 0, last_reminded_at: null },
    { id: "b", status: "replied" as const, reminder_count: 0, last_reminded_at: null },
    { id: "c", status: "sent" as const, reminder_count: 0, last_reminded_at: null },
    { id: "d", status: "pending" as const, reminder_count: 0, last_reminded_at: null },
  ];
  const responses = [
    resp({ id: "a1", rfq_supplier_id: "a", rfq_line_id: "L1", unit_price: 10 }),
    resp({ id: "a2", rfq_supplier_id: "a", rfq_line_id: "L2", unit_price: 50, valid_until: "2026-10-01" }),
    resp({ id: "b1", rfq_supplier_id: "b", rfq_line_id: "L1", unit_price: 12 }),
  ];
  const cmp = buildComparison({ lines, suppliers, responses, today: TODAY, tenantCurrency: "SAR", respondBy: "2026-10-28", maxReminders: 2 });

  it("marks the lowest valid cell per line and flags the expired one", () => {
    expect(cmp.cells.get("L1")?.get("a")).toMatchObject({ lowestValid: true, validity: "ok" });
    expect(cmp.cells.get("L1")?.get("b")).toMatchObject({ lowestValid: false });
    expect(cmp.cells.get("L2")?.get("a")).toMatchObject({ lowestValid: false, lowestAny: true, validity: "expired" });
  });
  it("one column per supplier with coverage, total and a waiting state carrying the chase date", () => {
    const [a, b, c, d] = cmp.columns;
    expect(a).toMatchObject({ answered: true, waiting: false, cover: { quoted: 2, total: 2 }, total: 90 });
    expect(b).toMatchObject({ answered: true, cover: { quoted: 1, total: 2 }, total: 48 });
    expect(c).toMatchObject({ answered: false, waiting: true, chase: { date: "2026-10-27", overdue: false } });
    expect(d).toMatchObject({ notSent: true, waiting: false, chase: null });
  });
  it("a supplier with no row on a line has no cell there", () => {
    expect(cmp.cells.get("L2")?.get("b")).toBeUndefined();
  });
});
