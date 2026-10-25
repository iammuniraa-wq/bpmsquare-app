import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addLink, cancelOrder, confirmOrder, createOrder, createOrderFromSource, deleteOrderType, emailOrder, getAvailability, getOrder, getShare, listAttachments, listOrderTypes, patchOrder, putLines, readDetail, refreshAvailability, refreshFromErp,
} from "./client";

type Reply = { status?: number; body?: unknown; text?: string; throws?: boolean };
function stub(reply: Reply) {
  const fn = vi.fn(async () => {
    if (reply.throws) throw new TypeError("offline");
    const status = reply.status ?? 200;
    const text = reply.text ?? (reply.body === undefined ? "" : JSON.stringify(reply.body));
    return { ok: status >= 200 && status < 300, status, text: async () => text } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

const orderRow = { id: "o1", ref: "SO-0001", status: "confirmed", account_id: "a1", total: "10500", currency: "AED" };

describe("a failing endpoint never throws and never crashes a screen", () => {
  it("a dropped connection is a missing endpoint", async () => {
    stub({ throws: true });
    expect(await getOrder("o1")).toEqual({ ok: false, status: 0, error: "Network error", missing: true });
    expect(await listOrderTypes()).toMatchObject({ ok: false, missing: true });
    expect(await getShare("o1")).toMatchObject({ ok: false, missing: true });
    expect(await refreshAvailability("o1")).toMatchObject({ ok: false, missing: true });
  });
  it("a 404 with an HTML body (route not deployed yet) is missing", async () => {
    stub({ status: 404, text: "<html>Not found</html>" });
    expect(await getOrder("o1")).toMatchObject({ ok: false, status: 404, missing: true });
    expect(await listAttachments("o1")).toMatchObject({ ok: false, missing: true });
  });
  it("a 422 with the route's own message carries that message, and is not 'missing'", async () => {
    stub({ status: 422, body: { error: "Quote must be accepted first" } });
    const r = await createOrder({ account_id: "a1", lines: [], source: { type: "standard_quote", id: "sq1" } });
    expect(r).toEqual({ ok: false, status: 422, error: "Quote must be accepted first", missing: false });
  });
  it("a 409 keeps the body's error so the screen can offer 'create another'", async () => {
    stub({ status: 409, body: { error: "SO-0001 already exists for this quote" } });
    expect(await createOrder({ account_id: "a1", lines: [] })).toMatchObject({ ok: false, status: 409, error: "SO-0001 already exists for this quote" });
  });
  it("a 200 the screen cannot read is reported, not thrown", async () => {
    stub({ body: { nothing: "useful" } });
    expect(await getOrder("o1")).toMatchObject({ ok: false, missing: true });
    stub({ text: "not json at all" });
    expect(await getOrder("o1")).toMatchObject({ ok: false, missing: true });
  });
  it("an action answer with an empty body still succeeds", async () => {
    stub({ status: 200 });
    expect(await confirmOrder("o1")).toEqual({ ok: true, data: true });
    expect(await patchOrder("o1", { notes: "x" })).toEqual({ ok: true, data: true });
  });
});

describe("what each wrapper sends", () => {
  it("PUTs the replaced lines, POSTs cancel with the reason and link attachments with their kind", async () => {
    const f = stub({ status: 200, body: {} });
    await putLines("o1", [{ product_id: null, description: "x", printed_text: null, qty: 1, uom: null, unit_price: 2, discount_pct: 0, tax_pct: 5, requested_date: null }]);
    await cancelOrder("o1", "Customer withdrew");
    await addLink("o1", { url: "https://files.example/po.pdf", kind: "customer_po" });
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("/api/sales-orders/o1/lines");
    expect(calls[0][1].method).toBe("PUT");
    expect(JSON.parse(calls[0][1].body as string).lines).toHaveLength(1);
    expect(calls[1][0]).toBe("/api/sales-orders/o1/cancel");
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ reason: "Customer withdrew" });
    expect(JSON.parse(calls[2][1].body as string)).toMatchObject({ type: "link", url: "https://files.example/po.pdf", kind: "customer_po", name: "https://files.example/po.pdf" });
  });
  it("POSTs create with the source so the server copies the lines", async () => {
    const f = stub({ status: 201, body: { id: "o9", ref: "SO-0009" } });
    const r = await createOrder({ account_id: "a1", lines: [], source: { type: "quotation", id: "q1" }, confirm_another: true });
    expect(r).toEqual({ ok: true, data: { id: "o9", ref: "SO-0009" } });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ source: { type: "quotation", id: "q1" }, confirm_another: true });
  });
});

describe("create sales order from a quote", () => {
  it("sends only the source, so the server copies the rest", async () => {
    const f = stub({ status: 201, body: { id: "o1", ref: "SO-0001" } });
    expect(await createOrderFromSource({ type: "standard_quote", id: "sq1" })).toEqual({ ok: true, data: { id: "o1", ref: "SO-0001" } });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ source: { type: "standard_quote", id: "sq1" }, lines: [] });
  });
  it("marks the 'an order already exists' answer so the screen can ask, then sends confirm_another", async () => {
    const f = stub({ status: 409, body: { error: "An order already exists for this standard quote: SO-0001.", needs_confirmation: true, existing: [{ id: "o1", ref: "SO-0001" }] } });
    const first = await createOrderFromSource({ type: "standard_quote", id: "sq1" });
    expect(first).toMatchObject({ ok: false, status: 409, needsConfirmation: true });
    await createOrderFromSource({ type: "standard_quote", id: "sq1" }, true);
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ confirm_another: true });
  });
  it("does not mark an ordinary 409 (a locked order) as needing confirmation", async () => {
    stub({ status: 409, body: { error: "Locked", lock_reason: "Locked" } });
    const r = await createOrder({ account_id: "a", lines: [] });
    expect(r).not.toHaveProperty("needsConfirmation");
  });
});

describe("tolerant readers", () => {
  it("reads the order row with its lines inside, or an { order, lines } envelope", () => {
    const flat = readDetail({ ...orderRow, account_name: "Gulf Steel", lines: [{ id: "l1", description: "Plate", qty: "2", unit_price: 5 }] });
    expect(flat?.order.total).toBe(10500);
    expect(flat?.account).toMatchObject({ id: "a1", name: "Gulf Steel" });
    expect(flat?.lines[0]).toMatchObject({ qty: 2, line_total: 10, confirmed_qty: null, availability_source: null });
    const env = readDetail({ order: orderRow, lines: [], erp_link: { id: "x" }, erp_documents: [{ id: "d1", kind: "delivery", number: "DL-1" }, { id: "bad" }] });
    expect(env?.erpLinked).toBe(true);
    expect(env?.erpDocuments).toHaveLength(1);
  });
  it("defaults what the server left out and rejects what is not an order", () => {
    const d = readDetail({ id: "o1", ref: "SO-1", status: "weird" });
    expect(d?.order).toMatchObject({ status: "draft", spine: "open", origin: "bpmsquare", pricing_mode: "internal", bill_to: null, ship_to: null });
    expect(d?.erpLinked).toBe(false);
    expect(readDetail(null)).toBeNull();
    expect(readDetail({ id: "o1" })).toBeNull();
  });
  it("reads availability and attachments from an array or a wrapped list", async () => {
    stub({ body: { lines: [{ id: "l1", confirmed_qty: 3, availability_source: "master" }] } });
    const a = await getAvailability("o1");
    expect(a.ok && a.data.lines[0]).toMatchObject({ confirmed_qty: 3, availability_source: "master" });
    stub({ body: [{ id: "f1", name: "po.pdf", kind: "customer_po" }, { nothing: true }] });
    const at = await listAttachments("o1");
    expect(at.ok && at.data).toHaveLength(1);
  });
  it("reports whether deleting an order type deactivated it", async () => {
    stub({ body: { deactivated: true } });
    expect(await deleteOrderType("t1")).toEqual({ ok: true, data: { deactivated: true } });
    stub({ status: 200, body: { ok: true } });
    expect(await deleteOrderType("t1")).toEqual({ ok: true, data: { deactivated: false } });
  });
});

describe("readDetail: what the ERP added (SO2)", () => {
  it("reads the ERP link, the documents with their spine and the customer note", () => {
    const d = readDetail({
      ...orderRow, origin: "erp", account_id: null, erp_customer_name: "Contoso Ltd", erp_linked: true,
      erp_link: { number: "ORD-01000", synced_at: "2026-10-24T08:00:00Z", checked_at: "2026-10-24T09:00:00Z" },
      customer_note: "This customer is not in BPMSquare yet.",
      erp_documents: [{ id: "d1", kind: "invoice", number: "INV-1", date: "2026-11-02", due: "2026-12-01", amount: 472, currency: "USD", status: "Billed", spine: "open", fetched_at: "2026-10-24T09:00:00Z", href: "https://x.example/y" }],
    });
    expect(d?.order).toMatchObject({ account_id: null, erp_customer_name: "Contoso Ltd", origin: "erp" });
    expect(d?.erpLink).toEqual({ number: "ORD-01000", syncedAt: "2026-10-24T08:00:00Z", checkedAt: "2026-10-24T09:00:00Z" });
    expect(d?.customerNote).toMatch(/not in BPMSquare/);
    expect(d?.erpDocuments[0]).toMatchObject({ kind: "invoice", spine: "open", due: "2026-12-01", currency: "USD", fetchedAt: "2026-10-24T09:00:00Z" });
  });
  it("an older server that sends none reads as no link and no note", () => {
    const d = readDetail(orderRow);
    expect(d?.erpLink).toBeNull();
    expect(d?.customerNote).toBeNull();
    expect(d?.erpDocuments).toEqual([]);
  });
});

describe("refreshFromErp", () => {
  it("posts to the order's erp-refresh route and reports a throttled answer", async () => {
    const fn = stub({ body: { ok: true, throttled: true, invoices: 0 } });
    expect(await refreshFromErp("o1")).toEqual({ ok: true, data: { throttled: true, invoices: 0 } });
    expect(fn.mock.calls[0]).toEqual(["/api/sales-orders/o1/erp-refresh", expect.objectContaining({ method: "POST" })]);
  });
  it("carries the database-update marker", async () => {
    stub({ status: 503, body: { error: "A database update is needed", needsDatabaseUpdate: true } });
    const r = await refreshFromErp("o1");
    expect(r).toMatchObject({ ok: false, needsDatabaseUpdate: true });
  });
});

describe("Check with ERP and Send to ERP (SO3)", () => {
  it("readDetail carries the checks, the transfer log, the send blocker and the pending marker, dropping rows it cannot read", () => {
    const d = readDetail({
      ...orderRow, erp_available: true, erp_send_blocker: "Add at least one line first.", erp_checks_pending: false,
      erp_checks: [{ kind: "credit", status: "failed", message: "On hold", checked_at: "2026-10-24T10:00:00Z", stale: true, detail: { a: 1 } }, { kind: "bogus", status: "passed", checked_at: "x" }],
      erp_transfers: [{ id: "t1", attempted_at: "2026-10-24T10:00:00Z", by: "Asha", result: "failed", step: "create", message: "No" }, { id: "t2", result: "weird" }],
    });
    expect(d?.erpAvailable).toBe(true);
    expect(d?.erpSendBlocker).toBe("Add at least one line first.");
    expect(d?.erpChecks).toEqual([{ kind: "credit", status: "failed", message: "On hold", checked_at: "2026-10-24T10:00:00Z", stale: true, detail: { a: 1 } }]);
    expect(d?.erpTransfers).toEqual([{ id: "t1", attempted_at: "2026-10-24T10:00:00Z", by: "Asha", result: "failed", erp_number: null, step: "create", message: "No" }]);
    expect(readDetail(orderRow)).toMatchObject({ erpChecks: [], erpTransfers: [], erpSendBlocker: null, erpChecksPending: false, erpOrg: [] });
  });
  it("reads the ERP organisation lines and drops what it does not know", () => {
    const d = readDetail({
      ...orderRow,
      erp_org: [{ kind: "sales_area", label: "Sales area", ok: true, text: "Sales area 1000/10/00 (from coverage Saudi retail)" }, { kind: "plant", text: "x" }, { kind: "erp_company", ok: false }],
    });
    expect(d?.erpOrg).toEqual([{ kind: "sales_area", label: "Sales area", ok: true, text: "Sales area 1000/10/00 (from coverage Saudi retail)" }]);
  });
  it("posts the check and the confirmed send to their routes", async () => {
    const { checkWithErp, sendToErp } = await import("./client");
    const fn = stub({ body: { ok: true, checks: [{ kind: "stock", status: "passed", message: "ok", checked_at: "2026-10-24T10:00:00Z" }] } });
    expect(await checkWithErp("o1")).toMatchObject({ ok: true, data: { checks: [{ kind: "stock" }] } });
    expect(fn.mock.calls[0]).toEqual(["/api/sales-orders/o1/erp-check", expect.objectContaining({ method: "POST" })]);
    const send = stub({ body: { ok: true, erp_number: "ORD-9" } });
    expect(await sendToErp("o1", true)).toEqual({ ok: true, data: { erpNumber: "ORD-9", link: null } });
    expect(JSON.parse(String((send.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ confirm: true });
  });
  it("a send that needs confirmation or a database update is reported as such", async () => {
    const { sendToErp } = await import("./client");
    stub({ status: 409, body: { error: "read them", needs_confirmation: true, items: ["Credit: failed"] } });
    expect(await sendToErp("o1", false)).toMatchObject({ ok: false, status: 409, needsConfirmation: true });
    stub({ status: 503, body: { error: "x", needsDatabaseUpdate: true } });
    expect(await sendToErp("o1", true)).toMatchObject({ ok: false, needsDatabaseUpdate: true });
  });
});
