import { describe, expect, it } from "vitest";
import { deliveryCounts, deliverySummary, noContactNotice, supplierDelivery, type DeliveryFacts } from "./delivery";

const f = (over: Partial<DeliveryFacts> = {}): DeliveryFacts => ({ status: "pending", sent_at: null, reply_source: null, email_to: null, supplier_email: null, supplier_phone: null, ...over });

describe("a supplier's delivery state", () => {
  it("is Not sent with the reason when there is no contact on file", () => {
    expect(supplierDelivery(f())).toMatchObject({ key: "no_contact", label: "Not sent: no contact on file" });
    expect(supplierDelivery(f({ supplier_phone: "+966500000000" }))).toMatchObject({ key: "no_email", label: "Not sent: no email on file" });
    expect(supplierDelivery(f({ email_to: "a@b.co" }))).toMatchObject({ key: "not_sent", label: "Not sent" });
    expect(supplierDelivery(f({ supplier_email: "a@b.co" })).key).toBe("not_sent");
  });

  it("is Sent or Opened once a request went out", () => {
    expect(supplierDelivery(f({ status: "sent", sent_at: "2026-11-20T10:00:00Z" })).label).toBe("Sent");
    expect(supplierDelivery(f({ status: "viewed", sent_at: "2026-11-20T10:00:00Z" })).label).toBe("Opened");
  });

  it("says how a reply arrived", () => {
    expect(supplierDelivery(f({ status: "replied", reply_source: "link" })).label).toBe("Replied by link");
    expect(supplierDelivery(f({ status: "replied", reply_source: "buyer" })).label).toBe("Reply entered by hand");
    expect(supplierDelivery(f({ status: "replied", reply_source: null })).label).toBe("Reply entered by hand");
    expect(supplierDelivery(f({ status: "replied", reply_source: "upload" })).label).toBe("Reply sheet uploaded");
    expect(supplierDelivery(f({ status: "replied", reply_source: "email" })).label).toBe("Replied by email");
    expect(supplierDelivery(f({ status: "declined", reply_source: "buyer" })).label).toBe("Declined, entered by hand");
  });

  it("never reads a hand-entered reply as sent", () => {
    expect(supplierDelivery(f({ status: "replied", reply_source: "buyer", sent_at: null })).key).toBe("by_hand");
  });
});

describe("the RFQ delivery summary", () => {
  const three = [f({ status: "replied", reply_source: "buyer" }), f({ status: "replied", reply_source: "buyer" }), f({ status: "replied", reply_source: "buyer" })];

  it("does not say all sent when three suppliers had no contact and their replies were typed in", () => {
    const c = deliveryCounts(three);
    expect(c).toEqual({ invited: 3, sent: 0, notSent: 3, noContact: 0, byHand: 3 });
    expect(deliverySummary(c)).toBe("0 sent, 3 replies entered by hand");
  });

  it("says all sent only when every invited supplier was sent a request", () => {
    const sent = f({ status: "sent", sent_at: "2026-11-20T10:00:00Z" });
    expect(deliverySummary(deliveryCounts([sent, sent]))).toBe("all sent");
    expect(deliverySummary(deliveryCounts([sent, f({ status: "replied", reply_source: "link", sent_at: "2026-11-20T10:00:00Z" })]))).toBe("all sent");
  });

  it("counts suppliers with no contact", () => {
    const c = deliveryCounts([f({ status: "sent", sent_at: "x" }), f(), f({ email_to: "a@b.co" })]);
    expect(deliverySummary(c)).toBe("1 sent, 2 not sent (1 with no contact)");
  });

  it("ignores removed suppliers and handles an empty RFQ", () => {
    expect(deliveryCounts([f({ status: "cancelled" })]).invited).toBe(0);
    expect(deliverySummary(deliveryCounts([]))).toBe("add suppliers to start");
  });

  it("counts a reply entered by hand on a supplier that was also sent as sent", () => {
    expect(deliveryCounts([f({ status: "replied", reply_source: "buyer", sent_at: "2026-11-20T10:00:00Z" })]).sent).toBe(1);
  });
});

describe("the notice before sending", () => {
  const s = (name: string, email: string | null, phone: string | null) => ({ name, email, phone });

  it("names the suppliers that cannot be reached and what to do", () => {
    expect(noContactNotice([s("Al Noor", null, null), s("Delta", "d@x.co", null), s("Gulf Steel", null, " ")]))
      .toBe("2 of 3 suppliers have no email or phone (Al Noor, Gulf Steel): they will not receive it. Add a contact, or enter their reply by hand.");
  });

  it("uses the singular for one", () => {
    expect(noContactNotice([s("Al Noor", null, null), s("Delta", "d@x.co", null)])).toBe("1 of 2 suppliers has no email or phone (Al Noor): it will not receive it. Add a contact, or enter its reply by hand.");
  });

  it("is silent when a phone is enough and when everyone has an email", () => {
    expect(noContactNotice([s("A", null, "+9665"), s("B", "b@x.co", null)])).toBeNull();
    expect(noContactNotice([])).toBeNull();
  });

  it("treats an invalid email as none", () => {
    expect(noContactNotice([s("A", "not-an-email", null)])).toContain("1 of 1 supplier has no email or phone (A)");
  });
});
