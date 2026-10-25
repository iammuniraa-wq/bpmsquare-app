import { describe, expect, it, vi } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/link", () => ({
  default: (p: { href: string; className?: string; children: unknown; "aria-label"?: string }) =>
    create("a", { href: p.href, className: p.className, "aria-label": p["aria-label"] }, p.children as never),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));

import StatusPath from "./StatusPath";
import DocumentFlow from "./DocumentFlow";
import OverviewTab from "./OverviewTab";
import AvailabilityTab from "./AvailabilityTab";
import LinesTab from "./LinesTab";
import ErpTab from "./ErpTab";
import FilesAndLinks from "./FilesAndLinks";
import OrderChips from "./OrderChips";
import SalesOrderPrintDocument from "./SalesOrderPrintDocument";
import { documentFlow } from "./logic";
import { failureCopy } from "./SalesOrderDetail";
import { attachment, delivery, detail, invoice, line, order, ROUTES_STUB, type as orderType } from "./fixtures";

// createElement's overloads reject some prop shapes; the screens' own types are checked by tsc.
const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (e: ReactElement) => renderToString(e).replace(/<!-- -->/g, "");
const noop = () => {};

describe("StatusPath", () => {
  it("draws the five steps in order with the current one marked, and the hint on grey ERP steps", () => {
    const out = html(el(StatusPath, { order: order(), docs: [] }));
    const labels = [...out.matchAll(/class="[^"]*"[^>]*>(Draft|Confirmed|Delivered|Invoiced|Paid)</g)].map((m) => m[1]);
    expect(labels).toEqual(["Draft", "Confirmed", "Delivered", "Invoiced", "Paid"]);
    expect(out.match(/aria-current="step"/g)).toHaveLength(1);
    expect(out).toMatch(/data-state="current"[^>]*>[\s\S]*?Draft/);
    expect(out).toContain('title="Shown once your ERP reports it"');
    expect(out).toContain('aria-label="Order path"');
    expect(out).toContain('aria-label="About Order path"');
  });
  it("shows delivery and billing sub-status only once the ERP reports", () => {
    expect(html(el(StatusPath, { order: order({ status: "confirmed" }), docs: [] }))).not.toContain("sales_order.substatus");
    const out = html(el(StatusPath, { order: order({ status: "confirmed" }), docs: [delivery(), delivery({ id: "d2", delivered: false, status: "Open" }), invoice()] }));
    expect(out).toContain("Delivery: 1 of 2 delivered");
    expect(out).toContain("Billing: invoiced");
  });
  it("comes first in the header: nothing in the order's own page precedes it", () => {
    const src = readFileSync(join(process.cwd(), "src/components/salesOrders/SalesOrderDetail.tsx"), "utf8");
    const body = src.slice(src.lastIndexOf("<TabTitle"));
    expect(body.indexOf("<StatusPath")).toBeGreaterThan(-1);
    expect(body.indexOf("<StatusPath")).toBeLessThan(body.indexOf("<PageHeader"));
    expect(body.indexOf("<StatusPath")).toBeLessThan(body.indexOf("bpm-backlink"));
  });
});

describe("DocumentFlow", () => {
  const model = documentFlow(detail({ erpDocuments: [delivery(), invoice()] }), ROUTES_STUB);
  const out = html(el(DocumentFlow, { model, currency: "AED" }));
  it("draws every box and every link, once for each orientation", () => {
    expect(out.match(/data-node="/g)).toHaveLength(model.nodes.length * 2);
    expect(out.match(/data-link="/g)).toHaveLength(model.links.length * 2);
    expect(out).toContain('data-orientation="across"');
    expect(out).toContain('data-orientation="down"');
  });
  it("makes every real box open its record, but not this order and not a planned box", () => {
    expect(out).toContain('href="/standard-quotes/sq1"');
    const planned = html(el(DocumentFlow, { model: documentFlow(detail(), ROUTES_STUB), currency: "AED" }));
    expect(planned).toContain('aria-label="Planned delivery"');
    expect(planned).toContain('aria-label="Planned invoice"');
    expect(planned).not.toContain('href="/sales-orders/o1"');
    expect(out).toContain('aria-label="This order: Sales order, SO-0001');
  });
  it("carries a status and an amount in each box", () => {
    expect(out).toContain("Accepted");
    expect(out).toContain("Delivered");
    expect(out).toMatch(/INV-5001/);
    expect(out).toMatch(/AED\s?5,250/);
  });
});

describe("OverviewTab", () => {
  const view = (d = detail(), attachments = [attachment()]) => html(el(OverviewTab, { detail: d, attachments, currency: "AED", onSeeAvailability: noop }));
  it("shows Sold to and Bill to as one block when they are the same, then Ship to, and exactly three facts", () => {
    const out = view();
    expect(out).toContain("Sold to and bill to");
    expect(out).not.toContain(">Bill to<");
    expect(out).toContain("Ship to");
    expect(out).toContain("Gulf Steel LLC");
    for (const label of ["Total incl. VAT", "Expected delivery", "Customer PO"]) expect(out).toContain(label);
    expect(out.match(/data-guide="sales_order\.fact_/g)).toHaveLength(3);
    expect(out).toContain("AED");
    expect(out).toContain("PO-77123");
    expect(out).toContain("1 file");
  });
  it("splits Bill to out when it differs", () => {
    const out = view(detail({ order: order({ bill_to: { name: "Gulf Steel Finance", address: "PO Box 1" } }) }));
    expect(out).toContain(">Sold to<");
    expect(out).toContain(">Bill to<");
    expect(out).toContain("Gulf Steel Finance");
  });
  it("has no credit, price or stock chips and no fulfilment bars", () => {
    const out = view(detail({ lines: [line({ confirmed_qty: 10, confirmed_date: "2026-11-10", availability_source: "master" })] }));
    for (const word of ["Credit", "Passed", "Warning", "Failed", "progress", "meter"]) expect(out).not.toContain(word);
  });
  it("shows the attention banner only when a line is short or late", () => {
    expect(view()).not.toContain("sales_order.attention");
    expect(view(detail({ lines: [line({ confirmed_qty: 10, confirmed_date: "2026-11-10", availability_source: "master" })] }))).not.toContain("sales_order.attention");
    const short = view(detail({ lines: [line({ confirmed_qty: 4, confirmed_date: "2026-11-10", availability_source: "master" })] }));
    expect(short).toContain("sales_order.attention");
    expect(short).toContain("1 line is short on stock.");
    const late = view(detail({ lines: [line({ confirmed_qty: 10, confirmed_date: "2026-12-01", availability_source: "erp" })] }));
    expect(late).toContain("1 line arrives after the date asked.");
  });
  it("tags the expected delivery with its source, and says so when nothing is confirmed", () => {
    expect(view()).toContain("Not confirmed yet");
    const est = view(detail({ lines: [line({ confirmed_qty: 10, confirmed_date: "2026-11-10", availability_source: "master" })] }));
    expect(est).toContain("Master data (estimate)");
    const erp = view(detail({ lines: [line({ confirmed_qty: 10, confirmed_date: "2026-11-10", availability_source: "erp", availability_at: "2026-10-22T10:00:00Z" })] }));
    expect(erp).toMatch(/>ERP</);
  });
  it("leaves the file count out when the files could not be loaded", () => {
    const out = view(detail(), null as never);
    expect(out).not.toContain("No files");
    expect(out).not.toMatch(/\d files?</);
  });
});

describe("AvailabilityTab", () => {
  const view = (lines = [line()], p: Partial<{ canRefresh: boolean }> = {}) => html(el(AvailabilityTab, { lines, canRefresh: p.canRefresh ?? true, refreshing: false, onRefresh: noop }));
  it("tags each row ERP (with the fetch time) or Master data (estimate)", () => {
    const out = view([
      line({ id: "a", description: "Plate", confirmed_qty: 10, confirmed_date: "2026-11-09", availability_source: "master", availability_at: "2026-10-22T10:00:00Z" }),
      line({ id: "b", description: "Pipe", confirmed_qty: 10, confirmed_date: "2026-11-09", availability_source: "erp", availability_at: "2026-10-22T10:00:00Z" }),
    ]);
    expect(out).toContain('data-source="master"');
    expect(out).toContain("Master data (estimate)");
    expect(out).toContain('data-source="erp"');
    expect(out).toMatch(/fetched \d{2} \w{3}/);
    expect(out).toContain("Asked");
    expect(out).toContain("Confirmed");
  });
  it("says short and late in words", () => {
    const out = view([line({ confirmed_qty: 6, confirmed_date: "2026-11-20", availability_source: "master", availability_at: "2026-10-22T10:00:00Z" })]);
    expect(out).toContain("Short by 4 · 10 days late");
  });
  it("shows a stale banner with a Refresh action when lines were edited after the check", () => {
    const stale = view([line({ confirmed_qty: 10, confirmed_date: "2026-11-09", availability_source: "master", availability_at: null })]);
    expect(stale).toContain("sales_order.stale");
    expect(stale).toContain("Lines changed since the last check");
    expect(stale).toContain("sales_order.stale_refresh");
    expect(view()).not.toContain("sales_order.stale");
  });
  it("offers 'Check availability' before the first check and hides refresh when the order cannot be refreshed", () => {
    expect(view()).toContain("Check availability");
    expect(view([line()], { canRefresh: false })).not.toContain("sales_order.availability_refresh");
  });
  it("renders both a table and cards so a phone needs no sideways scroll", () => {
    const out = view();
    expect(out).toContain("<table");
    expect(out.match(/data-state="unchecked"/g)).toHaveLength(2);
  });
});

describe("LinesTab", () => {
  const props = { currency: "AED", products: [], onSaved: noop };
  it("reads as a table with the printed text one tap away, and totals", () => {
    const out = html(el(LinesTab, { ...props, detail: detail({ lines: [line({ printed_text: "Mill certificate included" })] }), editable: false }));
    for (const h of ["Item", "Qty", "Unit price", "Discount", "Line total"]) expect(out).toContain(`>${h}<`);
    expect(out).toContain("<details");
    expect(out).toContain("Mill certificate included");
    expect(out).toContain("Total AED");
    expect(out).not.toContain("sales_order.lines_save");
  });
  it("offers no Printed text control on a line that has none", () => {
    expect(html(el(LinesTab, { ...props, detail: detail(), editable: false }))).not.toContain("<details");
  });
  it("becomes the editor only while the order is editable", () => {
    const out = html(el(LinesTab, { ...props, detail: detail(), editable: true }));
    expect(out).toContain("sales_order.lines_editor");
    expect(out).toContain("sales_order.lines_save");
    expect(out).toContain("sales_order.add_line");
    expect(out).toContain('aria-label="Remove line 1"');
    for (const g of ["line_item", "line_qty", "line_unit", "line_price", "line_discount", "line_tax", "line_wanted", "remove_line", "printed_text"]) expect(out, g).toContain(`data-guide="sales_order.${g}"`);
  });
  it("says so when an order has no lines", () => {
    expect(html(el(LinesTab, { ...props, detail: detail({ lines: [] }), editable: false }))).toContain("No lines on this order");
  });
});

describe("ErpTab", () => {
  it("is an honest shell until a connector link exists", () => {
    const out = html(el(ErpTab, { detail: detail(), currency: "AED", externalLine: null, middlewareHref: "/settings/middleware" }));
    expect(out).toContain("Not in an ERP");
    expect(out).toContain("Nothing sent yet");
    expect(out).toContain("Invoices from Dynamics 365 appear here. Nothing yet.");
    expect(out).toContain("Deliveries come from F&amp;O or SAP, which are not connected.");
    expect(out).not.toContain("sales_order.erp_refresh");
    expect(out).toContain('href="/settings/middleware"');
    expect(html(el(ErpTab, { detail: detail(), currency: "AED", externalLine: null, middlewareHref: null }))).not.toContain("sales_order.erp_setup");
  });
  it("lists the deliveries and invoices the ERP reported, read-only", () => {
    const out = html(el(ErpTab, { detail: detail({ erpLinked: true, erpDocuments: [delivery(), invoice()] }), currency: "AED", externalLine: null, middlewareHref: null }));
    expect(out).toContain("DL-9001");
    expect(out).toContain("INV-5001");
    expect(out).not.toContain("<input");
    expect(out).not.toContain("Nothing yet.");
  });
  it("shows the ERP number, the ERP's status and when it was read, with a Refresh, for an order the ERP holds", () => {
    const d = detail({
      erpLinked: true, erpDocuments: [invoice({ spine: "paid", status: "Paid", due: "2026-12-01", href: "https://org.crm.dynamics.com/main.aspx?etn=invoice&id=x" })],
      erpLink: { number: "ORD-01000", syncedAt: "2026-10-24T08:00:00Z", checkedAt: "2026-10-24T09:30:00Z" }, order: order({ status_label: "Complete", spine: "completed" }),
    });
    const out = html(el(ErpTab, { detail: d, currency: "AED", externalLine: null, middlewareHref: null, onRefresh: noop }));
    expect(out).toContain("ORD-01000");
    expect(out).toContain("Complete");
    expect(out).toContain("sales_order.erp_refresh");
    expect(out).toContain("Paid");
    expect(out).toContain("Due");
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
  it("calls an ERP-read order's own ref its ERP number and offers no Refresh without a handler", () => {
    const d = detail({ erpLinked: true, order: order({ origin: "erp", ref: "ORD-77", status: "confirmed", status_label: "New" }) });
    const out = html(el(ErpTab, { detail: d, currency: "AED", externalLine: null, middlewareHref: null }));
    expect(out).toContain("ORD-77");
    expect(out).not.toContain("sales_order.erp_refresh");
  });
});

describe("ErpTab: Check with ERP and Send to ERP", () => {
  const chk = (kind: "credit" | "price" | "stock", status: "passed" | "warning" | "failed" | "not_run", over: object = {}) =>
    ({ kind, status, message: `${kind} says ${status}.`, detail: null, checked_at: "2026-10-24T09:30:00Z", stale: false, ...over });
  const props = { currency: "AED", externalLine: null, middlewareHref: null };
  const live = (over: object = {}) => detail({ erpAvailable: true, ...over });

  it("shows three result rows with their reason and time, and both buttons, once an ERP is connected", () => {
    const d = live({ erpChecks: [chk("credit", "passed"), chk("price", "warning"), chk("stock", "failed")] });
    const out = html(el(ErpTab, { detail: d, ...props, onCheck: noop, onSend: noop }));
    for (const g of ["sales_order.check_credit", "sales_order.check_price", "sales_order.check_stock", "sales_order.erp_check", "sales_order.erp_send"]) expect(out, g).toContain(g);
    for (const w of ["Passed", "Warning", "Failed", "credit says passed.", "stock says failed."]) expect(out, w).toContain(w);
    expect(out).toMatch(/24 Oct/);
    expect(out).toContain(">Check with ERP<");
    expect(out).toContain(">Send to ERP<");
  });
  it("says Out of date instead of the stored status once the lines changed, and Not checked before the first run", () => {
    const d = live({ erpChecks: [chk("credit", "passed", { stale: true })] });
    const out = html(el(ErpTab, { detail: d, ...props, onCheck: noop, onSend: noop }));
    expect(out).toContain("Out of date");
    expect(out).toContain("Not checked");
    expect(out).not.toContain(">Passed<");
  });
  it("disables Send with the reason visible, and never offers either button without a connector or after the ERP has the order", () => {
    const blocked = html(el(ErpTab, { detail: live({ erpSendBlocker: "This customer is not in the ERP yet. Sync customers from the ERP first." }), ...props, onCheck: noop, onSend: noop }));
    expect(blocked).toContain("sales_order.erp_blocker");
    expect(blocked).toContain("not in the ERP yet");
    expect(blocked).toMatch(/<button[^>]*disabled[^>]*>[^<]*(<[^>]+>)*Send to ERP/);
    const none = html(el(ErpTab, { detail: detail(), ...props, onCheck: noop, onSend: noop }));
    expect(none).not.toContain("sales_order.erp_send");
    expect(none).not.toContain("Check with ERP");
    const sent = html(el(ErpTab, { detail: live({ erpLinked: true, erpChecks: [chk("credit", "passed")] }), ...props, onCheck: noop, onSend: noop }));
    expect(sent).not.toContain("sales_order.erp_send");
    expect(sent).toContain("sales_order.check_credit");
  });
  it("says Needs a database update on the buttons while migration 0217 is pending", () => {
    const out = html(el(ErpTab, { detail: live({ erpChecksPending: true }), ...props, onCheck: noop, onSend: noop }));
    expect(out).toContain("Needs a database update");
    expect(out).toContain("sales_order.erp_pending");
    expect(out).not.toContain(">Send to ERP<");
  });
  it("lists the transfer log with who, result, the ERP number or the failing step, and Retry on the newest failure only", () => {
    const transfers = [
      { id: "t2", attempted_at: "2026-10-24T11:00:00Z", by: "Asha", result: "failed" as const, erp_number: null, step: "create", message: "Dynamics did not accept the order." },
      { id: "t1", attempted_at: "2026-10-24T10:00:00Z", by: null, result: "failed" as const, erp_number: null, step: "find", message: "older" },
    ];
    const out = html(el(ErpTab, { detail: live({ erpTransfers: transfers }), ...props, onSend: noop }));
    expect(out).toContain("sales_order.transfer_log");
    expect(out).toContain("Asha");
    expect(out).toContain("Step: create. Dynamics did not accept the order.");
    expect(out.match(/sales_order\.transfer_retry/g)).toHaveLength(2);
    const sent = html(el(ErpTab, { detail: live({ erpLinked: true, erpTransfers: [{ id: "t3", attempted_at: "2026-10-24T12:00:00Z", by: "Asha", result: "sent" as const, erp_number: "ORD-01001", step: null, message: null }] }), ...props }));
    expect(sent).toContain("ORD-01001");
    expect(sent).not.toContain("sales_order.transfer_retry");
    expect(sent).not.toContain("Nothing sent yet");
  });
});

describe("Overview banner and Availability with ERP checks", () => {
  const failed = (kind: "credit" | "price" | "stock", over: object = {}) => ({ kind, status: "failed" as const, message: "x", detail: null, checked_at: "2026-10-24T09:30:00Z", stale: false, ...over });
  it("the Overview banner appears for a current failed check and names it; a pass or a stale failure stays quiet", () => {
    const view = (checks: object[]) => html(el(OverviewTab, { detail: detail({ erpChecks: checks as never }), attachments: [], currency: "AED", onSeeAvailability: noop, onSeeErp: noop }));
    expect(view([failed("credit")])).toContain("The ERP check for credit failed.");
    expect(view([failed("credit")])).toContain("See the ERP checks");
    expect(view([failed("credit", { stale: true })])).not.toContain("sales_order.attention");
    expect(view([{ ...failed("credit"), status: "passed" }])).not.toContain("sales_order.attention");
    expect(view([])).not.toContain("sales_order.attention");
  });
  it("shows no check chips on Overview", () => {
    const out = html(el(OverviewTab, { detail: detail({ erpChecks: [{ ...failed("credit"), status: "passed" }] as never }), attachments: [], currency: "AED", onSeeAvailability: noop }));
    expect(out).not.toContain("Passed");
    expect(out).not.toContain("Credit");
  });
  it("Availability shows the ERP stock per line, labelled ERP, only after a stock check", () => {
    const erpStock = new Map([["l1", { onHand: 12, checkedAt: "2026-10-24T09:30:00Z", stale: false }]]);
    const withStock = html(el(AvailabilityTab, { lines: [line()], canRefresh: true, refreshing: false, onRefresh: noop, erpStock }));
    expect(withStock).toContain("ERP stock");
    expect(withStock).toContain("12 Nos on hand");
    expect(withStock).toContain("sales_order.erp_stock");
    const without = html(el(AvailabilityTab, { lines: [line()], canRefresh: true, refreshing: false, onRefresh: noop }));
    expect(without).not.toContain("ERP stock");
  });
});

describe("FilesAndLinks", () => {
  const view = (p: object) => html(el(FilesAndLinks, { orderId: "o1", items: [attachment(), attachment({ id: "f2", type: "link", kind: "drawing", name: "Drawing rev B", ref: "https://files.example/dwg", href: "https://files.example/dwg", size_bytes: null })], canAdd: true, onChanged: noop, ...p }));
  it("lists files and links with their kind, who and when", () => {
    const out = view({});
    expect(out).toContain("po-77123.pdf");
    expect(out).toContain("Customer PO");
    expect(out).toContain("Drawing");
    expect(out).toContain("Asha");
    expect(out).toContain('href="https://files.example/dwg"');
    expect(out).toContain('href="/api/sales-orders/o1/attachments/f1"');
  });
  it("offers upload, add link and remove only while the order can be annotated", () => {
    const open = view({});
    for (const g of ["sales_order.file_upload", "sales_order.link_add", "sales_order.file_remove"]) expect(open).toContain(g);
    const closed = view({ canAdd: false });
    for (const g of ["sales_order.file_upload", "sales_order.link_add", "sales_order.file_remove"]) expect(closed).not.toContain(g);
  });
  it("says the list is unavailable, and offers only a retry, when it could not be loaded", () => {
    const out = view({ items: null });
    expect(out).toContain("Files are not available");
    expect(out).not.toContain("sales_order.file_upload");
  });
  it("shows a real empty state with the next step", () => {
    expect(view({ items: [] })).toContain("No files or links yet");
  });
});

describe("OrderChips and the lock chip", () => {
  it("shows no lock chip on an editable draft", () => {
    const out = html(el(OrderChips, { order: order(), type: orderType(), erpLinked: false }));
    expect(out).toContain("Draft");
    expect(out).toContain("Standard order");
    expect(out).not.toContain("sales_order.lock");
  });
  it("shows the lock chip with an 'i' named after it, for each reason", () => {
    const cases: [Parameters<typeof order>[0], boolean, string][] = [
      [{ status: "confirmed", spine: "in_progress" }, false, "Locked"],
      [{ status: "draft" }, true, "In the ERP"],
      [{ origin: "erp", status: "confirmed", spine: "in_progress" }, false, "Read-only"],
      [{ status: "cancelled", spine: "cancelled" }, false, "Cancelled"],
    ];
    for (const [o, linked, chip] of cases) {
      const out = html(el(OrderChips, { order: order(o), type: null, erpLinked: linked }));
      expect(out, chip).toContain("sales_order.lock");
      expect(out, chip).toContain(`aria-label="About ${chip}"`);
    }
  });
  it("prefers the server's reason, but never prints it (it sits behind the i)", () => {
    const out = html(el(OrderChips, { order: order({ status: "confirmed", spine: "in_progress" }), type: null, erpLinked: false, reason: "Confirmed orders can't be edited." }));
    expect(out).not.toContain("Confirmed orders can't be edited.");
  });
});

describe("failureCopy", () => {
  it("gives an empty state per failure, never an error page", () => {
    expect(failureCopy({ phase: "failed", status: 404, error: "Not found", missing: true }).title).toBe("Order not found");
    expect(failureCopy({ phase: "failed", status: 403, error: "Forbidden", missing: false }).title).toBe("You cannot open this order");
    const down = failureCopy({ phase: "failed", status: 0, error: "Network error", missing: true });
    expect(down).toMatchObject({ title: "Sales orders are not available right now", retry: true });
    expect(failureCopy({ phase: "failed", status: 503, error: "x", missing: false }).retry).toBe(true);
    expect(failureCopy({ phase: "failed", status: 503, error: "A database update is needed", missing: false, needsDatabaseUpdate: true }).title).toBe("Sales orders need a database update");
  });
});

describe("SalesOrderPrintDocument", () => {
  const doc = (over: object = {}) => html(el(SalesOrderPrintDocument, {
    order: order({ notes: "Deliver in the morning", terms: "30 days" }), lines: [line({ printed_text: "Includes mill certificate" }), line({ id: "l2", description: "Pipe", discount_pct: 10 })],
    account: { name: "Gulf Steel LLC", city: "Dubai" }, contact: { name: "Omar" }, companyInfo: { name: "Acme Trading" }, currency: "AED", ...over,
  }));
  it("prints each line's printed text under the line", () => {
    const out = doc();
    expect(out).toMatch(/Steel plate 10 mm[\s\S]*Includes mill certificate/);
    expect(out).toContain("SO-0001");
    expect(out).toContain("PO-77123");
  });
  it("follows the order type's template: block order, hidden blocks, accent colour", () => {
    const template = { accent_color: "#aa3366", logo_position: "left" as const, blocks: [
      { id: "t", type: "totals", visible: true }, { id: "l", type: "line_items", visible: true }, { id: "n", type: "notes", visible: false }, { id: "x", type: "bogus", visible: true },
      { id: "f", type: "footer_text", visible: true, content: "Thank you for your order" },
    ] };
    const out = doc({ template });
    expect(out.indexOf("Total")).toBeLessThan(out.indexOf("Description"));
    expect(out).not.toContain("Deliver in the morning");
    expect(out).toContain("Thank you for your order");
    expect(out).toContain("#aa3366");
    expect(out).not.toContain("Terms &amp; Conditions");
  });
  it("falls back to the default layout when the type has no blocks", () => {
    const out = doc({ template: { blocks: [] } });
    expect(out).toContain("Description");
    expect(out).toContain("Deliver in the morning");
    expect(out).toContain("Terms &amp; Conditions");
  });
  it("shows a separate Bill to and the Ship to when they are set", () => {
    const out = doc({ order: order({ bill_to: { name: "Gulf Finance" } }) });
    expect(out).toContain("Sold to");
    expect(out).toContain("Bill to");
    expect(out).toContain("Ship to");
  });
});

describe("the stylesheet", () => {
  const css = readFileSync(join(process.cwd(), "src/components/salesOrders/salesOrders.module.css"), "utf8");
  it("goes to one column under 900px and swaps the table for cards under 780px", () => {
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.facts \{ grid-template-columns: 1fr; \}/);
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*\.flowDown \{ display: block; \}/);
    expect(css).toMatch(/@media \(max-width: 780px\)[\s\S]*\.tableOnly \{ display: none !important; \}/);
    expect(css).toMatch(/\.cards \{ display: flex; \}/);
  });
  it("keeps tap targets at 44px on a phone and puts the primary action in a bar at the bottom edge", () => {
    expect(css).toMatch(/min-height: 44px/);
    expect(css).toMatch(/\.primarySlot \{[\s\S]*position: fixed[\s\S]*bottom: env\(safe-area-inset-bottom/);
  });
  it("respects reduced motion and uses theme variables, not hex colours", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
