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

import VariationsTab, { outcomeSentence } from "./VariationsTab";
import InvoicingTab from "./InvoicingTab";
import ProjectOverview from "./ProjectOverview";
import { BidAgainstBudgetCard, ProjectOriginCard } from "./ProjectOriginCards";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { budgetTotals, plannedMargin } from "@/lib/contractProjects/budget";
import { variationTotals } from "@/lib/contractProjects/variations";
import { milestoneTotals } from "@/lib/contractProjects/milestones";
import type { VariationsData, VariationView } from "@/lib/contractProjects/variationsServer";
import type { MilestonesData, MilestoneView } from "@/lib/contractProjects/milestonesServer";
import type { ProjectView } from "@/lib/contractProjects/view";
import type { ProjectOrigin } from "@/lib/contractProjects/originServer";
import { statusChoices } from "./MilestonePanel";

// The after-award screens render, with the right things on them and none of their explanations printed (6b). A server render of the real
// components with sample data; the layout rules for 375 px and PC (the table scrolls inside its own container, 44 px targets, the shared
// side panel that is a bottom sheet on a phone, no colour of its own) are read from the markup and the source.

const ROOT = path.resolve(__dirname, "../../..");
const clean = (s: string) => s.replace(/<!-- -->/g, "");
const src = (f: string) => readFileSync(path.join(ROOT, "src/components/contractProjects", f), "utf8");

const variation = (over: Partial<VariationView> = {}): VariationView => ({
  id: "v1", project_id: "p1", ref: "VAR-0001", title: "Extra gate", description: "A second gate on the east side", status: "draft", amount: 5000, cost_amount: 3000, change_request_ref: "CR-7", note: null,
  submitted_by: null, submitted_at: null, decided_by: null, decided_at: null, budget_revision_id: null, created_by: "u1", created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z",
  submitted_by_name: null, decided_by_name: null, revision_no: null, can_decide: false, mine: false, ...over,
});
const vdata = (rows: VariationView[], over: Partial<VariationsData> = {}): VariationsData => ({
  variations: rows, totals: variationTotals(rows, 105000), currency: "SAR", pending: false, canEdit: true, ...over,
});
const vtab = (d: VariationsData, panel?: { id?: string }) => clean(renderToString(createElement(VariationsTab, { projectId: "p1", data: d, initialPanel: panel })));

const milestone = (over: Partial<MilestoneView> = {}): MilestoneView => ({
  id: "m1", project_id: "p1", title: "Advance", due_date: "2026-11-15", basis: "percent", percent: 30, fixed_amount: null, status: "planned", invoice_id: null, sort_order: 10, note: null,
  created_by: "u1", created_at: "", updated_at: "", amount: 31500, display_status: "planned", invoice_ref: null, invoice_status: null, ...over,
});
const mdata = (rows: MilestoneView[], over: Partial<MilestonesData> = {}): MilestonesData => ({
  milestones: rows, totals: milestoneTotals(rows.map((r) => ({ ...r, invoice_status: r.invoice_status })), 105000), currency: "SAR", pending: false, canEdit: true, invoicesOn: true, hasCustomer: true, tax: { kind: "added", label: "VAT", rate: 15, source: "einvoice" }, ...over,
});
const itab = (d: MilestonesData, panel?: { id?: string }, closed = false) => clean(renderToString(createElement(InvoicingTab, { projectId: "p1", data: d, initialPanel: panel, projectClosed: closed })));

describe("the Variations tab", () => {
  const rows = [
    variation({ status: "approved", amount: 5000, cost_amount: 3000, revision_no: 1, decided_by_name: "A. Nasser", decided_at: "2026-10-22T00:00:00Z" }),
    variation({ id: "v2", ref: "VAR-0002", title: "Omit the gate", amount: -2000, cost_amount: -1200, status: "submitted", submitted_by_name: "Sara", submitted_at: "2026-10-23T00:00:00Z", can_decide: true }),
  ];
  const out = vtab(vdata(rows));

  it("opens with three tiles: approved variations, the revised contract value (with the original), and what waits", () => {
    expect(out).toContain('data-guide="cp.variations.kpis"');
    expect(out).toContain("Approved variations");
    expect(out).toContain("+SAR 5,000");
    expect(out).toContain("Revised contract value");
    expect(out).toContain("SAR 105,000");
    expect(out).toContain("original SAR 100,000");
    expect(out).toContain("Waiting for approval");
    expect(out).toContain("-SAR 2,000");
    expect(out).toContain('data-tone="warn"');
  });

  it("is one table: title with ref and change request, the status, the signed change in contract value and in cost", () => {
    expect(out).toContain('data-guide="cp.variations.table"');
    expect(out).toContain("Extra gate");
    expect(out).toContain("VAR-0001 · CR CR-7");
    expect(out).toContain("Approved");
    expect(out).toContain("Waiting for approval");
    expect(out).toContain("-SAR 1,200");
    expect(out.match(/<table/g)).toHaveLength(1);
  });

  it("prints none of the explanations; they sit behind the i", () => {
    for (const tip of [PROJECT_TIPS.variations]) expect(out).not.toContain(tip);
    expect(out).toContain("About Approved variations");
  });

  it("has + Add variation for someone who can edit, and not for a view-only person", () => {
    expect(out).toContain('data-guide="cp.variation.add"');
    expect(vtab(vdata(rows, { canEdit: false }))).not.toContain('data-guide="cp.variation.add"');
  });

  it("an empty list says what to do next; a pending migration is stated", () => {
    expect(vtab(vdata([]))).toContain("No variations yet");
    expect(vtab(vdata([], { pending: true }))).toContain("migration 0231");
  });

  it("a long list shows a few rows and Show all", () => {
    const many = Array.from({ length: 14 }, (_, i) => variation({ id: `v${i}`, ref: `VAR-${String(i + 1).padStart(4, "0")}`, title: `Change ${i + 1}` }));
    const long = vtab(vdata(many));
    expect(long).toContain("Show all 14");
    expect(long).toContain("Change 10");
    expect(long).not.toContain("Change 11");
  });

  it("the table scrolls inside its own container and every row and button is a 44 px target", () => {
    expect(out).toMatch(/overflow-x:auto/);
    const s = src("VariationsTab.tsx");
    expect(s.match(/minHeight: (44|52)/g)!.length).toBeGreaterThanOrEqual(3);
    expect(s).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  describe("the side panel", () => {
    it("a new variation: title, the two signed amounts, change request, what changed, a note, and Save only", () => {
      const p = vtab(vdata(rows), {});
      expect(p).toContain('data-guide="cp.variation.panel"');
      for (const g of ["cp.variation.field.title", "cp.variation.field.amount", "cp.variation.field.cost", "cp.variation.field.change_request", "cp.variation.field.description", "cp.variation.save"]) expect(p, g).toContain(`data-guide="${g}"`);
      expect(p).not.toContain("cp.variation.send");
      expect(p).not.toContain("cp.variation.remove");
      expect(p).toContain('role="dialog"');
    });

    it("a draft can be saved, sent for approval or removed", () => {
      const p = vtab(vdata([variation()]), { id: "v1" });
      for (const g of ["cp.variation.save", "cp.variation.send", "cp.variation.remove"]) expect(p, g).toContain(`data-guide="${g}"`);
      expect(p).toContain('value="Extra gate"');
      expect(p).toContain('value="5000"');
    });

    it("one waiting for approval: an approver sees Approve and Reject, the sender Withdraw, the fields are locked", () => {
      const waiting = variation({ status: "submitted", submitted_by_name: "Sara", can_decide: true, mine: false });
      const approver = vtab(vdata([waiting]), { id: "v1" });
      expect(approver).toContain('data-guide="cp.variation.approve"');
      expect(approver).toContain('data-guide="cp.variation.reject"');
      expect(approver).not.toContain('data-guide="cp.variation.save"');
      expect(approver).toMatch(/<input[^>]*value="Extra gate"[^>]*disabled|<input[^>]*disabled[^>]*value="Extra gate"/);
      const sender = vtab(vdata([{ ...waiting, can_decide: false, mine: true }]), { id: "v1" });
      expect(sender).toContain('data-guide="cp.variation.withdraw"');
      expect(sender).not.toContain('data-guide="cp.variation.approve"');
      const other = vtab(vdata([{ ...waiting, can_decide: false, mine: false }]), { id: "v1" });
      expect(other).toContain("An approver will decide it");
    });

    it("an approved one is read-only and links to the budget revision it opened", () => {
      const p = vtab(vdata([variation({ status: "approved", revision_no: 2, decided_by_name: "A. Nasser", decided_at: "2026-10-22T00:00:00Z" })]), { id: "v1" });
      expect(p).toContain("Approved by A. Nasser");
      expect(p).toContain("Budget revision 2");
      expect(p).toContain("/contract-projects/p1?tab=revisions");
      expect(p).not.toContain('data-guide="cp.variation.save"');
    });

    it("a rejected one says so and can be changed and sent again", () => {
      const p = vtab(vdata([variation({ status: "rejected", decided_by_name: "A. Nasser" })]), { id: "v1" });
      expect(p).toContain("This variation was rejected");
      expect(p).toContain('data-guide="cp.variation.send"');
    });
  });

  it("says in one sentence what an approval did to the budget", () => {
    expect(outcomeSentence({ status: "approved", contract_value: 105000, revision: "started", revision_no: 2 }, "SAR")).toBe("The contract value is now SAR 105,000. Budget revision 2 was opened for the cost.");
    expect(outcomeSentence({ status: "approved", contract_value: 105000, revision: "already_open" }, "SAR")).toContain("add the cost there");
    expect(outcomeSentence({ status: "approved", contract_value: 105000, revision: "no_baseline" }, "SAR")).toContain("baseline");
    expect(outcomeSentence({ status: "rejected", revision: null }, "SAR")).toContain("Rejected");
  });
});

describe("the Invoicing tab", () => {
  const rows = [
    milestone(),
    milestone({ id: "m2", title: "Mobilisation", basis: "fixed", percent: null, fixed_amount: 10000, amount: 10000, status: "invoiced", display_status: "invoiced", invoice_id: "i2", invoice_ref: "INV-0002", invoice_status: "sent" }),
  ];
  const out = itab(mdata(rows));

  it("opens with three tiles: contracted, invoiced, still to invoice", () => {
    expect(out).toContain('data-guide="cp.invoicing.kpis"');
    expect(out).toContain("Contracted");
    expect(out).toContain("SAR 105,000");
    expect(out).toContain("Invoiced");
    expect(out).toContain("SAR 10,000");
    expect(out).toContain("Still to invoice");
    expect(out).toContain("SAR 95,000");
    expect(out).toContain("90% of the contract");
  });

  it("is one table: the milestone with its due date, the amount (and percent), the status, and the invoice or the button to make one", () => {
    expect(out).toContain('data-guide="cp.invoicing.table"');
    expect(out).toContain("due 15 Nov 2026");
    expect(out).toContain("SAR 31,500");
    expect(out).toContain("30%");
    expect(out).toContain("Ready to invoice".slice(0, 0) + "Planned");
    expect(out).toContain("/invoices/i2");
    expect(out).toContain("INV-0002");
    expect(out).toContain('data-guide="cp.milestone.create_invoice"');
    expect(out.match(/<table/g)).toHaveLength(1);
  });

  it("Create invoice is offered only to someone who can edit, with the Invoices module on, a customer on the project, and an open project", () => {
    expect(itab(mdata(rows, { canEdit: false }))).not.toContain("cp.milestone.create_invoice");
    expect(itab(mdata(rows, { invoicesOn: false }))).not.toContain("cp.milestone.create_invoice");
    const noCustomer = itab(mdata(rows, { hasCustomer: false }));
    expect(noCustomer).not.toContain("cp.milestone.create_invoice");
    expect(noCustomer).toContain("no customer yet");
    expect(itab(mdata(rows), undefined, true)).not.toContain("cp.milestone.create_invoice");
  });

  it("each row says the amount is before tax: with Saudi VAT the figure with VAT, with no tax set 'No tax configured', and the panel says the same", () => {
    const withVat = itab(mdata(rows));
    expect(withVat).toContain("Amount before tax");
    expect(withVat).toContain('data-guide="cp.milestone.tax"');
    expect(withVat).toContain("Before VAT 15%");
    expect(withVat).toContain("with VAT");
    const none = itab(mdata(rows, { tax: { kind: "none" } }));
    expect(none).toContain("No tax configured");
    expect(none).not.toContain("with VAT");
    const panel = itab(mdata(rows), { id: rows[0].id });
    expect(panel).toContain("Before VAT 15%. With VAT: ");
    expect(itab(mdata(rows, { tax: { kind: "none" } }), { id: rows[0].id })).toContain("No tax configured");
  });

  it("a schedule that passes 100 percent is warned about in plain sight (not behind an i), and nothing is blocked", () => {
    const over = itab(mdata([milestone({ percent: 70 }), milestone({ id: "m2", percent: 70 })]));
    expect(over).toContain('data-guide="cp.invoicing.warning"');
    expect(over).toContain("add up to 140%");
    expect(out).not.toContain('data-guide="cp.invoicing.warning"');
  });

  it("prints none of the explanations, shows + Add milestone, and states an empty list and a pending migration", () => {
    for (const tip of [PROJECT_TIPS.milestones, PROJECT_TIPS.stillToInvoice]) expect(out).not.toContain(tip);
    expect(out).toContain('data-guide="cp.milestone.add"');
    expect(itab(mdata([]))).toContain("No milestones yet");
    expect(itab(mdata([], { pending: true }))).toContain("migration 0232");
    expect(itab(mdata(rows, { canEdit: false }))).not.toContain('data-guide="cp.milestone.add"');
  });

  it("the side panel: title, due date, amount as percent or fixed, the bill it works out, status choices for an existing one, Save and Remove", () => {
    const p = itab(mdata(rows), { id: "m1" });
    for (const g of ["cp.milestone.panel", "cp.milestone.field.title", "cp.milestone.field.due", "cp.milestone.field.basis", "cp.milestone.field.percent", "cp.milestone.field.status", "cp.milestone.save", "cp.milestone.remove"]) expect(p, g).toContain(`data-guide="${g}"`);
    expect(p).toContain("SAR 31,500");
    expect(p).toContain('role="dialog"');
    const fresh = itab(mdata(rows), {});
    expect(fresh).not.toContain("cp.milestone.field.status");
    expect(fresh).not.toContain("cp.milestone.remove");
    // Once invoiced the amount is locked and the milestone cannot be removed.
    const locked = itab(mdata(rows), { id: "m2" });
    expect(locked).not.toContain("cp.milestone.remove");
    expect(locked).toMatch(/<select[^>]*disabled/);
  });

  it("the status a person may choose follows where the milestone stands", () => {
    expect(statusChoices("planned")).toEqual(["planned", "ready"]);
    expect(statusChoices("ready")).toEqual(["planned", "ready"]);
    expect(statusChoices("invoiced")).toEqual(["invoiced", "paid"]);
    expect(statusChoices("paid")).toEqual(["paid"]);
  });

  it("the table scrolls inside its own container and every control is a 44 px target; no colour of its own", () => {
    expect(out).toMatch(/overflow-x:auto/);
    for (const f of ["InvoicingTab.tsx", "MilestonePanel.tsx", "VariationPanel.tsx", "ProjectOriginCards.tsx"]) {
      const s = src(f);
      expect(s, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
    expect(src("InvoicingTab.tsx").match(/minHeight: (44|52)/g)!.length).toBeGreaterThanOrEqual(4);
    expect(src("MilestonePanel.tsx").match(/minHeight: 44/g)!.length).toBeGreaterThanOrEqual(2);
    expect(src("VariationPanel.tsx").match(/minHeight: 44/g)!.length).toBeGreaterThanOrEqual(6);
  });
});

describe("where the project came from, and the bid against the budget", () => {
  const origin: ProjectOrigin = {
    deal: { id: "o1", ref: "OPP-1", title: "ARB-1" }, bid: { version_no: 2, submitted_at: "2026-10-12T08:00:00Z", total: 22000, currency: "SAR" },
    boq: { file_name: "ARB-1-BOQ.xlsx", uploaded_at: "2026-10-05T00:00:00Z", version: 2 }, estimates: [{ id: "e1", ref: "EST-0003", name: "Fence build-up" }],
  };

  it("the origin card links the tender, the bid version (number, date, price), the BOQ file and each estimate used, all read-only links", () => {
    const out = clean(renderToString(createElement(ProjectOriginCard, { origin })));
    expect(out).toContain('data-guide="cp.origin"');
    expect(out).toContain("/pipeline/o1");
    expect(out).toContain("/pipeline/o1?tab=bids");
    expect(out).toContain("Version 2 · 12 Oct 2026 · SAR 22,000");
    expect(out).toContain("/pipeline/o1?tab=boq");
    expect(out).toContain("ARB-1-BOQ.xlsx");
    expect(out).toContain("/estimates/e1");
    expect(out).toContain("EST-0003");
    expect(out).not.toContain(PROJECT_TIPS.origin);
    expect(out).not.toContain("<input");
  });

  it("says plainly when there is no bid version, BOQ file or estimate", () => {
    const out = clean(renderToString(createElement(ProjectOriginCard, { origin: { ...origin, bid: null, boq: null, estimates: [] } })));
    expect(out).toContain("No bid version");
    expect(out).toContain("No BOQ file");
    expect(out).toContain("None used");
  });

  it("the bid card shows the bid's cost, the budget now, the difference with a word as well as a colour, and the two margins", () => {
    const bid = { available: true as const, version_no: 2, figures: { bid_price: 100000, bid_cost: 80000, budget: 84000, delta: 4000, delta_pct: 5, bid_margin_pct: 20, planned_margin_pct: 19.2 } };
    const out = clean(renderToString(createElement(BidAgainstBudgetCard, { bid, currency: "SAR" })));
    expect(out).toContain("Cost in bid 2");
    expect(out).toContain("SAR 80,000");
    expect(out).toContain("SAR 84,000");
    expect(out).toContain("+SAR 4,000 · +5%");
    expect(out).toContain("Over the bid");
    expect(out).toContain("20% → 19.2%");
    expect(clean(renderToString(createElement(BidAgainstBudgetCard, { bid: { ...bid, figures: { ...bid.figures, delta: -500, delta_pct: -0.6 } }, currency: "SAR" })))).toContain("Under the bid");
    expect(clean(renderToString(createElement(BidAgainstBudgetCard, { bid: { available: false as const, version_no: 1 }, currency: "SAR" })))).toContain("submitted before bid costs were stored");
  });

  it("the Overview carries the two cards when the project came from a tender, and drops the duplicate Tender row from Details", () => {
    const lines = [{ id: "i1", line_key: "k1", line_no: 1, resource_code: "11", cost_code: null, wbs: null, description: "Fence", qty: 1, unit: "m", unit_cost: 100, amount: 100, cost_known: true, source_ref: null, reserve: false, committed: null, actual: null }];
    const totals = budgetTotals(lines);
    const base = {
      project: { id: "p1", tenant_id: "t", ref: "CPR-0001", name: "ARB-1 Fence", account_id: "a", source_opportunity_id: "o1", status: "draft", contract_value: 30000, currency: "SAR", planned_start: null, planned_end: null, manager_id: null, erp_system: null, erp_id: null, custom_data: null, created_by: "u1", created_at: "", updated_at: "" },
      account_name: "Aramco", manager_name: null, source: { id: "o1", ref: "OPP-1", title: "ARB-1" }, revisions: [], revision: null, lines, totals, margin: plannedMargin(30000, totals.total), compare: null,
      resources: [{ code: "11", name: "Material", revenue_side: false }], justifications: [], approval: { pending: null, canDecide: false, askBlocked: null, history: [] }, canEdit: true, needsApprovalUpdate: false,
    } as unknown as ProjectView;
    const bid = { available: false as const, version_no: 2 };
    const withCards = clean(renderToString(createElement(ProjectOverview, { view: { ...base, origin, bidAgainstBudget: bid } })));
    expect(withCards).toContain('data-guide="cp.origin"');
    expect(withCards).toContain('data-guide="cp.bidvs"');
    expect(withCards.match(/>Tender</g) ?? []).toHaveLength(1); // the origin card's row, not a second one in Details
    const without = clean(renderToString(createElement(ProjectOverview, { view: base })));
    expect(without).not.toContain('data-guide="cp.origin"');
    expect(without).toContain(">Tender<");
  });
});

describe("the record page", () => {
  const page = readFileSync(path.join(ROOT, "src/app/(app)/contract-projects/[id]/page.tsx"), "utf8");
  it("has Variations and Invoicing between Budget and Revisions, each loading its own data only when its tab is open", () => {
    const ids = [...page.matchAll(/id: "(\w+)", label/g)].map((m) => m[1]);
    expect(ids).toEqual(["overview", "budget", "variations", "invoicing", "revisions", "handover", "activity"]);
    expect(page).toContain("<VariationsSection");
    expect(page).toContain("<InvoicingSection");
    const sections = src("AfterAwardSections.tsx");
    expect(sections).toContain("export async function VariationsSection");
    expect(sections).toContain("export async function InvoicingSection");
  });
});
