import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Opportunity, OpportunityLine } from "@/lib/types";
import type { OpportunityStageDef } from "@/lib/constants";
import type { CompetitorView, CompetitorsData } from "@/lib/tender/competitors/rules";
import { fixtureCard } from "@/lib/analysis/cardFixture";
import type { DockAnalysis } from "@/lib/assistant/analysisTool";

// The Competitors tab, rendered on the server: the list of cards, the strip, the add panel, the "Who won" picker, the card with its
// analysis open, and the tabs of a tender deal. 375 px and PC share one markup: the grid is `repeat(auto-fill, minmax(min(100%, 320px), 1fr))`
// (one column on a phone), the form uses the shared `.fg2` rule (one column under 900 px) and the panel the shared SidePanel (a bottom sheet
// under 780 px), so the checks here are the ones that decide whether a phone fits: 44 px targets, no fixed widths, no horizontal scroll,
// long lists paged, no colour of its own.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/pipeline/x",
}));

import CompetitorsTab from "./competitors/CompetitorsTab";
import CompetitorCard from "./competitors/CompetitorCard";
import CompetitorPanel from "./competitors/CompetitorPanel";
import WhoWonPicker from "./competitors/WhoWonPicker";
import OutcomeSection from "./OutcomeSection";
import OpportunityDetailClient from "@/app/(app)/pipeline/[id]/OpportunityDetailClient";

const ROOT = path.resolve(__dirname, "../../..");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const noop = () => {};
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const comp = (n: number, name: string, over: Partial<CompetitorView> = {}): CompetitorView => ({
  id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name, website: null, country: null, expected_price: null, strengths: null, notes: null, is_winner: false, sort: n,
  created_at: `2026-10-0${(n % 9) + 1}T00:00:00Z`, ...over,
});
const data = (competitors: CompetitorView[], over: Partial<CompetitorsData> = {}): CompetitorsData => ({ competitors, pending: false, insights: { available: true }, ...over });
const tab = (d: CompetitorsData, props: Partial<Parameters<typeof CompetitorsTab>[0]> = {}) =>
  clean(renderToString(createElement(CompetitorsTab, { opportunityId: OPP, canEdit: true, onError: noop, initialData: d, ...props })));

const RIVAL = comp(1, "Rival Co", { website: "https://www.rival.com", country: "Saudi Arabia", expected_price: "lower", strengths: "Local presence & fast delivery", notes: "Won the last two for this client" });

function buttonsOf(html: string, guidePrefix: string) {
  return [...html.matchAll(/<button\b[^>]*data-guide="([a-z_.]+)"[^>]*>/g)].filter((m) => m[1].startsWith(guidePrefix)).map((m) => m[0]);
}

describe("the Competitors tab", () => {
  it("shows a card per competitor with name, website, country, price view, strengths and note, as text", () => {
    const out = tab(data([RIVAL, comp(2, "<script>alert(1)</script>", { strengths: "<b>bold</b>" })]));
    expect(out).toContain('data-guide="competitor.tab"');
    expect(out).toContain("Rival Co");
    expect(out).toContain("www.rival.com");
    expect(out).toContain('href="https://www.rival.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("Saudi Arabia");
    expect(out).toContain("Expected price: Below us");
    expect(out).toContain("Local presence &amp; fast delivery");
    expect(out).toContain("Won the last two for this client");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<b>bold</b>");
  });

  it("the strip counts the competitors, those expected to be cheaper, and names the winner", () => {
    const out = tab(data([RIVAL, comp(2, "Second Co", { expected_price: "higher", is_winner: true }), comp(3, "Third Co")]));
    expect(out).toContain('data-guide="competitor.strip"');
    expect(out).toContain("Expect to be cheaper");
    expect(out).toContain("of 2 with a price view");
    expect(out).toContain("Second Co");
    expect(out).toContain("Won this tender");
    expect(tab(data([comp(1, "A")]))).toContain("Not decided");
  });

  it("an empty tab says what to do next and offers the add button; a view-only person is not offered it", () => {
    const empty = tab(data([]));
    expect(empty).toContain("No competitors yet");
    expect(empty).toContain("Add the companies you expect to bid against");
    expect(empty).toContain("+ Add competitor");
    const view = tab(data([]), { canEdit: false });
    expect(view).toContain("No competitors have been added to this tender.");
    expect(view).not.toContain("+ Add competitor");
    expect(tab(data([RIVAL]), { canEdit: false })).not.toContain('data-guide="competitor.edit"');
  });

  it("says a database update is needed while the migration is pending, with no add button and no strip", () => {
    const out = tab(data([], { pending: true }));
    expect(out).toContain("migration 0229");
    expect(out).not.toContain("+ Add competitor");
    expect(out).not.toContain("competitor.strip");
  });

  it("Company insights is a button per card when the analysis is available and absent when it is not; Analyse all needs two or more", () => {
    const one = tab(data([RIVAL]));
    expect(one).toContain('data-guide="competitor.insights"');
    expect(one).toContain("Company insights");
    expect(one).not.toContain("competitor.analyse_all");
    expect(tab(data([RIVAL, comp(2, "B")]))).toContain('data-guide="competitor.analyse_all"');
    const off = tab(data([RIVAL, comp(2, "B")], { insights: { available: false, reason: "Company analysis is not switched on for this workspace." } }));
    expect(off).not.toContain("competitor.insights");
    expect(off).not.toContain("competitor.analyse_all");
    expect(off).toContain('aria-label="About Company insights"');
  });

  it("pages a long list: a few cards, then Show all", () => {
    const many = data(Array.from({ length: 9 }, (_, i) => comp(i + 1, `Company number ${i + 1}`)));
    const out = tab(many);
    expect(out).toContain("Company number 6");
    expect(out).not.toContain("Company number 7");
    expect(out).toContain("Show all 9");
  });

  it("opens the add panel with one required field and the rest optional, as a dialog with the shared form grid", () => {
    const out = tab(data([]), { initialPanel: true });
    expect(out).toContain('role="dialog"');
    expect(out).toContain("Add competitor");
    for (const g of ["competitor.field.name", "competitor.field.website", "competitor.field.country", "competitor.field.price", "competitor.field.strengths", "competitor.field.notes", "competitor.save"]) expect(out, g).toContain(`data-guide="${g}"`);
    expect(out).toContain('class="fg2"');
    expect(out).toContain("Below us");
    expect(out).toContain("Above us");
    expect(out.match(/ \*</g) ?? []).toHaveLength(1);
  });

  it("the edit panel starts from the saved values", () => {
    const out = clean(renderToString(createElement(CompetitorPanel, { opportunityId: OPP, competitor: RIVAL, onClose: noop, onSaved: noop })));
    expect(out).toContain("Edit competitor");
    expect(out).toContain('value="Rival Co"');
    expect(out).toContain('value="https://www.rival.com"');
    expect(out).toContain('<option value="lower" selected="">Below us</option>');
  });
});

describe("a phone (375 px) and a desktop share one markup that fits both", () => {
  const out = tab(data([RIVAL, comp(2, "Second Co", { is_winner: true })]));

  it("the cards are a grid that falls to one column on a phone, with no fixed width anywhere", () => {
    expect(out).toContain("repeat(auto-fill, minmax(min(100%, 320px), 1fr))");
    expect(out).not.toMatch(/(?<![-a-z])width:\s*\d{3,}px/);
    expect(out).not.toMatch(/overflow-x:\s*(scroll|auto)/);
  });

  it("every button on the tab is a 44 px target, either set on the button or lifted by the tab's .bpm-tap on a phone", () => {
    expect(out).toContain('class="bpm-tap"');
    for (const b of [...buttonsOf(out, "competitor.add"), ...buttonsOf(out, "competitor.insights"), ...buttonsOf(out, "competitor.edit"), ...buttonsOf(out, "competitor.analyse_all")]) expect(b, b).toMatch(/min-height:44px/);
    const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.bpm-tap \.bpm-btn, \.bpm-tap \.bpm-input \{ min-height: 44px; \}/);
  });

  it("the panel is a bottom sheet on a phone and the form one column under 900 px (the shared rules)", () => {
    expect(readFileSync(path.join(ROOT, "src/components/ui/SidePanel.module.css"), "utf8")).toMatch(/@media \(max-width: 780px\)/);
    expect(readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8")).toMatch(/\.fg2, \.fg3 \{ grid-template-columns: 1fr !important/);
  });

  it("the new files carry no colour of their own: no hex, no rgb()", () => {
    const dir = path.join(ROOT, "src/components/tender/competitors");
    const files = [...readdirSync(dir).map((f) => path.join(dir, f)), path.join(ROOT, "src/lib/tender/competitors/rules.ts")];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], f).toEqual([]);
      expect(src.match(/\brgba?\(/g) ?? [], f).toEqual([]);
    }
  });
});

describe("Company insights on a card", () => {
  const analysis: DockAnalysis = { card: fixtureCard(), cached: true, saved: true, notice: null, webDerived: false, digest: "", subject: { accountId: null, name: "Rival Co", domain: null, country: null } };
  const card = (insight?: Parameters<typeof CompetitorCard>[0]["insight"]) => clean(renderToString(createElement(CompetitorCard, {
    competitor: RIVAL, canEdit: true, insightsAvailable: true, insight, onInsights: noop, onToggleInsights: noop, onEdit: noop, onToggleWinner: noop, onRemove: noop, onOpen: noop, onAsk: noop,
  })));

  it("shows the existing analysis card once it is loaded, with the button turned into Hide insights", () => {
    const out = card({ status: "done", analysis, open: true });
    expect(out).toContain("Hide insights");
    expect(out).toContain("Worth following up");
    expect(out).toContain("What they are doing");
    expect(card({ status: "done", analysis, open: false })).toContain("Show insights");
    expect(card({ status: "done", analysis, open: false })).not.toContain("Worth following up");
  });

  it("shows a loading state on the button and a plain reason when the analysis fails", () => {
    expect(card({ status: "loading" })).toContain("Analysing…");
    const failed = card({ status: "error", message: "The daily limit for company analyses is reached. Try again tomorrow." });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("The daily limit for company analyses is reached.");
    expect(failed).toContain("Company insights");
  });

  it("never links to a website that is not https", () => {
    const out = clean(renderToString(createElement(CompetitorCard, {
      competitor: comp(1, "X", { website: "javascript:alert(1)" }), canEdit: false, insightsAvailable: false, onInsights: noop, onToggleInsights: noop, onEdit: noop, onToggleWinner: noop, onRemove: noop, onOpen: noop, onAsk: noop,
    })));
    expect(out).not.toContain("javascript:");
  });
});

describe("Who won", () => {
  const picker = (value: string, list = [comp(1, "Rival Co"), comp(2, "Second Co")]) =>
    clean(renderToString(createElement(WhoWonPicker, { opportunityId: OPP, value, onChange: noop, initialCompetitors: list, guide: "tender.close.competitor" })));

  it("is a choice over this deal's competitors plus Someone else when the deal has some", () => {
    const out = picker("");
    expect(out).toContain("<select");
    expect(out).toContain("Rival Co");
    expect(out).toContain("Second Co");
    expect(out).toContain("Someone else…");
    expect(out).toContain('data-guide="tender.close.competitor"');
    expect(picker("Rival Co")).toContain('<option value="Rival Co" selected="">');
    expect(picker("rival co")).toContain('<option value="Rival Co" selected="">');
  });

  it("a name that is not on the list shows Someone else with the name in a box", () => {
    const out = picker("Newcomer Ltd");
    expect(out).toContain('<option value="__other" selected="">');
    expect(out).toContain('value="Newcomer Ltd"');
    expect(out).toContain("Name of the company that won");
  });

  it("is the plain text box it replaced when there are no competitors yet", () => {
    const out = picker("", []);
    expect(out).not.toContain("<select");
    expect(out).toContain('placeholder="Who won (required)"');
  });

  it("is what the Outcome section asks 'Won by' with, and the close dialog uses it too", () => {
    const outcome = clean(renderToString(createElement(OutcomeSection, {
      opportunityId: OPP, fmt: (n: number) => String(n), onError: noop, onNotice: noop,
      data: { stage: "bid_lost", award_value: null, winning_bidder: null, award_date: null, outcome_note: null, competitor: null, loss_reason: null, our_total: null, our_version: null, currency: "SAR", canEdit: true, pending: false },
    })));
    expect(outcome).toContain('data-guide="tender.outcome.won_by"');
    expect(outcome).toContain("Won by");
    const client = readFileSync(path.join(ROOT, "src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx"), "utf8");
    expect(client).toContain('<WhoWonPicker opportunityId={opp.id}');
    expect(client).toContain('guide="tender.close.competitor"');
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

  it("a tender deal has a Competitors tab, last, after Room; a standard deal never does", () => {
    const withRoom = page({ initialTab: "overview" }, { room: { pending: false, unread: 0, openQuestions: 0, isAdmin: false } });
    expect(withRoom).toContain("Competitors");
    expect(withRoom.indexOf('data-guide="tab:room"')).toBeLessThan(withRoom.indexOf('data-guide="tab:competitors"'));
    expect(withRoom.indexOf('data-guide="tab:boq"')).toBeLessThan(withRoom.indexOf('data-guide="tab:competitors"'));
    expect(page({ initialTab: "overview" }, null)).not.toContain("Competitors");
  });

  it("opening the tab shows its header and the add button at once, before the list has loaded", () => {
    const out = page({ initialTab: "competitors" }, { boqEdit: true });
    expect(out).toContain('data-guide="competitor.tab"');
    expect(out).toContain("+ Add competitor");
    expect(out).toContain("Loading competitors…");
  });

  it("a view-only person gets the tab without the add button", () => {
    expect(page({ initialTab: "competitors" }, { boqEdit: false })).not.toContain("+ Add competitor");
  });

  it("the standard deal's own competitor box on the Overview tab is unchanged", () => {
    expect(page({ initialTab: "overview" }, null)).toContain("Competitor");
  });
});
