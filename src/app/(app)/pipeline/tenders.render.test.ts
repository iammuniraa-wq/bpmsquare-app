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
import BidDecisionMarker from "./[id]/BidDecisionMarker";
import ClosingChip from "@/components/tender/ClosingChip";
import { DEFAULT_OPPORTUNITY_STAGES, DEFAULT_TENDER_STAGES } from "@/lib/constants";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { TenderBoardRow, TenderView } from "@/lib/tender/views";
import type { ApprovalEntry, ApprovalView } from "@/lib/tender/approval";

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

  it("'Bids ending soon' lists the tenders still facing their deadline, soonest first, with a countdown in words", () => {
    const out = html("tenders");
    expect(out).toContain("Bids ending soon");
    expect(out).toContain('data-guide="tender.closing_soon"');
    expect(out).toContain("Bid ends in 2 days"); // ARB-1, amber
    expect(out).toMatch(/data-tone="amber"/);
    // ARB-3 is submitted: it is on the board but no longer a deadline, and ARB-2 is six weeks out.
    const listStart = out.indexOf('data-guide="tender.closing_soon"');
    const list = out.slice(listStart, out.indexOf("Show all", listStart) > 0 ? undefined : listStart + 1500);
    expect(list).toContain("ARB-1");
    expect(list).not.toContain("ARB-3");
  });

  it("shows how many Deal Room messages are unread on a tender, on the board and in 'Bids ending soon', and nothing when none", () => {
    const withRoom = tenders.map((t, i) => (i === 0 ? { ...t, tender: { ...t.tender, room_unread: 3 } } : t)) as TenderBoardRow[];
    const out = html("tenders", { tenders: withRoom });
    expect(out).toContain('data-guide="tender.room_unread"');
    expect(out.match(/3 new in Room/g)?.length).toBe(2);
    expect(html("tenders")).not.toContain("new in Room");
  });

  it("prints none of its explanations: they sit behind the i", () => {
    const out = html("tenders");
    for (const tip of Object.values(TENDER_TIPS)) expect(out).not.toContain(tip);
    expect(out).toContain('aria-label="About Tenders"');
    expect(out).toContain('aria-label="About Bids ending soon"');
  });

  it("says plainly, and keeps the board off, while migration 0220 is pending", () => {
    const out = html("tenders", { tenders: [], tendersPending: true });
    expect(out).toContain("migration 0220");
    expect(out).toContain('role="alert"');
    expect(out).not.toContain("Bids ending soon");
  });

  it("an empty Tenders tab shows the empty board and an empty 'Bids ending soon'", () => {
    const out = html("tenders", { tenders: [] });
    expect(out).toContain("No bid ends in the next 14 days");
    expect(out).toContain("Nothing here");
  });
});

describe("the bid end date chip", () => {
  const chip = (closingAt: string | null, closed = false) => renderToString(createElement(ClosingChip, { closingAt, nowIso: NOW, timezone: TZ, closed }));

  it("is calm, amber or red by days left, and says it in words", () => {
    expect(chip("2026-11-20T09:00:00Z")).toMatch(/data-tone="ok"[\s\S]*Bid ends in 26 days/);
    expect(chip("2026-10-29T09:00:00Z")).toMatch(/data-tone="amber"[\s\S]*Bid ends in 4 days/);
    expect(chip("2026-10-26T09:00:00Z")).toMatch(/data-tone="red"[\s\S]*Bid ends tomorrow/);
    expect(chip("2026-10-24T09:00:00Z")).toMatch(/data-tone="red"[\s\S]*Bid ended yesterday/);
    expect(chip(null)).toMatch(/data-tone="none"[\s\S]*No bid end date/);
  });

  it("stops counting down once the bid is in or the tender is closed", () => {
    const out = chip("2026-10-26T09:00:00Z", true);
    expect(out).toContain('data-tone="none"');
    expect(out).not.toContain("Bid ends");
  });
});

describe("the bid decision, opened from its marker in the header", () => {
  const view: TenderView = {
    tender_no: "ARB-4400123", issuer_name: "Saudi Aramco", issuer_account_id: null, portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z",
    bid_bond_amount: 96000, bid_bond_currency: "SAR", bid_bond_expiry: "2027-01-30", addenda_count: 2, decision: "go", decision_reason: null,
    decided_by_name: "A. Nasser", decided_at: "2026-10-21T08:00:00.000Z", source_email_id: null,
    bond_status: "held", bond_released_at: null, bond_released_by_name: null,
  };
  const entry = (over: Partial<ApprovalEntry> = {}): ApprovalEntry => ({
    id: "r1", decision: "go", reason: "Strong fit", status: "approved", requested_by_name: "S. Khan", requested_at: "2026-10-20T08:00:00.000Z",
    decided_by_name: "A. Nasser", decided_at: "2026-10-21T08:00:00.000Z", comment: "Go ahead", ...over,
  });
  const approval = (over: Partial<ApprovalView> = {}): ApprovalView => ({ standing: null, recordedBefore: false, pending: null, canDecide: false, proposalBlocked: null, history: [], ...over });
  const render = (v: TenderView, a: ApprovalView | null, open = true) => renderToString(createElement(BidDecisionMarker, {
    opportunityId: "o1", tender: v, approval: a, onError: () => {}, onNotice: () => {}, initialOpen: open,
  })).replace(/<!-- -->/g, "");
  const out = render(view, approval({ standing: entry(), recordedBefore: false }));

  it("is a chip in the header that says where the decision stands, and opens the actions in the shared panel", () => {
    const closed = render(view, approval({ standing: entry() }), false);
    expect(closed).toContain("Bid decision: Go");
    expect(closed).toContain('data-guide="tender.decision.marker"');
    expect(closed).toContain('aria-haspopup="dialog"');
    expect(closed).not.toContain('role="dialog"');
    expect(out).toContain('role="dialog"');
    expect(out).toContain('data-guide="tender.decision"');
  });

  it("shows the approved decision with who approved it, and no Move to buttons: an approved decision moves the deal by itself", () => {
    expect(out).toContain("Approved");
    expect(out).toContain("A. Nasser");
    expect(out).toContain("Strong fit");
    expect(out).not.toContain("Move to Estimating");
    expect(out).not.toContain("Move to No-bid");
    expect(out).not.toContain("tender.decision.advance");
  });

  it("offers a proposal (Go, No-go, a reason) when none is waiting", () => {
    const form = render({ ...view, decision: null }, approval());
    expect(form).toContain("Bid decision: Pending");
    expect(form).toContain('data-guide="tender.decision.propose"');
    expect(form).toContain('data-guide="tender.decision.go"');
    expect(form).toContain('data-guide="tender.decision.no_go"');
    expect(form).toContain('data-guide="tender.decision.save"');
    expect(form).toContain("Ask for approval");
  });

  it("a waiting proposal shows Approve and Reject to an approver, and Withdraw to its proposer, never the form", () => {
    const waiting = render({ ...view, decision: null }, approval({ pending: { ...entry({ status: "pending", decided_by_name: null, decided_at: null, comment: null }), mine: false }, canDecide: true }));
    expect(waiting).toContain("Bid decision: Awaiting approval");
    expect(waiting).toContain("Waiting for approval");
    expect(waiting).toContain('data-guide="tender.decision.approve"');
    expect(waiting).toContain('data-guide="tender.decision.reject"');
    expect(waiting).not.toContain('data-guide="tender.decision.propose"');
    expect(waiting).not.toContain('data-guide="tender.decision.withdraw"');
    const mine = render({ ...view, decision: null }, approval({ pending: { ...entry({ status: "pending" }), mine: true }, canDecide: false }));
    expect(mine).toContain('data-guide="tender.decision.withdraw"');
    expect(mine).not.toContain('data-guide="tender.decision.approve"');
  });

  it("a decision saved before approval was required stays readable and says so", () => {
    const legacy = render(view, approval({ recordedBefore: true }));
    expect(legacy).toContain("Recorded before approval was required");
    expect(legacy).toContain("Bid decision: Go");
  });

  it("with the approval table missing it says a database update is needed", () => {
    expect(render(view, null)).toContain("migration 0221");
  });

  it("prints none of its explanations", () => {
    for (const tip of Object.values(TENDER_TIPS)) expect(out).not.toContain(tip);
  });
});
