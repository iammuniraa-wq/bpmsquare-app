import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pillar } from "@/lib/theme";
import type { EstimateListItem } from "@/lib/tender/estimates/server";
import type { EstimateTenderContext } from "@/lib/tender/estimates/context";

// Colour system (docs/design/colour-system.md) on the tender-edition screens: each strip names what it shows in words, picks its tone
// from the meaning of the number, wraps on a phone (auto-fit grid) and carries no colour literal of its own.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/pipeline/x",
}));

import TenderStatStrip from "./TenderStatStrip";
import BoqTab, { type BoqScreenState } from "./BoqTab";
import EstimatesTab, { type EstimatesTabData } from "./EstimatesTab";
import TenderEstimateStrip from "./TenderEstimateStrip";
import RfqStatStrip, { rfqProgress } from "@/components/rfq/RfqStatStrip";

const ROOT = path.resolve(__dirname, "../../..");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const noop = () => {};
const NOW = "2026-10-26T08:00:00.000Z";
const TZ = "Asia/Riyadh";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const tones = (html: string) => [...html.matchAll(/data-tone="([a-z]+)"/g)].map((m) => m[1]);
const tileOf = (html: string, label: string) => {
  const i = html.indexOf(`>${label}<`);
  expect(i, label).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<div data-tone", i), i);
};

describe("the strip at the top of the tender Overview", () => {
  type Props = Parameters<typeof TenderStatStrip>[0];
  const base: Props = { closingAt: "2026-10-30T09:00:00.000Z", nowIso: NOW, timezone: TZ, finished: false, decision: "go", approvalPending: null, bond: { amount: 96000, expiry: "2027-06-30", status: "held" }, openQuestions: 0, overdueSteps: 0 };
  const html = (over: Partial<Props> = {}) => clean(renderToString(createElement(TenderStatStrip, { ...base, ...over })));

  it("names the bid end date countdown, the decision, the guarantee and the open work, each in words", () => {
    const out = html();
    expect(out).toContain('data-guide="tender.strip"');
    for (const w of ["Bid end date", "Bid decision", "Bid guarantee", "Open work", "Bid ends in 4 days", "Go", "Issued"]) expect(out, w).toContain(w);
    expect(out).toContain("repeat(auto-fit, minmax(170px, 1fr))");
    // The only hex in the markup is a theme.ts pillar edge token.
    expect(Object.values(pillar).reduce((h, p) => h.split(p.base).join(""), out)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("tones follow the meaning: soon is amber, a go is teal, an issued guarantee is teal, nothing open is plain", () => {
    const out = html();
    expect(tileOf(out, "Bid end date")).toContain('data-tone="warn"');
    expect(tileOf(out, "Bid decision")).toContain('data-tone="good"');
    expect(tileOf(out, "Bid guarantee")).toContain('data-tone="good"');
    expect(tileOf(out, "Open work")).toContain('data-tone="neutral"');
    expect(out).not.toContain("border-top:3px");
  });

  it("past is red, far away is plain, a no-go is red, a waiting proposal is amber, an expiring bond is amber, open work is amber", () => {
    expect(tileOf(html({ closingAt: "2026-10-20T09:00:00.000Z" }), "Bid end date")).toContain('data-tone="bad"');
    expect(tileOf(html({ closingAt: "2026-12-20T09:00:00.000Z" }), "Bid end date")).toContain('data-tone="neutral"');
    expect(tileOf(html({ decision: "no_go" }), "Bid decision")).toContain('data-tone="bad"');
    const waiting = html({ decision: null, approvalPending: "go" });
    expect(tileOf(waiting, "Bid decision")).toContain('data-tone="warn"');
    expect(waiting).toContain("Awaiting approval");
    expect(tileOf(html({ bond: { amount: 1, expiry: "2026-11-05", status: "held" } }), "Bid guarantee")).toContain('data-tone="warn"');
    expect(tileOf(html({ bond: { amount: 1, expiry: "2026-10-01", status: "held" } }), "Bid guarantee")).toContain('data-tone="bad"');
    const busy = html({ openQuestions: 2, overdueSteps: 1 });
    expect(tileOf(busy, "Open work")).toContain('data-tone="warn"');
    expect(busy).toContain("2 open questions");
    expect(busy).toContain("1 overdue step");
  });

  it("a finished tender shows its date, not a countdown, and a tender with no guarantee says so", () => {
    const out = html({ finished: true, bond: { amount: null, expiry: null, status: "held" } });
    expect(tileOf(out, "Bid end date")).toContain('data-tone="neutral"');
    expect(out).toContain("no longer a deadline");
    expect(out).not.toContain("Bid ends in");
    expect(out).toContain("no guarantee recorded");
  });

  it("is drawn on the tender Overview only, and the guarantee is named in the new words", () => {
    expect(readFileSync(path.join(ROOT, "src/app/(app)/pipeline/[id]/TenderOverview.tsx"), "utf8")).toContain("<TenderStatStrip");
    expect(readFileSync(path.join(ROOT, "src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx"), "utf8")).not.toContain("TenderStatStrip");
  });
});

describe("the Prices strip on the BOQ tab", () => {
  const state = (totals: Partial<BoqScreenState["totals"]>): BoqScreenState => ({
    pending: false,
    source: { file_name: "x.xlsx", sheet_name: "BOQ", version: 1, uploaded_at: "2026-10-26T08:00:00Z", line_count: 3, added_columns: false },
    lines: [], validity_days: 180, today: "2026-10-26", totals: { lines: 3, priced: 3, unpriced: 0, stale: 0, amount: 1250.5, ...totals }, unpriced: [],
  } as BoqScreenState);
  const html = (s: BoqScreenState) => clean(renderToString(createElement(BoqTab, { opportunityId: OPP, canEdit: true, onError: noop, onNotice: noop, initialData: s })));

  it("everything priced is teal, the total is blue, the rest is plain", () => {
    const out = html(state({}));
    expect(out).toContain('data-guide="boq.summary"');
    expect(tileOf(out, "Priced")).toContain('data-tone="good"');
    expect(out).toContain("3 of 3");
    expect(tileOf(out, "Total")).toContain('data-tone="info"');
    expect(out).toContain("1,250.50");
    expect(tileOf(out, "Stale prices")).toContain('data-tone="neutral"');
    expect(tileOf(out, "Without a product")).toContain('data-tone="neutral"');
  });

  it("lines still to price, stale prices and lines without a product are amber, and say how many", () => {
    const out = html(state({ priced: 1, unpriced: 2, stale: 1, no_product: 3 }));
    expect(tileOf(out, "Priced")).toContain('data-tone="warn"');
    expect(out).toContain("1 of 3");
    expect(out).toContain("2 to price");
    expect(tileOf(out, "Stale prices")).toContain('data-tone="warn"');
    expect(out).toContain("older than 180 days");
    expect(tileOf(out, "Without a product")).toContain('data-tone="warn"');
  });
});

describe("the strip on the Estimates tab", () => {
  const item = (n: number, over: Partial<EstimateListItem> = {}): EstimateListItem => ({
    id: `eeeeeeee-eeee-4eee-8eee-eeeeeeeeee0${n}`, ref: `EST-000${n}`, name: `Estimate ${n}`, status: "draft", template_id: "t1", template_name: "Pipe run",
    currency: "SAR", margin_pct: 10, cost_total: 1000, price: 1100, standard_quote_id: null, opportunity_id: OPP, created_at: "2026-10-20T08:00:00.000Z", updated_at: "2026-10-24T08:00:00.000Z",
    line_count: 3, missing_count: 0, stale_links: 0, linked_boq_lines: 0, ...over,
  });
  const data = (estimates: EstimateListItem[]): EstimatesTabData => ({ pending: false, estimates, templates: [], can_create: false, rfq_enabled: false });
  const html = (estimates: EstimateListItem[]) => clean(renderToString(createElement(EstimatesTab, { opportunityId: OPP, canEdit: true, onError: noop, initialData: data(estimates) })));

  it("adds up the estimates, the cost and the lines they price; a changed estimate is amber", () => {
    const out = html([item(1, { cost_total: 5006, stale_links: 2, linked_boq_lines: 3 }), item(2, { cost_total: 994, linked_boq_lines: 1 })]);
    expect(out).toContain('data-guide="tender.estimates.strip"');
    expect(tileOf(out, "Estimates linked")).toContain('data-tone="context"');
    expect(out).toContain("6,000.00");
    expect(tileOf(out, "Cost total")).toContain('data-tone="info"');
    expect(tileOf(out, "Lines priced from them")).toContain('data-tone="good"');
    expect(tileOf(out, "Needs re-price")).toContain('data-tone="warn"');
    expect(out).toContain("an estimate changed");
  });

  it("nothing changed is plain, and no estimates means no strip", () => {
    const calm = html([item(1)]);
    expect(tileOf(calm, "Needs re-price")).toContain('data-tone="neutral"');
    expect(tileOf(calm, "Lines priced from them")).toContain('data-tone="neutral"');
    expect(html([])).not.toContain("tender.estimates.strip");
  });

  it("mixed currencies are said, never added up silently", () => {
    expect(html([item(1), item(2, { currency: "USD" })])).toContain("mixed currencies");
  });
});

describe("the strip on an estimate made for a tender", () => {
  const ctx = (over: Partial<EstimateTenderContext> = {}): EstimateTenderContext => ({
    deal: { id: OPP, ref: "OPP-0011", title: "Pipeline package 4", stage: "estimating" }, bid_locked: false, links: [], missing: [], origin_label: "x", valid_days: 180, rfq_enabled: false, locked: false, ...over,
  });
  const lnk = (id: string, over: Record<string, unknown> = {}) => ({ link_id: id, boq_id: "b", item: "1.3", qty: 1, uom: "m", waiting: false, stale: false, needs_review: false, review_note: null, output_label: "x", ...over });
  const html = (c: EstimateTenderContext) => clean(renderToString(createElement(TenderEstimateStrip, { ctx: c, estimateId: "e1", canEdit: true })));

  it("counts the linked lines, those priced, those to re-price and the missing costs, in amber when they need a person", () => {
    const out = html(ctx({ links: [lnk("l1"), lnk("l2", { stale: true }), lnk("l3", { waiting: true })], missing: [{} as never] }));
    expect(out).toContain('data-guide="tender.estimate.tiles"');
    expect(tileOf(out, "BOQ lines linked")).toContain('data-tone="context"');
    expect(tileOf(out, "Lines priced")).toContain('data-tone="good"');
    expect(tileOf(out, "Needs re-price")).toContain('data-tone="warn"');
    expect(tileOf(out, "Costs missing")).toContain('data-tone="warn"');
    expect(out).toContain("1 waiting to price");
  });

  it("keeps the amber quantity-mismatch warning, and shows no tiles for an estimate with no links and no gaps", () => {
    const mismatch = html(ctx({ links: [lnk("l1", { quantity: { status: "mismatch", note: "Built for 10 m, the BOQ line is 12 m" } })] }));
    expect(mismatch).toContain('data-guide="tender.estimate.quantity_mismatch"');
    expect(mismatch).toContain("Built for 10 m, the BOQ line is 12 m");
    expect(html(ctx())).not.toContain("tender.estimate.tiles");
  });
});

describe("the strip on an RFQ", () => {
  const sup = (status: string) => ({ status });
  const lines = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const b = { suppliers: [sup("pending"), sup("sent"), sup("replied"), sup("declined"), sup("cancelled")], lines, awards: [{ rfq_line_id: "a" }], responses: [] };

  it("works out invited, replies, awarded and open from the loaded bundle, ignoring cancelled suppliers", () => {
    expect(rfqProgress(b)).toEqual({ invited: 4, unsent: 1, replied: 2, waiting: 1, lines: 3, awarded: 1, open: 2 });
  });

  it("falls back to awarded replies while the awards migration is pending", () => {
    expect(rfqProgress({ ...b, awards: undefined, awards_pending: true, responses: [{ rfq_line_id: "a", is_awarded: true }, { rfq_line_id: "b", is_awarded: true }, { rfq_line_id: "zzz", is_awarded: true }] }).awarded).toBe(2);
  });

  it("awarded is teal, still open is amber, replies waiting is amber, and the words say it", () => {
    const out = clean(renderToString(createElement(RfqStatStrip, { progress: rfqProgress(b) })));
    expect(out).toContain('data-guide="rfq.strip"');
    for (const w of ["Suppliers invited", "Replies in", "Awarded lines", "Still open", "1 of 3", "1 still waiting", "lines without a winner"]) expect(out, w).toContain(w);
    expect(tileOf(out, "Awarded lines")).toContain('data-tone="good"');
    expect(tileOf(out, "Still open")).toContain('data-tone="warn"');
    expect(tileOf(out, "Replies in")).toContain('data-tone="warn"');
    expect(tones(out)).toHaveLength(4);
  });

  it("everything awarded leaves nothing open and nothing amber", () => {
    const out = clean(renderToString(createElement(RfqStatStrip, { progress: rfqProgress({ ...b, suppliers: [sup("replied")], awards: lines.map((l) => ({ rfq_line_id: l.id })) }) })));
    expect(out).toContain("every line has a winner");
    expect(tileOf(out, "Still open")).toContain('data-tone="neutral"');
    expect(tileOf(out, "Replies in")).toContain('data-tone="good"');
  });

  it("is drawn on the RFQ page", () => {
    expect(readFileSync(path.join(ROOT, "src/app/(app)/rfqs/[id]/RfqDetailClient.tsx"), "utf8")).toContain("<RfqStatStrip");
  });
});
