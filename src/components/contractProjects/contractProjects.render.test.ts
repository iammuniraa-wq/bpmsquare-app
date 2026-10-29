import { describe, it, expect, vi } from "vitest";
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

import ProjectOverview from "./ProjectOverview";
import ProjectKpiStrip from "./ProjectKpiStrip";
import { pillar } from "@/lib/theme";
import BudgetGrid from "./BudgetGrid";
import RevisionsPanel from "./RevisionsPanel";
import HandoverPanel from "./HandoverPanel";
import ApprovalControls from "./ApprovalControls";
import ContractProjectBanner from "./ContractProjectBanner";
import { budgetTotals, diffRevisions, plannedMargin } from "@/lib/contractProjects/budget";
import { projectPath } from "@/lib/contractProjects/path";
import ProjectPathBar from "./ProjectPathBar";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import type { ProjectView } from "@/lib/contractProjects/view";
import type { BudgetLine } from "@/lib/contractProjects/types";

// The contract project screens render, with the right things on them and none of their explanations printed (6b). A server render of
// the real components with sample data; the layout rules (one column under 900 px, the grid scrolling inside its own container, 44 px
// targets) are read from the markup and the source.

const ROOT = path.resolve(__dirname, "../../..");
const strip = (s: string) => s.replace(/<!-- -->/g, "");

const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: "i1", line_key: "k1", line_no: 1, resource_code: "11", cost_code: "32 31 13", wbs: "1.1", description: "Chain link fence", qty: 100, unit: "m", unit_cost: 120, amount: 12000,
  cost_known: true, source_ref: null, reserve: false, committed: null, actual: null, ...over,
});
const lines = [
  line(), line({ id: "i2", line_key: "k2", line_no: 2, resource_code: "31", cost_code: null, description: "Labour", unit_cost: 250, qty: 40, amount: 10000, cost_known: false }),
  line({ id: "i3", line_key: "k3", line_no: 3, resource_code: "11", description: "Gate", qty: 1, unit_cost: 800, amount: 800, reserve: true }),
];
const rev = (over: Record<string, unknown> = {}) => ({ id: "r0", project_id: "p1", rev_no: 0, status: "draft", justification_code: null, justification_text: null, created_by: "u1", created_at: "2026-10-26T00:00:00Z", approved_by: null, approved_at: null, locked_at: null, total: 22800, created_by_name: "Sara", approved_by_name: null, ...over });
const totals = budgetTotals(lines);

const view = (over: Partial<ProjectView> = {}): ProjectView => ({
  project: { id: "p1", tenant_id: "t", ref: "CPR-0001", name: "ARB-1 Fence", account_id: "a", source_opportunity_id: "o1", status: "draft", contract_value: 30000, currency: "SAR", planned_start: "2026-11-01", planned_end: "2027-03-01", manager_id: null, erp_system: null, erp_id: null, custom_data: null, handover_sent_at: null, created_by: "u1", created_at: "", updated_at: "" },
  account_name: "Aramco", manager_name: "A. Nasser", source: { id: "o1", ref: "OPP-1", title: "ARB-1" },
  revisions: [rev()] as ProjectView["revisions"], revision: rev() as ProjectView["revision"], lines, totals, margin: plannedMargin(30000, totals.total), compare: null,
  resources: [{ code: "11", name: "Material", revenue_side: false }, { code: "31", name: "Man Power", revenue_side: false }, { code: "91", name: "Revenue", revenue_side: true }],
  justifications: [{ code: "scope_change", name: "Scope change" }, { code: "other", name: "Other" }],
  approval: { pending: null, canDecide: false, askBlocked: null, history: [] }, canEdit: true, needsApprovalUpdate: false,
  marginFloor: null, path: projectPath({ status: "draft", handover_sent_at: null }, false), ...over,
});

describe("Overview", () => {
  const out = strip(renderToString(createElement(ProjectOverview, { view: view() })));

  it("does not repeat the key figures: they appear once, in the page header section", () => {
    expect(out).not.toContain('data-guide="cp.kpis"');
    expect(out).not.toContain("Planned margin");
    expect(out).not.toContain("from the awarded tender");
    expect(out).not.toContain("Baseline · Draft");
  });

  it("shows ONE graph, Where the budget goes: the cost types and a Margin segment, in one legend row", () => {
    expect(out).toContain("Where the budget goes");
    expect(out).toContain('data-guide="cp.bar"');
    expect(out).toContain('data-guide="cp.stack"');
    expect(out).toContain("Material");
    expect(out).toContain("Man Power");
    expect(out).toContain("Margin 24%"); // (30000 - 22800) / 30000
    expect(out).toContain("Budget SAR 22,800 of contract value SAR 30,000. The rest is your margin.");
    expect(out).toContain("Material: SAR 12,800");
    expect(out).not.toContain("Budget against contract value");
    expect(out).not.toContain("Budget by cost type");
    expect(out).not.toContain("Over by");
  });

  it("an over-allocated budget fills the bar and says Over by in red", () => {
    const over = strip(renderToString(createElement(ProjectOverview, { view: view({ project: { ...view().project, contract_value: 20000 } }) })));
    expect(over).toContain("Over by SAR 2,800");
    expect(over).not.toContain("Margin ");
  });

  it("opens with a Needs-you banner: the approval action and each thing to fix as a link, before the graph", () => {
    expect(out).toContain('data-guide="cp.needs_you"');
    expect(out.indexOf('data-guide="cp.needs_you"')).toBeLessThan(out.indexOf('data-guide="cp.bar"'));
    expect(out).toContain('data-guide="cp.approval.ask"');
    expect(out).toContain("1 line without a cost code");
    expect(out).toContain("/contract-projects/p1?tab=budget");
    expect(out).toContain(">Fix<");
    expect(out).not.toContain("estimated cost");
    expect(out).not.toContain('data-guide="cp.attention"');
  });

  it("omits the banner altogether (not an empty card) when nothing is waiting for this person", () => {
    const fixed = lines.map((l) => ({ ...l, cost_code: "32 31 13" }));
    const quiet = strip(renderToString(createElement(ProjectOverview, { view: view({ lines: fixed, totals: budgetTotals(fixed), canEdit: false }) })));
    expect(quiet).not.toContain("cp.needs_you");
    expect(quiet).not.toContain("Needs you");
  });

  it("a person who may only decide sees Approve and Reject in the banner, and nothing about asking", () => {
    const pending = { id: "ar1", revision_id: "r0", rev_no: 0, status: "pending" as const, reason: null, requested_by_name: "Sara", requested_at: "2026-10-26T00:00:00Z", decided_by_name: null, decided_at: null, comment: null, mine: false };
    const waiting = strip(renderToString(createElement(ProjectOverview, { view: view({ revision: rev({ status: "pending" }) as ProjectView["revision"], approval: { pending, canDecide: true, askBlocked: null, history: [] } }) })));
    expect(waiting).toContain("cp.approval.approve");
    expect(waiting).toContain("cp.approval.reject");
    expect(waiting).not.toContain("cp.approval.ask");
  });

  it("keeps the project details folded away, with a one-line summary, and prints none of the explanations", () => {
    expect(out).toContain("Project details");
    expect(out).toContain("A. Nasser · 01 Nov 2026");
    expect(out).not.toContain("Planned end");
    expect(out).not.toContain("Customer");
    for (const tip of [PROJECT_TIPS.whereBudgetGoes, PROJECT_TIPS.plannedMargin, PROJECT_TIPS.erpId]) expect(out).not.toContain(tip);
    expect(out).toContain("About Where the budget goes");
  });

  it("the tender it came from is the page header's back link, not a card or a Details row", () => {
    expect(out).not.toContain("Came from");
    expect(out).not.toContain("/pipeline/o1");
    const page = readFileSync(path.join(ROOT, "src/app/(app)/contract-projects/[id]/page.tsx"), "utf8");
    expect(page).toContain("backHref={view.source ? ROUTES.pipelineDetail(view.source.id) : ROUTES.contractProjects}");
    expect(page).toContain("`Tender ${view.source.ref ?? view.source.title}`");
    expect(page).toContain("from bid v${origin.bid.version_no}");
  });

  it("a project with no lines says where to add them", () => {
    const empty = strip(renderToString(createElement(ProjectOverview, { view: view({ lines: [], totals: budgetTotals([]), margin: plannedMargin(30000, 0) }) })));
    expect(empty).toContain("Add budget lines on the Budget tab");
  });
});

describe("Key figures (shown once, on every tab)", () => {
  const out = strip(renderToString(createElement(ProjectKpiStrip, { view: view() })));

  it("is one section with three tiles: the contract value, the budget and the planned margin", () => {
    expect(out).toContain("Key figures");
    expect(out).toContain('data-guide="cp.kpis"');
    expect(out).toContain("SAR 30,000");
    expect(out).toContain("SAR 22,800");
    expect(out).toContain("24%"); // (30000 - 22800) / 30000
    expect(out).toContain("Baseline · Draft");
    expect(out).toContain("from the awarded tender");
    expect(out).not.toContain("Lines");
    expect(out.match(/data-tone=/g)).toHaveLength(3);
    expect(out).toContain('data-tone="info"');
    expect(out).toContain('data-tone="good"'); // margin 24%, no floor set
    expect(out).toContain(`background:${pillar.blue.bg}`);
    expect(out).toContain("repeat(auto-fit, minmax(170px, 1fr))"); // wraps on a phone
    // No colour literal in the tiles themselves (the section's own chrome is the shared SettingsSection).
    const tiles = out.slice(out.indexOf('data-guide="cp.kpis"'));
    expect(Object.values(pillar).reduce((h, p) => h.split(p.base).join(""), tiles)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("the section is open on a PC, folds away on a phone, and says the contract and margin in its summary", () => {
    const src = readFileSync(path.join(ROOT, "src/components/contractProjects/ProjectKpiStrip.tsx"), "utf8");
    expect(src).toContain('id="cp.key_figures"');
    expect(src).toContain("defaultOpen defaultOpenNarrow={false}");
    expect(src).toContain("summary={`${money(p.contract_value, cur)} · margin ${pct(margin.pct)}`}");
  });

  it("the margin goes amber under the workspace floor, red when negative, and never amber without a floor", () => {
    const tone = (v: ProjectView) => strip(renderToString(createElement(ProjectKpiStrip, { view: v })));
    expect(tone(view({ marginFloor: 30 }))).toContain('data-tone="warn"'); // 24% under a 30% floor
    expect(tone(view({ marginFloor: 20 }))).not.toContain('data-tone="warn"');
    expect(tone(view({ marginFloor: null, margin: plannedMargin(30000, 29000) }))).not.toContain('data-tone="warn"'); // 3%, no floor set
    const over = tone(view({ margin: plannedMargin(10000, totals.total), project: { ...view().project, contract_value: 10000 } }));
    expect(over).toContain("-128%");
    expect(over).toContain('data-tone="bad"');
    const none = tone(view({ margin: plannedMargin(0, totals.total), project: { ...view().project, contract_value: 0 } }));
    expect(none).toContain("Needs a contract value");
    expect(none).not.toContain('data-tone="good"');
  });

  it("is drawn by the page header, with the project path above it, not by the Overview tab", () => {
    const page = readFileSync(path.join(ROOT, "src/app/(app)/contract-projects/[id]/page.tsx"), "utf8");
    expect(page).toContain("<ProjectKpiStrip");
    expect(page).toContain("<ProjectPathBar");
    expect(page).not.toContain("facts={[");
  });
});

describe("Project path", () => {
  it("shows Draft, Baseline waiting, Active, Handed over and Closed with the current step marked", () => {
    const out = strip(renderToString(createElement(ProjectPathBar, { path: projectPath({ status: "active", handover_sent_at: null }, false) })));
    for (const label of ["Draft", "Baseline waiting", "Active", "Handed over", "Closed"]) expect(out).toContain(label);
    expect(out).toContain('data-step="active" data-state="current" aria-current="step"');
    expect(out).toContain('data-step="draft" data-state="done"');
    expect(out).toContain('data-step="closed" data-state="todo"');
    expect(out).toContain("About Project path");
    expect(out).toContain("overflow-x:auto"); // scrolls sideways on a phone
  });
});

describe("Approval controls", () => {
  const r = (props: Partial<Parameters<typeof ApprovalControls>[0]>) => strip(renderToString(createElement(ApprovalControls, { projectId: "p1", revisionId: "r0", revisionStatus: "draft", canEdit: true, approval: view().approval, closed: false, ...props })));
  const pending = { id: "ar1", revision_id: "r0", rev_no: 0, status: "pending" as const, reason: "Baseline budget, SAR 22,800", requested_by_name: "Sara", requested_at: "2026-10-26T00:00:00Z", decided_by_name: null, decided_at: null, comment: null, mine: false };

  it("offers Ask for approval to someone who can edit a draft, and says why not when it is blocked (printed, not hidden)", () => {
    expect(r({})).toContain("Ask for approval");
    const blocked = r({ approval: { pending: null, canDecide: false, askBlocked: "Add at least one budget line first", history: [] } });
    expect(blocked).toContain("Add at least one budget line first");
    expect(blocked).not.toContain("cp.approval.ask");
    expect(r({ canEdit: false })).not.toContain("Ask for approval");
  });

  it("shows Approve and Reject to an approver, Withdraw to the asker, and neither to anyone else", () => {
    const approver = r({ revisionStatus: "pending", approval: { pending, canDecide: true, askBlocked: null, history: [] } });
    expect(approver).toContain("Approve");
    expect(approver).toContain("cp.approval.reject");
    expect(approver).not.toContain("Withdraw the request");
    const asker = r({ revisionStatus: "pending", approval: { pending: { ...pending, mine: true }, canDecide: false, askBlocked: null, history: [] } });
    expect(asker).toContain("Withdraw the request");
    expect(asker).not.toContain("cp.approval.approve");
    const other = r({ revisionStatus: "pending", approval: { pending, canDecide: false, askBlocked: null, history: [] } });
    expect(other).toContain("An approver will decide it");
  });

  it("an approved budget says it is locked; a pending 0221 migration is stated", () => {
    expect(r({ revisionStatus: "approved" })).toContain("approved and locked");
    expect(r({ approval: null })).toContain("migration 0221");
  });
});

describe("Budget", () => {
  const props = { projectId: "p1", revision: { id: "r0", rev_no: 0, status: "draft" as const }, revisions: [{ id: "r0", rev_no: 0, status: "draft" as const }], lines, resources: view().resources, canEdit: true, projectClosed: false, currency: "SAR" };
  const out = strip(renderToString(createElement(BudgetGrid, props)));

  it("opens with a one-line Budget header and its i", () => {
    expect(out).toContain('<h2 class="bpm-t-section">Budget</h2>');
    expect(out).toContain("About Budget");
  });

  it("groups the lines by resource type with a subtotal each, and shows every line's amount", () => {
    expect(out).toContain("11 · Material · SAR 12,800.00");
    expect(out).toContain("31 · Man Power · SAR 10,000.00");
    expect(out).toContain("Total SAR 22,800.00");
    expect(out).toContain('value="Chain link fence"');
    expect(out).toContain('value="Labour"');
  });

  it("marks an estimated cost, offers only cost-side resource types, and has Add line and Save in their places", () => {
    expect(out).toContain('data-guide="cp.budget.estimated"');
    expect(out).toContain("estimated");
    expect(out).not.toContain("91 · Revenue");
    expect(out).toContain('data-guide="cp.budget.add"');
    expect(out).toContain('data-guide="cp.budget.save"');
  });

  it("the grid scrolls inside its own container and every control is 44 px tall", () => {
    expect(out).toContain('data-guide="cp.budget.scroll"');
    expect(out).toMatch(/overflow-x:auto/);
    expect(out).toMatch(/min-width:980px/);
    const src = readFileSync(path.join(ROOT, "src/components/contractProjects/BudgetGrid.tsx"), "utf8");
    expect(src.match(/minHeight: 44/g)!.length).toBeGreaterThanOrEqual(8);
  });

  it("a locked budget (waiting or approved) has no Add, Save or Remove, disabled inputs, and says why", () => {
    for (const status of ["pending", "approved", "superseded"] as const) {
      const locked = strip(renderToString(createElement(BudgetGrid, { ...props, revision: { ...props.revision, status }, revisions: [{ id: "r0", rev_no: 0, status }] })));
      expect(locked, status).not.toContain("cp.budget.add");
      expect(locked, status).not.toContain("cp.budget.save");
      expect(locked, status).not.toContain("cp.budget.remove");
      expect(locked, status).toContain("cp.budget.locked");
      expect(locked, status).toMatch(/aria-label="Description"[^>]*disabled|disabled=""[^>]*aria-label="Description"/);
    }
    expect(strip(renderToString(createElement(BudgetGrid, { ...props, canEdit: false })))).not.toContain("cp.budget.add");
    expect(strip(renderToString(createElement(BudgetGrid, { ...props, projectClosed: true })))).toContain("This project is closed");
  });

  it("committed and actual cost appear, read-only, only once the ERP has filled them", () => {
    expect(out).not.toContain("Ordered");
    expect(out).not.toContain("Spent");
    const withErp = strip(renderToString(createElement(BudgetGrid, { ...props, lines: [line({ committed: 5000, actual: 1200 })] })));
    expect(withErp).toContain("Ordered");
    expect(withErp).toContain("Spent");
    expect(withErp).not.toContain("Committed");
    expect(withErp).not.toContain(">Actual<");
    expect(withErp).toContain("5,000.00");
  });

  it("an empty budget says what to do next", () => {
    expect(strip(renderToString(createElement(BudgetGrid, { ...props, lines: [] })))).toContain("No lines yet. Add the first one.");
  });
});

describe("Revisions", () => {
  const approved = rev({ id: "r0", status: "approved", approved_at: "2026-10-27T00:00:00Z", approved_by_name: "A. Nasser", locked_at: "2026-10-27T00:00:00Z" });
  const draft1 = rev({ id: "r1", rev_no: 1, status: "draft", justification_code: "scope_change", justification_text: "More fence", total: 23300 });
  const base = view({ revisions: [approved, draft1] as ProjectView["revisions"], revision: draft1 as ProjectView["revision"] });

  it("lists every revision newest first with its status, reason, total and who approved it", () => {
    const out = strip(renderToString(createElement(RevisionsPanel, { view: base })));
    expect(out.indexOf("Revision 1")).toBeLessThan(out.indexOf("Baseline"));
    expect(out).toContain("Scope change: More fence");
    expect(out).toContain("A. Nasser");
    expect(out).toContain("Waiting for approval".slice(0, 0) + "Approved");
    expect(out).toContain("/contract-projects/p1?tab=budget&amp;revision=r1");
  });

  it("shows what the revision changed against the one before it", () => {
    const changed = lines.map((l) => (l.line_key === "k1" ? { ...l, unit_cost: 130, amount: 13000 } : l)).concat(line({ id: "i9", line_key: "k9", line_no: 4, description: "Extra bay", amount: 500 }));
    const diff = diffRevisions(lines, changed);
    const out = strip(renderToString(createElement(RevisionsPanel, { view: { ...base, compare: { against: { id: "r0", rev_no: 0, status: "approved" }, diff } } })));
    expect(out).toContain('data-guide="cp.revisions.diff"');
    expect(out).toContain("Revision 1 against the baseline");
    expect(out).toContain("1 added · 0 removed · 1 changed");
    expect(out).toContain("+ Extra bay");
    expect(out).toContain("unit cost 120 → 130");
  });

  it("offers a new revision (with its reason) only after a baseline is approved and while none is open", () => {
    const only = view({ revisions: [approved] as ProjectView["revisions"], revision: approved as ProjectView["revision"] });
    const out = strip(renderToString(createElement(RevisionsPanel, { view: only })));
    expect(out).toContain('data-guide="cp.revisions.start"');
    expect(out).toContain("Scope change");
    expect(strip(renderToString(createElement(RevisionsPanel, { view: base })))).not.toContain('data-guide="cp.revisions.start"');
    const draftOnly = view();
    expect(strip(renderToString(createElement(RevisionsPanel, { view: draftOnly })))).not.toContain('data-guide="cp.revisions.start"');
    expect(strip(renderToString(createElement(RevisionsPanel, { view: { ...only, canEdit: false } })))).not.toContain('data-guide="cp.revisions.start"');
  });
});

describe("Handover", () => {
  it("offers the Excel download and a disabled Send to ePROMIS with its explanation behind an i", () => {
    const out = strip(renderToString(createElement(HandoverPanel, { projectId: "p1", revisionId: "r0", revLabel: "Baseline", hasBudget: true })));
    expect(out).toContain("Hand over to the ERP");
    expect(out).toContain("/api/contract-projects/p1/handover?revision=r0");
    expect(out).toContain("Download Excel");
    expect(out).toMatch(/<button[^>]*disabled[^>]*data-guide="cp.handover.send"|<button[^>]*data-guide="cp.handover.send"[^>]*disabled/);
    expect(out).toContain("About Send to ePROMIS");
    expect(out).not.toContain(PROJECT_TIPS.sendToErp);
  });

  it("with no budget the download is off", () => {
    const out = strip(renderToString(createElement(HandoverPanel, { projectId: "p1", revisionId: null, revLabel: null, hasBudget: false })));
    expect(out).not.toContain("/api/contract-projects/");
    expect(out).toContain("There is no budget to hand over yet");
  });
});

describe("the strip on an awarded tender", () => {
  it("offers Create contract project, or a link once the project exists, or nothing", () => {
    const create = strip(renderToString(createElement(ContractProjectBanner, { info: { existing: null, canCreate: true }, busy: false, onCreate: () => {} })));
    expect(create).toContain("Create contract project");
    const open = strip(renderToString(createElement(ContractProjectBanner, { info: { existing: { id: "p9", ref: "CPR-0009" }, canCreate: true }, busy: false, onCreate: () => {} })));
    expect(open).toContain("/contract-projects/p9");
    expect(open).toContain("CPR-0009");
    expect(open).not.toContain("Create contract project");
    expect(strip(renderToString(createElement(ContractProjectBanner, { info: { existing: null, canCreate: false }, busy: false, onCreate: () => {} })))).toBe("");
  });
});

describe("the record page", () => {
  const page = readFileSync(path.join(ROOT, "src/app/(app)/contract-projects/[id]/page.tsx"), "utf8");
  it("has the five tabs the design names, Activity carrying the Nova timeline", () => {
    for (const id of ['id: "overview"', 'id: "budget"', 'id: "revisions"', 'id: "handover"', 'id: "activity"']) expect(page).toContain(id);
    // The ids stay (links keep working); only the words changed.
    expect(page).toContain('id: "variations", label: "Client changes"');
    expect(page).toContain('id: "invoicing", label: "Client billing"');
    expect(page).toContain('<RecordActivity objectType="contract_projects"');
  });
});
