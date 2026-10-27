import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { OpportunityLine } from "@/lib/types";
import type { BidsData } from "@/lib/tender/bids/rules";
import { tipTextProblems } from "@/lib/infoTip";
import { TENDER_TIPS } from "@/lib/tender/tips";

// Redesign 2026-10-27 (docs/design/gcc-tender-deals.md section 26), the pieces that are not the deal header: the Bid tab's readiness line and
// documents, the Bill of quantities for a tender whose lines were typed by hand, the row-level estimate actions that moved into the row
// panel, and the Costing -> Bill of quantities filter. Rendered on the server.

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/pipeline/x",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import BidsTab from "./BidsTab";
import BoqTab, { type BoqScreenState } from "./BoqTab";
import DealLinesBoq, { HAND_LINE_LIMIT, linesPayload, toRows } from "./DealLinesBoq";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const fmt = (n: number) => `SAR ${n.toLocaleString("en-US")}`;
const noop = () => {};
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const ver = (n: number, total: number) => ({ id: `v${n}`, version_no: n, submitted_at: `2026-10-${10 + n}T09:00:00Z`, submitted_by_name: "S. Khan", currency: "SAR", total, line_count: 3, revision_reason: n > 1 ? "Addendum" : null, note: null });
const bids = (over: Partial<BidsData> = {}): BidsData => ({ versions: [ver(2, 6500), ver(1, 6600)], pending: false, working_total: 6500, canEdit: true, ...over });
const checks = (over: Record<string, unknown> = {}) => ({ priceValidityDays: 180, unpricedFromLines: 0, approvedGo: true, guarantee: { amount: null, expiry: null, status: "requested" as const }, ...over });
const quote = (i: number) => ({ object: "standard_quote" as const, id: `q${i}`, ref: `SQ-000${i}`, status: "draft", subtotal: 1000 * i, total: 1000 * i, created_at: `2026-10-2${i}T00:00:00Z` });
const bid = (props: Record<string, unknown> = {}) => clean(renderToString(createElement(BidsTab, { opportunityId: OPP, data: bids(), stage: "estimating", outcome: "open", fmt, onError: noop, onNotice: noop, ...props } as never)));

describe("the readiness line on the Bid tab", () => {
  it("warns with what is still open, uses the warning tone, and never takes the Submit button away", () => {
    const out = bid({ checks: checks({ unpricedFromLines: 12, approvedGo: false, guarantee: { amount: 96000, expiry: "2027-06-30", status: "issued" } }) });
    expect(out).toContain('data-guide="tender.bid.readiness"');
    expect(out).toContain('data-state="open"');
    expect(out).toContain("Before you submit");
    expect(out).toContain("12 lines have no price.");
    expect(out).toContain("No approved go decision.");
    expect(out).toContain("The bid guarantee is not yet marked Submitted.");
    expect(out).toContain('data-guide="tender.bid.submit"');
  });

  it("says Ready to submit when nothing is open, and shows nothing once the tender has ended", () => {
    expect(bid({ checks: checks() })).toContain("Ready to submit");
    expect(bid({ checks: checks(), stage: "awarded", outcome: "won" })).not.toContain('data-guide="tender.bid.readiness"');
    expect(bid()).not.toContain('data-guide="tender.bid.readiness"');
  });

  it("sits above the figures and the buttons, with its explanation behind an i", () => {
    const out = bid({ checks: checks({ unpricedFromLines: 3 }) });
    expect(out.indexOf('data-guide="tender.bid.readiness"')).toBeLessThan(out.indexOf('data-guide="tender.bids.summary"'));
    expect(out.indexOf('data-guide="tender.bids.summary"')).toBeLessThan(out.indexOf('data-guide="tender.bid.submit"'));
    expect(out).toContain('aria-label="About Before you submit"');
    expect(out).not.toContain(TENDER_TIPS.submitWarnings);
  });

  it("the header's Submit bid starts the same flow as the button on the tab, once per press", () => {
    const src = read("src/components/tender/BidsTab.tsx");
    expect(src).toMatch(/if \(startSignal <= handledSignal\.current\) return;/);
    expect(src).toMatch(/if \(canSubmit\) void warnThen\(\(\) => setAskSubmit\(true\)\);\s*else if \(canRevise\) void warnThen\(revise\)/);
    // A stage the server would refuse (a legacy approved go still on Bid/No-bid) says so instead of doing nothing.
    expect(src).toContain('onError("A bid is submitted from Estimating or Clarifications")');
  });
});

describe("Documents we send", () => {
  it("holds the priced BOQ, the answer sheet and the quote maker, after the versions and the comparison", () => {
    const out = bid({ quotes: [quote(1)], canMakeQuote: true });
    expect(out).toContain("Documents we send");
    expect(out).toContain('data-guide="boq.downloads"');
    expect(out).toContain("Make a Standard Quote from this version");
    expect(out.indexOf("Documents we send")).toBeGreaterThan(out.indexOf("Compare versions"));
    expect(out.indexOf("Compare versions")).toBeGreaterThan(out.indexOf("Versions"));
  });

  it("the quote is made from a chosen version, the latest first, and says so in its request", () => {
    const out = bid({ canMakeQuote: true });
    expect(out).toContain('data-guide="tender.bid.quote_version"');
    expect(out).toMatch(/<option value="2"[^>]*>Version 2 · SAR 6,500<\/option>/);
    const src = read("src/components/tender/BidDocuments.tsx");
    expect(src).toContain("bid_version: Number(version)");
    expect(src).toContain("/convert`");
  });

  it("the Version select defaults to the LATEST version, even after a newer one arrives or the list is in another order (live bug OPP-0015)", () => {
    const selected = (versions: unknown[]) => {
      const out = bid({ canMakeQuote: true, data: bids({ versions: versions as never }) });
      return out.slice(out.indexOf('data-guide="tender.bid.quote_version"')).match(/<option value="(\d+)"[^>]*selected/)?.[1];
    };
    expect(selected([ver(3, 7000), ver(2, 6500), ver(1, 6600)])).toBe("3");
    expect(selected([ver(2, 6500), ver(3, 7000), ver(1, 6600)])).toBe("3");
    expect(selected([ver(1, 6600)])).toBe("1");
    const src = read("src/components/tender/BidDocuments.tsx");
    expect(src).toContain("defaultQuoteVersion(versions, picked)");
    expect(src).not.toMatch(/useState\(String\(versions\[0\]/);
  });

  it("with no version yet it says to submit a bid first, and offers no button", () => {
    const out = bid({ canMakeQuote: true, data: bids({ versions: [] }) });
    expect(out).toContain("Submit a bid first");
    expect(out).not.toContain('data-guide="tender.bid.make_quote"');
  });

  it("lists the quotes already made, newest first, each a link, and pages a long list", () => {
    const few = bid({ quotes: [quote(2), quote(1)] });
    expect(few.indexOf("SQ-0002")).toBeLessThan(few.indexOf("SQ-0001"));
    expect(few).toContain("· latest");
    const many = bid({ quotes: Array.from({ length: 8 }, (_, i) => quote(i + 1)) });
    expect(many).toContain("Show all 8");
    expect(many.split('href="/standard-quotes/q').length - 1).toBe(5);
  });

  it("every control is a 44 px target and the explanations sit behind an i", () => {
    const out = bid({ canMakeQuote: true, quotes: [quote(1)] });
    for (const b of [...out.matchAll(/<button\b[^>]*data-guide="(?:tender\.bid\.make_quote|boq\.download|boq\.answer_sheet)"[^>]*>/g)].map((m) => m[0])) expect(b, b).toContain("min-height:44px");
    expect(out).not.toContain(TENDER_TIPS.bidDocuments);
    expect(out).not.toContain(TENDER_TIPS.bidQuote);
    expect(out).toContain('aria-label="About Standard Quote"');
  });

  it("the new explanations fit behind an i", () => {
    for (const k of ["bidDocuments", "bidQuote", "history"] as const) expect(tipTextProblems(TENDER_TIPS[k]), k).toEqual([]);
  });
});

describe("a tender whose lines were typed by hand", () => {
  const line = (id: string, no: string | null, description: string, qty: number, rate: number): OpportunityLine => ({ id, tenant_id: "t1", opportunity_id: OPP, sl_no: no, description, uom: "m", qty, rate, discount_pct: 0, amount: qty * rate, product_id: null, pricing_document_id: null, group_id: null, group_label: null, group_type: null, break_of: null, break_qty: null, is_selected: true, show_on_pdf: true } as unknown as OpportunityLine);
  const lines = [line("a", "1", "Pipe 6in", 10, 50), line("b", "2", "Flange", 4, 0)];
  const hand = (p: Record<string, unknown> = {}) => clean(renderToString(createElement(DealLinesBoq, { opportunityId: OPP, lines, version: "v1", canEdit: true, cards: false, onError: noop, onNotice: noop, onChanged: noop, ...p } as never)));
  const noFile: BoqScreenState = { pending: false, source: null, lines: [], validity_days: 180, today: "2026-10-27", totals: { lines: 0, priced: 0, unpriced: 0, stale: 0, amount: 0 }, unpriced: [] } as never;
  const tab = (p: Record<string, unknown> = {}) => { nav.search = ""; return clean(renderToString(createElement(BoqTab, { opportunityId: OPP, canEdit: true, onError: noop, onNotice: noop, initialData: noFile, layout: "table", ...p } as never))); };

  it("shows the deal's own lines as rows with their item numbers, and Add line", () => {
    const out = hand();
    expect(out).toContain('data-guide="boq.hand"');
    expect(out).toContain("Lines typed by hand · 2");
    expect(out).toContain("Pipe 6in");
    expect(out).toContain('aria-label="Open item 1"');
    expect(out).toContain('data-guide="boq.hand.add"');
  });

  it("the Bill of quantities tab uses it only while no client file is uploaded, and the empty note only when there are no lines either", () => {
    expect(tab({ dealLines: lines, dealLinesVersion: "v1" })).toContain('data-guide="boq.hand"');
    expect(tab({ dealLines: lines, dealLinesVersion: "v1" })).not.toContain('data-guide="boq.empty"');
    expect(tab({ dealLines: [], dealLinesVersion: "v1" })).toContain('data-guide="boq.empty"');
    const withFile = tab({ dealLines: lines, dealLinesVersion: "v1", initialData: { ...noFile, source: { file_name: "x.xlsx", sheet_name: "S", version: 1, uploaded_at: "2026-10-26T00:00:00Z", line_count: 0, added_columns: false } } });
    expect(withFile).not.toContain('data-guide="boq.hand"');
  });

  it("opens a panel to edit one line (item number, description, quantity, unit, rate) or to add one", () => {
    const edit = hand({ initialDraft: { id: "a", sl_no: "1", description: "Pipe 6in", uom: "m", qty: "10", rate: "50" } });
    expect(edit).toContain('role="dialog"');
    for (const g of ["boq.hand.item", "boq.hand.description", "boq.hand.qty", "boq.hand.uom", "boq.hand.rate", "boq.hand.save", "boq.hand.delete"]) expect(edit, g).toContain(`data-guide="${g}"`);
    const add = hand({ initialDraft: { id: null, sl_no: "", description: "", uom: "", qty: "1", rate: "" } });
    expect(add).toContain("New line");
    expect(add).not.toContain('data-guide="boq.hand.delete"');
    for (const b of [...edit.matchAll(/<button\b[^>]*data-guide="boq\.hand\.(?:save|add|show_more)"[^>]*>/g)].map((m) => m[0])) expect(b).toContain("min-height:44px");
  });

  it("a view-only person sees the rows and can neither add nor edit", () => {
    const out = hand({ canEdit: false });
    expect(out).toContain("Pipe 6in");
    expect(out).not.toContain('data-guide="boq.hand.add"');
  });

  it("past the 200 lines the editor can keep, it is read-only and says where to go", () => {
    const big = Array.from({ length: HAND_LINE_LIMIT + 1 }, (_, i) => line(`m${i}`, String(i + 1), `Item ${i + 1}`, 1, 1));
    const out = hand({ lines: big });
    expect(out).toContain('data-guide="boq.hand.too_many"');
    expect(out).not.toContain('data-guide="boq.hand.add"');
  });

  it("saves through the lines route as one rewrite that keeps every other line, with the version it loaded", () => {
    const draft = { id: "a", sl_no: "1", description: "Pipe 6in DN150", uom: "m", qty: "12", rate: "55" };
    const body = linesPayload(lines, { replace: draft });
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ local_id: "a", sl_no: "1", description: "Pipe 6in DN150", qty: "12", rate: "55" });
    expect(body[1]).toMatchObject({ local_id: "b", sl_no: "2", description: "Flange", qty: "4", rate: "0" });
    expect(linesPayload(lines, { remove: "a" }).map((l) => l.local_id)).toEqual(["b"]);
    const added = linesPayload(lines, { replace: { id: null, sl_no: "", description: "Freight", uom: "lot", qty: "1", rate: "30" } });
    expect(added.map((l) => l.sl_no)).toEqual(["1", "2", "3"]);
    const src = read("src/components/tender/DealLinesBoq.tsx");
    expect(src).toContain('method: "PUT"');
    expect(src).toContain("base_version: version");
    expect(src).toContain("/lines`");
  });

  it("rows are the shared table rows: priced means a rate above zero", () => {
    expect(toRows(lines).map((r) => [r.item_no, r.priced])).toEqual([["1", true], ["2", false]]);
  });
});

describe("the row-level estimate actions are back in the row panel", () => {
  const row = { id: "b1", line_id: "l", row_no: 8, item_no: "A.1", cost_code: null, description: "Excavation", uom: "m3", qty: 120, rate: 0, amount: 0, priced: false, linked: true, removed: false, price_source: null, price_source_ref: null, price_as_of: null, stale: false, stale_text: null, stale_accepted: false, unit_cost: null, markup_pct: null, file_rate: null };
  const data = { pending: false, source: { file_name: "x.xlsx", sheet_name: "S", version: 1, uploaded_at: "2026-10-26T00:00:00Z", line_count: 1, added_columns: false }, lines: [row], validity_days: 180, today: "2026-10-27", totals: { lines: 1, priced: 0, unpriced: 1, stale: 0, amount: 0 }, unpriced: [] } as never;
  const est = (estimates: unknown[]) => ({ pending: false, estimates, links: [], today: "2026-10-27", valid_days: 180, bid_locked: false, stage: "estimating" });
  const panel = (p: Record<string, unknown> = {}) => { nav.search = ""; return clean(renderToString(createElement(BoqTab, { opportunityId: OPP, canEdit: true, onError: noop, onNotice: noop, initialData: data, layout: "table", initialOpenRow: "b1", ...p } as never))); };

  it("Build up this rate and Price from estimate are offered under the cost block when the estimator is on", () => {
    const out = panel({ initialEstimates: est([{ id: "e1", ref: "EST-0001", name: "Precast" }]) });
    expect(out).toContain('data-guide="boq.row.estimate_actions"');
    expect(out).toContain("Build up this rate");
    expect(out).toContain("Price from estimate");
    expect(out.indexOf('data-guide="boq.row.cost"')).toBeLessThan(out.indexOf('data-guide="boq.row.estimate_actions"'));
  });

  it("Build up is offered even when no estimate exists yet; Price from estimate only when there is one", () => {
    const out = panel({ initialEstimates: est([]) });
    expect(out).toContain("Build up this rate");
    expect(out).not.toContain("Price from estimate");
  });

  it("not offered without the estimator (no estimate state), to a view-only person, or on a row with no quantity", () => {
    expect(panel()).not.toContain('data-guide="boq.row.estimate_actions"');
    expect(panel({ canEdit: false, initialEstimates: est([{ id: "e1", ref: "E", name: "P" }]) })).not.toContain("Build up this rate");
  });

  it("the buttons are 44 px targets and the panel shows the estimate links read-only, once (no second copy of the link chips)", () => {
    const out = panel({ initialEstimates: est([{ id: "e1", ref: "EST-0001", name: "Precast" }]) });
    for (const b of [...out.matchAll(/<button\b[^>]*data-guide="boq\.estimate\.(?:price|build)"[^>]*>/g)].map((m) => m[0])) expect(b, b).toContain("min-height:44px");
    expect(out).not.toContain('data-guide="boq.estimate.link"');
  });
});

describe("Costing sends the person to the rows that still need a cost", () => {
  it("the Bill of quantities takes a one-shot filter request and applies it, and the filter lives in ?boqfilter= so a page load works", () => {
    const src = read("src/components/tender/BoqTab.tsx");
    expect(src).toContain('useUrlTab(BOQ_FILTERS, "boqfilter", "all")');
    expect(src).toMatch(/if \(!filterRequest \|\| filterRequest\.n <= askedFilter\.current\) return;/);
    expect(src).toMatch(/setFilter\(filterRequest\.filter\); setShown\(0\);/);
  });

  it("a page load with ?boqfilter=unpriced shows that filter pressed", () => {
    nav.search = "boqfilter=unpriced";
    const data = { pending: false, source: { file_name: "x.xlsx", sheet_name: "S", version: 1, uploaded_at: "2026-10-26T00:00:00Z", line_count: 2, added_columns: false },
      lines: [{ id: "p", line_id: "l", row_no: 1, item_no: "1", cost_code: null, description: "Priced row", uom: "m", qty: 1, rate: 5, amount: 5, priced: true, linked: true, removed: false, price_source: "manual", price_source_ref: null, price_as_of: "2026-10-27", stale: false, stale_text: null, stale_accepted: false, unit_cost: null, markup_pct: null },
        { id: "u", line_id: "l2", row_no: 2, item_no: "2", cost_code: null, description: "Unpriced row", uom: "m", qty: 1, rate: 0, amount: 0, priced: false, linked: true, removed: false, price_source: null, price_source_ref: null, price_as_of: null, stale: false, stale_text: null, stale_accepted: false, unit_cost: null, markup_pct: null }],
      validity_days: 180, today: "2026-10-27", totals: { lines: 2, priced: 1, unpriced: 1, stale: 0, amount: 5 }, unpriced: [] } as never;
    const out = clean(renderToString(createElement(BoqTab, { opportunityId: OPP, canEdit: true, onError: noop, onNotice: noop, initialData: data, layout: "table" } as never)));
    expect(out).toMatch(/aria-pressed="true"[^>]*data-guide="boq\.filter\.unpriced"|data-guide="boq\.filter\.unpriced"[^>]*aria-pressed="true"/);
    expect(out).toContain("Unpriced row");
    expect(out).not.toContain("Priced row</");
    nav.search = "";
  });

  it("the deal page opens the Bill of quantities when only ?boqfilter= is given, and the request is dropped when the person leaves the tab", () => {
    expect(read("src/app/(app)/pipeline/[id]/page.tsx")).toContain('sp?.boqfilter ? "boq"');
    expect(read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx")).toMatch(/if \(next !== "boq"\) setBoqRequest\(undefined\)/);
  });

  it("the row panel's Open in Costing is wired to the Costing tab", () => {
    expect(read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx")).toContain('onOpenCosting={tender.costing ? () => openTab("costing") : undefined}');
  });
});
