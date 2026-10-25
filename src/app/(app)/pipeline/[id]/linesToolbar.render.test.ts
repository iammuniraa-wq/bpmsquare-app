import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { Opportunity, OpportunityLine } from "@/lib/types";
import type { OpportunityStageDef } from "@/lib/constants";

// GCC tender deals: the Lines tab's actions sit ABOVE the table for a tender deal, with one supplier-price button; a standard deal
// keeps its action row below the table and its own "Request quotation". Rendered with the real page component on the server.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/pipeline/x",
}));
// The RFQ module is on in this workspace, so the editor would draw its own "Request quotation".
vi.mock("@/lib/tenant-context", async (orig) => ({ ...(await orig<typeof import("@/lib/tenant-context")>()), useTenantFeature: (k: string) => k === "rfq" }));

import OpportunityDetailClient from "./OpportunityDetailClient";

const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const opp = { id: OPP, tenant_id: "t1", ref: "OPP-2", title: "Valves for Plant 4", account_id: "acc", contact_id: null, stage: "estimating", outcome: "open", amount: 0, probability: 25, owner_id: "u1", team: [], source: "direct", created_at: "2026-10-01T00:00:00Z", stage_since: "2026-10-01T00:00:00Z", expected_close: null, description: null, competitor: null, closed_at: null, loss_reason: null, probability_override: null, probability_override_reason: null } as unknown as Opportunity & { stage_since: string };
const line = (id: string, description: string, rate: number): OpportunityLine => ({ id, tenant_id: "t1", opportunity_id: OPP, sl_no: id, description, uom: "Nos", qty: 2, rate, discount_pct: 0, amount: 2 * rate, product_id: null, pricing_document_id: null, rfq_line_id: null, group_id: null, group_label: null, group_type: null, break_of: null, break_qty: null, is_selected: true, show_on_pdf: true } as unknown as OpportunityLine);
const stages: OpportunityStageDef[] = [{ value: "estimating", label: "Estimating", probability_hint: 25, is_closed: false } as unknown as OpportunityStageDef, { value: "won", label: "Won", probability_hint: 100, is_closed: true, outcome: "won" } as unknown as OpportunityStageDef];
const lines = [line("1", "Gate valve 100mm", 0), line("2", "Pipe 110mm", 0), line("3", "Paint", 12)];

const tenderTab = { view: { closing_at: null, decision: null, decided_by_name: null, decided_at: null }, room: null, approval: null, accounts: [], nowIso: "2026-10-26T00:00:00Z", timezone: "Asia/Riyadh" } as never;
const composerLines = (priced: boolean) => lines.map((l) => ({ source_line_id: l.id, product_id: null, description: l.description, uom: "Nos", qty: 2, include: priced ? !(Number(l.rate) > 0) : true, linked_ref: null, hint: Number(l.rate) > 0 ? null : "no price yet" }));

function page({ tender, rfq = true, quotes = 0 }: { tender: boolean; rfq?: boolean; quotes?: number }) {
  return renderToString(createElement(OpportunityDetailClient, {
    opp, accountName: "Aramco", contacts: [], initialLines: lines, linesVersion: "v1",
    quotes: Array.from({ length: quotes }, (_, i) => ({ object: "standard_quote" as const, id: `q${i}`, ref: `SQ-${i}`, status: "draft", subtotal: 10, total: 10, created_at: "2026-10-02T00:00:00Z" })),
    stages, members: [], products: [], pricingEnabled: false, standardQuotesEnabled: true, todayKey: "2026-10-26", currentUserId: "u1",
    activity: null, initialTab: "lines",
    tender: tender ? tenderTab : null,
    tenderRfq: tender && rfq ? { originLabel: "Deal OPP-2", lines: composerLines(true) } : null,
  } as never)).replace(/<!-- -->/g, "");
}

const count = (html: string, s: string) => html.split(s).length - 1;

describe("a tender deal's Lines tab", () => {
  const html = page({ tender: true });

  it("has one toolbar above the lines table: Lines total, Request supplier prices, Save lines", () => {
    expect(html).toContain('data-guide="tender.lines.toolbar"');
    const bar = html.indexOf('data-guide="tender.lines.toolbar"');
    const table = html.indexOf("Line items");
    expect(bar).toBeGreaterThan(-1);
    expect(bar).toBeLessThan(table);
    expect(html.indexOf("Lines total")).toBeLessThan(table);
    expect(html.indexOf("Request supplier prices")).toBeLessThan(table);
    expect(html.indexOf("Save lines")).toBeLessThan(table);
  });

  it("has exactly one request-for-prices button, with the count of lines that have no price, and not the editor's Request quotation", () => {
    expect(count(html, "Request supplier prices")).toBeGreaterThanOrEqual(1);
    expect(html).toMatch(/Request supplier prices \(2\)/);
    // The editor's header button is gone; the per-line "Request quotation" chips in the table's RFQ column are the table's own and stay.
    expect(html).not.toMatch(/Request quotation \(\d+\)/);
    const header = html.slice(html.indexOf("Line items"), html.indexOf("min-width:860px"));
    expect(header).not.toContain("Request quotation");
    expect(count(html, 'data-guide="tender.lines.rfq"')).toBe(1);
  });

  it("has no action row below the table: Lines total and Save lines appear once, Convert to Standard Quote only in the header", () => {
    expect(count(html, "Lines total")).toBe(1);
    expect(count(html, "Save lines")).toBe(1);
    expect(count(html, "Convert to Standard Quote")).toBe(1);
    expect(html.lastIndexOf("Convert to Standard Quote")).toBeLessThan(html.indexOf("Line items"));
  });

  it("keeps every control of the toolbar 44 px tall, and Save lines disabled until there is something to save", () => {
    const bar = html.slice(html.indexOf('data-guide="tender.lines.toolbar"'), html.indexOf("Line items"));
    expect(bar).toMatch(/min-height:44px/);
    expect(bar).toMatch(/<button[^>]*disabled=""[^>]*data-guide="tender.lines.save"|<button[^>]*data-guide="tender.lines.save"[^>]*disabled=""|disabled=""[^>]*>Save lines/);
  });

  it("says the amount follows a quote behind the i, not as running text", () => {
    const withQuote = page({ tender: true, quotes: 1 });
    expect(withQuote).not.toContain("the deal amount follows its latest quote");
    expect(withQuote).toContain("Lines total");
  });

  it("a tender workspace without the RFQ module has no request button at all", () => {
    const noRfq = page({ tender: true, rfq: false });
    expect(noRfq).not.toContain("Request supplier prices");
  });
});

describe("a standard deal's Lines tab is unchanged", () => {
  const html = page({ tender: false });

  it("keeps the action row below the table and its own Request quotation above it", () => {
    expect(html).not.toContain('data-guide="tender.lines.toolbar"');
    expect(html).not.toContain("Request supplier prices");
    expect(html).toMatch(/Request quotation \(2\)/);
    const table = html.indexOf("Line items");
    const header = html.slice(table, html.indexOf("min-width:860px"));
    expect(header).toMatch(/Request quotation \(2\)/);
    expect(html.lastIndexOf("Lines total")).toBeGreaterThan(table);
    expect(html.lastIndexOf("Save lines")).toBeGreaterThan(table);
    expect(count(html, "Lines total")).toBe(1);
    expect(count(html, "Save lines")).toBe(1);
  });

  it("still offers Convert to Standard Quote in the row below the lines as well as in the header", () => {
    expect(count(html, "Convert to Standard Quote")).toBe(2);
    expect(html.lastIndexOf("Convert to Standard Quote")).toBeGreaterThan(html.indexOf("Line items"));
  });

  it("says the amount follows a quote exactly as before", () => {
    expect(page({ tender: false, quotes: 1 })).toContain("Lines total");
    expect(page({ tender: false, quotes: 1 })).toContain("the deal amount follows its latest quote");
  });
});

describe("how the pieces are wired", () => {
  const src = readFileSync("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx", "utf8");
  const editor = readFileSync("src/components/sales/DocumentLinesEditor.tsx", "utf8");

  it("the shared editor's Request quotation is hidden only when the page says so, and the page says so only for a tender with the RFQ module", () => {
    expect(editor).toMatch(/hideRfqRequest = false/);
    expect(editor).toMatch(/\{rfqModule && !hideRfqRequest && \(\(\) => \{/);
    expect(src).toMatch(/hideRfqRequest=\{!!tender && !!tenderRfq\}/);
  });

  it("the toolbar is mounted only for a tender deal; the old bottom row is the else branch", () => {
    expect(src).toMatch(/\{tender && \(\s*<TenderLinesToolbar/);
    expect(src).toMatch(/\{tender \? \(\s*<TenderLinesSaveBar/);
  });

  it("on a phone a Save bar follows the page once the toolbar has scrolled away, using the shared sticky class", () => {
    const bar = readFileSync("src/components/tender/TenderLinesToolbar.tsx", "utf8");
    expect(bar).toMatch(/IntersectionObserver/);
    expect(bar).toMatch(/className="sticky-actions"/);
    expect(bar).toMatch(/if \(!narrow \|\| !offscreen \|\| !dirty\) return null;/);
  });
});
