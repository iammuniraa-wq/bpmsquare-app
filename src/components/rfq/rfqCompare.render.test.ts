import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/rfqs/x",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import RfqCompare, { type CompareBundle } from "./RfqCompare";
import { RFQ_TIPS } from "@/lib/rfq/tips";

// The comparison renders with the right things on it and none of its explanations printed (6b). A server render of the real
// component with sample rows. The two widths (375 px and PC) are decided by the rules in the component's own style block, which
// this test reads: the table scrolls inside its own container, the item column sticks only on wide screens, and every control
// is at least 44 px tall under 900 px.

const sup = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, rfq_id: "r1", supplier_id: `s-${id}`, email_to: null, contact_name: null, status: "replied", link_expires_at: null, sent_at: "2026-10-18T00:00:00Z", viewed_at: null,
  replied_at: "2026-10-20T00:00:00Z", reminder_count: 0, last_reminded_at: null, supplier_quote_ref: null, currency: "SAR", incoterm: "DAP", freight_amount: null,
  payment_terms: null, valid_until: null, note: null, reply_source: "buyer", suppliers: { id: `s-${id}`, ref: null, name, email: null, phone: null }, ...over,
});
const resp = (id: string, rs: string, line: string, price: number, over: Record<string, unknown> = {}) => ({
  id, rfq_supplier_id: rs, rfq_line_id: line, status: "quoted", unit_price: price, currency: "SAR", fx_rate: null, lead_time_days: 14, moq: 5, offered_description: null,
  valid_until: "2026-12-31", note: null, source: "buyer", is_awarded: false, submitted_at: "2026-10-20T08:00:00Z", ...over,
});
const line = (id: string, n: number, over: Record<string, unknown> = {}) => ({
  id, rfq_id: "r1", sl_no: n, product_id: null, description: `Item ${n}`, spec: null, uom: "Nos", qty: 10, required_by: null, status: "open", awarded_response_id: null,
  awarded_unit_cost: null, cost_input_id: null, cost_model_code: null, path: "purchase.unit_cost", ...over,
});

const bundle = (over: Partial<CompareBundle> = {}): CompareBundle => ({
  rfq: { id: "r1", tenant_id: "t1", ref: "RFQ-0001", title: "Pipes", status: "sent", origin_type: "opportunity", origin_id: "o1", origin_label: "OPP-1", respond_by: "2026-10-24", currency: null } as never,
  lines: [line("L1", 1), line("L2", 2)] as never,
  suppliers: [sup("A", "Alpha Supply"), sup("B", "Beta Steel"), sup("C", "Gamma Tubes", { status: "sent", replied_at: null, reminder_count: 2, last_reminded_at: "2026-10-23T00:00:00Z" })] as never,
  responses: [
    resp("a1", "A", "L1", 100), resp("a2", "A", "L2", 40),
    resp("b1", "B", "L1", 120), resp("b2", "B", "L2", 35, { valid_until: "2026-10-01" }),
  ] as never,
  products: [], origin_href: "/pipeline/o1", tenant_currency: "SAR", awards: [], awards_pending: false, today: "2026-10-26", stale_days: 180, max_reminders: 2, ...over,
});

const html = (b: CompareBundle, canEdit = true) =>
  renderToString(createElement(RfqCompare, { b, canEdit, id: "r1", call: async () => ({}), run: () => {}, onKeyIn: () => {}, onAddSupplier: () => {}, onDone: () => {} })).replace(/<!-- -->/g, "");

describe("the comparison", () => {
  const out = html(bundle());

  it("one column per supplier and one row per line, with price, lead time, MOQ, validity and the age of the answer", () => {
    for (const name of ["Alpha Supply", "Beta Steel", "Gamma Tubes"]) expect(out).toContain(name);
    expect(out).toContain("1. Item 1");
    expect(out).toContain("2. Item 2");
    expect(out).toContain("100.00 SAR");
    expect(out).toContain("14 d lead");
    expect(out).toContain("MOQ 5");
    expect(out).toContain("Valid to 31 Dec 2026");
    expect(out).toContain("Answered 6 d ago");
  });

  it("marks the lowest valid price per line and calls an expired answer amber, never the lowest", () => {
    // Line 1: Alpha 100 is the lowest valid. Line 2: Beta 35 is cheaper but expired, so Alpha 40 is the lowest valid.
    expect(out.match(/Lowest valid/g)!.length).toBe(2 + 1); // two cells + the legend
    expect(out).toContain("Expired 01 Oct 2026");
    expect(out).toMatch(/>Expired</);
  });

  it("shows each answering supplier's coverage and total, and the waiting supplier with the chase state", () => {
    expect(out.match(/Covers 2 of 2 lines/g)!.length).toBe(2);
    expect(out).toContain("1,400.00 SAR"); // Alpha: 10 x 100 + 10 x 40
    expect(out).toContain("1,550.00 SAR"); // Beta: 10 x 120 + 10 x 35
    expect(out).toMatch(/>Waiting</);
    expect(out).toContain("Overdue since 24 Oct 2026: chase now"); // reply-by 24 Oct passed, both reminders used
  });

  it("prints none of its explanations: they sit behind the i", () => {
    for (const text of Object.values(RFQ_TIPS)) expect(out).not.toContain(text);
    expect(out).toContain("About the comparison");
  });

  it("scrolls inside its own container and keeps phones usable: sticky item column only on wide screens, 44 px controls under 900 px", () => {
    expect(out).toContain('class="rfq-cmp-scroll"');
    expect(out).toMatch(/\.rfq-cmp-scroll \{ overflow-x: auto; max-width: 100%; \}/);
    expect(out).toMatch(/@media \(min-width: 901px\) \{ \.rfq-cmp-first \{ position: sticky; left: 0; z-index: 1; \} \}/);
    expect(out).toMatch(/@media \(max-width: 900px\) \{[^}]*\.rfq-cmp-first \{ min-width: 160px; \}[^}]*\.rfq-cmp button[^}]*min-height: 44px/);
  });

  it("offers Award on each answer, Award all on a supplier with quotes, and Enter reply; a viewer gets none of them", () => {
    expect(out.match(/data-guide="rfq\.compare\.award"/g)!.length).toBe(4);
    expect(out.match(/data-guide="rfq\.compare\.award_all"/g)!.length).toBe(2);
    expect(out).toContain("Enter reply");
    const viewer = html(bundle(), false);
    expect(viewer).not.toContain("rfq.compare.award");
    expect(viewer).not.toContain("Enter reply");
    expect(viewer).toContain("100.00 SAR");
  });

  it("while migration 0224 is pending the comparison shows and awarding says a database update is needed", () => {
    const pending = html(bundle({ awards_pending: true }));
    expect(pending).toContain("100.00 SAR");
    expect(pending).toContain("migration 0224");
    expect(pending).not.toContain("rfq.compare.award\"");
    expect(pending).not.toContain("data-guide=\"rfq.compare.award_all\"");
  });
});

describe("an awarded line", () => {
  it("shows who chose it and when, and why when it was not the lowest valid price", () => {
    const b = bundle({
      lines: [line("L1", 1, { status: "awarded", awarded_unit_cost: 120 }), line("L2", 2)] as never,
      responses: [resp("a1", "A", "L1", 100), resp("b1", "B", "L1", 120, { is_awarded: true }), resp("a2", "A", "L2", 40)] as never,
      awards: [{
        id: "w1", rfq_line_id: "L1", rfq_supplier_id: "B", supplier_id: "s-B", response_id: "b1", chosen_by: "u1", chosen_by_name: "S. Khan", chosen_at: "2026-10-25T09:00:00Z",
        reason: "Delivers to site", not_lowest: true, landed_unit: 120, lowest_valid_unit: 100, applied_to_deal_at: null, applied_rate: null,
      }],
    });
    const out = html(b);
    expect(out).toContain("Awarded · 120.00 SAR");
    expect(out).toContain("Beta Steel · S. Khan · 25 Oct");
    expect(out).toContain("Not the lowest valid price: Delivers to site");
    expect(out).toContain("1 awarded price not on the deal yet");
    expect(out).toContain("Use these prices on the deal lines");
  });

  it("offers the deal prices only for an RFQ raised from a deal", () => {
    const b = bundle({
      rfq: { ...bundle().rfq, origin_type: "manual", origin_id: null } as never,
      awards: [{ id: "w1", rfq_line_id: "L1", rfq_supplier_id: "A", supplier_id: "s-A", response_id: "a1", chosen_by: "u1", chosen_at: "2026-10-25T09:00:00Z", reason: null, not_lowest: false, landed_unit: 100, lowest_valid_unit: 100, applied_to_deal_at: null, applied_rate: null }],
    });
    expect(html(b)).not.toContain("Use these prices on the deal lines");
  });
});

describe("the empty states", () => {
  it("an RFQ with no supplier says so and offers to add some", () => {
    const out = html(bundle({ suppliers: [] as never, responses: [] }));
    expect(out).toContain("No suppliers on this RFQ yet.");
    expect(out).toContain("Add suppliers");
  });
});
