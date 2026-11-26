import { describe, expect, it } from "vitest";
import {
  canCancelExpense, canDecideExpense, cleanExpenseInput, exposureTotals, expenseFlags, findDuplicate, projectAmount, recordedAmount, reasonProblem,
} from "./expenseRules";
import {
  acceptedByLine, balanceAfter, cleanReceiptInput, cleanReceiptLine, discrepancyLines, lineState, receiptOutcome, receivedValueByPackage, summarise,
} from "./receiptRules";

const P = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const base = { client_id: C, project_id: P, amount: "412.85", expense_date: "2026-11-20" };
const opts = { today: "2026-11-23", projectCurrency: "SAR" };

describe("cleanExpenseInput", () => {
  it("accepts a plain expense and defaults the currency, paid by and document state", () => {
    const r = cleanExpenseInput(base, opts);
    expect(r.ok && r.value).toMatchObject({ amount: 412.85, currency: "SAR", amount_project_ccy: 412.85, paid_by: "company", document_state: "receipt_attached", category_id: null });
  });
  it("needs an idempotency key, a project, a positive amount and a real date", () => {
    expect(cleanExpenseInput({ ...base, client_id: "x" }, opts)).toMatchObject({ ok: false });
    expect(cleanExpenseInput({ ...base, project_id: "" }, opts)).toMatchObject({ ok: false });
    expect(cleanExpenseInput({ ...base, amount: 0 }, opts)).toMatchObject({ ok: false });
    expect(cleanExpenseInput({ ...base, amount: "abc" }, opts)).toMatchObject({ ok: false });
    expect(cleanExpenseInput({ ...base, expense_date: "2026-02-30" }, opts)).toMatchObject({ ok: false });
    expect(cleanExpenseInput({ ...base, amount: 1e12 }, opts)).toMatchObject({ ok: false });
  });
  it("refuses a date in the future or more than a year back, and allows one day of clock difference", () => {
    expect(cleanExpenseInput({ ...base, expense_date: "2026-11-30" }, opts)).toMatchObject({ ok: false });
    expect(cleanExpenseInput({ ...base, expense_date: "2026-11-24" }, opts)).toMatchObject({ ok: true });
    expect(cleanExpenseInput({ ...base, expense_date: "2025-01-01" }, opts)).toMatchObject({ ok: false });
  });
  it("a foreign currency has no project amount until the approver enters it", () => {
    const r = cleanExpenseInput({ ...base, currency: "usd" }, opts);
    expect(r.ok && r.value).toMatchObject({ currency: "USD", amount_project_ccy: null });
  });
  it("keeps the VAT within the amount", () => {
    expect(cleanExpenseInput({ ...base, vat_amount: 53.85 }, opts)).toMatchObject({ ok: true });
    expect(cleanExpenseInput({ ...base, vat_amount: 999999 }, opts)).toMatchObject({ ok: false });
  });
  it("ignores a tenant or status the client tries to send, and keeps only shaped ids", () => {
    const r = cleanExpenseInput({ ...base, tenant_id: "evil", status: "approved", category_id: "not-a-uuid", line_key: P }, opts);
    expect(r.ok && Object.keys(r.value)).not.toContain("tenant_id");
    expect(r.ok && Object.keys(r.value)).not.toContain("status");
    expect(r.ok && r.value.category_id).toBeNull();
    expect(r.ok && r.value.line_key).toBe(P);
  });
});

describe("what counts as cost", () => {
  const e = (over: Record<string, unknown> = {}) => ({ status: "approved", amount: 100, currency: "SAR", amount_project_ccy: 100, posted_amount: null, erp_state: "not_sent", ...over });
  it("a waiting or returned expense adds no recorded cost; an approved one does at once", () => {
    expect(recordedAmount(e({ status: "submitted" }), "SAR")).toBe(0);
    expect(recordedAmount(e({ status: "rejected" }), "SAR")).toBe(0);
    expect(recordedAmount(e({ status: "cancelled" }), "SAR")).toBe(0);
    expect(recordedAmount(e(), "SAR")).toBe(100);
  });
  it("the posted amount replaces the recorded one, never added to it", () => {
    const posted = e({ erp_state: "posted", posted_amount: 98.5 });
    expect(recordedAmount(posted, "SAR")).toBe(98.5);
    expect(exposureTotals([posted, e()], "SAR")).toEqual({ waiting: 0, recorded: 100, posted: 98.5, unconverted: 0 });
  });
  it("splits waiting, recorded and posted, and counts a foreign amount nobody converted apart", () => {
    const list = [e({ status: "submitted", amount: 40, amount_project_ccy: 40 }), e(), e({ currency: "USD", amount_project_ccy: null }), e({ status: "rejected" })];
    expect(exposureTotals(list, "SAR")).toEqual({ waiting: 40, recorded: 100, posted: 0, unconverted: 1 });
    expect(projectAmount({ amount: 5, currency: "USD", amount_project_ccy: null }, "SAR")).toBeNull();
  });
});

describe("duplicates and warnings", () => {
  const prior = { id: "a", project_id: P, amount: 412.85, currency: "SAR", vendor_text: "Eastern Crane Rental", expense_date: "2026-11-01", status: "approved" };
  const cand = { project_id: P, amount: 412.85, currency: "SAR", vendor_text: "  eastern crane rental ", expense_date: "2026-11-20", status: "submitted" };
  it("finds the same amount, vendor and project inside 60 days", () => {
    expect(findDuplicate(cand, [prior])?.id).toBe("a");
  });
  it("ignores another project, a returned or cancelled one, another amount and anything older than 60 days", () => {
    expect(findDuplicate(cand, [{ ...prior, project_id: C }])).toBeNull();
    expect(findDuplicate(cand, [{ ...prior, status: "rejected" }])).toBeNull();
    expect(findDuplicate(cand, [{ ...prior, status: "cancelled" }])).toBeNull();
    expect(findDuplicate(cand, [{ ...prior, amount: 413 }])).toBeNull();
    expect(findDuplicate(cand, [{ ...prior, expense_date: "2026-08-01" }])).toBeNull();
  });
  it("the same photo is a duplicate even with another vendor text", () => {
    expect(findDuplicate({ ...cand, vendor_text: null, photo_hash: "h" }, [{ ...prior, vendor_text: "x", photo_hash: "h" }])?.id).toBe("a");
  });
  it("flags over the limit, over the monthly cap, a duplicate and a missing line; never blocks", () => {
    const f = expenseFlags({ amountInProject: 3000, categoryLimit: 2000, config: { pm_limit: 5000, monthly_cap: 10000 }, monthSoFar: 8000, hasLine: false, duplicate: true });
    expect(f).toEqual(["duplicate", "over_limit", "over_cap", "no_line"]);
    expect(expenseFlags({ amountInProject: 100, categoryLimit: null, config: null, monthSoFar: 0, hasLine: true, duplicate: false })).toEqual([]);
  });
});

describe("who may decide an expense", () => {
  const ctx = { actorId: "pm", actorIsAdmin: false, submitterId: "site", managerId: "pm", costApprovers: ["cost"], allowSelfApproval: false, amountInProject: 500, categoryLimit: null, config: { pm_limit: 1000 } };
  it("the project manager decides within the limit; the submitter and a stranger cannot", () => {
    expect(canDecideExpense(ctx)).toEqual({ ok: true, level: "manager" });
    expect(canDecideExpense({ ...ctx, actorId: "site" })).toMatchObject({ ok: false, status: 403 });
    expect(canDecideExpense({ ...ctx, actorId: "someone" })).toMatchObject({ ok: false, status: 403 });
  });
  it("above the manager's limit only a cost approver may, and an admin always may", () => {
    expect(canDecideExpense({ ...ctx, amountInProject: 2000 })).toMatchObject({ ok: false, status: 403 });
    expect(canDecideExpense({ ...ctx, amountInProject: 2000, actorId: "cost" })).toEqual({ ok: true, level: "cost" });
    expect(canDecideExpense({ ...ctx, amountInProject: 2000, actorId: "adm", actorIsAdmin: true })).toEqual({ ok: true, level: "cost" });
  });
  it("a manager who submitted needs a cost approver; self-approval is only by the workspace switch", () => {
    expect(canDecideExpense({ ...ctx, submitterId: "pm" })).toMatchObject({ ok: false });
    expect(canDecideExpense({ ...ctx, submitterId: "pm", actorId: "cost" })).toEqual({ ok: true, level: "cost" });
    expect(canDecideExpense({ ...ctx, submitterId: "pm", allowSelfApproval: true })).toEqual({ ok: true, level: "manager" });
  });
  it("a category limit also stops the manager", () => {
    expect(canDecideExpense({ ...ctx, categoryLimit: 300 })).toMatchObject({ ok: false });
  });
  it("cancel: the submitter while waiting or returned, a decider until the ERP has it, nobody after", () => {
    const c = { status: "submitted", erpState: "not_sent", actorId: "site", submitterId: "site", isDecider: false };
    expect(canCancelExpense(c)).toEqual({ ok: true });
    expect(canCancelExpense({ ...c, status: "approved" })).toMatchObject({ ok: false });
    expect(canCancelExpense({ ...c, status: "approved", actorId: "pm", isDecider: true })).toEqual({ ok: true });
    expect(canCancelExpense({ ...c, status: "approved", erpState: "sent", actorId: "pm", isDecider: true })).toMatchObject({ ok: false });
    expect(canCancelExpense({ ...c, status: "cancelled" })).toMatchObject({ ok: false });
  });
  it("a reason is at least three characters", () => {
    expect(reasonProblem("no")).not.toBeNull();
    expect(reasonProblem("Wrong job")).toBeNull();
  });
});

const line = (over: Record<string, unknown> = {}) => ({ description: "Hollow-core slab", element_code: "HCS-B2-014", qty_expected: 8, qty_received: 8, ...over });

describe("receipt lines", () => {
  it("All OK needs no reason", () => {
    const r = cleanReceiptLine(line(), 0);
    expect(r.ok && r.value).toMatchObject({ qty_accepted: 8, qty_rejected: 0, condition: "ok", reason_code: null });
    expect(r.ok && lineState(r.value)).toBe("ok");
  });
  it("accepted plus rejected must equal what arrived", () => {
    expect(cleanReceiptLine(line({ qty_accepted: 5, qty_rejected: 1 }), 0)).toMatchObject({ ok: false });
    expect(cleanReceiptLine(line({ qty_accepted: 7, qty_rejected: 1, reason_code: "cracked" }), 0)).toMatchObject({ ok: true });
  });
  it("short, over, rejected and damaged each need a reason; Other needs a note", () => {
    expect(cleanReceiptLine(line({ qty_received: 6 }), 0)).toMatchObject({ ok: false });
    expect(cleanReceiptLine(line({ qty_received: 6, reason_code: "not_delivered" }), 0)).toMatchObject({ ok: true });
    expect(cleanReceiptLine(line({ qty_received: 9 }), 0)).toMatchObject({ ok: false });
    expect(cleanReceiptLine(line({ qty_received: 9, reason_code: "other" }), 0)).toMatchObject({ ok: false });
    expect(cleanReceiptLine(line({ qty_received: 9, reason_code: "other", note: "Extra one sent" }), 0)).toMatchObject({ ok: true });
    expect(cleanReceiptLine(line({ condition: "damaged" }), 0)).toMatchObject({ ok: false });
    expect(cleanReceiptLine(line({ condition: "damaged", reason_code: "damaged_in_transit" }), 0)).toMatchObject({ ok: true });
  });
  it("refuses a reason that is not on the list and a negative quantity", () => {
    expect(cleanReceiptLine(line({ qty_received: 6, reason_code: "because" }), 0)).toMatchObject({ ok: false });
    expect(cleanReceiptLine(line({ qty_received: -1 }), 0)).toMatchObject({ ok: false });
  });
  it("a whole delivery rejected is one outcome, a gap is partial, a clean one complete", () => {
    const ok = cleanReceiptLine(line(), 0);
    const rej = cleanReceiptLine(line({ qty_accepted: 0, qty_rejected: 8, reason_code: "wrong_element" }), 0);
    const short = cleanReceiptLine(line({ qty_received: 6, reason_code: "not_delivered" }), 0);
    if (!ok.ok || !rej.ok || !short.ok) throw new Error("setup");
    expect(receiptOutcome([ok.value])).toBe("complete");
    expect(receiptOutcome([ok.value, short.value])).toBe("partial");
    expect(receiptOutcome([rej.value])).toBe("rejected");
    expect(receiptOutcome([rej.value, ok.value])).toBe("partial");
    expect(summarise([ok.value, short.value])).toMatchObject({ accepted: 14, short: 2 });
    expect(discrepancyLines([ok.value, short.value])).toEqual(["HCS-B2-014 Hollow-core slab: short 2 (Not delivered)"]);
  });
});

describe("cleanReceiptInput", () => {
  const body = { client_id: C, project_id: P, lines: [line()] };
  const now = new Date("2026-11-23T10:00:00Z");
  it("needs a project, a client id and at least one item", () => {
    expect(cleanReceiptInput(body, { now })).toMatchObject({ ok: true });
    expect(cleanReceiptInput({ ...body, lines: [] }, { now })).toMatchObject({ ok: false });
    expect(cleanReceiptInput({ ...body, project_id: "x" }, { now })).toMatchObject({ ok: false });
    expect(cleanReceiptInput({ ...body, client_id: undefined }, { now })).toMatchObject({ ok: false });
  });
  it("keeps the capture time but not a future one or one over a week old", () => {
    const r = cleanReceiptInput({ ...body, received_at: "2026-11-22T08:00:00Z" }, { now });
    expect(r.ok && r.value.received_at).toBe("2026-11-22T08:00:00.000Z");
    expect(cleanReceiptInput({ ...body, received_at: "2026-11-24T08:00:00Z" }, { now })).toMatchObject({ ok: false });
    expect(cleanReceiptInput({ ...body, received_at: "2026-11-01T08:00:00Z" }, { now })).toMatchObject({ ok: false });
  });
  it("element and building stay free text and never need the element master", () => {
    const r = cleanReceiptInput({ ...body, lines: [{ ...line(), building: "B2" }, { description: "Loose item", qty_received: 3 }] }, { now });
    expect(r.ok && r.value.lines[1]).toMatchObject({ element_code: null, building: null, line_key: null, qty_expected: null });
  });
});

describe("received value per package", () => {
  it("is the accepted quantity times the awarded rate; a cancelled receipt counts for nothing", () => {
    const key = "33333333-3333-4333-8333-333333333333";
    const accepted = acceptedByLine([
      { status: "confirmed", lines: [{ line_key: key, qty_accepted: 6 }] },
      { status: "confirmed", lines: [{ line_key: key, qty_accepted: 2 }, { line_key: null, qty_accepted: 99 }] },
      { status: "cancelled", lines: [{ line_key: key, qty_accepted: 50 }] },
    ]);
    expect(accepted.get(key)).toBe(8);
    const [pkg] = receivedValueByPackage([{ package_id: "p", committed: 1000, lines: [{ line_key: key, qty: 10, unit_cost: 100 }] }], accepted);
    expect(pkg).toEqual({ package_id: "p", committed: 1000, received_value: 800, still_to_receive: 200 });
  });
  it("the balance of a delivery note after earlier trucks never goes below zero", () => {
    expect(balanceAfter(12, 8)).toBe(4);
    expect(balanceAfter(12, 15)).toBe(0);
    expect(balanceAfter(null, 3)).toBeNull();
  });
});
