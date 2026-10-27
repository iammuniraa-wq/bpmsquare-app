import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "@/lib/marketing/testFakeDb";

let current: ReturnType<typeof fakeDb>;
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => current.client }));

const e = await import("./emitters");
const { emitQuotationOutcome } = await import("./quotationOutcome");
const events = () => current.tables.domain_event ?? [];

beforeEach(() => { current = fakeDb(); });

const UUID_CONTACT = "11111111-1111-4111-8111-111111111111";

describe("the event emitters added for the sales hand-overs", () => {
  it("quote.accepted: one row, tenant-scoped, ids and labels only, and a retry does not double it", async () => {
    const p = { quoteId: "q1", objectType: "standard_quote" as const, ref: "SQ-1", total: 500, accountId: "a1", contactId: UUID_CONTACT, actorId: "u1" };
    await e.emitQuoteAccepted("t1", p);
    await e.emitQuoteAccepted("t1", p);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ tenant_id: "t1", name: "quote.accepted", object_type: "standard_quote", object_id: "q1", account_id: "a1", contact_id: UUID_CONTACT });
    expect(events()[0].payload).toEqual({ ref: "SQ-1", total: 500 });
  });

  it("quote.accepted drops a Quotation contact that is free text rather than an id", async () => {
    await e.emitQuoteAccepted("t1", { quoteId: "q1", objectType: "quote", ref: "QT-1", contactId: "Mr Sharma", accountId: "a1" });
    expect(events()[0].contact_id).toBeNull();
  });

  it("the same quote id in two tenants records two events, never one shared one", async () => {
    await e.emitQuoteAccepted("t1", { quoteId: "q1", objectType: "quote" });
    await e.emitQuoteAccepted("t2", { quoteId: "q1", objectType: "quote" });
    expect(events().map((r) => r.tenant_id).sort()).toEqual(["t1", "t2"]);
  });

  it("work_order.completed, quote.created, quote.outcome_changed, opportunity.updated fire once with a payload of ids and labels", async () => {
    await e.emitWorkOrderCompleted("t1", { workOrderId: "w1", ref: "WO-1", from: "in_progress", accountId: "a1", caseId: "c1" });
    await e.emitWorkOrderCompleted("t1", { workOrderId: "w1", ref: "WO-1", from: "in_progress", accountId: "a1", caseId: "c1" });
    await e.emitQuoteCreated("t1", { quoteId: "q1", objectType: "standard_quote", ref: "SQ-1", total: 10, accountId: "a1", from: "QT-1" });
    await e.emitQuoteOutcomeChanged("t1", { quoteId: "q2", ref: "QT-2", from: "open", to: "lost", accountId: "a1" });
    await e.emitOpportunityUpdated("t1", { opportunityId: "o1", ref: "OPP-1", fields: ["title"], accountId: "a1", stamp: "s1" });
    expect(events().map((r) => r.name)).toEqual(["work_order.completed", "quote.created", "quote.outcome_changed", "opportunity.updated"]);
    expect(events().every((r) => r.tenant_id === "t1")).toBe(true);
    expect(events()[0].payload).toEqual({ ref: "WO-1", from: "in_progress", case_id: "c1" });
  });

  it("quote.revised is about the new version and names the old one by id and ref", async () => {
    const p = { quoteId: "q2", ref: "QT-1-R2", revisedFrom: "QT-1", previousId: "q1", revision: 2, accountId: "a1" };
    await e.emitQuoteRevised("t1", p);
    await e.emitQuoteRevised("t1", p);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ tenant_id: "t1", name: "quote.revised", object_type: "quote", object_id: "q2" });
    expect(events()[0].payload).toEqual({ ref: "QT-1-R2", revised_from: "QT-1", previous_id: "q1", revision: 2 });
  });

  it("rfq.sent is one per supplier (a reminder is not a second), rfq.replied once per supplier, rfq.awarded once per line award", async () => {
    await e.emitRfqSent("t1", { rfqId: "r1", rfqSupplierId: "s1", supplierId: "sup1", ref: "RFQ-1" });
    await e.emitRfqSent("t1", { rfqId: "r1", rfqSupplierId: "s1", supplierId: "sup1", ref: "RFQ-1" });
    await e.emitRfqSent("t1", { rfqId: "r1", rfqSupplierId: "s2", supplierId: "sup2", ref: "RFQ-1" });
    await e.emitRfqReplied("t1", { rfqId: "r1", rfqSupplierId: "s1", source: "link", declined: false, lines: 3 });
    await e.emitRfqReplied("t1", { rfqId: "r1", rfqSupplierId: "s1", source: "buyer", declined: false, lines: 3 });
    await e.emitRfqAwarded("t1", { rfqId: "r1", ref: "RFQ-1", lineId: "l1", responseId: "x1", supplierId: "sup1", unitCost: 9.5 });
    await e.emitRfqAwarded("t1", { rfqId: "r1", ref: "RFQ-1", lineId: "l1", responseId: "x1", supplierId: "sup1", unitCost: 9.5 });
    await e.emitRfqAwarded("t1", { rfqId: "r1", ref: "RFQ-1", lineId: "l2", responseId: "x2", supplierId: "sup1", unitCost: 4 });
    const count = (n: string) => events().filter((r) => r.name === n).length;
    expect(count("rfq.sent")).toBe(2);
    expect(count("rfq.replied")).toBe(1);
    expect(count("rfq.awarded")).toBe(2);
    expect(events().every((r) => r.object_type === "rfq" && r.object_id === "r1" && r.tenant_id === "t1")).toBe(true);
  });
});

describe("emitQuotationOutcome (in-app and v1 Quotation PATCH)", () => {
  const before = { id: "q1", ref: "QT-1", account_id: "a1", contact_id: UUID_CONTACT, outcome: "open", total: 100 };

  it("a won outcome fires quote.outcome_changed and quote.accepted, once each", async () => {
    await emitQuotationOutcome("t1", before, { ...before, outcome: "won" }, "u1");
    await emitQuotationOutcome("t1", before, { ...before, outcome: "won" }, "u1");
    expect(events().map((r) => r.name).sort()).toEqual(["quote.accepted", "quote.outcome_changed"]);
    expect(events().every((r) => r.tenant_id === "t1" && r.object_type === "quote" && r.object_id === "q1")).toBe(true);
  });

  it("lost fires only outcome_changed; an unchanged outcome fires nothing", async () => {
    await emitQuotationOutcome("t1", before, { ...before, outcome: "lost" });
    expect(events().map((r) => r.name)).toEqual(["quote.outcome_changed"]);
    current = fakeDb();
    await emitQuotationOutcome("t1", before, { ...before, outcome: "open" });
    await emitQuotationOutcome("t1", before, null);
    expect(events()).toHaveLength(0);
  });

  it("an already-won quote saved again does not announce another win", async () => {
    const won = { ...before, outcome: "won" };
    await emitQuotationOutcome("t1", won, { ...won, total: 120 });
    expect(events()).toHaveLength(0);
  });
});
