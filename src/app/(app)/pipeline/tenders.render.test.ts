import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const nav = vi.hoisted(() => ({ tab: null as string | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(nav.tab ? { tab: nav.tab } : {}),
  usePathname: () => "/pipeline",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import PipelineTabs from "./PipelineTabs";
import TenderTab from "./[id]/TenderTab";
import ClosingChip from "@/components/tender/ClosingChip";
import { DEFAULT_OPPORTUNITY_STAGES, DEFAULT_TENDER_STAGES } from "@/lib/constants";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { TenderBoardRow, TenderView } from "@/lib/tender/views";

// The tender screens render, with the right things on them and none of their explanations printed (6b). This is a server
// render of the real components with sample rows; the layout itself (one column under 900 px) comes from the kit classes
// these screens reuse (.fg2, .kpi-grid, the board's own scroller), and is checked separately in the browser.

const NOW = "2026-10-25T09:00:00.000Z";
const TZ = "Asia/Riyadh";

const base = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id, tenant_id: "t1", ref: `OPP-${id}`, account_id: "a1", contact_id: null, lead_id: null, source: "direct", source_campaign_id: null, title, description: null,
  stage: "qualify", outcome: "open", loss_reason: null, loss_note: null, expected_close: null, amount: 0, currency: null, probability: 20, probability_override: null,
  probability_override_reason: null, owner_id: "u1", team: [], competitor: null, approval_status: null, custom_data: null, created_by: "u1",
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closed_at: null, account_name: "Acme", stage_since: "2026-10-01T00:00:00Z", ...over,
});
const deals = [base("1", "A plain elevator deal")] as never[];
const tenders = [
  { ...base("2", "ARB-1 · Aramco", { stage: "estimating", probability: 25 }), tender: { tender_no: "ARB-1", issuer_name: "Aramco", portal: "ariba", closing_at: "2026-10-27T09:00:00.000Z", decision: null } },
  { ...base("3", "ARB-2 · SEC", { stage: "received", probability: 10 }), tender: { tender_no: "ARB-2", issuer_name: "SEC", portal: "email", closing_at: "2026-12-01T09:00:00.000Z", decision: null } },
  { ...base("4", "ARB-3 · Submitted one", { stage: "submitted", probability: 40 }), tender: { tender_no: "ARB-3", issuer_name: "NEOM", portal: "excel", closing_at: "2026-10-26T09:00:00.000Z", decision: "go" } },
] as unknown as TenderBoardRow[];

const html = (tab: string | null, over: Partial<Parameters<typeof PipelineTabs>[0]> = {}) => {
  nav.tab = tab;
  return renderToString(createElement(PipelineTabs, {
    deals: deals as never, dealStages: DEFAULT_OPPORTUNITY_STAGES, tenders, tenderStages: DEFAULT_TENDER_STAGES, tendersPending: false,
    members: [{ user_id: "u1", name: "Abdul", email: null }], accounts: [{ id: "a1", name: "Acme" }], todayKey: "2026-10-25", currentUserId: "u1", nowIso: NOW, timezone: TZ, ...over,
  })).replace(/<!-- -->/g, "");
};

describe("the Pipeline with the tender edition", () => {
  it("opens on Deals: the standard board without the tender deals, and the usual New Deal button", () => {
    const out = html(null);
    expect(out).toContain("+ New Deal");
    expect(out).toContain("A plain elevator deal");
    for (const t of ["ARB-1", "ARB-2", "ARB-3"]) expect(out).not.toContain(t);
    expect(out).toContain(">Tenders<");
    expect(out).toMatch(/aria-selected="true"[^>]*data-guide="tab:deals"|data-guide="tab:deals"[^>]*aria-selected="true"/);
    expect(out).toContain("Qualify");
    expect(out).not.toContain("Estimating");
  });

  it("the Tenders tab has its own button, the tender stages, the tender cards and no standard deal", () => {
    const out = html("tenders");
    expect(out).toContain("+ New tender");
    expect(out).not.toContain("+ New Deal");
    expect(out).not.toContain("A plain elevator deal");
    for (const label of ["Received", "Bid/No-bid", "Estimating", "Submitted", "Clarifications"]) expect(out).toContain(label);
    expect(out).not.toContain("Qualify");
    expect(out).toContain("ARB-1 · Aramco");
    expect(out).toContain("/pipeline/2");
  });

  it("'Closing soon' lists the tenders still facing their deadline, soonest first, with a countdown in words", () => {
    const out = html("tenders");
    expect(out).toContain("Closing soon");
    expect(out).toContain('data-guide="tender.closing_soon"');
    expect(out).toContain("Closes in 2 days"); // ARB-1, amber
    expect(out).toMatch(/data-tone="amber"/);
    // ARB-3 is submitted: it is on the board but no longer a deadline, and ARB-2 is six weeks out.
    const listStart = out.indexOf('data-guide="tender.closing_soon"');
    const list = out.slice(listStart, out.indexOf("Show all", listStart) > 0 ? undefined : listStart + 1500);
    expect(list).toContain("ARB-1");
    expect(list).not.toContain("ARB-3");
  });

  it("prints none of its explanations: they sit behind the i", () => {
    const out = html("tenders");
    for (const tip of Object.values(TENDER_TIPS)) expect(out).not.toContain(tip);
    expect(out).toContain('aria-label="About Tenders"');
    expect(out).toContain('aria-label="About Closing soon"');
  });

  it("says plainly, and keeps the board off, while migration 0220 is pending", () => {
    const out = html("tenders", { tenders: [], tendersPending: true });
    expect(out).toContain("migration 0220");
    expect(out).toContain('role="alert"');
    expect(out).not.toContain("Closing soon");
  });

  it("an empty Tenders tab shows the empty board and an empty 'Closing soon'", () => {
    const out = html("tenders", { tenders: [] });
    expect(out).toContain("Nothing closes in the next 14 days");
    expect(out).toContain("Nothing here");
  });
});

describe("the closing-date chip", () => {
  const chip = (closingAt: string | null, closed = false) => renderToString(createElement(ClosingChip, { closingAt, nowIso: NOW, timezone: TZ, closed }));

  it("is calm, amber or red by days left, and says it in words", () => {
    expect(chip("2026-11-20T09:00:00Z")).toMatch(/data-tone="ok"[\s\S]*Closes in 26 days/);
    expect(chip("2026-10-29T09:00:00Z")).toMatch(/data-tone="amber"[\s\S]*Closes in 4 days/);
    expect(chip("2026-10-26T09:00:00Z")).toMatch(/data-tone="red"[\s\S]*Closes tomorrow/);
    expect(chip("2026-10-24T09:00:00Z")).toMatch(/data-tone="red"[\s\S]*Closed yesterday/);
    expect(chip(null)).toMatch(/data-tone="none"[\s\S]*No closing date/);
  });

  it("stops counting down once the bid is in or the tender is closed", () => {
    const out = chip("2026-10-26T09:00:00Z", true);
    expect(out).toContain('data-tone="none"');
    expect(out).not.toContain("Closes");
  });
});

describe("the Tender tab of a deal", () => {
  const view: TenderView = {
    tender_no: "ARB-4400123", issuer_name: "Saudi Aramco", issuer_account_id: null, portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z",
    bid_bond_amount: 96000, bid_bond_currency: "SAR", bid_bond_expiry: "2027-01-30", addenda_count: 2, decision: "go", decision_reason: null,
    decided_by_name: "A. Nasser", decided_at: "2026-10-21T08:00:00.000Z", source_email_id: null,
  };
  const out = renderToString(createElement(TenderTab, {
    opportunityId: "o1", tender: view, accounts: [{ id: "a1", name: "Acme" }], nowIso: NOW, timezone: TZ, finished: false, onError: () => {}, onNotice: () => {},
  }));

  it("has the details, the bid decision and the bond as sections that open and close", () => {
    for (const title of ["Tender details", "Bid decision", "Bid bond"]) expect(out).toContain(title);
    expect(out.match(/aria-expanded="(true|false)"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(out).toContain('data-guide="tender.tab"');
  });

  it("shows the recorded decision with who decided, and the bond as a one-line digest", () => {
    expect(out).toContain("Go");
    expect(out).toContain("A. Nasser");
    expect(out).toContain("SAR 96,000");
    expect(out).toContain("valid to 30 Jan 2027");
  });

  it("offers Go and No-go as two large buttons and a Record decision button, and the countdown", () => {
    expect(out).toContain('data-guide="tender.decision.go"');
    expect(out).toContain('data-guide="tender.decision.no_go"');
    expect(out).toContain('data-guide="tender.decision.save"');
    expect(out).toContain("Closes in 5 days");
  });

  it("prints none of its explanations", () => {
    for (const tip of Object.values(TENDER_TIPS)) expect(out).not.toContain(tip);
  });
});
