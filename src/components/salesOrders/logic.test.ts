import { describe, expect, it } from "vitest";
import { orderEditable } from "@/lib/salesOrders/types";
import {
  attention, attentionText, availabilityRows, availabilityStatus, documentFlow, estimateTotals, expectedDelivery, layoutFlow, lockInfo,
  orderActions, orderPath, partyBlocks, pricingLine, sourceTag, subStatus, tagText, FLOW_BOX,
} from "./logic";
import { delivery, detail, invoice, line, order, ROUTES_STUB } from "./fixtures";

const states = (m: ReturnType<typeof orderPath>) => m.steps.map((s) => `${s.key}:${s.state}`);

describe("the status path", () => {
  it("starts a draft at Draft with every later step grey and a hint on the ERP ones", () => {
    const m = orderPath(order(), []);
    expect(states(m)).toEqual(["draft:current", "confirmed:pending", "delivered:pending", "invoiced:pending", "paid:pending"]);
    expect(m.steps.find((s) => s.key === "delivered")?.hint).toBe("Shown once your ERP reports it");
    expect(m.steps.find((s) => s.key === "confirmed")?.hint).toBeNull();
  });
  it("moves a confirmed order to Confirmed and keeps Delivered, Invoiced and Paid grey until the ERP reports", () => {
    const m = orderPath(order({ status: "confirmed", confirmed_at: "2026-10-21T00:00:00Z" }), []);
    expect(states(m)).toEqual(["draft:done", "confirmed:current", "delivered:pending", "invoiced:pending", "paid:pending"]);
  });
  it("follows ERP documents: a delivery, then an invoice, then payment", () => {
    const confirmed = order({ status: "confirmed" });
    expect(states(orderPath(confirmed, [delivery()])).slice(2)).toEqual(["delivered:current", "invoiced:pending", "paid:pending"]);
    expect(states(orderPath(confirmed, [delivery(), invoice()])).slice(2)).toEqual(["delivered:done", "invoiced:current", "paid:pending"]);
    const paid = orderPath(confirmed, [delivery(), invoice({ paid: true, status: "Paid" })]);
    expect(states(paid).slice(2)).toEqual(["delivered:done", "invoiced:done", "paid:current"]);
  });
  it("says 'Waiting for the ERP' once documents exist but a step is not reached", () => {
    const m = orderPath(order({ status: "confirmed" }), [delivery({ delivered: false, status: "Open" })]);
    expect(m.steps.find((s) => s.key === "delivered")?.hint).toBe("Waiting for the ERP");
  });
  it("keeps what a cancelled order reached and has no current step", () => {
    const m = orderPath(order({ status: "cancelled", confirmed_at: "2026-10-21T00:00:00Z" }), []);
    expect(m.cancelled).toBe(true);
    expect(states(m)).toEqual(["draft:done", "confirmed:done", "delivered:pending", "invoiced:pending", "paid:pending"]);
    expect(orderPath(order({ status: "cancelled" }), []).steps.map((s) => s.state)).toEqual(["done", "pending", "pending", "pending", "pending"]);
  });
});

describe("delivery and billing sub-status", () => {
  it("is empty until the ERP reports", () => expect(subStatus([])).toEqual({ delivery: null, billing: null }));
  it("shows partial fulfilment as '1 of 2'", () => {
    const s = subStatus([delivery(), delivery({ id: "d2", delivered: false, status: "Open" }), invoice({ paid: true, status: "Paid" }), invoice({ id: "i2" })]);
    expect(s).toEqual({ delivery: "Delivery: 1 of 2 delivered", billing: "Billing: 1 of 2 paid" });
  });
});

describe("the lock chip", () => {
  it("shows no chip while the order is editable, and agrees with orderEditable for every state", () => {
    expect(lockInfo({ origin: "bpmsquare", status: "draft" }, false)).toMatchObject({ locked: false, chip: null, reason: null });
    for (const origin of ["bpmsquare", "erp"] as const) for (const status of ["draft", "confirmed", "cancelled"] as const) for (const linked of [false, true]) {
      expect(lockInfo({ origin, status }, linked).locked).toBe(!orderEditable({ origin, status }, linked));
    }
  });
  it("names the reason: from the ERP, accepted by the ERP, confirmed, cancelled", () => {
    expect(lockInfo({ origin: "erp", status: "confirmed" }, false)).toMatchObject({ chip: "Read-only", annotatable: false });
    expect(lockInfo({ origin: "bpmsquare", status: "draft" }, true)).toMatchObject({ chip: "In the ERP", annotatable: true });
    expect(lockInfo({ origin: "bpmsquare", status: "confirmed" }, false)).toMatchObject({ chip: "Locked", annotatable: true });
    expect(lockInfo({ origin: "bpmsquare", status: "cancelled" }, false)).toMatchObject({ chip: "Cancelled", annotatable: false });
    expect(lockInfo({ origin: "bpmsquare", status: "confirmed" }, false).reason).toMatch(/Reopen/);
    expect(lockInfo({ origin: "bpmsquare", status: "draft" }, true).reason).toMatch(/ERP accepted/);
  });
});

describe("which actions the state allows", () => {
  const a = (o: Parameters<typeof orderActions>[0], linked = false, erp = false) => orderActions(o, linked, { erpAvailable: erp });
  it("lets a draft be confirmed, cancelled, deleted and its lines edited", () => {
    expect(a({ origin: "bpmsquare", status: "draft" })).toMatchObject({ confirm: true, cancel: true, reopen: false, remove: true, editLines: true, email: true });
  });
  it("lets a confirmed order be reopened only while no ERP link exists", () => {
    expect(a({ origin: "bpmsquare", status: "confirmed" })).toMatchObject({ confirm: false, reopen: true, cancel: true, remove: false });
    expect(a({ origin: "bpmsquare", status: "confirmed" }, true)).toMatchObject({ reopen: false, cancel: false });
  });
  it("offers nothing that changes an ERP order, a cancelled order, and hides Check with ERP until a connector exists", () => {
    expect(a({ origin: "erp", status: "confirmed" })).toMatchObject({ confirm: false, cancel: false, reopen: false, remove: false, pdf: true });
    expect(a({ origin: "bpmsquare", status: "cancelled" })).toMatchObject({ email: false, whatsapp: false, cancel: false, reopen: false, pdf: true });
    expect(a({ origin: "bpmsquare", status: "draft" }).checkWithErp).toBe(false);
    expect(a({ origin: "bpmsquare", status: "draft" }, false, true).checkWithErp).toBe(true);
    expect(a({ origin: "bpmsquare", status: "draft" }, true, true).checkWithErp).toBe(false);
    expect(a({ origin: "bpmsquare", status: "draft" }).sendToErp).toBe(false);
    expect(a({ origin: "bpmsquare", status: "confirmed" }, false, true).sendToErp).toBe(true);
    expect(a({ origin: "bpmsquare", status: "draft" }, true, true).sendToErp).toBe(false);
    expect(a({ origin: "erp", status: "confirmed" }, false, true).sendToErp).toBe(false);
  });
});

describe("the quiet pricing line", () => {
  it("names the quote an internally priced order came from", () => {
    expect(pricingLine("internal", { type: "standard_quote", ref: "SQ-2026-0012" })).toBe("Internal pricing, as quote SQ-2026-0012");
    expect(pricingLine("internal", { type: "quotation", ref: "Q-7" })).toBe("Internal pricing, as quote Q-7");
    expect(pricingLine("internal", null)).toBe("Internal pricing, from your price list");
    expect(pricingLine("external", null)).toBe("External pricing, supplied by the ERP");
  });
});

describe("the attention banner", () => {
  it("stays quiet for lines that are not checked, in stock and on time", () => {
    expect(attentionText(attention([line()]))).toBeNull();
    expect(attentionText(attention([line({ confirmed_qty: 10, confirmed_date: "2026-11-10", availability_source: "master" })]))).toBeNull();
  });
  it("flags a line confirmed for less than asked, and one confirmed for a date after the date asked", () => {
    const a = attention([line({ confirmed_qty: 6, confirmed_date: "2026-11-09" }), line({ id: "l2", confirmed_qty: 10, confirmed_date: "2026-11-20" })]);
    expect(a.short.map((l) => l.id)).toEqual(["l1"]);
    expect(a.late.map((l) => l.id)).toEqual(["l2"]);
    expect(attentionText(a)).toBe("1 line is short on stock and 1 line arrives after the date asked.");
  });
  it("counts a line that is both short and late under both", () => {
    expect(attentionText(attention([line({ confirmed_qty: 1, confirmed_date: "2026-12-01" }), line({ id: "l2", confirmed_qty: 2, confirmed_date: "2026-12-02" })]))).toBe("2 lines are short on stock and 2 lines arrive after the date asked.");
  });
  it("does not call a line late when no date was asked for", () => {
    expect(attention([line({ requested_date: null, confirmed_date: "2026-12-01", confirmed_qty: 10 })]).late).toEqual([]);
  });
});

describe("availability source tags", () => {
  it("tags ERP values read-only with the fetch time, master data as an estimate, and unchecked lines plainly", () => {
    const erp = sourceTag({ availability_source: "erp", availability_at: "2026-10-22T10:30:00Z" });
    expect(erp).toMatchObject({ kind: "erp", label: "ERP" });
    expect(erp.detail).toMatch(/^fetched /);
    expect(sourceTag({ availability_source: "master", availability_at: "2026-10-22T10:30:00Z" })).toEqual({ kind: "master", label: "Master data", detail: "estimate" });
    expect(sourceTag({ availability_source: null, availability_at: null })).toEqual({ kind: "none", label: "Not checked", detail: null });
    expect(tagText(sourceTag({ availability_source: "master", availability_at: null }))).toBe("Master data (estimate)");
  });
  it("gives each row its state and tag", () => {
    const rows = availabilityRows([
      line({ id: "a" }),
      line({ id: "b", confirmed_qty: 4, confirmed_date: "2026-11-01", availability_source: "master" }),
      line({ id: "c", confirmed_qty: 10, confirmed_date: "2026-11-30", availability_source: "erp", availability_at: "2026-10-22T10:00:00Z" }),
      line({ id: "d", confirmed_qty: 10, confirmed_date: "2026-11-05", availability_source: "master", availability_at: "2026-10-22T10:00:00Z" }),
    ]);
    expect(rows.map((r) => [r.line.id, r.state, r.tag.kind])).toEqual([["a", "unchecked", "none"], ["b", "short", "master"], ["c", "late", "erp"], ["d", "ok", "master"]]);
  });
  it("knows unchecked, stale (edited since the check) and fresh", () => {
    expect(availabilityStatus([line()])).toBe("unchecked");
    expect(availabilityStatus([])).toBe("unchecked");
    expect(availabilityStatus([line({ confirmed_qty: 10, availability_source: "master", availability_at: null })])).toBe("stale");
    expect(availabilityStatus([line({ confirmed_qty: 10, availability_source: "master", availability_at: "2026-10-22T10:00:00Z" })])).toBe("fresh");
  });
  it("gives the expected delivery a source tag, estimate when any date is master data", () => {
    const ls = [line({ confirmed_date: "2026-11-05", availability_source: "erp" }), line({ id: "l2", confirmed_date: "2026-11-12", availability_source: "master" })];
    expect(expectedDelivery({ expected_date: null }, ls)).toMatchObject({ date: "2026-11-12", tag: { kind: "master" } });
    expect(expectedDelivery({ expected_date: "2026-11-30" }, [line({ confirmed_date: "2026-11-30", availability_source: "erp" })])).toMatchObject({ date: "2026-11-30", tag: { kind: "erp" } });
    expect(expectedDelivery({ expected_date: null }, [line()])).toMatchObject({ date: null, tag: { kind: "none" } });
  });
});

describe("the parties on Overview", () => {
  it("merges Sold to and Bill to when there is no separate bill-to or it is the same", () => {
    expect(partyBlocks(detail()).merged).toBe(true);
    expect(partyBlocks(detail()).billTo).toBeNull();
    expect(partyBlocks(detail({ order: order({ bill_to: { name: "gulf steel llc" } }) })).merged).toBe(true);
  });
  it("shows Bill to separately when it differs, and Ship to when set", () => {
    const p = partyBlocks(detail({ order: order({ bill_to: { name: "Gulf Steel Finance", address: "PO Box 1" } }) }));
    expect(p.merged).toBe(false);
    expect(p.billTo).toEqual({ name: "Gulf Steel Finance", lines: ["PO Box 1"] });
    expect(p.shipTo?.name).toBe("Gulf Steel, Jebel Ali yard");
    expect(p.soldTo).toEqual({ name: "Gulf Steel LLC", lines: ["Omar Haddad"] });
  });
});

describe("totals estimate", () => {
  it("nets the discount per line, adds each line's tax and the shipping", () => {
    const t = estimateTotals([{ qty: 10, unit_price: 100, discount_pct: 10, tax_pct: 5 }, { qty: 1, unit_price: 50, discount_pct: 0, tax_pct: 0 }], 20);
    expect(t).toEqual({ subtotal: 950, tax: 45, shipping: 20, total: 1015 });
  });
});

describe("the document flow", () => {
  const ids = (m: ReturnType<typeof documentFlow>) => m.nodes.map((n) => n.id);
  it("shows quote then order with dashed planned delivery and invoice when the ERP has reported nothing", () => {
    const m = documentFlow(detail(), ROUTES_STUB);
    expect(ids(m)).toEqual(["source", "order", "planned-delivery", "planned-invoice"]);
    expect(m.links.map((l) => `${l.from}>${l.to}${l.planned ? "*" : ""}`)).toEqual(["source>order", "order>planned-delivery*", "planned-delivery>planned-invoice*"]);
    const src = m.nodes[0];
    expect(src).toMatchObject({ title: "Standard quote", ref: "SQ-2026-0012", href: "/standard-quotes/sq1", statusLabel: "Accepted" });
    expect(m.nodes.find((n) => n.id === "order")).toMatchObject({ current: true, amount: 10500, href: "/sales-orders/o1", col: 1 });
    expect(m.nodes.filter((n) => n.planned).every((n) => n.href === null && n.tone === "planned")).toBe(true);
  });
  it("starts from an email when the order came from one, and has no source box for a direct order", () => {
    expect(ids(documentFlow(detail({ source: { type: "email", id: null, ref: "Re: 500 plates" } }), ROUTES_STUB))[0]).toBe("source");
    expect(documentFlow(detail({ source: { type: "email", id: null, ref: null } }), ROUTES_STUB).nodes[0].kind).toBe("email");
    expect(ids(documentFlow(detail({ source: null }), ROUTES_STUB))).toEqual(["order", "planned-delivery", "planned-invoice"]);
  });
  it("follows each delivery with its invoice, a planned invoice when none is raised yet, and loose invoices off the order", () => {
    const m = documentFlow(detail({
      erpDocuments: [delivery(), invoice(), delivery({ id: "d2", number: "DL-9002", delivered: false, status: "Open" }), invoice({ id: "i9", delivery_id: null, number: "INV-9" })],
    }), ROUTES_STUB);
    expect(ids(m)).toEqual(["source", "order", "delivery-d1", "invoice-i1", "delivery-d2", "planned-invoice-d2", "invoice-i9"]);
    expect(m.links.find((l) => l.to === "invoice-i9")).toMatchObject({ from: "order", planned: false });
    expect(m.links.find((l) => l.to === "planned-invoice-d2")).toMatchObject({ from: "delivery-d2", planned: true });
    expect(m.nodes.find((n) => n.id === "delivery-d1")).toMatchObject({ tone: "done", statusLabel: "Delivered" });
    expect(m.nodes.find((n) => n.id === "invoice-i1")).toMatchObject({ amount: 5250, tone: "active", row: 0 });
    expect(m.rows).toBe(3);
  });
  it("lays boxes out left to right with curved connectors, and top to bottom for a phone", () => {
    const m = documentFlow(detail({ erpDocuments: [delivery(), invoice()] }), ROUTES_STUB);
    const across = layoutFlow(m, "across");
    const order = across.nodes.find((n) => n.id === "order")!;
    const del = across.nodes.find((n) => n.id === "delivery-d1")!;
    expect(del.x).toBeGreaterThan(order.x);
    expect(del.y).toBe(order.y);
    expect(across.links).toHaveLength(m.links.length);
    expect(across.links[0].d).toMatch(/^M[\d.]+,[\d.]+ C/);
    expect(across.width).toBe(FLOW_BOX.pad * 2 + 4 * FLOW_BOX.w + 3 * FLOW_BOX.gapAlong);
    expect(layoutFlow(documentFlow(detail({ erpDocuments: [delivery(), delivery({ id: "d2", number: "DL-2" })] }), ROUTES_STUB), "down").width).toBeLessThanOrEqual(311);
    const down = layoutFlow(m, "down");
    const dOrder = down.nodes.find((n) => n.id === "order")!;
    const dDel = down.nodes.find((n) => n.id === "delivery-d1")!;
    expect(dDel.y).toBeGreaterThan(dOrder.y);
    expect(dDel.x).toBe(dOrder.x);
    expect(down.height).toBeGreaterThan(down.width / 4);
  });
  it("spreads two deliveries across rows (across) or columns (down)", () => {
    const m = documentFlow(detail({ erpDocuments: [delivery(), delivery({ id: "d2", number: "DL-2" })] }), ROUTES_STUB);
    const a = layoutFlow(m, "across").nodes;
    expect(a.find((n) => n.id === "delivery-d2")!.y).toBeGreaterThan(a.find((n) => n.id === "delivery-d1")!.y);
    const d = layoutFlow(m, "down").nodes;
    expect(d.find((n) => n.id === "delivery-d2")!.x).toBeGreaterThan(d.find((n) => n.id === "delivery-d1")!.x);
  });
});

describe("the path from ERP documents (erp_documents spine)", () => {
  const confirmed = order({ status: "confirmed", confirmed_at: "2026-10-21T00:00:00Z" });
  it("lights Delivered, Invoiced and Paid from the spine the ERP reported", () => {
    const m = orderPath(confirmed, [delivery({ spine: "delivered", status: "Delivered" }), invoice({ spine: "paid", status: "Paid" })]);
    expect(states(m)).toEqual(["draft:done", "confirmed:done", "delivered:done", "invoiced:done", "paid:current"]);
  });
  it("an open invoice is Invoiced, not Paid, whatever its wording says", () => {
    const m = orderPath(confirmed, [invoice({ spine: "open", status: "Paid by cheque soon" })]);
    // The path is a line: a step before the furthest one reached reads as passed, as it always has.
    expect(states(m)).toEqual(["draft:done", "confirmed:done", "delivered:done", "invoiced:current", "paid:pending"]);
  });
  it("a cancelled invoice or delivery counts for nothing", () => {
    const m = orderPath(confirmed, [invoice({ spine: "cancelled" }), delivery({ spine: "cancelled" })]);
    expect(states(m)).toEqual(["draft:done", "confirmed:current", "delivered:pending", "invoiced:pending", "paid:pending"]);
    expect(subStatus([invoice({ spine: "cancelled" })])).toEqual({ delivery: null, billing: null });
  });
  it("needs every live invoice paid for Paid", () => {
    const m = orderPath(confirmed, [invoice({ id: "i1", spine: "paid" }), invoice({ id: "i2", spine: "open" })]);
    expect(states(m).slice(3)).toEqual(["invoiced:current", "paid:pending"]);
  });
});
