import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Opportunity, OpportunityLine } from "@/lib/types";
import type { OpportunityStageDef } from "@/lib/constants";
import type { TenderView } from "@/lib/tender/views";
import type { ApprovalView } from "@/lib/tender/approval";
import type { OutcomeData } from "@/lib/tender/outcome";

// Redesign step 1 (docs/design/gcc-tender-deals.md section 21): the merged tender Overview and the header of a tender deal, rendered on
// the server. 375 px and PC share one markup: the two columns come from an auto-fit grid that wraps under about 900 px, the collapsible
// blocks come from the shared section, and the phone defaults (Documents and Bid guarantee closed) are applied after mount from the
// section's own narrow default. So the checks here are the ones that decide whether a phone fits: 44 px targets, no fixed widths, no
// literal colour, the right blocks in the right order, and the standard deal untouched.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/pipeline/x",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import OpportunityDetailClient from "./OpportunityDetailClient";
import SettingsSection from "@/components/settings/SettingsSection";
import BidDecisionMarker from "./BidDecisionMarker";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const opp = { id: OPP, tenant_id: "t1", ref: "OPP-2", title: "Valves for Plant 4", account_id: "acc", contact_id: null, stage: "estimating", outcome: "open", amount: 0, probability: 25, owner_id: "u1", team: [], source: "direct", created_at: "2026-10-01T00:00:00Z", stage_since: "2026-10-01T00:00:00Z", expected_close: "2026-10-30", description: "Supply of valves", competitor: null, closed_at: null, loss_reason: null, probability_override: null, probability_override_reason: null } as unknown as Opportunity & { stage_since: string };
const line = (rate: number, id = "1") => ({ id, tenant_id: "t1", opportunity_id: OPP, sl_no: id, description: `Gate valve ${id}`, uom: "Nos", qty: 2, rate, discount_pct: 0, amount: 2 * rate, product_id: null, pricing_document_id: null, rfq_line_id: null, group_id: null, group_label: null, group_type: null, break_of: null, break_qty: null, is_selected: true, show_on_pdf: true }) as unknown as OpportunityLine;
const stages = [
  { value: "received", label: "Received", probability_hint: 10 }, { value: "bid_no_bid", label: "Bid/No-bid", probability_hint: 15 }, { value: "estimating", label: "Estimating", probability_hint: 25 },
  { value: "awarded", label: "Awarded", probability_hint: 100, is_closed: true, outcome: "won" },
] as unknown as OpportunityStageDef[];
const view: TenderView = {
  tender_no: "ARB-4400123", issuer_name: "Saudi Aramco", issuer_account_id: "acc1", portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z",
  bid_bond_amount: 96000, bid_bond_currency: "SAR", bid_bond_expiry: "2027-06-30", addenda_count: 2, decision: null, decision_reason: null,
  decided_by_name: null, decided_at: null, source_email_id: null, bond_status: "issued", bond_released_at: null, bond_released_by_name: null,
};
const approval = (over: Partial<ApprovalView> = {}): ApprovalView => ({ standing: null, recordedBefore: false, pending: null, canDecide: false, proposalBlocked: null, history: [], ...over });
const members = [{ user_id: "u1", name: "S. Khan", email: null }];

const page = (extra: Record<string, unknown> = {}, tender: Record<string, unknown> | null = {}, lines: OpportunityLine[] = [line(100)]) => clean(renderToString(createElement(OpportunityDetailClient, {
  opp, accountName: "Aramco", contacts: [], initialLines: lines, linesVersion: "v1", quotes: [], stages, members, products: [], pricingEnabled: false, standardQuotesEnabled: false,
  todayKey: "2026-10-26", currentUserId: "u1", activity: createElement("div", null, "CHANGE-HISTORY"),
  tender: tender === null ? null : { view, room: null, approval: approval(), accounts: [{ id: "acc1", name: "Saudi Aramco" }], nowIso: "2026-10-26T00:00:00Z", timezone: "Asia/Riyadh", ...tender },
  sourceEmail: createElement("div", { "data-guide": "inbox.source" }, "FROM-EMAIL"),
  ...extra,
} as never)));

const tabLabels = (html: string) => [...html.matchAll(/role="tab"[^>]*>([^<]*)/g)].map((m) => m[1]);

describe("the tabs of a tender deal", () => {
  it("a tender has exactly Overview, Bill of quantities, Costing, Bid, Room, Competitors, in that order: no Tender, Lines, Estimates, Quotes, Related or Activity tab", () => {
    const out = page({ related: createElement("div", null, "RFQ") }, {
      room: { pending: false, unread: 0, isAdmin: false }, costing: { canEdit: true },
      bids: { versions: [], pending: false, working_total: 0, canEdit: true },
    });
    expect(tabLabels(out).map((l) => l.replace(/\d+$/, ""))).toEqual(["Overview", "Bill of quantities", "Costing", "Bid", "Room", "Competitors"]);
    expect(out).not.toContain('data-guide="tab:tender"');
  });

  it("History is not a tab: it is in the header menu, opened from there, and a standard deal has no such item", () => {
    const client = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(client).toMatch(/\{ label: "History", onSelect: \(\) => setHistoryOpen\(true\), hidden: !tender \}/);
    expect(tabLabels(page())).not.toContain("History");
    expect(tabLabels(page())).not.toContain("Activity");
  });

  it("opens on Overview, and an old ?tab= link or saved state lands on the nearest tab: tender and unknown on Overview, lines on the Bill of quantities", () => {
    expect(page()).toContain('data-guide="tender.tab"');
    expect(page({ initialTab: "tender" })).toContain('data-guide="tender.tab"');
    expect(page({ initialTab: "lines" })).not.toContain('data-guide="tender.tab"');
    expect(page({ initialTab: "lines" })).toMatch(/data-guide="tab:boq"[^>]*aria-selected="true"/);
    expect(page({ initialTab: "nonsense" })).toContain('data-guide="tender.tab"');
  });

  it("a standard deal keeps its own Overview and no tender facts, tab or marker", () => {
    const out = page({ initialTab: "overview" }, null);
    expect(tabLabels(out)).toEqual(["Overview", "Lines", "Quotes", "Activity"]);
    for (const w of ["Expected close", "Competitor", "Probability override %"]) expect(out, w).toContain(w);
    for (const w of ["Bid decision", "Bid end date", "Bid guarantee", "What the client asked for", 'data-guide="tender.tab"']) expect(out, w).not.toContain(w);
    expect(out).toContain("close by");
  });
});

describe("the header of a tender deal (every tab)", () => {
  it("shows the path of the tender on every tab, and the five facts in one Details section that is closed by default", () => {
    for (const tab of ["overview", "boq", "competitors"]) {
      const out = page({ initialTab: tab });
      expect(out, tab).toContain('data-guide="tender.steps"');
      expect(out, tab).toContain('data-guide="tender.next"');
      expect(out, tab).toContain('data-guide="tender.checklist"');
      expect(out, tab).toMatch(/aria-expanded="false"[^>]*>(?:<span[^>]*>)?Details|Details<\/span><\/button>/);
      expect(out, tab).toMatch(/Estimating · [^<]* · bid ends 30 Oct 2026 · guarantee issued/);
      // Closed: the stage select and the chips are not drawn until the section is opened.
      expect(out, tab).not.toContain('aria-label="Stage"');
      expect(out, tab).not.toContain("Bid decision: Pending");
      expect(out.indexOf('data-guide="tender.steps"'), tab).toBeLessThan(out.indexOf("Details"));
    }
  });

  it("the Details section holds Stage, the bid decision marker, the Bid end date chip and the Bid guarantee chip, in that order", () => {
    const src = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(src).toMatch(/<SettingsSection id="tender\.header_facts" title="Details"[^>]*defaultOpen=\{false\} defaultOpenNarrow=\{false\}>\{factsRow\}<\/SettingsSection>/);
    const tf = src.slice(src.indexOf("const tenderFacts = tender"), src.indexOf("const factsRow = ("));
    for (const w of ["BidDecisionMarker", 'label: "Bid end date"', 'label: "Bid guarantee"']) expect(tf, w).toContain(w);
    expect(tf.indexOf("BidDecisionMarker")).toBeLessThan(tf.indexOf('label: "Bid end date"'));
    expect(tf.indexOf('label: "Bid end date"')).toBeLessThan(tf.indexOf('label: "Bid guarantee"'));
    const row = src.slice(src.indexOf("const factsRow = ("));
    expect(row.indexOf('label: "Stage"')).toBeGreaterThan(-1);
    expect(row.indexOf('label: "Stage"')).toBeLessThan(row.indexOf("...(tenderFacts"));
  });

  it("the subtitle says the bid ends, not that the deal closes", () => {
    const out = page();
    expect(out).toContain("bid ends 30 Oct 2026");
    expect(out).not.toContain("close by");
  });

  it("the marker follows the decision: awaiting, go and no-go, each with its tone", () => {
    const entry = { id: "r", decision: "go" as const, reason: "x", status: "pending" as const, requested_by_name: "S. Khan", requested_at: "2026-10-20T00:00:00Z", decided_by_name: null, decided_at: null, comment: null };
    const marker = (a: ApprovalView, v: TenderView = view) => clean(renderToString(createElement(BidDecisionMarker, { opportunityId: OPP, tender: v, approval: a, onError: () => {}, onNotice: () => {}, onSaved: () => {} } as never)));
    const waiting = marker(approval({ pending: { ...entry, mine: false } }));
    expect(waiting).toContain("Bid decision: Awaiting approval");
    expect(waiting).toMatch(/data-tone="warn" data-state="awaiting"|data-state="awaiting"[^>]*data-tone="warn"/);
    const go = marker(approval({ standing: { ...entry, status: "approved" } }), { ...view, decision: "go" });
    expect(go).toContain("Bid decision: Go");
    expect(go).toMatch(/data-state="go"/);
    const noGo = marker(approval({ standing: { ...entry, decision: "no_go", status: "approved" } }), { ...view, decision: "no_go" });
    expect(noGo).toContain("Bid decision: No-go");
    expect(noGo).toMatch(/data-tone="bad"/);
  });

  it("a tender with no guarantee recorded says so in the Details summary", () => {
    const out = page({}, { view: { ...view, bid_bond_amount: null, bid_bond_expiry: null, bond_status: "requested" } });
    expect(out).toContain("guarantee none");
    expect(out).not.toContain("guarantee issued");
  });

  it("after the bid is in, the Bid end date is a date, not a countdown", () => {
    const out = page({ opp: { ...opp, stage: "submitted" } });
    expect(out).not.toContain("Bid ends in 4 days");
  });
});

describe("the merged Overview", () => {
  const out = page();
  const at = (s: string) => out.indexOf(s);

  it("has the blocks in order: what the client asked for, Documents, Open work, Bid guarantee", () => {
    const title = (t: string) => out.search(new RegExp(`bpm-t-section"[^>]*>${t}<`));
    const order = ["What the client asked for", "Documents", "Open work", "Bid guarantee"].map(title);
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("asks for what the issuer sent: tender number, issuer, issuer account as a link, portal, Bid end date, owner, source, description, team", () => {
    for (const w of ["Tender number", "Issuer", "Issuer account", "Portal", "Bid end date", "Owner", "Source", "Description", "Team"]) expect(out, w).toContain(w);
    expect(out).toContain('href="/accounts/acc1"');
    expect(out).toContain("Open Saudi Aramco");
    expect(out).toContain("Supply of valves");
  });

  it("has no free-text Competitor field, no Closing/Close by wording and no Addenda or Bid bond wording", () => {
    expect(out).not.toContain(">Competitor<");
    const visible = out.replace(/data-guide="[^"]*"/g, "");
    for (const w of ["Closing", "Close by", "Closes in", "Addenda", "addenda", "Bid bond", "Held"]) expect(visible, w).not.toContain(w);
  });

  it("Documents holds the source email first, then the Change requests counter", () => {
    expect(out).toContain("FROM-EMAIL");
    expect(at("FROM-EMAIL")).toBeLessThan(at("Change requests"));
    expect(out).toContain('aria-label="One more change request"');
    expect(out).toContain('aria-label="One fewer change request"');
    expect(out).toMatch(/aria-live="polite">2</);
  });

  it("Open work shows the lines without a price, from the lines already on the page", () => {
    expect(page({}, {}, [line(0, "1"), line(0, "2"), line(50, "3")])).toContain("2 lines without a price");
    expect(out).toContain("0 lines without a price");
    expect(out).toContain("Nothing is waiting for you.");
  });

  it("Open work lists overdue next steps and unpriced lines only, never Deal Room questions", () => {
    const withRoom = page({}, { room: { pending: false, unread: 0, isAdmin: false } });
    expect(withRoom).not.toContain('data-guide="tender.open_questions"');
    expect(withRoom).not.toContain("open question");
    expect(withRoom).toContain('data-guide="tender.unpriced"');
    expect(withRoom).toContain("0 lines without a price");
  });

  it("the Bid guarantee block has its state, amount, currency, valid-until, a Release guarantee button, and the new state words", () => {
    for (const w of ["State", "Amount", "Currency", "Valid until", "Release guarantee"]) expect(out, w).toContain(w);
    for (const s of ["Requested", "Issued", "Submitted"]) expect(out, s).toContain(`>${s}</option>`);
    expect(out).not.toContain(">Released</option>");
    expect(out).toContain('aria-label="Bid guarantee state"');
  });

  it("a released guarantee shows its state as text, with no selector and no Release button", () => {
    const released = page({}, { view: { ...view, bond_status: "released", bond_released_at: "2026-10-24T08:00:00.000Z", bond_released_by_name: "S. Khan" } });
    expect(released).not.toContain('aria-label="Bid guarantee state"');
    expect(released).not.toContain("Release guarantee");
    expect(released).toContain("Guarantee: Released");
  });

  it("a view-only person gets the guarantee state as text", () => {
    expect(page({}, { boqEdit: false })).not.toContain('aria-label="Bid guarantee state"');
  });

  it("the Outcome block follows only in a closed stage", () => {
    const outcome: OutcomeData = { stage: "awarded", award_value: 900_000, winning_bidder: null, award_date: null, outcome_note: null, competitor: null, loss_reason: null, our_total: 900_000, our_version: 1, currency: "SAR", canEdit: true, pending: false };
    expect(page({}, { outcome })).toContain("Outcome: awarded");
    expect(out).not.toContain("Outcome:");
  });

  it("prints none of its explanations: they sit behind the i", async () => {
    const { TENDER_TIPS } = await import("@/lib/tender/tips");
    for (const tip of Object.values(TENDER_TIPS)) expect(out).not.toContain(tip);
  });

  it("keeps the stat strip of the Overview, with the new words", () => {
    expect(out).toContain('data-guide="tender.strip"');
    expect(out).toContain("Bid end date");
    expect(out).toContain("Bid guarantee");
    expect(read("src/app/(app)/pipeline/[id]/TenderOverview.tsx")).toContain("<TenderStatStrip");
  });
});

describe("on a phone (375 px)", () => {
  const src = read("src/app/(app)/pipeline/[id]/TenderOverview.tsx");
  const marker = read("src/app/(app)/pipeline/[id]/BidDecisionMarker.tsx");

  it("the two columns are an auto-fit grid that falls to one column under about 900 px, with no fixed width", () => {
    expect(src).toContain("repeat(auto-fit, minmax(min(100%, 440px), 1fr))");
    expect(src).not.toMatch(/width: \d{3,}/);
    expect(src).not.toMatch(/overflow-?x/i);
  });

  it("What the client asked for and Open work open by default on a phone; Documents and Bid guarantee start closed", () => {
    const flag = (id: string) => src.match(new RegExp(`id="${id}"[^>]*`))![0];
    expect(flag("tender.asked")).toContain("defaultOpenNarrow");
    expect(flag("tender.asked")).not.toContain("defaultOpenNarrow={false}");
    expect(flag("tender.open_work")).toMatch(/defaultOpenNarrows*$/);
    expect(flag("tender.documents")).toContain("defaultOpenNarrow={false}");
    expect(flag("tender.guarantee")).toContain("defaultOpenNarrow={false}");
  });

  it("the shared section applies a narrow default only when nothing was remembered", () => {
    const section = read("src/components/settings/SettingsSection.tsx");
    expect(section).toContain("defaultOpenNarrow");
    expect(section.indexOf("if (stored !== null)")).toBeLessThan(section.indexOf("matchMedia(\"(max-width: 900px)\")"));
  });

  it("every tap target is at least 44 px: the marker, the counter, the buttons and the links", () => {
    expect(marker).toContain("minHeight: 44");
    for (const needle of ["One fewer change request", "One more change request"]) expect(src).toContain(needle);
    expect(src.match(/minWidth: 44, minHeight: 44/g)!.length).toBeGreaterThanOrEqual(2);
    // Every real button on the rendered Overview is 44 px tall; the section headers (52 px) and the "i" are the shared kit's own.
    const html = page();
    const overview = html.slice(html.indexOf('data-guide="tender.tab"'));
    const buttons = [...overview.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).filter((b) => !b.includes("bpm-tip") && !b.includes("aria-expanded"));
    expect(buttons.length).toBeGreaterThan(5);
    for (const b of buttons) expect(b, b).toContain("min-height:44px");
  });

  it("uses the tone system only: no hex or rgb colour in the new screens", () => {
    for (const code of [src, marker]) expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("the sections render on the server in their desktop default (all open) with nothing hidden from the first paint", () => {
    const html = clean(renderToString(createElement(SettingsSection, { id: "x", title: "T", defaultOpen: true, defaultOpenNarrow: false, children: createElement("p", null, "BODY") })));
    expect(html).toContain("BODY");
    expect(html).toContain('aria-expanded="true"');
  });

  it("switching tabs scrolls the strip to the selected tab and, on a phone, to the top of the new content", () => {
    const client = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(client).toContain('inline: "center"');
    expect(client).toContain('strip.scrollIntoView({ block: "start" })');
    expect(client).toMatch(/shownTab\.current !== tab && narrow/);
  });
});

describe("the warnings before a bid is submitted or revised", () => {
  const bids = read("src/components/tender/BidsTab.tsx");

  it("both Submit bid and Revise bid go through the warning step, which asks the BOQ for its totals and then lets the person continue", () => {
    expect(bids).toMatch(/data-guide="tender\.bid\.submit"[^\n]*warnThen\(\(\) => setAskSubmit\(true\)\)/);
    expect(bids).toMatch(/data-guide="tender\.bid\.revise"[^\n]*warnThen\(revise\)/);
    expect(bids).toContain("/boq`");
    expect(bids).toContain("Go on");
  });

  it("only warns: the dialog is a confirm the person can accept, and the submit route gained no new refusal", () => {
    expect(bids).toMatch(/if \(warnings\.length > 0 && !\(await confirm\(/);
    const route = read("src/app/api/opportunities/[id]/tender/bids/route.ts");
    expect(route).not.toMatch(/unpriced|stale|submitWarnings|bond_status/);
  });

  it("the deal page hands the Bids tab what it knows: the lines' prices, the approval, the guarantee and the workspace's price validity", () => {
    const client = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(client).toMatch(/checks=\{\{[\s\S]*priceValidityDays[\s\S]*unpricedFromLines[\s\S]*approvedGo[\s\S]*guarantee/);
    expect(read("src/app/(app)/pipeline/[id]/page.tsx")).toContain("priceValidityDays={priceValidityDays(tenant?.config ?? null)}");
  });
});

describe("the new words", () => {
  it("the tender screens say Bid end date, Change requests and Bid guarantee, never the old labels", () => {
    const files = [
      "src/app/(app)/pipeline/new/tender/NewTenderForm.tsx", "src/app/(app)/pipeline/TendersPanel.tsx", "src/components/tender/ClosingChip.tsx", "src/components/tender/BondChip.tsx",
      "src/components/tender/BondRelease.tsx", "src/components/tender/TenderStatStrip.tsx", "src/app/(app)/pipeline/[id]/TenderOverview.tsx", "src/app/(app)/pipeline/[id]/BidDecisionMarker.tsx",
    ];
    for (const f of files) {
      const text = read(f).replace(/data-guide="[^"]*"|\/\/.*$/gm, "");
      expect(text, f).not.toMatch(/label="Closing date"|"Closing"|Closes in|Close by|Addenda|Bid bond|Release bond|>Bond:/);
    }
  });

  it("the Pipeline's tender board says Bid ends, and a standard deal board still says Close by", () => {
    expect(read("src/app/(app)/pipeline/TendersPanel.tsx")).toContain('closeLabel="Bid ends"');
    expect(read("src/app/(app)/pipeline/PipelineBoard.tsx")).toContain('closeLabel = "Close by"');
  });
});

describe("the bid decision panel", () => {
  it("is the shared side panel (a bottom sheet under 780 px), not a hand-rolled popover", () => {
    const marker = read("src/app/(app)/pipeline/[id]/BidDecisionMarker.tsx");
    expect(marker).toContain('import SidePanel from "@/components/ui/SidePanel"');
    expect(marker).toContain("<SidePanel ");
  });

  it("the old Bid decision section and the manual Move to buttons are gone from the page", () => {
    const body = read("src/app/(app)/pipeline/[id]/BidDecision.tsx");
    expect(body).not.toMatch(/Move to Estimating|Move to No-bid|tender\.decision\.advance/);
    expect(read("src/app/(app)/pipeline/[id]/TenderOverview.tsx")).not.toContain("<BidDecision ");
  });
});
