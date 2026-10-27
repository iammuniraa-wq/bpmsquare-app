import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Opportunity, OpportunityLine } from "@/lib/types";
import { opportunityStages } from "@/lib/sales/opportunity";
import { tenderStages } from "@/lib/tender/rules";
import type { TenderView } from "@/lib/tender/views";
import type { CallsData } from "@/lib/tender/calls";

// Redesign 2026-10-27 (docs/design/gcc-tender-deals.md section 26): the header of a tender deal by stage, the History panel, the Bid tab's
// documents and the phone rules, rendered with the real page component on the server. The bug these guard: a tender's primary button was
// "Convert to Standard Quote", so a tender set to Won produced a quote, not a project.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/pipeline/x",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown; className?: string }) => createElement("a", { href: p.href, className: p.className }, p.children as never) }));

import OpportunityDetailClient from "./OpportunityDetailClient";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const baseOpp = { id: OPP, tenant_id: "t1", ref: "OPP-2", title: "Valves for Plant 4", account_id: "acc", contact_id: null, stage: "estimating", outcome: "open", amount: 0, probability: 25, owner_id: "u1", team: [], source: "direct", created_at: "2026-10-01T00:00:00Z", stage_since: "2026-10-01T00:00:00Z", expected_close: null, description: null, competitor: null, closed_at: null, loss_reason: null, probability_override: null, probability_override_reason: null };
const oppAt = (stage: string, outcome = "open") => ({ ...baseOpp, stage, outcome }) as unknown as Opportunity & { stage_since: string };
const line = (id: string) => ({ id, tenant_id: "t1", opportunity_id: OPP, sl_no: id, description: `Gate valve ${id}`, uom: "Nos", qty: 2, rate: 100, discount_pct: 0, amount: 200, product_id: null, pricing_document_id: null, rfq_line_id: null, group_id: null, group_label: null, group_type: null, break_of: null, break_qty: null, is_selected: true, show_on_pdf: true }) as unknown as OpportunityLine;
const view: TenderView = {
  tender_no: "ARB-1", issuer_name: "Aramco", issuer_account_id: null, portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z", bid_bond_amount: null, bid_bond_currency: null,
  bid_bond_expiry: null, addenda_count: 0, decision: null, decision_reason: null, decided_by_name: null, decided_at: null, source_email_id: null, bond_status: "requested", bond_released_at: null, bond_released_by_name: null,
};
const ver = (n: number, total: number) => ({ id: `v${n}`, version_no: n, submitted_at: `2026-10-${10 + n}T09:00:00Z`, submitted_by_name: "S. Khan", currency: "SAR", total, line_count: 2, revision_reason: n > 1 ? "Addendum" : null, note: null });
const quote = (i: number) => ({ object: "standard_quote" as const, id: `q${i}`, ref: `SQ-000${i}`, status: "draft", subtotal: 1000 * i, total: 1000 * i, created_at: `2026-10-2${i}T00:00:00Z` });

function page(o: { stage?: string; outcome?: string; tender?: Record<string, unknown> | null; extra?: Record<string, unknown>; stages?: unknown } = {}) {
  const tender = o.tender === null ? null : { view, room: null, approval: null, accounts: [], nowIso: "2026-10-26T00:00:00Z", timezone: "Asia/Riyadh", bids: { versions: [], pending: false, working_total: 0, canEdit: true }, ...o.tender };
  return clean(renderToString(createElement(OpportunityDetailClient, {
    opp: oppAt(o.stage ?? "estimating", o.outcome), accountName: "Aramco", contacts: [], initialLines: [line("1")], linesVersion: "v1", quotes: [], stages: o.stages ?? (tender ? tenderStages() : opportunityStages(null)),
    members: [], products: [], pricingEnabled: false, standardQuotesEnabled: true, todayKey: "2026-10-26", currentUserId: "u1", activity: createElement("div", null, "CHANGE-HISTORY"),
    tender, ...o.extra,
  } as never)));
}
const primaryGuides = (html: string) => [...html.matchAll(/data-guide="(tender\.primary\.[a-z_]+)"/g)].map((m) => m[1]);
const buttonFor = (html: string, guide: string) => html.match(new RegExp(`<(?:button|a)\\b[^>]*data-guide="${guide}"[^>]*>[^<]*`))?.[0] ?? "";

describe("the primary header button of a tender follows the stage", () => {
  it("Received: Propose bid decision", () => {
    const out = page({ stage: "received" });
    expect(primaryGuides(out)).toEqual(["tender.primary.propose"]);
    expect(buttonFor(out, "tender.primary.propose")).toContain("Propose bid decision");
  });

  it("Estimating: Submit bid, and Revise bid once a version is in", () => {
    expect(buttonFor(page({ stage: "estimating" }), "tender.primary.submit")).toContain("Submit bid");
    const revised = page({ stage: "estimating", tender: { bids: { versions: [ver(1, 200)], pending: false, working_total: 0, canEdit: true } } });
    expect(buttonFor(revised, "tender.primary.revise")).toContain("Revise bid");
    expect(primaryGuides(revised)).toEqual(["tender.primary.revise"]);
  });

  it("Submitted and Clarifications: Record the outcome", () => {
    for (const stage of ["submitted", "clarifications"]) {
      const out = page({ stage });
      expect(buttonFor(out, "tender.primary.outcome"), stage).toContain("Record the outcome");
      expect(primaryGuides(out), stage).toEqual(["tender.primary.outcome"]);
    }
  });

  it("Awarded and won: Create contract project, or a link to it once it exists", () => {
    const create = page({ stage: "awarded", outcome: "won", extra: { contractProject: { existing: null, canCreate: true }, canStartContractProject: true } });
    expect(buttonFor(create, "tender.primary.create_project")).toContain("Create contract project");
    const open = page({ stage: "awarded", outcome: "won", extra: { contractProject: { existing: { id: "p1", ref: "CPR-0001" }, canCreate: true } } });
    // The link is the shared Button as a Link (the test's Link stand-in keeps only href and class).
    expect(open).toMatch(/<a href="\/contract-projects\/p1"[^>]*>Open contract project<\/a>/);
    expect(open).not.toContain("Create contract project");
    expect(read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx")).toContain("data-guide={tenderButton.guide}");
  });

  it("Lost and No-bid have no primary button", () => {
    expect(primaryGuides(page({ stage: "bid_lost", outcome: "lost" }))).toEqual([]);
    expect(primaryGuides(page({ stage: "no_bid", outcome: "dropped" }))).toEqual([]);
  });

  it("a tender header never offers Convert to Standard Quote, in any stage, even with the module on", () => {
    for (const stage of ["received", "bid_no_bid", "estimating", "submitted", "clarifications", "awarded", "bid_lost", "no_bid"]) {
      const out = page({ stage, outcome: stage === "awarded" ? "won" : stage === "bid_lost" ? "lost" : stage === "no_bid" ? "dropped" : "open" });
      expect(out, stage).not.toContain("Convert to Standard Quote");
    }
  });

  it("every primary button is a 44 px target", () => {
    for (const stage of ["received", "estimating", "submitted"]) expect(buttonFor(page({ stage }), `tender.primary.${stage === "received" ? "propose" : stage === "estimating" ? "submit" : "outcome"}`), stage).toContain("min-height:44px");
  });

  it("a standard deal keeps Convert to Standard Quote as its primary step, and no tender button", () => {
    const out = page({ tender: null, stage: "qualify" });
    expect(out).toContain("Convert to Standard Quote");
    expect(primaryGuides(out)).toEqual([]);
  });

  it("the buttons are wired: propose opens the decision panel, submit and revise open the Bid tab and start its flow, the outcome opens the close dialog, create makes the project", () => {
    const src = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(src).toMatch(/key === "propose_decision"\) setDecisionOpen\(true\)/);
    expect(src).toMatch(/key === "submit_bid" \|\| key === "revise_bid"\) \{ openTab\("bid"\); setBidStart\(\(n\) => n \+ 1\); \}/);
    expect(src).toMatch(/key === "record_outcome"\) markWon\(\)/);
    expect(src).toMatch(/key === "create_project"\) createContractProject\(\)/);
    expect(src).toContain("startSignal={bidStart}");
    expect(src).toContain("<BidDecisionPanel");
  });
});

describe("the close dialog on a tender", () => {
  const src = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
  const dialog = src.slice(src.indexOf("{closing && ("));

  it("offers Create contract project now when Won and the person may create one, and never makes a Standard Quote", () => {
    expect(src).toMatch(/const offerProject = !!tender && !!contractProject && !contractProject\.existing && canStartContractProject && closing\?\.outcome === "won"/);
    expect(dialog).toContain("Create contract project now");
    expect(dialog).toContain("confirmClose(true)");
    expect(dialog).not.toMatch(/Standard Quote|convert\(/);
    expect(src).toMatch(/if \(ok && thenProject\) await postContractProject\(\)/);
  });

  it("the project is created only after the deal has been saved as won (the server needs an awarded, won tender)", () => {
    expect(src).toMatch(/const ok = await patch\(\{ stage: cl\.stage, outcome: cl\.outcome[\s\S]*if \(ok && thenProject\)/);
  });

  it("the page tells the client whether the caller may create a project", () => {
    const pageSrc = read("src/app/(app)/pipeline/[id]/page.tsx");
    expect(pageSrc).toContain("canStartContractProject={canStartProject}");
    expect(pageSrc).toMatch(/canStartProject = canViewWorkcenter\(perms, "contract_projects"\) && canEditWorkcenter\(perms, "contract_projects"\)/);
  });
});

describe("History", () => {
  const calls: CallsData = { calls: [{ id: "a", kind: "call", occurred_at: "2026-10-20T09:00:00Z", with_whom: null, summary: "Rang the client", outcome: null, next_step: "Send BOQ", next_step_due: "2026-10-22", next_step_done_at: null, logged_by_name: "S. Khan", can_change: true }], pending: false, canEdit: true };

  it("is closed until asked for, and ?tab=activity opens it as a side panel with the calls above the change history", () => {
    const closed = page({ tender: { calls } });
    expect(closed).not.toContain('aria-label="History"');
    expect(closed).not.toContain("CHANGE-HISTORY");
    const open = page({ tender: { calls }, extra: { initialTab: "activity" } });
    expect(open).toMatch(/<aside[^>]*role="dialog"[^>]*aria-label="History"/);
    expect(open.indexOf("Rang the client")).toBeGreaterThan(-1);
    expect(open.indexOf("Rang the client")).toBeLessThan(open.indexOf("CHANGE-HISTORY"));
  });

  it("is the shared side panel (a drawer on a PC, a bottom sheet under 780 px) and its explanation sits behind an i", () => {
    const src = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(src).toContain('import SidePanel from "@/components/ui/SidePanel"');
    expect(src).toMatch(/<SidePanel title="History" label="History" subtitle=\{<InfoTip label="History">\{TENDER_TIPS\.history\}<\/InfoTip>\}/);
    expect(read("src/components/ui/SidePanel.module.css")).toMatch(/max-width:\s*780px/);
  });

  it("the Overview's overdue next steps open it", () => {
    const src = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(src).toContain("onOpenHistory={() => setHistoryOpen(true)}");
    const out = page({ tender: { calls } });
    expect(out).toContain('data-guide="tender.overdue_steps"');
  });

  it("a standard deal keeps its Activity tab and has no History item", () => {
    const out = page({ tender: null, stage: "qualify", extra: { initialTab: "activity" } });
    expect(out).toContain("CHANGE-HISTORY");
    expect(out).toMatch(/data-guide="tab:activity"/);
    expect(out).not.toContain('aria-label="History"');
  });
});

describe("the Bid tab's documents", () => {
  const open = (extra: Record<string, unknown> = {}, tender: Record<string, unknown> = {}) => page({
    stage: "submitted", extra: { initialTab: "bid", quotes: [quote(1), quote(2)], ...extra },
    tender: { bids: { versions: [ver(2, 6500), ver(1, 6600)], pending: false, working_total: 0, canEdit: true }, ...tender },
  });

  it("holds the priced BOQ, the answer sheet, and Make a Standard Quote from this version", () => {
    const out = open();
    expect(out).toContain('data-guide="tender.bid.documents"');
    expect(out).toContain("Download priced BOQ");
    expect(out).toContain("Export answer sheet");
    expect(out).toContain("Make a Standard Quote from this version");
    expect(out).toContain('data-guide="tender.bid.quote_version"');
  });

  it("lists the quotes already made from the deal", () => {
    const out = open();
    expect(out).toContain("SQ-0001");
    expect(out).toContain("SQ-0002");
    expect(out).toContain('href="/standard-quotes/q1"');
  });

  it("a view-only person gets no quote maker but still sees the list", () => {
    const out = open({}, { boqEdit: false, bids: { versions: [ver(1, 6600)], pending: false, working_total: 0, canEdit: false } });
    expect(out).not.toContain("Make a Standard Quote from this version");
    expect(out).toContain("SQ-0001");
  });

  it("the Quotes tab is gone for a tender and the quote maker is not offered when Standard Quotes is off", () => {
    expect(open()).not.toContain('data-guide="tab:quotes"');
    expect(open({ standardQuotesEnabled: false })).not.toContain("Make a Standard Quote from this version");
  });
});

describe("on a phone (under 780 px)", () => {
  const src = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");

  it("the header is minimal: the facts fold into one collapsible section, the title, stage chip, primary button and menu stay", () => {
    expect(src).toContain('window.matchMedia("(max-width: 780px)")');
    expect(src).toMatch(/\{tender && phone \? \(\s*<SettingsSection id="tender\.header_facts" title="Deal facts"/);
    const out = page({ stage: "estimating" });
    expect(out).toContain("Valves for Plant 4");
    expect(out).toContain('data-guide="record.more"');
    expect(out).toMatch(/data-guide="tender\.primary\.submit"/);
  });

  it("the bid decision panel is mounted by the page, so the primary button can open it while the facts are folded", () => {
    expect(src).toContain("controlled={{ open: decisionOpen, setOpen: setDecisionOpen }}");
    expect(src).toMatch(/\{tender && decisionOpen && \(\s*<BidDecisionPanel/);
  });

  it("the tab strip scrolls sideways and a selected tab opens with its content visible", () => {
    expect(src).toContain('inline: "center"');
    expect(src).toMatch(/shownTab\.current !== tab && narrow/);
    expect(read("src/app/globals.css")).toMatch(/\.bpm-tabs\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("uses the tone system only: no colour literal in the new code", () => {
    for (const f of ["src/lib/tender/headerAction.ts", "src/lib/tender/tabs.ts", "src/components/tender/BidDocuments.tsx", "src/components/tender/DealLinesBoq.tsx"]) {
      expect(read(f).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });
});
