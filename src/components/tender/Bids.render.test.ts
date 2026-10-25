import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Opportunity, OpportunityLine } from "@/lib/types";
import type { OpportunityStageDef } from "@/lib/constants";
import { diffBids, type BidLine, type BidsData } from "@/lib/tender/bids/rules";
import type { CallsData, CallView } from "@/lib/tender/calls";
import type { OutcomeData } from "@/lib/tender/outcome";

// Slice 4 screens, rendered on the server: the Bids tab, the calls on the Activity tab, the Log a call panel, the Outcome section and
// the tabs of a tender deal. 375 px and PC share one markup: one column under 900 px comes from the shared `.fg2` rule, so the checks
// here are the ones that decide whether a phone fits: 44 px targets, no fixed widths, long lists paged.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/pipeline/x",
}));

import BidsTab from "./BidsTab";
import CallsPanel from "./CallsPanel";
import { LogCallButton } from "./LogCall";
import OutcomeSection from "./OutcomeSection";
import OpportunityDetailClient from "@/app/(app)/pipeline/[id]/OpportunityDetailClient";

const ROOT = path.resolve(__dirname, "../../..");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const fmt = (n: number) => `SAR ${n.toLocaleString("en-US")}`;
const noop = () => {};
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const ver = (n: number, total: number, over: Record<string, unknown> = {}) => ({ id: `v${n}`, version_no: n, submitted_at: `2026-10-${10 + n}T09:00:00Z`, submitted_by_name: "S. Khan", currency: "SAR", total, line_count: 3, revision_reason: n > 1 ? "Addendum 2: scope changed" : null, note: null, ...over });
const bids = (over: Partial<BidsData> = {}): BidsData => ({ versions: [ver(2, 6500), ver(1, 6600)], pending: false, working_total: 6500, canEdit: true, ...over });

function buttonsOf(html: string, guidePrefix: string) {
  return [...html.matchAll(/<button\b[^>]*data-guide="(tender\.[a-z_.]+)"[^>]*>/g)].filter((m) => m[1].startsWith(guidePrefix)).map((m) => m[0]);
}

describe("the Bids tab", () => {
  const html = (props: Partial<Parameters<typeof BidsTab>[0]> = {}) =>
    clean(renderToString(createElement(BidsTab, { opportunityId: OPP, data: bids(), stage: "estimating", outcome: "open", fmt, onError: noop, onNotice: noop, ...props })));

  it("shows the lines total now, the last submitted version and the versions newest first", () => {
    const out = html();
    expect(out).toContain('data-guide="tender.bids"');
    expect(out).toContain("Lines total now");
    expect(out).toContain("SAR 6,500");
    expect(out).toContain("Version 2 · SAR 6,500");
    expect(out.indexOf("Version 2")).toBeLessThan(out.indexOf("Version 1"));
    expect(out).toContain("Why revised: Addendum 2: scope changed");
    expect(out).toContain("same as the last version");
  });

  it("offers Submit bid from Estimating and Revise bid from Submitted, never both, never when closed or view-only", () => {
    expect(html()).toContain('data-guide="tender.bid.submit"');
    expect(html()).not.toContain('data-guide="tender.bid.revise"');
    expect(html({ stage: "submitted" })).toContain('data-guide="tender.bid.revise"');
    expect(html({ stage: "submitted" })).not.toContain('data-guide="tender.bid.submit"');
    expect(html({ stage: "clarifications" })).toContain('data-guide="tender.bid.revise"');
    expect(html({ stage: "clarifications" })).toContain('data-guide="tender.bid.submit"');
    expect(html({ stage: "awarded", outcome: "won" })).not.toMatch(/tender\.bid\.(submit|revise)/);
    expect(html({ data: bids({ canEdit: false }) })).not.toMatch(/tender\.bid\.(submit|revise)/);
  });

  it("the submit form asks for a reason from the second version and not for the first", () => {
    const second = html({ initialSubmitOpen: true });
    expect(second).toContain("Submit version 3");
    expect(second).toContain('data-guide="tender.bid.reason"');
    expect(second).toContain('data-guide="tender.bid.confirm"');
    const first = html({ initialSubmitOpen: true, data: bids({ versions: [], working_total: 100 }) });
    expect(first).toContain("Submit version 1");
    expect(first).not.toContain('data-guide="tender.bid.reason"');
    expect(first).toContain("None yet");
  });

  it("compares two versions: counts, the total's change in amount and percent, and the lines that moved", () => {
    const line = (item_no: string, description: string, qty: number, rate: number): BidLine => ({ key: `no:${item_no}`, item_no, description, unit: "Nos", qty, rate, amount: qty * rate, product_ref: null, price_source: null });
    const from = { lines: [line("1", "Gate valve", 4, 100), line("3", "Mobilisation", 1, 5000)], total: 5400 };
    const to = { lines: [line("1", "Gate valve", 4, 90), line("4", "Testing", 1, 800)], total: 1160 };
    const out = html({ initialCompare: { from: 1, to: 2, diff: diffBids(from, to) } });
    expect(out).toContain('data-guide="tender.bid.diff"');
    expect(out).toContain("-SAR 4,240 (-78.52%)");
    expect(out).toContain("Lines added");
    expect(out).toContain("Testing");
    expect(out).toContain("Lines removed");
    expect(out).toContain("Mobilisation");
    expect(out).toContain("Lines changed");
    expect(out).toContain("Rate SAR 100 to SAR 90");
  });

  it("needs two versions to compare, and says a database update is needed while the migration is pending", () => {
    expect(html({ data: bids({ versions: [ver(1, 6600)] }) })).not.toContain('data-guide="tender.bid.compare"');
    expect(html()).toContain('data-guide="tender.bid.compare"');
    const pending = html({ data: bids({ versions: [], pending: true }) });
    expect(pending).toContain("migration 0225");
    expect(pending).not.toMatch(/tender\.bid\.(submit|revise)/);
  });

  it("fits a phone: every button is a 44 px target, nothing has a fixed width, a long history shows a few and 'Show all'", () => {
    const many = bids({ versions: Array.from({ length: 12 }, (_, i) => ver(12 - i, 1000 + i)) });
    const out = html({ data: many, stage: "clarifications", initialSubmitOpen: true });
    expect(out).toContain("Show all 12");
    expect(out.split('data-guide="tender.bid.version"').length - 1).toBe(5);
    expect(out).toContain("Version 8");
    const buttons = buttonsOf(out, "tender.bid");
    expect(buttons.length).toBeGreaterThan(3);
    for (const b of buttons) expect(b, b).toMatch(/min-height:44px/);
    expect(out).not.toMatch(/(?<![-\w])width:\s*\d{3,}px/);
    expect(out).toContain('class="fg2"');
  });

  it("holds every explanation behind an i and prints none as running text", () => {
    const out = html();
    expect(out).toContain('aria-label="About Submit bid"');
    expect(out).not.toContain("Costs and markup are never saved");
    expect(html({ initialSubmitOpen: true })).toContain('aria-label="About Why is the bid revised?"');
  });
});

describe("the calls on the Activity tab", () => {
  const call = (id: string, over: Partial<CallView> = {}): CallView => ({ id, kind: "call", occurred_at: "2026-10-20T09:00:00Z", with_whom: "R. Haddad", summary: "Consultant confirmed the addendum", outcome: null, next_step: null, next_step_due: null, next_step_done_at: null, logged_by_name: "S. Khan", can_change: true, ...over });
  const data = (calls: CallView[], over: Partial<CallsData> = {}): CallsData => ({ calls, pending: false, canEdit: true, ...over });
  const html = (d: CallsData, props: Record<string, unknown> = {}) => clean(renderToString(createElement(CallsPanel, { opportunityId: OPP, data: d, todayKey: "2026-10-26", ...props })));

  it("lists the entries as text, with the next step and a red chip once it is overdue", () => {
    const out = html(data([call("a", { summary: "<script>alert(1)</script> Ring back", next_step: "Send revised BOQ", next_step_due: "2026-10-22" }), call("b", { next_step: "Send price", next_step_due: "2026-11-02" }), call("c", { next_step: "Sent", next_step_due: "2026-10-01", next_step_done_at: "2026-10-02T00:00:00Z" })]));
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
    expect(out).toContain("Overdue since 22 Oct 2026");
    expect(out).toContain("Due 02 Nov 2026");
    expect(out).toContain(">Done<");
    expect(out).toContain("Mark done");
    expect(out).toContain('data-guide="tender.call.row"');
  });

  it("offers Log a call and the row actions only to someone who may edit, and Remove only on their own entries", () => {
    expect(html(data([call("a")]))).toContain('data-guide="tender.call.log"');
    expect(html(data([call("a")]))).toContain('data-guide="tender.call.remove"');
    expect(html(data([call("a", { can_change: false })]))).not.toContain('data-guide="tender.call.remove"');
    const view = html(data([call("a", { next_step: "x", next_step_due: "2026-10-22" })], { canEdit: false }));
    expect(view).not.toContain('data-guide="tender.call.log"');
    expect(view).not.toContain('data-guide="tender.call.done"');
    expect(view).not.toContain('data-guide="tender.call.remove"');
  });

  it("pages a long list (a few rows, then Show all), and says what to do on an empty one", () => {
    const many = data(Array.from({ length: 9 }, (_, i) => call(`c${i}`, { summary: `Entry number ${i}` })));
    const out = html(many);
    expect(out).toContain("Entry number 4");
    expect(out).not.toContain("Entry number 5");
    expect(out).toContain("Show all 9");
    expect(html(many, { initialShowAll: true })).toContain("Entry number 8");
    expect(html(data([]))).toContain("No calls logged yet");
  });

  it("says a database update is needed while the migration is pending, and every button is a 44 px target", () => {
    expect(html(data([], { pending: true }))).toContain("migration 0225");
    const out = html(data([call("a", { next_step: "x", next_step_due: "2026-10-22" })]));
    for (const b of buttonsOf(out, "tender.call")) expect(b, b).toMatch(/min-height:44px/);
  });
});

describe("the Log a call panel", () => {
  const open = clean(renderToString(createElement(LogCallButton, { opportunityId: OPP, initialOpen: true })));

  it("asks for what was discussed, and for little else: kind, when, with whom, outcome, next step and due", () => {
    expect(open).toContain('role="dialog"');
    for (const g of ["tender.call.kind", "tender.call.when", "tender.call.with", "tender.call.summary", "tender.call.outcome", "tender.call.next_step", "tender.call.due", "tender.call.save"]) expect(open, g).toContain(`data-guide="${g}"`);
    expect(open).toContain("What was discussed");
    expect(open).toContain('class="fg2"');
    expect(open).toContain("Call");
    expect(open).toContain("Site visit");
  });

  it("the button that opens it is a 44 px target with its explanation behind an i", () => {
    const closed = clean(renderToString(createElement(LogCallButton, { opportunityId: OPP })));
    expect(buttonsOf(closed, "tender.call.log")[0]).toMatch(/min-height:44px/);
    expect(closed).toContain('aria-label="About Log a call"');
    expect(closed).not.toContain('role="dialog"');
  });

  it("is a side panel on a desktop and a bottom sheet on a phone (the shared panel's own rule)", () => {
    const css = readFileSync(path.join(ROOT, "src/components/ui/SidePanel.module.css"), "utf8");
    expect(css).toMatch(/@media \(max-width: 780px\)/);
  });
});

describe("the Outcome section", () => {
  const data = (over: Partial<OutcomeData> = {}): OutcomeData => ({ stage: "bid_lost", award_value: 950_000, winning_bidder: "Rival Co", award_date: "2026-11-12", outcome_note: null, competitor: "Rival Co", loss_reason: "price", our_total: 1_030_000, our_version: 3, currency: "SAR", canEdit: true, pending: false, ...over });
  const html = (d: OutcomeData) => clean(renderToString(createElement(OutcomeSection, { opportunityId: OPP, data: d, fmt, onError: noop, onNotice: noop })));

  it("Lost shows our final bid beside the winning price with the difference, and asks for who won and why", () => {
    const out = html(data());
    expect(out).toContain("Outcome: lost");
    expect(out).toContain("Our final bid (version 3)");
    expect(out).toContain("SAR 1,030,000");
    expect(out).toContain("Winning price");
    expect(out).toContain("SAR 950,000");
    expect(out).toContain("+SAR 80,000");
    expect(out).toContain("Our bid was 8.42% above the winning price");
    for (const g of ["tender.outcome.won_by", "tender.outcome.loss_reason", "tender.outcome.value", "tender.outcome.date", "tender.outcome.note", "tender.outcome.save"]) expect(out, g).toContain(`data-guide="${g}"`);
  });

  it("Awarded has no loss fields and compares with the awarded price; No-bid has only the note", () => {
    const won = html(data({ stage: "awarded", our_total: 900_000, award_value: 900_000 }));
    expect(won).toContain("Outcome: awarded");
    expect(won).not.toContain("tender.outcome.won_by");
    expect(won).not.toContain("tender.outcome.loss_reason");
    expect(won).toContain("Our bid matched the awarded price");
    const nobid = html(data({ stage: "no_bid", award_value: null, our_total: null }));
    expect(nobid).toContain("Outcome: no-bid");
    expect(nobid).not.toContain("tender.outcome.compare");
    expect(nobid).not.toContain("tender.outcome.value");
    expect(nobid).toContain("tender.outcome.note");
  });

  it("says so when no bid was recorded, hides the form from a view-only person, and flags a pending migration", () => {
    expect(html(data({ our_total: null, our_version: null, award_value: null }))).toContain("No bid recorded");
    expect(html(data({ canEdit: false }))).not.toContain("tender.outcome.save");
    const pending = html(data({ pending: true }));
    expect(pending).toContain("migration 0225");
    expect(pending).not.toContain("tender.outcome.save");
  });
});

describe("the tabs of a tender deal", () => {
  const opp = { id: OPP, tenant_id: "t1", ref: "OPP-2", title: "Valves for Plant 4", account_id: "acc", contact_id: null, stage: "estimating", outcome: "open", amount: 0, probability: 25, owner_id: "u1", team: [], source: "direct", created_at: "2026-10-01T00:00:00Z", stage_since: "2026-10-01T00:00:00Z", expected_close: null, description: null, competitor: null, closed_at: null, loss_reason: null, probability_override: null, probability_override_reason: null } as unknown as Opportunity & { stage_since: string };
  const line = { id: "1", tenant_id: "t1", opportunity_id: OPP, sl_no: "1", description: "Gate valve", uom: "Nos", qty: 2, rate: 100, discount_pct: 0, amount: 200, product_id: null, pricing_document_id: null, rfq_line_id: null, group_id: null, group_label: null, group_type: null, break_of: null, break_qty: null, is_selected: true, show_on_pdf: true } as unknown as OpportunityLine;
  const stages = [{ value: "estimating", label: "Estimating", probability_hint: 25 }, { value: "bid_lost", label: "Lost", probability_hint: 0, is_closed: true, outcome: "lost" }] as unknown as OpportunityStageDef[];
  const view = { closing_at: null, decision: null, decided_by_name: null, decided_at: null } as never;
  const page = (extra: Record<string, unknown>, tabData: Record<string, unknown> | null = {}) => clean(renderToString(createElement(OpportunityDetailClient, {
    opp, accountName: "Aramco", contacts: [], initialLines: [line], linesVersion: "v1", quotes: [], stages, members: [], products: [], pricingEnabled: false, standardQuotesEnabled: false,
    todayKey: "2026-10-26", currentUserId: "u1", activity: createElement("div", null, "CHANGE-HISTORY"),
    tender: tabData === null ? null : { view, room: null, approval: null, accounts: [], nowIso: "2026-10-26T00:00:00Z", timezone: "Asia/Riyadh", ...tabData },
    ...extra,
  } as never)));

  it("a tender deal gets a Bids tab with its count; a standard deal and a tender without the migration's data do not", () => {
    expect(page({ initialTab: "overview" }, { bids: bids() })).toMatch(/Bids/);
    expect(page({ initialTab: "overview" }, null)).not.toMatch(/>Bids</);
    expect(page({ initialTab: "overview" }, {})).not.toMatch(/>Bids</);
  });

  it("the Bids tab renders inside the deal with the lines total from the saved lines", () => {
    const out = page({ initialTab: "bids" }, { bids: bids({ working_total: 0 }) });
    expect(out).toContain('data-guide="tender.bids"');
    expect(out).toContain("Lines total now");
  });

  it("the Activity tab lists the calls above the change history, and the Tender tab carries the overdue chip", () => {
    const calls: CallsData = { calls: [{ id: "a", kind: "call", occurred_at: "2026-10-20T09:00:00Z", with_whom: null, summary: "Rang the client", outcome: null, next_step: "Send BOQ", next_step_due: "2026-10-22", next_step_done_at: null, logged_by_name: "S. Khan", can_change: true }], pending: false, canEdit: true };
    const activity = page({ initialTab: "activity" }, { calls });
    expect(activity.indexOf("Rang the client")).toBeGreaterThan(-1);
    expect(activity.indexOf("Rang the client")).toBeLessThan(activity.indexOf("CHANGE-HISTORY"));
    const tender = page({ initialTab: "tender" }, { calls });
    expect(tender).toContain('data-guide="tender.overdue_steps"');
    expect(tender).toContain("1 overdue next step");
    expect(page({ initialTab: "tender" }, { calls: { ...calls, calls: [] } })).not.toContain("tender.overdue_steps");
    expect(page({ initialTab: "activity" }, {})).not.toContain("Calls and visits");
  });

  it("the Tender tab shows the Outcome section once the tender has ended, and not before", () => {
    const outcome: OutcomeData = { stage: "bid_lost", award_value: null, winning_bidder: null, award_date: null, outcome_note: null, competitor: null, loss_reason: null, our_total: 200, our_version: 1, currency: "SAR", canEdit: true, pending: false };
    expect(page({ initialTab: "tender" }, { outcome })).toContain('data-guide="tender.outcome"');
    expect(page({ initialTab: "tender" }, { outcome: null })).not.toContain('data-guide="tender.outcome"');
  });
});
