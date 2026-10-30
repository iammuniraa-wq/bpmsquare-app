import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/contract-projects/p1",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import BuyoutTab from "./BuyoutTab";
import NewPackagePanel from "./NewPackagePanel";
import PackagePanel, { QuoteCard, RoundsTable, type Action } from "./PackagePanel";
import BuyoutProgressCard from "./BuyoutProgressCard";
import SendRequestForm from "./SendRequestForm";
import BudgetGrid from "../BudgetGrid";
import { allocationView } from "@/lib/contractProjects/allocation";
import { BUYOUT_TIPS } from "./tips";
import { awardedDetail, data, detail, lines, packages, rounds, row } from "./testData";
import type { BuyoutData, PackageDetail, PickerList } from "./types";
import type { BudgetLine } from "@/lib/contractProjects/types";

// The Buy-out screens render, with the right words on them and none of their explanations printed (6b). A server render of the real components
// with the mock-up's example packages. 375 px and PC share one markup: the table and the cards are both rendered and CSS picks one at 780 px
// (.bpm-rows-table / .bpm-rows-cards), the table scrolls inside its own container, the panels are the shared SidePanel (a bottom sheet under
// 780 px), every action is a 44 px target, and no colour is written by hand. The real look needs an eye on develop.

const ROOT = path.resolve(__dirname, "../../../..");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const src = (f: string) => readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const noop = () => {};

const tab = (d: BuyoutData, props: Partial<Parameters<typeof BuyoutTab>[0]> = {}) =>
  clean(renderToString(createElement(BuyoutTab, { projectId: "p1", data: d, currency: "INR", canEdit: true, ...props })));
const panel = (props: Partial<Parameters<typeof PackagePanel>[0]> = {}) =>
  clean(renderToString(createElement(PackagePanel, {
    projectId: "p1", row: row(), currency: "INR", canEdit: true, groupName: "Red Sea approved vendors", onClose: noop, onChanged: noop, initialDetail: detail(), ...props,
  })));

/** The opening tag of every button-like control that carries the shared button class. */
const controls = (html: string) => [...html.matchAll(/<(?:button|a)\b[^>]*class="[^"]*bpm-btn[^"]*"[^>]*>(?:[^<]*)/g)].map((m) => m[0]).filter((t) => !/>Close$/.test(t));

describe("the Buy-out tab", () => {
  const out = tab(data());

  it("opens with the approved group, three tiles and what each says under its figure", () => {
    expect(out).toContain('data-guide="buyout.group"');
    expect(out).toContain("Suppliers from:");
    expect(out).toContain("Red Sea approved vendors");
    expect(out).toContain('data-guide="buyout.kpis"');
    for (const w of ["Packages", "5 packages, 12 budget lines", "Ordered vs budget", "INR 170,300", "18% of INR 924,670, 2 awarded", "Needs decision", "1 ready to award, 1 waiting on replies"]) {
      expect(out, w).toContain(w);
    }
    for (const gone of ["Budget in packages", "Best quotes vs budget", "Needs a decision"]) expect(out, gone).not.toContain(gone);
    expect(out.match(/data-tone="/g)).toHaveLength(3);
    expect(out).toContain('data-tone="warn"');
    expect(out).toContain('data-tone="info"');
  });

  it("says when the client has no approved list", () => {
    const o = tab(data({ group: null }));
    expect(o).toContain("No approved list for this client");
    expect(o).not.toContain("Suppliers from:");
  });

  it("has the six filters with counts", () => {
    for (const [f, label, n] of [["all", "All", 5], ["draft", "Not sent", 1], ["out", "Out", 1], ["ready", "Ready to award", 1], ["awarded", "Awarded", 1], ["handed_over", "Handed over", 1]] as const) {
      expect(out).toContain(`data-guide="buyout.filter.${f}"`);
      expect(out).toContain(`${label} <span style="opacity:0.75;margin-left:4px">${n}</span>`);
    }
    expect(out).toContain('aria-pressed="true"');
    const ready = tab(data(), { initialFilter: "ready" });
    expect(ready).toContain("Precast manholes and culvert");
    expect(ready).not.toContain("Earthworks and backfill");
  });

  it("is one table: package with its lines, kind and ref, the figures, the status chip and the ePROMIS chip", () => {
    expect(out).toContain('data-guide="buyout.table"');
    for (const h of ["Package", "Budget", "Best quote", "Ordered", "Against budget", "Status", "ePROMIS"]) expect(out, h).toContain(`>${h}</th>`);
    expect(out).toContain("HDPE pipe supply");
    expect(out).toContain("2 lines · Supplier · PKG-0002");
    expect(out).toContain("2 lines · Subcontract · PKG-0005");
    expect(out).toContain("Out, 2 of 3 replied");
    for (const s of ["Not sent", "Ready to award", "Awarded", "Handed over"]) expect(out, s).toContain(s);
    expect(out).toContain("INR 11,000 over");
    expect(out).toContain("INR 5,270 under");
    expect(out.match(/<table/g)).toHaveLength(1);
    for (const e of ["Not ready", "Sent"]) expect(out, e).toContain(e);
  });

  it("a phone gets a card per package from the same markup, the table scrolls inside its own container", () => {
    expect(out).toContain('class="bpm-rows-table"');
    expect(out).toContain('class="bpm-rows-cards"');
    expect(out).toContain("overflow-x:auto");
    expect(out.match(/data-guide="buyout.card"/g)).toHaveLength(5);
    expect(out.match(/data-guide="buyout.row"/g)).toHaveLength(5);
    expect(out.match(/<table/g)).toHaveLength(1);
    expect(out).toMatch(/class="bpm-tap"/);
  });

  it("prints none of its explanations; they sit behind the i", () => {
    for (const tip of Object.values(BUYOUT_TIPS)) expect(out).not.toContain(tip);
    expect(out).toContain("About Approved suppliers");
    expect(out).toContain("About Ordered vs budget");
    expect(out).toContain("About Packages");
  });

  it("every action control is a 44 px target and the rows open the panel from the keyboard too", () => {
    const c = controls(out);
    expect(c.length).toBeGreaterThan(0);
    for (const t of c) expect(t, t).toContain("min-height:44px");
    expect(out.match(/min-height:52px/g)!.length).toBeGreaterThanOrEqual(5);
    expect(out).toContain('aria-label="Open package HDPE pipe supply"');
  });

  it("+ New package for someone who can edit, not for a view-only person or a closed project", () => {
    expect(out).toContain('data-guide="buyout.package.new"');
    expect(tab(data(), { canEdit: false })).not.toContain('data-guide="buyout.package.new"');
  });

  it("a long list shows a few rows and Show all", () => {
    const many = Array.from({ length: 14 }, (_, i) => row({ id: `p${i}`, name: `Package ${i + 1}`, ref: `PKG-${100 + i}` }));
    const long = tab(data({ packages: many, tiles: { ...data().tiles, packages: 14 } }));
    expect(long).toContain("Show all 14");
    expect(long).toContain("Package 10");
    expect(long).not.toContain("Package 11");
  });

  it("an empty tab says what to do next; a pending database is stated", () => {
    expect(tab(data({ packages: [], tiles: { budget: 0, committed: 0, best_vs_budget: 0, needs_decision: 0, packages: 0 } }))).toContain("No packages yet");
    expect(tab(data({ packages: [], unassigned_lines: [] }))).toContain("Add budget lines on the Budget tab first");
    expect(tab(data({ pending: true }))).toContain("Buy-out needs a database update");
  });

  it("warns, in words, when committed is over the budget", () => {
    const o = tab(data({ tiles: { budget: 100000, committed: 130000, best_vs_budget: -30000, needs_decision: 0, packages: 1 } }));
    expect(o).toContain("over the budget by INR 30,000");
  });

  it("opens a package from the tab (server render with a panel open)", () => {
    const o = tab(data(), { initialPanel: { id: "pipe" } });
    expect(o).toContain('role="dialog"');
    expect(o).toContain("Package HDPE pipe supply");
  });
});

describe("the new package panel", () => {
  const out = clean(renderToString(createElement(NewPackagePanel, { projectId: "p1", lines, currency: "INR", onClose: noop, onCreated: noop })));

  it("asks for a name and a kind, lists the budget lines not in a package, and creates", () => {
    expect(out).toContain('data-guide="buyout.new"');
    for (const g of ["buyout.new.field.name", "buyout.new.field.kind", "buyout.new.lines", "buyout.new.create", "buyout.new.cancel"]) expect(out, g).toContain(`data-guide="${g}"`);
    expect(out).toContain("6.1 · Kerb stone");
    expect(out).toContain("INR 18,000");
    expect(out).toContain("<option value=\"supplier\" selected=\"\">Supplier</option>");
    expect(out).toContain("Subcontract");
    expect(out.match(/data-guide="buyout.new.line"/g)).toHaveLength(2);
    expect(out).toContain("disabled");
  });

  it("with every line already in a package it says so", () => {
    const e = clean(renderToString(createElement(NewPackagePanel, { projectId: "p1", lines: [], currency: "INR", onClose: noop, onCreated: noop })));
    expect(e).toContain("Every budget line is already in a package");
  });

  it("is the shared side panel and fits a phone: 44 px targets, no colour of its own", () => {
    expect(out).toContain('aria-modal="true"');
    for (const t of controls(out)) expect(t, t).toContain("min-height:44px");
    expect(src("src/components/contractProjects/buyout/NewPackagePanel.tsx")).toContain("SidePanel");
  });
});

describe("the package panel", () => {
  const out = panel();

  it("is the shared side panel with the name, kind, ref and status chip", () => {
    expect(out).toContain('role="dialog"');
    expect(out).toContain('data-guide="buyout.panel"');
    expect(out).toContain("HDPE pipe supply");
    expect(out).toContain("Supplier package · PKG-0002");
    expect(out).toContain(">Out<");
  });

  it("lists the lines with item numbers and cost in the bid, as a table and as cards", () => {
    expect(out).toContain('data-guide="buyout.lines"');
    for (const w of ["2.1", "HDPE pipe 600 mm", "420 m", "INR 178,500", "2.2", "HDPE pipe 900 mm", "INR 241,500", "INR 420,000"]) expect(out, w).toContain(w);
    expect(out).toContain(">Item</th>");
    expect(out).toContain("Cost in bid");
    expect(out).toContain('class="bpm-rows-cards"');
    expect(out).not.toContain(BUYOUT_TIPS.costInBid);
  });

  it("puts the quotes of the current round side by side: lowest valid marked, expired or stale in amber, no reply stated", () => {
    expect(out).toContain('data-guide="buyout.quotes"');
    expect(out).toContain("SAMPLE Gulf Pipes LLC");
    expect(out).toContain("INR 431,000");
    expect(out).toContain("28 d lead");
    expect(out).toContain("Lowest valid");
    expect(out).toContain("Expired or stale");
    expect(out).toContain("No reply yet");
    expect(out.match(/data-guide="buyout.quote"/g)).toHaveLength(4);
    expect(out).toContain('data-state="lowest"');
    expect(out).toContain("auto-fit");
    expect(out.match(/Lowest valid/g)).toHaveLength(1);
  });

  it("offers Award package on every answered quote and not on the one with no reply", () => {
    expect(out.match(/data-guide="buyout.award.open"/g)).toHaveLength(3);
    expect(out.match(/Award package/g)).toHaveLength(3);
  });

  it("offers Send a new round when a round exists, and Send request when none was sent", () => {
    expect(out).toContain("Send a new round");
    const none = panel({ initialDetail: detail({ rounds: [], package: { ...detail().package, current_rfq_id: null, status: "draft" } }), row: row({ status: "draft" }) });
    expect(none).toContain(">Send request<");
    expect(none).toContain("No request sent yet. Choose the suppliers and send one request for the whole package.");
    expect(none).toContain('data-guide="buyout.delete.open"');
    expect(out).not.toContain('data-guide="buyout.delete.open"');
  });

  it("keeps every round for audit, newest first, each linking to its RFQ page", () => {
    expect(out).toContain("Rounds kept for audit");
    expect(out).toContain("2 rounds");
    const table = clean(renderToString(createElement(RoundsTable, { rounds, currency: "INR" })));
    expect(table.indexOf("RFQ-0012")).toBeLessThan(table.indexOf("RFQ-0009"));
    expect(table).toContain('href="/rfqs/rfq12"');
    expect(table).toContain('href="/rfqs/rfq9"');
    for (const w of ["Round 2 (current)", "Round 1", "3 of 4 replied, lowest INR 431,000", "2 of 2 replied, lowest INR 452,000"]) expect(table, w).toContain(w);
    expect(table).toContain('class="bpm-rows-cards"');
  });

  it("shows the budget against the best quote and the committed price, and warns (never blocks) when over", () => {
    expect(out).toContain('data-guide="buyout.bars"');
    for (const w of ["Budget", "Best quote", "Ordered", "INR 420,000", "INR 431,000"]) expect(out, w).toContain(w);
    expect(out).toContain("The best quote is over the budget by INR 11,000. You can still award and hand over.");
    const under = panel({ initialDetail: detail({ budget_bars: { budget: 500000, best_quote: 431000, committed: null } }) });
    expect(under).not.toContain("is over the budget");
  });

  it("the handover is unavailable until the package is awarded", () => {
    expect(out).toContain("Available after the package is awarded.");
    expect(out).toContain('data-guide="buyout.handover.download"');
    expect(out).not.toContain('data-guide="buyout.handover.mark_sent"');
  });

  it("prints none of its explanations", () => {
    for (const tip of Object.values(BUYOUT_TIPS)) expect(out).not.toContain(tip);
  });

  it("every control is a 44 px target", () => {
    const c = controls(out);
    expect(c.length).toBeGreaterThan(3);
    for (const t of c) expect(t, t).toContain("min-height:44px");
  });

  it("a view-only person sees the quotes but no Award, Send request, Delete or Mark as sent", () => {
    const ro = panel({ canEdit: false });
    expect(ro).toContain("SAMPLE Gulf Pipes LLC");
    for (const g of ["buyout.award.open", "buyout.send.open", "buyout.delete.open", "buyout.handover.mark_sent", "buyout.unaward.open"]) expect(ro, g).not.toContain(`data-guide="${g}"`);
  });

  it("while it loads it says so", () => {
    const loading = clean(renderToString(createElement(PackagePanel, { projectId: "p1", row: row(), currency: "INR", canEdit: true, groupName: null, onClose: noop, onChanged: noop })));
    expect(loading).toContain("Loading the package");
    expect(loading).toContain("HDPE pipe supply");
  });
});

describe("awarding", () => {
  const lowest = rounds[0].quotes[0];
  const dearer = rounds[0].quotes[1];
  const stale = rounds[0].quotes[3];
  const award = (q: typeof lowest): Action => ({ kind: "award", quote: q, rfqId: "rfq12" });

  it("the lowest valid price is two taps: Award package, then Confirm award; no reason is asked", () => {
    const out = panel({ initialAction: award(lowest) });
    expect(out).toContain('data-guide="buyout.award"');
    expect(out).toContain("Award the package to SAMPLE Gulf Pipes LLC for INR 431,000");
    expect(out).toContain('data-guide="buyout.award.confirm"');
    expect(out).toContain('data-guide="buyout.award.cancel"');
    expect(out).not.toContain('data-guide="buyout.award.reason"');
  });

  it("a price that is not the lowest valid one needs a reason, and the confirm is held until it is typed", () => {
    const out = panel({ initialAction: award(dearer) });
    expect(out).toContain('data-guide="buyout.award.reason"');
    expect(out).toContain("Not the lowest valid price. A reason is needed.");
    expect(out).toMatch(/<button[^>]*data-guide="buyout.award.confirm"[^>]*disabled/);
    expect(out).toContain("Why this supplier?");
  });

  it("an expired or stale answer also needs a reason and says why", () => {
    const out = panel({ initialAction: award(stale) });
    expect(out).toContain("This answer has expired or is stale. A reason is needed.");
    expect(out).toContain('data-guide="buyout.award.reason"');
  });

  it("an award over the package budget warns and can still go ahead", () => {
    const out = panel({ initialAction: award(lowest) });
    expect(out).toContain('data-guide="buyout.award.over"');
    expect(out).toContain("over the package budget by INR 11,000. You can still award it.");
    expect(out).not.toMatch(/<button[^>]*data-guide="buyout.award.confirm"[^>]*disabled/);
  });

  it("after the award the winner is marked, the reason and who are shown, and Un-award is offered with a reason box", () => {
    const out = panel({ row: row({ status: "awarded", handover: { state: "ready", sent_at: null } }), initialDetail: awardedDetail() });
    expect(out).toContain('data-state="won"');
    expect(out).toContain("Awarded quote");
    expect(out).toContain("Awarded to");
    expect(out).toContain("Precast Arabia Pipes");
    expect(out).toContain("for INR 438,500");
    expect(out).toContain("Not the lowest valid price: Better lead time");
    expect(out).toContain('data-guide="buyout.unaward.open"');
    expect(out).not.toContain('data-guide="buyout.award.open"');
    expect(out).not.toContain('data-guide="buyout.send.open"');
    const asking = panel({ row: row({ status: "awarded", handover: { state: "ready", sent_at: null } }), initialDetail: awardedDetail(), initialAction: { kind: "unaward" } });
    expect(asking).toContain('data-guide="buyout.unaward.reason"');
    expect(asking).toMatch(/<button[^>]*data-guide="buyout.unaward.confirm"[^>]*disabled/);
  });

  it("committed over the budget warns without blocking", () => {
    const out = panel({ row: row({ status: "awarded" }), initialDetail: awardedDetail() });
    expect(out).toContain("Ordered is over the budget by INR 18,500. You can still award and hand over.");
  });

  it("the quote card marks lowest valid and the winner with words, not colour alone", () => {
    const low = clean(renderToString(createElement(QuoteCard, { quote: lowest, currency: "INR", won: false, canAward: true, onAward: noop })));
    expect(low).toContain("Lowest valid");
    const won = clean(renderToString(createElement(QuoteCard, { quote: lowest, currency: "INR", won: true, canAward: false, onAward: noop })));
    expect(won).toContain("Awarded");
    expect(won).not.toContain("Lowest valid");
    expect(won).not.toContain("Award package");
  });
});

describe("the handover", () => {
  const awarded = (handover: PackageDetail["handover"]) => panel({ row: row({ status: handover.state === "sent" ? "handed_over" : "awarded" }), initialDetail: { ...awardedDetail(), handover } });

  it("an awarded package offers Download Excel, an optional ERP reference and Mark as sent to ePROMIS", () => {
    const out = awarded({ state: "ready", sent_at: null });
    expect(out).toContain("Handover for Precast Arabia Pipes");
    expect(out).toContain("Ready to hand over");
    expect(out).toContain('href="/api/contract-projects/p1/buyout/packages/pk1/handover"');
    expect(out).toContain("download");
    expect(out).toContain('data-guide="buyout.handover.mark_sent"');
    expect(out).toContain('data-guide="buyout.handover.erp_ref"');
    expect(out).toContain("Mark as sent to ePROMIS");
  });

  it("once sent it says when and by whom, keeps the download, and no longer offers Mark as sent or Un-award", () => {
    const out = awarded({ state: "sent", sent_at: "2026-10-27T08:00:00Z", sent_by_name: "Sara", erp_ref: "PO-77" });
    expect(out).toContain("Marked as sent to ePROMIS");
    expect(out).toContain("27 Oct 2026");
    expect(out).toContain("Sara");
    expect(out).toContain("ERP PO-77");
    expect(out).toContain('data-guide="buyout.handover.download"');
    expect(out).not.toContain('data-guide="buyout.handover.mark_sent"');
    expect(out).not.toContain('data-guide="buyout.unaward.open"');
  });
});

describe("sending a request", () => {
  const picker = (over: Partial<PickerList> = {}): PickerList => ({
    restricted: true, group: { name: "Red Sea approved vendors" },
    suppliers: [{ id: "s1", name: "SAMPLE Gulf Pipes LLC", email: "a@x.com", city: "Dammam" }, { id: "s2", name: "No Email Co.", email: null, city: null }], ...over,
  });
  const form = (p: PickerList, extra: Partial<Parameters<typeof SendRequestForm>[0]> = {}) =>
    clean(renderToString(createElement(SendRequestForm, { projectId: "p1", packageId: "pk1", groupName: null, nextRound: 1, busy: false, error: "", onSend: noop, onCancel: noop, initialPicker: p, ...extra })));

  it("offers only the suppliers the route allowed, and says where they come from", () => {
    const out = form(picker());
    expect(out).toContain("Suppliers from:");
    expect(out).toContain("Red Sea approved vendors");
    expect(out.match(/data-guide="buyout.send.supplier"/g)).toHaveLength(2);
    expect(out).toContain("Dammam · a@x.com");
    expect(out).toContain("no email");
    expect(out).toContain('data-guide="buyout.send.field.reply_by"');
    expect(out).toContain('data-guide="buyout.send.field.note"');
    expect(out).toContain('data-guide="buyout.send.submit"');
    expect(out).toMatch(/<button[^>]*data-guide="buyout.send.submit"[^>]*disabled/);
  });

  it("with no approved list it says so quietly and offers everyone the route sent", () => {
    const out = form(picker({ restricted: false, group: null }));
    expect(out).toContain("No approved list for this client");
    expect(out).not.toContain("Suppliers from:");
  });

  it("names the round and shows the server's refusal", () => {
    const out = form(picker(), { nextRound: 3, error: "Gulf Pipes is not on the approved list" });
    expect(out).toContain("Request, round 3");
    expect(out).toContain('data-guide="buyout.send.error"');
    expect(out).toContain("Gulf Pipes is not on the approved list");
  });

  it("an empty approved list says where to add suppliers", () => {
    expect(form(picker({ suppliers: [] }))).toContain("The approved list has no suppliers yet. Add them under Suppliers, Groups.");
  });

  it("the panel opens it from Send request with the group name for the note", () => {
    const out = panel({ initialAction: { kind: "send" }, initialPicker: picker({ group: null }) });
    expect(out).toContain('data-guide="buyout.send"');
    expect(out).toContain("Red Sea approved vendors");
    expect(out).toContain("Request, round 3");
  });
});

describe("Overview and Budget", () => {
  it("the Overview card counts the packages, shows committed against the budget and links to the tab", () => {
    const out = clean(renderToString(createElement(BuyoutProgressCard, { projectId: "p1", currency: "INR", initial: data() })));
    expect(out).toContain("Buy-out progress");
    expect(out).toContain("<b>2</b> of 5 packages awarded, 1 handed over");
    expect(out).toContain("INR 170,300 of INR 924,670");
    expect(out).toContain('href="/contract-projects/p1?tab=buyout"');
    expect(out).toContain("Open Buy-out");
    expect(src("src/components/contractProjects/buyout/BuyoutProgressCard.tsx")).toContain("minHeight: 44");
    expect(out).not.toContain(BUYOUT_TIPS.progress);
  });

  it("the Overview card warns when committed is over, says when there are no packages, and is absent when the summary is", () => {
    expect(clean(renderToString(createElement(BuyoutProgressCard, { projectId: "p1", currency: "INR", initial: data({ tiles: { budget: 100, committed: 150, best_vs_budget: -50, needs_decision: 0, packages: 1 } }) })))).toContain("Over the budget by INR 50");
    expect(clean(renderToString(createElement(BuyoutProgressCard, { projectId: "p1", currency: "INR", initial: data({ packages: [], tiles: { budget: 0, committed: 0, best_vs_budget: 0, needs_decision: 0, packages: 0 } }) })))).toContain("No packages yet.");
    expect(renderToString(createElement(BuyoutProgressCard, { projectId: "p1", currency: "INR" }))).toBe("");
  });

  const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
    id: "i1", line_key: "k1", line_no: 1, resource_code: "11", cost_code: "32 31 13", wbs: "1.1", description: "Pipe", qty: 100, unit: "m", unit_cost: 120, amount: 12000,
    cost_known: true, source_ref: null, reserve: false, committed: null, actual: null, allocated: true, client_rate: null, client_amount: null, source_line_id: null, ...over,
  });
  const grid = (props: Partial<Parameters<typeof BudgetGrid>[0]> = {}) => {
    const lines = props.lines ?? [line(), line({ id: "i2", line_key: "k2", description: "Gate" })];
    return clean(renderToString(createElement(BudgetGrid, {
      projectId: "p1", revision: { id: "r0", rev_no: 0, status: "draft" }, revisions: [{ id: "r0", rev_no: 0, status: "draft" }], lines,
      allocation: allocationView({ allocation_basis: "line", contract_value: 0 }, lines, [], null),
      resources: [{ code: "11", name: "Material", revenue_side: false }], canEdit: true, projectClosed: false, currency: "INR", ...props,
    })));
  };

  it("the Budget tab gets a Committed column from the buy-out summary, with a dash for a line not yet bought", () => {
    const out = grid({ buyoutOn: true, initialBuyout: data({ committed_by_line: { k1: 12000 } }) });
    expect(out).toContain('data-guide="cp.budget.committed"');
    expect(out).toContain("12,000.00");
    expect(out).not.toContain(">Actual<");
  });

  it("without a buy-out summary, or when nothing is awarded, the column is left out", () => {
    expect(grid()).not.toContain('data-guide="cp.budget.committed"');
    expect(grid({ buyoutOn: true })).not.toContain('data-guide="cp.budget.committed"');
    expect(grid({ buyoutOn: true, initialBuyout: data({ committed_by_line: {} }) })).not.toContain('data-guide="cp.budget.committed"');
    expect(grid({ buyoutOn: true, initialBuyout: data() })).not.toContain('data-guide="cp.budget.committed"');
  });

  it("an ERP-committed line keeps its own figure", () => {
    const out = grid({ buyoutOn: true, initialBuyout: data({ committed_by_line: { k1: 99 } }), lines: [line({ committed: 5000 })] });
    expect(out).toContain("5,000.00");
    expect(out).not.toContain("99.00");
  });
});

describe("the tab on the project page", () => {
  const page = src("src/app/(app)/contract-projects/[id]/page.tsx");

  it("sits after Budget and before Variations, only for a project made from a tender with both module flags", () => {
    expect(page.indexOf('id: "budget"')).toBeLessThan(page.indexOf('id: "buyout"'));
    expect(page.indexOf('id: "buyout"')).toBeLessThan(page.indexOf('id: "variations"'));
    expect(page).toContain('label: "Buy-out"');
    expect(page).toContain("const buyoutOn = buyoutVisible(p, tenant?.features);");
    expect(page).toContain("...(buyoutOn ? [{ id: \"buyout\"");
    expect(page).toContain("<ProjectOverview view={view} buyoutOn={buyoutOn}");
    expect(page).toContain("buyoutOn={buyoutOn}\n");
  });

  it("the Overview mounts the progress card only when Buy-out is on", () => {
    expect(src("src/components/contractProjects/ProjectOverview.tsx")).toContain("{buyoutOn && <BuyoutProgressCard projectId={p.id} currency={cur} />}");
  });
});
