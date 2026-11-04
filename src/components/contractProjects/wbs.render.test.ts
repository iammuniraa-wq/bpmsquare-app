import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tipTextProblems } from "@/lib/infoTip";
import { allocationView } from "@/lib/contractProjects/allocation";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import { WBS_PENDING, WBS_TIPS } from "@/lib/wbs/tips";
import type { BudgetLine, WorkPackageRow } from "@/lib/contractProjects/types";
import type { EmployeeChoice } from "@/lib/contractProjects/workPackagesServer";

// The WBS on the contract project (docs/design/wbs.md slice 3): the WBS tab, the tree in the Budget tab's allocation table, the item panel,
// and what each says while the baseline is approved or migration 0243 is pending. Rendered on the server with the real components.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }), useSearchParams: () => new URLSearchParams("") }));

import WbsTab from "./WbsTab";
import WbsItemPanel from "./WbsItemPanel";
import BudgetGrid from "./BudgetGrid";
import { WbsTable } from "./AllocationTable";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/<!-- -->/g, "");
const noop = () => {};

const K = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const line = (n: number, over: Partial<BudgetLine> = {}): BudgetLine => ({
  id: `i${n}`, line_key: K(n), line_no: n, resource_code: "11", cost_code: "03", wbs: `2.${n}`, description: `Line ${n}`, qty: 10, unit: "m", unit_cost: 0, amount: 0, cost_known: true,
  source_ref: null, reserve: false, committed: null, actual: null, allocated: false, client_rate: 100, client_amount: 1000, source_line_id: `d${n}`, ...over,
});
const pkg = (id: string, code: string, parent: string | null, over: Partial<WorkPackageRow> = {}): WorkPackageRow => ({
  id, code, name: `Item ${code}`, owner_employee_id: null, owner_name: null, allocated_cost: null, sort_order: 10, note: null, line_keys: [], parent_id: parent, line_parts: [], ...over,
});
const LINES = [line(1, { description: "Steel access stair", qty: 337.1, client_amount: 141582 }), line(2, { description: "Handrail", client_amount: 8000 }), line(3, { description: "Gate", client_amount: 500 })];
const PACKAGES = [
  pkg("root", "1", null, { name: "Steel", sort_order: 10 }),
  pkg("fab", "1.1", "root", { name: "Fabrication", sort_order: 10, owner_employee_id: "e1", owner_name: "Sara Khan", line_keys: [K(2)], line_parts: [{ line_key: K(1), share_pct: 60 }], allocated_cost: 5000 }),
  pkg("gal", "1.2", "root", { name: "Galvanising", sort_order: 20, owner_employee_id: "e2", owner_name: "Omar Ali", line_parts: [{ line_key: K(1), share_pct: 15 }] }),
  pkg("ere", "2", null, { name: "Erection", sort_order: 20, line_parts: [{ line_key: K(1), share_pct: 25 }] }),
];
const EMPLOYEES: EmployeeChoice[] = [
  { id: "e1", name: "Sara Khan", code: "E-1", email: null, has_login: true }, { id: "e2", name: "Omar Ali", code: "E-2", email: null, has_login: false },
];
const view = (packages = PACKAGES, basis: "line" | "package" = "package") => allocationView({ allocation_basis: basis, contract_value: 200000 }, LINES, packages, null);

const tab = (over: Record<string, unknown> = {}) => {
  const packages = (over.packages as WorkPackageRow[] | undefined) ?? PACKAGES;
  const v = view(packages, (over.basis as "line" | "package" | undefined) ?? "package");
  return strip(renderToString(createElement(WbsTab, {
    projectId: "p1", basis: "package", revisionStatus: "draft", projectClosed: false, packages, rows: v.wbsRows, unassigned: v.unassigned, lines: LINES, employees: EMPLOYEES, currency: "SAR",
    canEdit: true, pending: false, treePending: false, fromTender: true, ...over,
  } as never)));
};
const buttonsOf = (out: string, guide: string) => [...out.matchAll(new RegExp(`<button[^>]*data-guide="${guide.replace(/\./g, "\\.")}"[^>]*>`, "g"))].map((m) => m[0]);

describe("the WBS tab", () => {
  const out = tab();

  it("opens with a WBS header and its i, New WBS item and Renumber for an editor, and the code i", () => {
    expect(out).toContain('<h2 class="bpm-t-section">WBS</h2>');
    expect(out).toContain('aria-label="About WBS"');
    expect(out).toContain('aria-label="About WBS codes"');
    for (const g of ["cp.wbs.add", "cp.wbs.renumber"]) {
      const b = buttonsOf(out, g);
      expect(b, g).toHaveLength(1);
      expect(b[0]).toMatch(/min-height:44px/);
    }
    expect(out).toContain("New WBS item");
  });

  it("draws the tree in order with each item's code, name, owner and roll-ups; a parent adds its sub-items up", () => {
    expect(out.match(/data-guide="cp\.wbs\.item"/g)).toHaveLength(4);
    for (const w of ["Steel", "Fabrication", "Galvanising", "Erection", "Sara Khan", "Omar Ali"]) expect(out, w).toContain(w);
    expect(out).toContain('aria-level="1"');
    expect(out).toContain('aria-level="2"');
    // 1.1 holds the handrail whole and 60 % of the stair; the branch adds 1.2's 15 %; client amounts are the client's, never the cost
    expect(out).toContain("2 (1 shared)");
    expect(out).toContain("SAR 92,949.20");
    expect(out).toContain("SAR 114,186.50");
    expect(out).toContain("5,000.00");
  });

  it("says in amber, beside the owner, that an owner has no login yet; and how many items have no owner", () => {
    expect(out).toContain('data-guide="cp.wbs.no_login"');
    expect(out).toContain("no login");
    expect(out).toContain("1 WBS item without an owner");
    expect(out).toContain("No owner");
  });

  it("lists the lines in no item in amber, with the line a split leaves, and lets an editor tick them", () => {
    expect(out).toContain('data-guide="cp.wbs.tree"');
    expect(out).toContain('data-guide="boq.wbs_unassigned"');
    expect(out).toContain("Unassigned: 1 line");
    expect(out).toContain('aria-label="Select item 2.3"');
  });

  it("the lock line is visible once the baseline is waiting or approved, and not while it is a draft", () => {
    expect(out).not.toContain("Allocation locked");
    for (const status of ["pending", "approved"] as const) {
      const locked = tab({ revisionStatus: status });
      expect(locked, status).toContain("Allocation locked: baseline approved. Structure and owners can still change.");
      expect(locked, status).toContain('data-guide="cp.wbs.locked"');
      expect(locked, status).toContain('data-guide="cp.wbs.add"'); // structure is still editable
      expect(locked, status).toContain('data-guide="boq.wbs_unassigned"');
      expect(locked.match(/aria-label="Select item/g) ?? [], status).toHaveLength(0); // but nothing can be grouped
    }
    // by BOQ line the money sits on the lines, so there is nothing to lock
    expect(tab({ revisionStatus: "approved", basis: "line" })).not.toContain("Allocation locked");
  });

  it("a view-only person, a closed project", () => {
    const viewOnly = tab({ canEdit: false });
    for (const w of ["cp.wbs.add", "cp.wbs.renumber", "cp.wbs.group_bar"]) expect(viewOnly, w).not.toContain(w);
    expect(viewOnly).toContain("You can view this project but not change it");
    expect(viewOnly).toContain("Steel");
    const closed = tab({ projectClosed: true });
    expect(closed).toContain("This project is closed");
    expect(closed).not.toContain("cp.wbs.add");
  });

  it("an empty WBS says what to do next; a project from a tender says the tender had none", () => {
    expect(tab({ packages: [], fromTender: true })).toContain("No WBS was copied from the tender. Add the first item.");
    expect(tab({ packages: [], fromTender: false })).toContain("No WBS yet. Add the first item.");
    expect(tab({ packages: [], canEdit: false, fromTender: false })).toContain("No WBS yet.");
    expect(tab({ packages: [], fromTender: false })).not.toContain("cp.wbs.renumber");
  });

  it("while 0243 is pending it says so once and keeps the flat list; while 0240 is pending it says that instead", () => {
    const flat = tab({ treePending: true, packages: PACKAGES.map((p) => ({ ...p, parent_id: null, line_parts: [] })) });
    expect(flat).toContain(WBS_PENDING);
    expect(flat.split(WBS_PENDING).length - 1).toBe(1);
    expect(flat).toContain("Steel");
    expect(flat).not.toContain("cp.wbs.renumber");
    expect(flat).not.toContain('data-guide="cp.wbs.split"');
    const none = tab({ pending: true, packages: [] });
    expect(none).toContain("The WBS needs a database update (migration 0240)");
    expect(none).not.toContain('data-guide="cp.wbs.tree"');
  });

  it("uses the word WBS, never 'work package', and prints no explanation as running text", () => {
    for (const w of ["work package", "Work package", "Work breakdown"]) expect(out, w).not.toContain(w);
    for (const t of [...Object.values(WBS_TIPS), PROJECT_TIPS.workBreakdown, PROJECT_TIPS.packageOwner]) expect(out.split(t).length - 1, t).toBe(0);
  });

  it("every control is a 44 px target and the stylesheet makes the rows cards under 900 px", () => {
    for (const b of [...out.matchAll(/<button[^>]*data-guide="cp\.wbs\.(?:add|renumber|open)"[^>]*>/g)].map((m) => m[0])) expect(b).toMatch(/min-height:44px/);
    expect(read("src/components/contractProjects/WbsTab.tsx").match(/minHeight: 44/g)!.length).toBeGreaterThanOrEqual(6);
    const css = read("src/components/tender/wbs/Wbs.module.css");
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*grid-template-areas/);
    expect(out).not.toMatch(/(?<![-\w])(?:min-)?width:\s*(?:[2-9]\d\d|\d{4,})px/);
  });
});

describe("the allocation table by WBS", () => {
  const v = view();
  const draw = (typed: Record<string, string>, editable = true, rows = v.wbsRows) => strip(renderToString(createElement(WbsTable, { rows, typed, onType: noop, editable, currency: "SAR", onOpen: noop })));

  it("a tree: an input on each bottom-level item, 44 px; a parent shows what its sub-items add up to and has no input", () => {
    const out = draw({ fab: "5000", gal: "", ere: "" });
    expect(out).toContain('data-guide="cp.alloc.table"');
    expect(out.match(/<tr[^>]*data-guide="cp\.alloc\.wbs_row"[^>]*>/g)).toHaveLength(4);
    expect(out).toMatch(/data-leaf="0"/);
    const inputs = out.match(/<input[^>]*data-guide="cp\.alloc\.input"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(6); // three leaves, in the table and in the cards of 375 px
    for (const i of inputs) { expect(i).toMatch(/min-height:44px/); expect(i).toMatch(/type="number"/); }
    expect(inputs.some((i) => /for 1 Steel|for 1 Item/.test(i))).toBe(false);
    expect(out).toContain('data-guide="cp.alloc.rolled"');
    expect(out).toContain("5,000.00");
    expect(out).toContain("SAR 114,186.50");
  });

  it("indents sub-items, and under 780 px the rows are cards with the same facts", () => {
    const out = draw({});
    expect(out).toMatch(/padding:0 12px 0 30px/);
    expect(out).toContain('class="bpm-rows-cards"');
    expect(out.match(/data-guide="cp\.alloc\.card"/g)).toHaveLength(4);
  });

  it("a split line counts in each item by its share, and the lines column says how many are shared", () => {
    const out = draw({});
    expect(out).toContain("2 (1 shared)");
    expect(out).toContain("SAR 21,237.30");
    expect(out).toContain("SAR 35,395.50");
  });

  it("no WBS yet says where to add the first item", () => {
    expect(draw({}, true, [])).toContain("No WBS yet. Add the first item on the WBS tab");
  });
});

describe("the Budget tab by BOQ line shows where each line sits", () => {
  const base = { projectId: "p1", revision: { id: "r0", rev_no: 0, status: "draft" as const }, revisions: [{ id: "r0", rev_no: 0, status: "draft" as const }], resources: [{ code: "11", name: "Material", revenue_side: false }], canEdit: true, projectClosed: false, currency: "SAR", contractValue: 200000 };
  const draw = (over: Record<string, unknown> = {}) => strip(renderToString(createElement(BudgetGrid, { ...base, lines: LINES, basis: "line", packages: PACKAGES, allocation: view(PACKAGES, "line"), ...over } as never)));

  it("has a WBS column with the item, or the shares of a split line, and a dash for a line in none", () => {
    const out = draw();
    expect(out).toContain('data-guide="cp.alloc.wbs_col"');
    expect(out).toContain("1.1 60 % · 1.2 15 % · 2 25 %");
    expect(out).toMatch(/data-guide="cp\.alloc\.wbs_text"[^>]*>1\.1</);
    expect(out).toContain(">—<");
  });

  it("switches between BOQ line and WBS, and the Budget tab no longer carries a work breakdown section", () => {
    const out = draw();
    expect(out).toMatch(/role="radio" aria-checked="true"[^>]*>BOQ line</);
    expect(out).toMatch(/role="radio" aria-checked="false"[^>]*>WBS</);
    expect(out).not.toContain("Work breakdown");
    expect(out).not.toContain("cp.wbs.add");
  });

  it("has no WBS column while no line sits in an item", () => {
    expect(draw({ packages: [], allocation: view([], "line") })).not.toContain("cp.alloc.wbs_col");
  });
});

describe("the item panel", () => {
  const panel = (over: Record<string, unknown> = {}) => strip(renderToString(createElement(WbsItemPanel, {
    projectId: "p1", pkg: PACKAGES[1], packages: PACKAGES, lines: LINES, employees: EMPLOYEES, locked: null, linesLocked: null, basis: "package", onClose: noop, onSaved: noop, onEditSplit: noop, ...over,
  } as never)));

  it("shows code, name, parent, owner, the lines it holds and its share of a split line, in a dialog", () => {
    const out = panel();
    expect(out).toContain('role="dialog"');
    expect(out).toContain("1.1 Fabrication");
    for (const g of ["cp.wbs.code", "cp.wbs.name", "cp.wbs.parent", "cp.wbs.owner", "cp.wbs.lines", "cp.wbs.save", "cp.wbs.remove"]) expect(out, g).toContain(`data-guide="${g}"`);
    expect(out).toContain("With a login");
    expect(out).toContain("No login yet");
    expect(out).toContain("Handrail");
    expect(out).toContain("1.1 · 60 %");
    expect(out).toContain('data-guide="cp.wbs.edit_split"');
    expect(out).toContain("Save WBS item");
    expect(out).toContain('aria-label="About Code"');
    expect(out).toContain('aria-label="About Parent"');
    expect(out).not.toMatch(/<option[^>]*value="fab"/); // not under itself
  });

  it("a new item previews the code it will get and says when a parent's lines move into it", () => {
    const out = panel({ pkg: null, parentId: "fab" });
    expect(out).toContain("New WBS item");
    expect(out).toMatch(/placeholder="1\.1\.1"/);
    expect(out).toContain("1.1 holds lines. They move into this new item.");
  });

  it("an item of the same split line shows the line as split across items", () => {
    expect(panel({ pkg: PACKAGES[3] })).toContain("2 · 25 %");
    expect(panel({ pkg: PACKAGES[1], lines: [...LINES] })).not.toContain("Line 4");
    expect(panel({ pkg: pkg("x", "3", null), packages: [...PACKAGES, pkg("x", "3", null)] })).toContain("split across items");
  });

  it("an owner without a login gets the amber line and the Create login prompt, but is not blocked from other changes", () => {
    const out = panel({ pkg: PACKAGES[2] });
    expect(out).toContain('data-guide="cp.wbs.needs_login"');
    expect(out).toContain("Omar Ali has no login yet.");
    expect(out).toMatch(/<button[^>]*data-guide="cp\.wbs\.save"(?![^>]*disabled)[^>]*>/);
  });

  it("when the baseline is approved the lines cannot be changed and the panel says so; names and owners still can", () => {
    const out = panel({ linesLocked: "Allocation locked: baseline approved. Structure and owners can still change." });
    expect(out).toContain('data-guide="cp.wbs.lines_locked"');
    expect(out).toContain("Allocation locked: baseline approved.");
    expect(out.match(/<input type="checkbox"[^>]*disabled=""/g)!.length).toBe(3);
    expect(out).not.toMatch(/<button[^>]*data-guide="cp\.wbs\.save"[^>]*disabled/);
    expect(out).toMatch(/<input[^>]*data-guide="cp\.wbs\.name"(?![^>]*disabled)/);
  });

  it("a branch says its lines sit in its sub-items; a closed or view-only project disables everything", () => {
    expect(panel({ pkg: PACKAGES[0] })).toContain("1 has sub-items; the lines sit in them.");
    const locked = panel({ locked: "This project is closed" });
    expect(locked).toContain("This project is closed");
    expect(locked).toMatch(/<button[^>]*data-guide="cp\.wbs\.save"[^>]*disabled/);
    expect(locked).toMatch(/<button[^>]*data-guide="cp\.wbs\.remove"[^>]*disabled/);
  });

  it("every control is a 44 px target and no colour literal is used", () => {
    for (const f of ["WbsItemPanel.tsx", "WbsTab.tsx", "AllocationTable.tsx"]) expect(read(`src/components/contractProjects/${f}`).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const out = panel();
    for (const b of [...out.matchAll(/<button[^>]*data-guide="cp\.wbs\.(?:save|remove)"[^>]*>/g)].map((m) => m[0])) expect(b).toMatch(/min-height:44px/);
  });
});

describe("the texts", () => {
  it("every WBS and project tip fits the InfoTip limit, and the item number tip replaced the WBS reference", () => {
    for (const [k, t] of Object.entries(PROJECT_TIPS)) expect(tipTextProblems(t), k).toEqual([]);
    expect(PROJECT_TIPS).not.toHaveProperty("wbs");
    expect(PROJECT_TIPS.itemNo).toContain("item number");
    expect(read("src/components/contractProjects/LineDetailsPanel.tsx")).toContain('label="Item no."');
    expect(read("src/components/contractProjects/LineDetailsPanel.tsx")).not.toContain("Item reference");
  });
});
