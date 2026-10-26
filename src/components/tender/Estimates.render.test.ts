import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { EstimatesState, LinkView, EstimateListItem } from "@/lib/tender/estimates/server";
import type { EstimateTenderContext } from "@/lib/tender/estimates/context";
import { ESTIMATE_TIPS } from "@/lib/tender/estimates/tips";

// GCC tender deals, slice 3c-1: the estimate screens, rendered on the server. 375 px and PC share one markup (one column under 900 px
// comes from the shared `.fg2` rule), so the checks are the ones that decide whether a phone fits: 44 px targets, no fixed widths, long
// lists paged, explanations behind the "i", a guide id on every control, and no cost on a screen that is not the estimate's own.

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/pipeline/x",
}));

import EstimatesTab, { type EstimatesTabData } from "./EstimatesTab";
import { LineEstimates } from "./BoqEstimates";
import { AllocatePanel, EstimateAttention } from "./BoqEstimatePanels";
import TenderEstimateStrip from "./TenderEstimateStrip";
import BoqTab, { type BoqScreenState } from "./BoqTab";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const noop = () => {};
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const EST = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";

const item = (n: number, over: Partial<EstimateListItem> = {}): EstimateListItem => ({
  id: n === 1 ? EST : `eeeeeeee-eeee-4eee-8eee-eeeeeeeeee0${n}`, ref: `EST-000${n}`, name: n === 1 ? "Pipe run, route 4" : `Estimate ${n}`, status: "draft", template_id: "t1", template_name: "Pipe run",
  currency: "SAR", margin_pct: 10, cost_total: 5006, price: 5506.6, standard_quote_id: null, opportunity_id: OPP, created_at: "2026-10-20T08:00:00.000Z", updated_at: "2026-10-24T08:00:00.000Z",
  line_count: 3, missing_count: 0, stale_links: 0, linked_boq_lines: 0, ...over,
});
const link = (over: Partial<LinkView> = {}): LinkView => ({
  id: "99999999-9999-4999-8999-999999999991", boq_id: "b1", estimate_id: EST, estimate_ref: "EST-0001", estimate_name: "Pipe run, route 4", output: "total", output_label: "Whole estimate", basis: "total", share_pct: 100,
  applied_cost: 41.7167, waiting: false, stale: false, broken: false, needs_review: false, review_note: null, ...over,
});
const state = (over: Partial<EstimatesState> = {}): EstimatesState => ({ pending: false, estimates: [item(1), item(2)], links: [], today: "2026-10-26", valid_days: 180, bid_locked: false, stage: "estimating", ...over });
const tab = (over: Partial<EstimatesTabData> = {}): EstimatesTabData => ({
  pending: false, estimates: [item(1, { stale_links: 2, linked_boq_lines: 3, missing_count: 4 }), item(2)], templates: [{ id: "t1", name: "Pipe run", description: null }, { id: "t2", name: "Precast wall", description: null }],
  can_create: true, rfq_enabled: true, ...over,
});

const guideButtons = (html: string, prefix: string) => [...html.matchAll(/<(?:button|a)\b[^>]*data-guide="([a-z_.]+)"[^>]*>/g)].filter((m) => m[1].startsWith(prefix)).map((m) => m[0]);

describe("the Estimates tab", () => {
  const html = (p: Partial<Parameters<typeof EstimatesTab>[0]> = {}) => clean(renderToString(createElement(EstimatesTab, { opportunityId: OPP, canEdit: true, onError: noop, initialData: tab(), ...p })));

  it("lists the deal's estimates with template, status, cost, price and last change, and what needs a person", () => {
    const out = html();
    expect(out).toContain('data-guide="tender.estimates"');
    expect(out).toContain("EST-0001 · Pipe run, route 4");
    expect(out).toContain("Pipe run · Draft");
    expect(out).toContain("5,006.00");
    expect(out).toContain("5,506.60");
    expect(out).toContain("Changed 24 Oct 2026");
    expect(out).toContain("3 BOQ lines priced from it");
    expect(out).toContain("Estimate changed, re-price");
    expect(out).toContain("4 costs missing");
    expect(out).toContain('href="/estimates/' + EST + '"');
  });

  it("starts a new estimate on the chosen template with this deal attached", () => {
    const out = html();
    expect(out).toContain("New estimate");
    expect(out).toContain(`href="/estimates/new?template=t1&amp;opportunity=${OPP}"`);
    expect(out).toContain('data-guide="tender.estimate.template"');
    expect(html({ initialData: tab({ templates: [] }) })).toContain(`href="/estimates/new?opportunity=${OPP}"`);
  });

  it("offers Raise RFQ for missing costs only with the RFQ module and only to someone who may edit the deal", () => {
    expect(html()).toContain('data-guide="tender.estimate.rfq"');
    expect(html({ initialData: tab({ rfq_enabled: false }) })).not.toContain('data-guide="tender.estimate.rfq"');
    expect(html({ canEdit: false })).not.toContain('data-guide="tender.estimate.rfq"');
  });

  it("a person who cannot create estimates, or who only views, sees the list but not New estimate", () => {
    expect(html({ initialData: tab({ can_create: false }) })).not.toContain('data-guide="tender.estimate.new"');
    expect(html({ canEdit: false })).not.toContain('data-guide="tender.estimate.new"');
    expect(html({ canEdit: false })).toContain("EST-0001");
  });

  it("says what to do on an empty tender and when the database update is pending", () => {
    expect(html({ initialData: tab({ estimates: [] }) })).toContain("No estimate for this tender yet");
    const pending = html({ initialData: tab({ pending: true, estimates: [] }) });
    expect(pending).toContain("migration 0227");
    expect(pending).toContain('role="alert"');
  });

  it("fits a phone: every control is a 44 px target, nothing has a fixed width, a long list shows a few and 'Show all'", () => {
    const many = tab({ estimates: Array.from({ length: 12 }, (_, i) => item(i + 1, { name: `Estimate number ${i + 1}`, ref: `EST-01${i}` })) });
    const out = html({ initialData: many });
    expect(out).toContain("Estimate number 8");
    expect(out).not.toContain("Estimate number 9");
    expect(out).toContain("Show all 12 estimates");
    for (const b of guideButtons(out, "tender.estimate")) expect(b, b).toMatch(/min-height:44px/);
    expect(out).not.toMatch(/(?<![-\w])width:\s*\d{3,}px/);
  });

  it("keeps its explanations behind the i", () => {
    const out = html();
    for (const k of ["tab", "newEstimate", "rowCost", "missing"] as const) expect(out.split(ESTIMATE_TIPS[k]).length - 1, k).toBeLessThanOrEqual(0);
    expect(out).toContain('aria-label="About New estimate"');
  });
});

describe("price from estimate and build up this rate, on a BOQ line", () => {
  const line = { id: "b1", item_no: "1.3", description: "HDPE pipe 110mm laid in trench", qty: 120, uom: "m", priced: false };
  const html = (p: Partial<Parameters<typeof LineEstimates>[0]> = {}) =>
    clean(renderToString(createElement(LineEstimates, { opportunityId: OPP, base: `/api/opportunities/${OPP}/boq`, line, state: state(), canEdit: true, markup: 0, onChanged: noop, onError: noop, onNotice: noop, ...p })));

  it("offers both ways to someone who may edit, and Price from estimate only when the deal has an estimate", () => {
    const out = html();
    expect(out).toContain("Price from estimate");
    expect(out).toContain("Build up this rate");
    expect(html({ state: state({ estimates: [] }) })).not.toContain("Price from estimate");
    expect(html({ state: state({ estimates: [] }) })).toContain("Build up this rate");
    expect(html({ line: { ...line, qty: 0 } })).not.toContain("Build up this rate");
  });

  it("a view-only person sees nothing on a line with no link, and the link but no buttons on a line with one", () => {
    expect(html({ canEdit: false })).toBe("");
    const out = html({ canEdit: false, state: state({ links: [link({ stale: true })] }) });
    expect(out).toContain("EST-0001");
    expect(out).not.toContain("Re-price");
    expect(out).not.toContain("Unlink");
    expect(out).not.toContain("Price from estimate");
  });

  it("shows the estimate that priced the line, what part of it and how", () => {
    const out = html({ state: state({ links: [link({ output: "line:x", output_label: "HDPE pipe 110mm", basis: "per_unit", share_pct: 50 })] }) });
    expect(out).toContain('href="/estimates/' + EST + '"');
    expect(out).toContain("HDPE pipe 110mm");
    expect(out).toContain("cost per unit, 50%");
    expect(html({ state: state({ links: [link()] }) })).toContain("100% of its cost");
  });

  it("says Estimate changed, re-price, and offers Re-price; a build in progress offers Use its total", () => {
    const stale = html({ state: state({ links: [link({ stale: true })] }) });
    expect(stale).toContain("Estimate changed, re-price");
    expect(stale).toContain('data-guide="boq.estimate.reprice"');
    expect(stale).toContain(">Re-price<");
    const waiting = html({ state: state({ links: [link({ waiting: true, applied_cost: null })] }) });
    expect(waiting).toContain("Build-up in progress");
    expect(waiting).toContain(">Use its total<");
    expect(html({ state: state({ links: [link()] }) })).not.toContain("Re-price");
  });

  it("shows the note an award left and offers Mark reviewed; a part that is gone is called out", () => {
    const review = html({ state: state({ links: [link({ needs_review: true, review_note: "RFQ-0004 was awarded to Gulf Pipes" })] }) });
    expect(review).toContain("RFQ-0004 was awarded to Gulf Pipes");
    expect(review).toContain("Mark reviewed");
    expect(html({ state: state({ links: [link({ broken: true })] }) })).toContain("That part of the estimate is gone");
  });

  it("the open picker lists the outputs with the cost per unit each gives, as 44 px targets", () => {
    const out = html({
      initialOpen: "price",
      initialOutputs: {
        estimate: { id: EST, ref: "EST-0001", name: "Pipe run" }, boq: { id: "b1", qty: 120, uom: "m" },
        outputs: [
          { key: "total", kind: "total", label: "Whole estimate", cost: 5006, qty: null, unit: null, lines: 3, unpriced: 0, per_unit_total: 41.7167, per_unit_line: null, reason: null },
          { key: "line:x", kind: "line", label: "HDPE pipe 110mm", cost: 3906, qty: 120, unit: "m", lines: 1, unpriced: 1, per_unit_total: 32.55, per_unit_line: 32.55, reason: null },
        ],
      },
    });
    expect(out).toContain('data-guide="boq.estimate.picker"');
    expect(out).toContain("Whole estimate");
    expect(out).toContain("41.72 per m");
    expect(out).toContain("1 without a cost");
    for (const b of guideButtons(out, "boq.estimate")) expect(b, b).toMatch(/min-height:44px/);
    expect(out).not.toMatch(/(?<![-\w])width:\s*\d{3,}px/);
  });

  it("a build-up waiting on an unconfirmed quantity says so on the BOQ line, with both numbers when they differ, and is silent when they match", () => {
    const q = { status: "mismatch" as const, measured: 17.5, boq_qty: 120, uom: "m", item: "1.3", needs_confirm: true, note: "This estimate is for 17.5 m, the BOQ line is 120 m. Make this estimate for 120 m, then confirm." };
    const out = html({ state: state({ links: [link({ waiting: true, applied_cost: null, quantity: q })] }) });
    expect(out).toContain('data-guide="boq.estimate.quantity"');
    expect(out).toContain("This estimate is for 17.5 m, the BOQ line is 120 m. Make this estimate for 120 m, then confirm.");
    expect(out).toContain(">Use its total<");
    for (const b of guideButtons(out, "boq.estimate").filter((x) => x.startsWith("<button"))) expect(b, b).toMatch(/min-height:44px/);
    expect(out).not.toMatch(/(?<![-\w])width:\s*\d{3,}px/);
    const ok = html({ state: state({ links: [link({ waiting: true, applied_cost: null, quantity: { ...q, status: "matches", measured: 120, needs_confirm: false, note: null } })] }) });
    expect(ok).not.toContain('data-guide="boq.estimate.quantity"');
  });

  it("the builder says what the line's quantity is and asks for a template", () => {
    const out = html({ initialOpen: "build" });
    expect(out).toContain('data-guide="boq.estimate.builder"');
    expect(out).toContain("120 m");
  });
});

describe("Allocate to BOQ and the attention row", () => {
  const base = `/api/opportunities/${OPP}/boq`;
  const alloc = {
    estimate: { id: EST, ref: "EST-0001", name: "Pipe run" },
    outputs: [{ key: "total", label: "Whole estimate", cost: 5006 }, { key: `line:x`, label: "HDPE pipe 110mm", cost: 3906 }],
    rows: [
      { boq_id: "b1", item_no: "1.3", row_no: 7, description: "HDPE pipe 110mm laid in trench", qty: 120, uom: "m", amount: 6000, output: "line:x", output_label: "HDPE pipe 110mm", output_cost: 3906, band: "strong" as const, score: 77, share_pct: 66.67 },
      { boq_id: "b2", item_no: "1.4", row_no: 8, description: "HDPE pipe 110mm, road crossing", qty: 30, uom: "m", amount: 3000, output: "line:x", output_label: "HDPE pipe 110mm", output_cost: 3906, band: "possible" as const, score: 62, share_pct: 33.33 },
    ],
    existing: [],
  };
  const panel = (p: Partial<Parameters<typeof AllocatePanel>[0]> = {}) =>
    clean(renderToString(createElement(AllocatePanel, { base, state: state(), canEdit: true, markup: 0, onChanged: noop, onError: noop, onNotice: noop, initialData: alloc, initialOpen: true, ...p })));

  it("shows the chip, and nothing at all when the deal has no estimate", () => {
    expect(panel({ initialOpen: false })).toContain("Allocate to BOQ");
    expect(panel({ initialOpen: false })).not.toContain('data-guide="boq.allocate.panel"');
    expect(panel({ state: state({ estimates: []}) })).toBe("");
  });

  it("open: each BOQ line with the estimate part it takes, its match band, an editable share and the cost per unit, and the unallocated cost", () => {
    const out = panel();
    expect(out).toContain('data-guide="boq.allocate.panel"');
    expect(out).toContain("HDPE pipe 110mm laid in trench");
    expect(out).toContain("strong match");
    expect(out).toContain("possible match");
    expect(out).toContain('value="66.67"');
    // 3,906 x 66.67% over 120 m.
    expect(out).toContain("21.70 / m");
    expect(out).toContain("Allocated");
    expect(out).toContain("Unallocated");
    expect(out).toContain('data-guide="boq.allocate.apply"');
    expect(out).toContain("Apply to 2 lines");
  });

  it("a view-only person gets no Apply button", () => {
    expect(panel({ canEdit: false })).not.toContain('data-guide="boq.allocate.apply"');
  });

  it("fits a phone: tick boxes and buttons are 44 px targets and nothing has a fixed width", () => {
    const out = panel();
    for (const b of guideButtons(out, "boq.allocate")) expect(b, b).toMatch(/min-height:44px/);
    expect(out).toMatch(/<label[^>]*min-height:44px/);
    expect(out).not.toMatch(/(?<![-\w])width:\s*\d{3,}px/);
  });

  const attention = (s: EstimatesState, p: Partial<Parameters<typeof EstimateAttention>[0]> = {}) =>
    clean(renderToString(createElement(EstimateAttention, { opportunityId: OPP, base, state: s, canEdit: true, markup: 0, rfqEnabled: true, onChanged: noop, onError: noop, onNotice: noop, ...p })));

  it("counts the costs still missing and the lines whose estimate changed, and is silent when there is nothing", () => {
    expect(attention(state())).toBe("");
    const s = state({ estimates: [item(1, { missing_count: 3 }), item(2, { missing_count: 2 })], links: [link({ stale: true }), link({ id: "99999999-9999-4999-8999-999999999992", boq_id: "b2", waiting: true })] });
    const out = attention(s);
    expect(out).toContain("5 estimate costs missing");
    expect(out).toContain("Re-price 2 lines (estimate changed)");
    for (const b of guideButtons(out, "boq.estimate")) expect(b, b).toMatch(/min-height:44px/);
  });

  it("the missing-costs list names the estimates and offers the RFQ only with the RFQ module", () => {
    const s = state({ estimates: [item(1, { missing_count: 3 })] });
    expect(attention(s, { initialOpen: true })).toContain('data-guide="boq.estimate.rfq"');
    const no = attention(s, { initialOpen: true, rfqEnabled: false });
    expect(no).not.toContain('data-guide="boq.estimate.rfq"');
    expect(no).toContain("does not have the RFQ module");
  });
});

describe("the strip on an estimate made for a tender", () => {
  const ctx = (over: Partial<EstimateTenderContext> = {}): EstimateTenderContext => ({
    deal: { id: OPP, ref: "OPP-0011", title: "Pipeline package 4", stage: "estimating" }, bid_locked: false, links: [], missing: [], origin_label: "Estimate EST-0001 (Tender OPP-0011)",
    valid_days: 180, rfq_enabled: true, locked: false, ...over,
  });
  const html = (c: EstimateTenderContext, canEdit = true) => clean(renderToString(createElement(TenderEstimateStrip, { ctx: c, estimateId: EST, canEdit })));

  it("says which tender the estimate is for and links back to it", () => {
    const out = html(ctx());
    expect(out).toContain("Tender: OPP-0011");
    expect(out).toContain(`href="/pipeline/${OPP}?tab=estimates"`);
    expect(out).toContain("Back to the tender");
  });

  it("a build waiting to be used offers to price the line, an estimate that moved on offers to re-price, an award leaves its note", () => {
    const out = html(ctx({ links: [
      { link_id: "l1", boq_id: "b1", item: "1.3 HDPE pipe", qty: 120, uom: "m", waiting: true, stale: false, needs_review: false, review_note: null, output_label: "Whole estimate" },
      { link_id: "l2", boq_id: "b2", item: "1.4 Road crossing", qty: 30, uom: "m", waiting: false, stale: true, needs_review: false, review_note: null, output_label: "Whole estimate" },
      { link_id: "l3", boq_id: "b3", item: "1.5 Valves", qty: 4, uom: "no", waiting: false, stale: false, needs_review: true, review_note: "RFQ-0004 was awarded to Gulf Pipes", output_label: "Line" },
    ] }));
    expect(out).toContain("Built for BOQ item 1.3 HDPE pipe · 120 m");
    expect(out).toContain("Price the line from this estimate");
    expect(out).toContain("Estimate changed, re-price 1 BOQ line");
    expect(out).toContain("RFQ-0004 was awarded to Gulf Pipes");
    expect(out).toContain(`href="/pipeline/${OPP}?tab=boq"`);
  });

  it("shows the missing costs and the RFQ button; a quoted estimate or a deal without the RFQ module gets no button", () => {
    const missing = [{ source_line_id: "x", description: "Gate valve", include: true, hint: "no cost yet" }];
    expect(html(ctx({ missing }))).toContain("1 cost missing or older than 180 days");
    expect(html(ctx({ missing }))).toContain('data-guide="tender.estimate.rfq"');
    expect(html(ctx({ missing, locked: true }))).not.toContain('data-guide="tender.estimate.rfq"');
    expect(html(ctx({ missing, rfq_enabled: false }))).not.toContain('data-guide="tender.estimate.rfq"');
    expect(html(ctx({ missing }), false)).not.toContain('data-guide="tender.estimate.rfq"');
  });

  const waitingLink = (quantity: EstimateTenderContext["links"][number]["quantity"]): EstimateTenderContext["links"][number] =>
    ({ link_id: "l1", boq_id: "b1", item: "1.1 Supply and lay 600x600 white porcelain floor tiles", qty: 120, uom: "m2", waiting: true, stale: false, needs_review: false, review_note: null, output_label: "Whole estimate", quantity });
  const notFilled = { status: "unknown" as const, measured: null, boq_qty: 120, uom: "m2", item: "1.1 Supply and lay tiles", needs_confirm: true, note: "The quantity was not filled in automatically. Make this estimate for 120 m2, then confirm." };
  const mismatch = { status: "mismatch" as const, measured: 17.5, boq_qty: 120, uom: "m2", item: "1.1 Supply and lay tiles", needs_confirm: true, note: "This estimate is for 17.5 m2, the BOQ line is 120 m2. Make this estimate for 120 m2, then confirm." };

  it("warns in plain sight, not behind an i, when the quantity was not filled in automatically (live test: 17.5 m2 default for a 120 m2 line)", () => {
    const out = html(ctx({ links: [waitingLink(notFilled)] }));
    expect(out).toContain("The quantity was not filled in automatically. Make this estimate for 120 m2, then confirm.");
    expect(out).toMatch(/<div role="alert" data-guide="tender.estimate.quantity"/);
    // The sentence is printed on the screen, not held in a tooltip, and the action is still the one standard button.
    expect(out).not.toContain(ESTIMATE_TIPS.tenderStrip + "The quantity");
    expect(out).toContain("Price the line from this estimate");
  });

  it("shows both numbers when the estimate's own quantity is known and differs, on a waiting build-up and on a rate already in use", () => {
    expect(html(ctx({ links: [waitingLink(mismatch)] }))).toContain("This estimate is for 17.5 m2, the BOQ line is 120 m2. Make this estimate for 120 m2, then confirm.");
    const used = html(ctx({ links: [{ ...waitingLink({ ...mismatch, needs_confirm: false, note: "This estimate is for 17.5 m2, the BOQ line is 120 m2." }), waiting: false }] }));
    expect(used).toContain('data-guide="tender.estimate.quantity_mismatch"');
    expect(used).toContain("This estimate is for 17.5 m2, the BOQ line is 120 m2.");
  });

  it("says nothing when the quantity is known to match, or when nothing is known about a link", () => {
    for (const q of [{ ...notFilled, status: "matches" as const, measured: 120, needs_confirm: false, note: null }, null, undefined]) {
      const out = html(ctx({ links: [waitingLink(q)] }));
      expect(out).not.toContain("tender.estimate.quantity");
      expect(out).not.toContain("not filled in automatically");
    }
  });

  it("the warning is the same markup at 375 px and on a PC: it wraps, has no fixed width, and the buttons stay 44 px targets", () => {
    const out = html(ctx({ links: [waitingLink(notFilled)] }));
    expect(out).toMatch(/overflow-wrap:anywhere/);
    expect(out).not.toMatch(/(?<![-\w])width:\s*\d{3,}px/);
    for (const b of guideButtons(out, "tender.estimate")) expect(b, b).toMatch(/min-height:44px/);
  });

  it("every link and button is a 44 px target", () => {
    const out = html(ctx({ links: [{ link_id: "l1", boq_id: "b1", item: "1.3", qty: 1, uom: "m", waiting: true, stale: false, needs_review: false, review_note: null, output_label: "x" }] }));
    for (const b of guideButtons(out, "tender.estimate")) expect(b, b).toMatch(/min-height:44px/);
  });
});

describe("the Bill of quantities and the deal page", () => {
  const boqState: BoqScreenState = {
    pending: false,
    source: { file_name: "x.xlsx", sheet_name: "BOQ", version: 1, uploaded_at: "2026-10-26T08:00:00Z", line_count: 1, added_columns: false },
    lines: [{ id: "b1", line_id: "l1", row_no: 8, item_no: "A.1", cost_code: null, description: "Excavation", uom: "m3", qty: 10, rate: 41.72, amount: 417.2, priced: true, linked: true, removed: false, price_source: "estimate", price_source_ref: "EST-0001", price_as_of: "2026-10-26", stale: false, stale_text: null, stale_accepted: false, unit_cost: 41.7167, markup_pct: 0 } as never],
    validity_days: 180, today: "2026-10-26", totals: { lines: 1, priced: 1, unpriced: 0, stale: 0, amount: 417.2 }, unpriced: [],
  } as BoqScreenState;
  const render = (initialEstimates?: EstimatesState) => { nav.search = ""; return clean(renderToString(createElement(BoqTab, { opportunityId: OPP, canEdit: true, onError: noop, onNotice: noop, initialData: boqState, initialEstimates }))); };

  it("names the estimate that priced the row as a chip, and a workspace without estimates still names it from the rate's source (the estimate tools live in Costing)", () => {
    const withEst = render(state({ links: [link({ boq_id: "b1" })] }));
    expect(withEst).toContain('data-chip="estimate"');
    expect(withEst).toContain("EST-0001");
    expect(withEst).not.toContain('data-guide="boq.estimate"');
    expect(withEst).not.toContain("Allocate to BOQ");
    const without = render();
    expect(without).toContain('data-chip="estimate"');
    expect(without).toContain("EST-0001");
  });

  it("the deal client draws an Estimates tab only when the server says the person may see Estimates", () => {
    const client = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(client).toMatch(/tender\?\.estimates \? \[\{ id: "estimates" as Tab, label: "Estimates" \}\]/);
    expect(client).toMatch(/tab === "estimates" && tender\?\.estimates && <EstimatesTab/);
    const page = read("src/app/(app)/pipeline/[id]/page.tsx");
    expect(page).toMatch(/tenant\?\.features\?\.estimator === true && canViewWorkcenter\(dealPerms, "estimates"\)/);
  });
});

describe("what a screen never shows and where its words live", () => {
  it("the explanations are in tips.ts, held to the limit by the test next to it, and not printed on the screens", () => {
    for (const f of ["src/components/tender/EstimatesTab.tsx", "src/components/tender/BoqEstimates.tsx", "src/components/tender/BoqEstimatePanels.tsx", "src/components/tender/TenderEstimateStrip.tsx", "src/components/tender/MissingRfqButton.tsx"]) {
      expect(read(f), f).toContain("ESTIMATE_TIPS");
    }
  });

  it("every control carries a guide id the assistant can point at", () => {
    const files = ["src/components/tender/EstimatesTab.tsx", "src/components/tender/BoqEstimates.tsx", "src/components/tender/BoqEstimatePanels.tsx", "src/components/tender/TenderEstimateStrip.tsx", "src/components/tender/MissingRfqButton.tsx"];
    const ids = new Set(files.flatMap((f) => [...read(f).matchAll(/"((?:tender|boq)\.[a-z_.]+)"/g)].map((m) => m[1])));
    for (const id of [
      "tender.estimate.quantity", "tender.estimate.quantity_mismatch", "boq.estimate.quantity",
      "tender.estimates", "tender.estimate.new", "tender.estimate.template", "tender.estimate.open", "tender.estimate.rfq", "tender.estimate.strip", "tender.estimate.back", "tender.estimate.use_total", "tender.estimate.reprice",
      "boq.estimate", "boq.estimate.price", "boq.estimate.build", "boq.estimate.picker", "boq.estimate.output", "boq.estimate.reprice", "boq.estimate.unlink", "boq.estimate.reviewed", "boq.estimate.reprice_all", "boq.estimate.missing_chip",
      "boq.allocate", "boq.allocate.chip", "boq.allocate.panel", "boq.allocate.apply", "boq.allocate.tick", "boq.allocate.share", "boq.allocate.mode", "boq.allocate.estimate",
    ]) expect(ids, id).toContain(id);
  });

  it("the screens that are not the estimate's own carry no cost field name in what they send (the server works the cost out)", () => {
    for (const f of ["src/components/tender/BoqEstimates.tsx", "src/components/tender/BoqEstimatePanels.tsx", "src/components/tender/TenderEstimateStrip.tsx"]) {
      const src = read(f).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src, f).not.toMatch(/applied_cost:|unit_cost:|cost_per_unit:|rate:/);
    }
  });
});
