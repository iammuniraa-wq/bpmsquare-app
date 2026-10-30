import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Opportunity, OpportunityLine } from "@/lib/types";
import type { OpportunityStageDef } from "@/lib/constants";
import type { CompetitorEvidence, CompetitorView, CompetitorsData } from "@/lib/tender/competitors/rules";
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
import CompetitorDetailPanel from "./competitors/CompetitorDetailPanel";
import ResearchQuestions from "./competitors/ResearchQuestions";
import { missingQuestions } from "@/lib/tender/competitors/researchRules";
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
  created_at: `2026-10-0${(n % 9) + 1}T00:00:00Z`, status: "accepted", origin: "manual", evidence: null, ...over,
});
const data = (competitors: CompetitorView[], over: Partial<CompetitorsData> = {}): CompetitorsData => ({ competitors, pending: false, insights: { available: true }, ...over });
const tab = (d: CompetitorsData, props: Partial<Parameters<typeof CompetitorsTab>[0]> = {}) =>
  clean(renderToString(createElement(CompetitorsTab, { opportunityId: OPP, canEdit: true, onError: noop, initialData: d, ...props })));

const RIVAL = comp(1, "Rival Co", { website: "https://www.rival.com", country: "Saudi Arabia", expected_price: "lower", strengths: "Local presence & fast delivery", notes: "Won the last two for this client" });

function buttonsOf(html: string, guidePrefix: string) {
  return [...html.matchAll(/<button\b[^>]*data-guide="([a-z_.]+)"[^>]*>/g)].filter((m) => m[1].startsWith(guidePrefix)).map((m) => m[0]);
}

describe("the Competitors tab", () => {
  it("lists one row per competitor with company, expected price and status, as text", () => {
    const out = tab(data([RIVAL, comp(2, "<script>alert(1)</script>", { strengths: "<b>bold</b>" })]));
    expect(out).toContain('data-guide="competitor.tab"');
    expect(out).toContain('data-guide="competitor.table"');
    expect(out.match(/data-guide="competitor\.row"/g)).toHaveLength(2);
    expect(out).toContain("Rival Co");
    expect(out).toContain("Below us");
    expect(out).toContain("Added by you");
    expect(out).toContain("Unknown");
    for (const head of ["Company", "Expected price", "Status"]) expect(out, head).toContain(`>${head}`);
    expect(out).not.toContain("<script>");
    // The list shows three things only: the rest is behind a click.
    for (const hidden of ["Local presence", "Won the last two for this client", "Saudi Arabia", "www.rival.com"]) expect(out, hidden).not.toContain(hidden);
  });

  it("the header line counts the competitors, those expected below us and the proposals; a proposal is not counted as a competitor", () => {
    const out = tab(data([RIVAL, comp(2, "Second Co", { expected_price: "higher", is_winner: true }), comp(3, "Third Co", { status: "proposed", origin: "research" })]));
    expect(out).toContain('data-guide="competitor.summary"');
    expect(out).toContain("2 on this tender · 1 expected below us · 1 proposed");
    expect(out).not.toContain("competitor.strip");
    expect(out).toContain("Winner");
    expect(tab(data([comp(1, "A")]))).toContain("1 on this tender</span>");
  });

  it("a proposal reads Proposed and the team's own competitor reads Added by you, in the order the server sends them", () => {
    const out = tab(data([RIVAL, comp(1, "Proposed Co", { status: "proposed", origin: "research" })]));
    expect(out).toContain(">Proposed<");
    expect(out).toContain(">Added by you<");
    expect(out.indexOf("Rival Co")).toBeLessThan(out.indexOf("Proposed Co"));
  });

  it("an empty tab says what to do next and offers the add button; a view-only person is not offered it", () => {
    const empty = tab(data([]));
    expect(empty).toContain("No competitors yet");
    expect(empty).toContain("Add the companies you expect to bid against");
    expect(empty).toContain("Add competitor");
    expect(empty).toContain('data-guide="competitor.suggest"');
    const view = tab(data([]), { canEdit: false });
    expect(view).toContain("No competitors have been added to this tender.");
    expect(view).not.toContain("Add competitor");
    expect(view).not.toContain("competitor.suggest");
  });

  it("says a database update is needed while the migration is pending, with no add button and no list", () => {
    const out = tab(data([], { pending: true }));
    expect(out).toContain("migration 0229");
    expect(out).not.toContain("Add competitor");
    expect(out).not.toContain("competitor.table");
  });

  it("there is no Analyse all and no strip of big tiles any more", () => {
    const out = tab(data([RIVAL, comp(2, "B")]));
    expect(out).not.toContain("competitor.analyse_all");
    expect(out).not.toContain("Analyse all");
    expect(out).not.toContain("Expect to be cheaper");
  });

  it("pages a long list: a few rows, then Show all", () => {
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

  it("the table becomes cards under 780 px, with no fixed width anywhere and no sideways scroll", () => {
    expect(out).toMatch(/@media \(max-width:780px\)/);
    expect(out).toContain(".cmp-table thead{display:none}");
    expect(out).not.toMatch(/(?<![-a-z])width:\s*\d{3,}px/);
    expect(out).not.toMatch(/overflow-x:\s*(scroll|auto)/);
  });

  it("every button on the tab is a 44 px target, either set on the button or lifted by the tab's .bpm-tap on a phone", () => {
    expect(out).toContain('class="bpm-tap"');
    for (const b of [...buttonsOf(out, "competitor.add"), ...buttonsOf(out, "competitor.open"), ...buttonsOf(out, "competitor.suggest")]) expect(b, b).toMatch(/min-height:44px|class="cmp-open"/);
    expect(out).toContain(".cmp-open{all:unset;box-sizing:border-box;cursor:pointer;min-height:44px");
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

describe("the competitor's detail panel", () => {
  const analysis: DockAnalysis = { card: fixtureCard(), cached: true, saved: true, notice: null, webDerived: false, digest: "", subject: { accountId: null, name: "Rival Co", domain: null, country: null } };
  const evidence: CompetitorEvidence = {
    v: 1, researched_at: "2026-10-29T08:00:00Z", model: "m",
    facts: [
      { text: "Won the 2025 pump supply award at Jubail", kind: "award", source_url: "https://news.example.com/jubail-award", source_title: "Jubail awards", published_on: "2025-06-02" },
      { text: "Opened a Riyadh office", kind: "profile", source_url: "https://www.rival.com/about", source_title: null, published_on: null },
    ],
    price: { text: "A comparable award was valued at SAR 1.9 million", amount: 1_900_000, source_url: "https://news.example.com/jubail-award" },
    wins: { text: "Won the 2024 tender against us at this client", source_url: "https://news.example.com/2024" },
  };
  const panel = (x: CompetitorView, extra: Record<string, unknown> = {}) => clean(renderToString(createElement(CompetitorDetailPanel, {
    competitor: x, canEdit: true, insightsAvailable: true, onClose: noop, onAccept: noop, onReject: noop, onEdit: noop, onToggleWinner: noop, onRemove: noop,
    onInsights: noop, onToggleInsights: noop, onOpen: noop, onAsk: noop, ...extra,
  } as never)));

  it("shows the team's facts and the evidence, every fact with a link to its source page", () => {
    const out = panel({ ...RIVAL, status: "proposed", origin: "research", evidence }, { ourBid: { total: 2_000_000, currency: "SAR", version_no: 2 } });
    for (const label of ["Website", "Country", "Expected price", "Strengths", "Notes", "Evidence", "Won against us", "Their likely price"]) expect(out, label).toContain(label);
    expect(out).toContain("Won the 2025 pump supply award at Jubail");
    expect(out).toContain('href="https://news.example.com/jubail-award"');
    expect(out).toContain("source: Jubail awards");
    expect(out).toContain("source: rival.com");
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("Won the 2024 tender against us at this client");
    expect(out).toContain("A comparable award was valued at SAR 1.9 million");
    expect(out).toContain("our bid SAR 2,000,000 (v2) · theirs is -5.0% against ours");
  });

  it("says not found, never a guess, where no page stated a thing", () => {
    const out = panel({ ...RIVAL, status: "proposed", origin: "research", evidence: { ...evidence, price: null, wins: null, facts: [evidence.facts[0]] } });
    expect(out.match(/not found/g)).toHaveLength(2);
    expect(panel(RIVAL).match(/not found/g)).toHaveLength(3);
  });

  it("never links to a page or a website that is not https", () => {
    const bad = { ...evidence, facts: [{ ...evidence.facts[0], source_url: "javascript:alert(1)" }], wins: { text: "x", source_url: "http://plain.example.com" } };
    const out = panel({ ...comp(1, "X", { website: "javascript:alert(1)" }), evidence: bad });
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain('href="http://');
  });

  it("a proposal offers Accept and Reject only; the team's own competitor offers Edit, Mark as winner and Remove", () => {
    const proposed = panel({ ...RIVAL, status: "proposed", origin: "research", evidence });
    expect(proposed).toContain('data-guide="competitor.accept"');
    expect(proposed).toContain('data-guide="competitor.reject"');
    for (const gone of ["competitor.edit", "competitor.winner", "competitor.remove"]) expect(proposed, gone).not.toContain(gone);
    expect(proposed).toContain("Proposed");
    const own = panel(RIVAL);
    for (const g of ["competitor.edit", "competitor.winner", "competitor.remove"]) expect(own, g).toContain(`data-guide="${g}"`);
    expect(own).toContain("Mark as winner");
    expect(own).toContain("Added by you");
    expect(own).not.toContain("competitor.accept");
    expect(panel({ ...RIVAL, is_winner: true })).toContain("Unmark winner");
  });

  it("a view-only person gets the facts and no actions", () => {
    const out = panel({ ...RIVAL, status: "proposed", origin: "research", evidence }, { canEdit: false });
    expect(out).toContain("Won the 2025 pump supply award at Jubail");
    for (const gone of ["competitor.accept", "competitor.reject", "competitor.edit"]) expect(out, gone).not.toContain(gone);
  });

  it("Company insights moved into the panel: a button when available, the analysis card once loaded, a plain reason when it fails", () => {
    expect(panel(RIVAL)).toContain("Company insights");
    expect(panel(RIVAL, { insightsAvailable: false })).not.toContain('data-guide="competitor.insights"');
    const out = panel(RIVAL, { insight: { status: "done", analysis, open: true } });
    expect(out).toContain("Hide insights");
    expect(out).toContain("Worth following up");
    expect(panel(RIVAL, { insight: { status: "done", analysis, open: false } })).toContain("Show insights");
    expect(panel(RIVAL, { insight: { status: "loading" } })).toContain("Analysing…");
    const failed = panel(RIVAL, { insight: { status: "error", message: "The daily limit for company analyses is reached. Try again tomorrow." } });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("The daily limit for company analyses is reached.");
  });

  it("opens from a row on the tab", () => {
    const out = tab(data([RIVAL]), { initialOpen: RIVAL.id });
    expect(out).toContain('role="dialog"');
    expect(out).toContain('data-guide="competitor.detail"');
    expect(out).toContain("Local presence &amp; fast delivery");
    expect(out).toContain("www.rival.com");
  });

  it("the list's own row never shows the evidence or the website (only the panel does)", () => {
    expect(tab(data([{ ...RIVAL, evidence }]))).not.toContain("Jubail");
  });
});

describe("Suggest from market research", () => {
  const questions = missingQuestions({}, { country: "Saudi Arabia" });
  const asking = (answers = {}) => clean(renderToString(createElement(ResearchQuestions, { questions, answers, onAnswer: noop, onCancel: noop } as never)));

  it("the button is the primary action of the header, with its explanation behind an i", () => {
    const out = tab(data([RIVAL]));
    expect(out).toContain('data-guide="competitor.suggest"');
    expect(out).toContain("Suggest from market research");
    expect(out).toContain('aria-label="About Suggest from market research"');
    expect(buttonsOf(out, "competitor.suggest")[0]).toMatch(/bpm-btn-primary/);
    expect(buttonsOf(out, "competitor.suggest")[0]).not.toMatch(/disabled/);
    expect(buttonsOf(out, "competitor.suggest")[0]).toMatch(/min-height:44px/);
  });

  it("is switched off, and the i says why, when web research or the person's access is not available", () => {
    const off = tab(data([RIVAL], { insights: { available: false, reason: "Company analysis is not switched on for this workspace." } }));
    expect(buttonsOf(off, "competitor.suggest")[0]).toMatch(/disabled/);
    expect(off).toContain('aria-label="About Suggest from market research"');
  });

  it("is switched off while migration 0239 is pending, with the update line", () => {
    const out = tab(data([RIVAL], { researchPending: true }));
    expect(buttonsOf(out, "competitor.suggest")[0]).toMatch(/disabled/);
    expect(out).toContain('data-guide="competitor.research.pending"');
    expect(out).toContain("migration 0239");
  });

  it("a view-only person is not offered it", () => {
    expect(tab(data([RIVAL]), { canEdit: false })).not.toContain("competitor.suggest");
  });

  it("asks one question at a time as option chips, each a 44 px target, with a Cancel", () => {
    const out = asking();
    expect(out).toContain('data-guide="competitor.research.questions"');
    expect(out).toContain("Is this a supply-only tender, or supply and install?");
    expect(out).not.toContain("Where should I look for competitors?");
    const chips = [...out.matchAll(/<button\b[^>]*data-guide="competitor\.research\.option"[^>]*>([^<]*)/g)];
    expect(chips.map((m) => m[1])).toEqual(["Supply only", "Supply and install"]);
    for (const m of chips) expect(m[0], m[0]).toMatch(/min-height:44px/);
    expect(buttonsOf(out, "competitor.research.cancel")[0]).toMatch(/min-height:44px/);
  });

  it("an answered question shrinks to one muted line and the next one appears", () => {
    const out = asking({ scope: "supply_install" });
    expect(out).toContain("Is this a supply-only tender, or supply and install? Supply and install");
    expect(out).toContain("Where should I look for competitors?");
    expect(out).toContain("Saudi Arabia only");
    expect(out).toContain(">GCC<");
    expect(out).not.toContain(">Supply only<");
  });

  it("the tab says what the research assumed, with a Change link, once a run has been answered", () => {
    const out = tab(data([RIVAL], { research: { scope: "supply_install", region: "gcc", issuer_type: "government" } }));
    expect(out).toContain('data-guide="competitor.research.assumes"');
    expect(out).toContain("Research assumes: supply and install · GCC · government");
    expect(out).toContain('data-guide="competitor.research.change"');
    expect(tab(data([RIVAL], { research: { scope: "supply", region: "gcc", issuer_type: "private" } }), { canEdit: false })).not.toContain("competitor.research.change");
    expect(tab(data([RIVAL]))).not.toContain("Research assumes");
  });

  it("the answers are not a tender field: the tab and the research files never write them to the tender or the deal", () => {
    const route = readFileSync(path.join(ROOT, "src/app/api/opportunities/[id]/competitors/research/route.ts"), "utf8");
    expect(route).toMatch(/custom_data: \{ \.\.\.custom, competitor_research:/);
    expect(route).not.toMatch(/from\("opportunities"\)/);
    expect(route.match(/from\("opportunity_tenders"\)/g)).toHaveLength(1);
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
    const withRoom = page({ initialTab: "overview" }, { room: { pending: false, unread: 0, isAdmin: false } });
    expect(withRoom).toContain("Competitors");
    expect(withRoom.indexOf('data-guide="tab:room"')).toBeLessThan(withRoom.indexOf('data-guide="tab:competitors"'));
    expect(withRoom.indexOf('data-guide="tab:boq"')).toBeLessThan(withRoom.indexOf('data-guide="tab:competitors"'));
    expect(page({ initialTab: "overview" }, null)).not.toContain("Competitors");
  });

  it("opening the tab shows its header and the add button at once, before the list has loaded", () => {
    const out = page({ initialTab: "competitors" }, { boqEdit: true });
    expect(out).toContain('data-guide="competitor.tab"');
    expect(out).toContain("Add competitor");
    expect(out).toContain("Loading competitors…");
  });

  it("a view-only person gets the tab without the add button", () => {
    expect(page({ initialTab: "competitors" }, { boqEdit: false })).not.toContain("Add competitor");
  });

  it("the standard deal's own competitor box on the Overview tab is unchanged", () => {
    expect(page({ initialTab: "overview" }, null)).toContain("Competitor");
  });
});
