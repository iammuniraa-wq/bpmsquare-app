import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pillar } from "@/lib/theme";
import { tipTextProblems } from "@/lib/infoTip";
import { BOQ_TABLE_TIPS } from "@/lib/tender/boq/tips";
import { WBS_PENDING, WBS_TIPS } from "@/lib/wbs/tips";
import { buildWbsState, membershipOf } from "@/lib/tender/wbs/view";

// The WBS on the tender's Bill of quantities (docs/design/wbs.md slice 2): the view switch, the WBS column, the tick boxes and selection bar, the
// Split chip and its parts, the split panel, the tree with its roll-ups and the Unassigned list, and what shows while migration 0243 is pending.
// Rendered on the server with the real components; phone behaviour is checked in the stylesheet, since a render has no viewport.

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search), useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }) }));

import BoqTab, { type BoqScreenState } from "../BoqTab";
import { BoqCards, BoqTable, type BoqRow, type WbsColumn } from "../BoqRows";
import BoqRowPanel from "../BoqRowPanel";
import GroupIntoWbs from "./GroupIntoWbs";
import SplitPanel from "./SplitPanel";
import UnassignedList from "./UnassignedList";
import WbsRow from "./WbsRow";
import WbsTree from "./WbsTree";
import WbsItemForm from "./WbsItemForm";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const clean = (h: string) => h.replace(/<!-- -->/g, "");
const noop = () => {};
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const WBS_BASE = `/api/opportunities/${OPP}/tender/wbs`;

const item = (id: string, code: string, name: string, parent: string | null = null, sort = 10) => ({
  id, code, name, parent_id: parent, sort_order: sort, code_is_manual: false, owner_employee_id: null as string | null, opportunity_id: OPP, note: null, created_at: null,
});
const ITEMS = [item("i1", "1", "Steel", null, 10), item("i11", "1.1", "Fabrication", "i1", 10), item("i12", "1.2", "Galvanising", "i1", 20), item("i2", "2", "Erection", null, 20)];

const base = {
  id: "", line_id: "l", row_no: 8, item_no: "A.1", cost_code: null, description: "", uom: "m", qty: 10, rate: 0, amount: 0, priced: false, linked: true, removed: false,
  price_source: null, price_source_ref: null, price_as_of: null, stale: false, stale_text: null, stale_accepted: false, unit_cost: null, markup_pct: null, file_rate: null,
  wbs_item_id: null, wbs_parts: [],
};
const row = (over: Record<string, unknown>) => ({ ...base, ...over }) as BoqScreenState["lines"][number];
const STAIR_PARTS = [{ wbs_item_id: "i11", share_pct: 60 }, { wbs_item_id: "i12", share_pct: 15 }, { wbs_item_id: "i2", share_pct: 25 }];
const LINES = [
  row({ id: "b1", row_no: 8, item_no: "2.4", description: "Steel access stair", qty: 337.1, uom: "m", rate: 420, amount: 141582, priced: true, unit_cost: 300, wbs_parts: STAIR_PARTS }),
  row({ id: "b2", row_no: 9, item_no: "2.5", description: "Handrail", qty: 40, rate: 50, amount: 2000, priced: true, wbs_item_id: "i11" }),
  row({ id: "b3", row_no: 10, item_no: "2.6", description: "Gate", qty: 2, rate: 100, amount: 200, priced: true }),
  row({ id: "b4", row_no: 11, item_no: "2.7", description: "Fence", qty: 30 }),
  row({ id: "b5", row_no: 12, item_no: "2.8", description: "Dropped priced line", removed: true, rate: 5, amount: 5, priced: true, wbs_item_id: "i2" }),
  row({ id: "b6", row_no: 13, item_no: "2.9", description: "Partly shared", qty: 100, rate: 10, amount: 1000, priced: true, wbs_parts: [{ wbs_item_id: "i11", share_pct: 60 }, { wbs_item_id: "i2", share_pct: 25 }] }),
];

function wbsState(lines = LINES, items = ITEMS) {
  const members = { item: new Map(lines.map((l) => [l.id, l.wbs_item_id ?? null])), parts: new Map(lines.filter((l) => (l.wbs_parts?.length ?? 0) > 0).map((l) => [l.id, [...l.wbs_parts!]])) };
  return buildWbsState(items, new Map(), lines, members);
}
const state = (over: Partial<BoqScreenState> = {}): BoqScreenState => ({
  pending: false,
  source: { file_name: "ARB BOQ.xlsx", sheet_name: "BOQ", version: 2, uploaded_at: "2026-10-26T08:00:00Z", line_count: 5, added_columns: true },
  lines: LINES, validity_days: 180, today: "2026-10-26", default_markup_pct: 15,
  totals: { lines: 5, priced: 4, unpriced: 1, stale: 0, amount: 145000, no_product: 0 }, unpriced: [],
  wbs: wbsState(),
  ...over,
} as BoqScreenState);

const html = (p: Partial<Parameters<typeof BoqTab>[0]> = {}, search = "") => {
  nav.search = search;
  return clean(renderToString(createElement(BoqTab, { opportunityId: OPP, canEdit: true, onError: noop, onNotice: noop, initialData: state(), layout: "table", ...p } as never)));
};
const buttons = (out: string, guide: string) => [...out.matchAll(new RegExp(`<button[^>]*data-guide="${guide.replace(/\./g, "\\.")}${guide.endsWith(".") ? "[^\"]*" : ""}"[^>]*>`, "g"))].map((m) => m[0]);

describe("the view switch", () => {
  it("shows BOQ and WBS as two 44 px buttons with an i, BOQ pressed by default; the address picks the view", () => {
    const out = html();
    expect(out).toContain('data-guide="boq.view"');
    const [boq, wbs] = [buttons(out, "boq.view.boq")[0], buttons(out, "boq.view.wbs")[0]];
    expect(boq).toContain('aria-pressed="true"');
    expect(wbs).toContain('aria-pressed="false"');
    for (const b of [boq, wbs]) expect(b).toMatch(/min-height:44px/);
    expect(out).toContain('aria-label="About View"');
    const tree = html({}, "boqview=wbs");
    expect(tree).toContain('data-guide="boq.wbs_tree"');
    expect(tree).not.toContain("<table");
    expect(tree).not.toContain('data-guide="boq.filter.all"');
    expect(html({}, "boqview=nonsense")).toContain("<table");
  });

  it("the first tile says how many WBS items and unassigned lines in the WBS view", () => {
    expect(html({}, "boqview=wbs")).toContain("4 WBS items · 3 unassigned");
  });

  it("is absent when the tender has no BOQ, when the answer carries no WBS, and when 0243 is pending, which says so once", () => {
    expect(html({ initialData: state({ wbs: undefined }) })).not.toContain('data-guide="boq.view"');
    const pending = html({ initialData: state({ wbs: { pending: true, items: [], rollup: {}, total: { part_count: 0, shared_count: 0, client_amount: 0, cost: null, priced_count: 0, costed_count: 0 } } }) }, "boqview=wbs");
    expect(pending).not.toContain('data-guide="boq.view"');
    expect(pending).toContain(WBS_PENDING);
    expect(pending.split(WBS_PENDING).length - 1).toBe(1);
    expect(pending).toContain("<table");
    expect(pending).not.toContain("boq.select_row");
    expect(pending).not.toContain('data-guide="boq.split"');
  });

  it("a view-only person sees the switch and the tree but no tick boxes, Split, New WBS item or menu", () => {
    const table = html({ canEdit: false });
    expect(table).toContain('data-guide="boq.view"');
    for (const w of ["boq.select_row", "boq.select_all", 'data-guide="boq.split"']) expect(table, w).not.toContain(w);
    const tree = html({ canEdit: false }, "boqview=wbs");
    for (const w of ["boq.wbs_new", "boq.wbs_renumber", "Actions for"]) expect(tree, w).not.toContain(w);
  });
});

describe("the BOQ view", () => {
  const out = html();
  it("has a WBS column after Item, a tick box per row with its own label, and a select-all", () => {
    expect(out).toMatch(/>Item<\/th><th[^>]*><span[^>]*>WBS<button[^>]*aria-label="About WBS"/);
    expect(out).toContain('aria-label="Select all rows on this page"');
    for (const item of ["2.4", "2.5", "2.6", "2.7", "2.9"]) expect(out, item).toContain(`aria-label="Select item ${item}"`);
    expect(out).not.toContain('aria-label="Select item 2.8"');
  });

  it("shows the item's code, a dash when unassigned, and a Split n chip with the codes in its title for a split line", () => {
    expect(out).toContain("Split 3 ▸");
    expect(out).toMatch(/<button[^>]*title="1\.1, 1\.2, 2"[^>]*aria-expanded="false"[^>]*data-guide="boq\.split_chip"/);
    expect(out).toMatch(/title="Fabrication"><span[^>]*>1\.1</);
    expect(out).toContain('data-guide="boq.wbs_col"');
    expect(out).toContain("15 % unassigned");
  });

  it("has a Split button on each editable row, Edit split on a split one, and every one is 44 px", () => {
    const all = buttons(out, "boq.split");
    expect(all.length).toBe(5);
    for (const b of all) expect(b).toMatch(/min-height:44px/);
    expect(out).toContain(">Edit split<");
    expect(out).toContain(">Split<");
  });

  it("the tick boxes, chip and expander controls are 44 px in the stylesheet, and the row's amber flags are pills", () => {
    const css = read("src/components/tender/wbs/Wbs.module.css");
    expect(css).toMatch(/\.check \{[^}]*min-width: 44px; min-height: 44px/);
    expect(css).toMatch(/\.chipBtn \{[^}]*min-height: 44px/);
    expect(out).toContain('data-chip="remainder"');
  });

  it("an expanded split line lists each part with its share, quantity and amount, and Edit split / Unsplit", () => {
    const wbs: WbsColumn = { items: ITEMS, selected: new Set(), onToggle: noop, onToggleAll: noop, canEdit: true, expanded: new Set(["b1"]), onExpand: noop, onSplit: noop, onUnsplit: noop, respread: new Set() };
    const out2 = clean(renderToString(createElement(BoqTable, { rows: [LINES[0] as BoqRow], links: [], openId: null, onOpen: noop, wbs })));
    expect(out2).toContain('data-guide="boq.split_parts"');
    expect(out2).toContain("1.1 Fabrication · 60 % · 202.26 m · 84,949.20");
    expect(out2).toContain("1.2 Galvanising · 15 % · 50.565 m · 21,237.30");
    expect(out2).toContain("2 Erection · 25 % · 84.275 m · 35,395.50");
    expect(out2).toContain('data-guide="boq.unsplit"');
    expect(out2).toContain('aria-expanded="true"');
  });

  it("flags a split line whose quantity changed in a revised file", () => {
    const wbs: WbsColumn = { items: ITEMS, selected: new Set(), onToggle: noop, onToggleAll: noop, canEdit: true, expanded: new Set(), onExpand: noop, onSplit: noop, onUnsplit: noop, respread: new Set(["b1"]) };
    const out2 = clean(renderToString(createElement(BoqTable, { rows: [LINES[0] as BoqRow], links: [], openId: null, onOpen: noop, wbs })));
    expect(out2).toContain('data-chip="respread"');
    expect(out2).toContain("shares re-spread");
  });

  it("a table without a WBS is exactly as before: no tick box, no WBS column, no Split", () => {
    const plain = clean(renderToString(createElement(BoqTable, { rows: [LINES[1] as BoqRow], links: [], openId: null, onOpen: noop })));
    for (const w of ["boq.select_row", "WBS", "Split", "type=\"checkbox\""]) expect(plain, w).not.toContain(w);
  });
});

describe("the phone cards", () => {
  const out = html({ layout: "cards" });
  it("put the checkbox at the card's left, keep each card one button, and carry the WBS chip and Split under it", () => {
    expect(out).not.toContain("<table");
    expect(out.match(/data-guide="boq\.line"/g)?.length).toBe(5);
    expect(out.match(/data-guide="boq\.card_wrap"/g)?.length).toBe(5);
    expect(out).toContain('aria-label="Select item 2.4"');
    expect(out).toContain("Split 3 ▸");
    const css = read("src/components/tender/wbs/Wbs.module.css");
    expect(css).toMatch(/\.cardRow \{[^}]*display: flex/);
    // a card is a button: no interactive control is nested inside one
    for (const card of out.match(/<button[^>]*data-guide="boq\.line"[^>]*>[\s\S]*?<\/button>/g) ?? []) expect(card).not.toMatch(/<(input|button)[^>]*>[\s\S]*<(input|button)/);
  });

  it("every control is a 44 px target and nothing has a fixed pixel width over 200", () => {
    for (const b of [...buttons(out, "boq.split"), ...buttons(out, "boq.view.")]) expect(b).toMatch(/min-height:44px/);
    expect(out).not.toMatch(/(?<![-\w])(?:min-)?width:\s*(?:[2-9]\d\d|\d{4,})px/);
  });

  it("the stylesheet makes the selection bar sticky and the tree rows cards under 900 px", () => {
    const css = read("src/components/tender/wbs/Wbs.module.css");
    const media = css.slice(css.indexOf("@media (max-width: 900px)"));
    expect(media).toMatch(/\.bar\[data-sticky="1"\] \{ position: sticky; bottom: 0/);
    expect(media).toMatch(/grid-template-areas/);
    expect(media).toMatch(/\.treeHead \{ display: none/);
  });
});

describe("the selection bar", () => {
  const items = ITEMS;
  const bar = (n: number, onSplit?: () => void) => clean(renderToString(createElement(GroupIntoWbs, { base: WBS_BASE, ids: Array.from({ length: n }, (_, i) => `b${i + 1}`), items, onClear: noop, onDone: noop, onError: noop, onSplit })));
  it("says how many are selected, offers Group into WBS and Clear, and 44 px targets", () => {
    const out = bar(3);
    expect(out).toContain('data-guide="boq.select_bar"');
    expect(out).toContain("3 selected");
    expect(out).toContain("Group into WBS ▾");
    expect(out).toContain(">Clear<");
    expect(out).toContain('aria-label="About Group into WBS"');
    for (const b of [...out.matchAll(/<button[^>]*data-guide="boq\.[^"]*"[^>]*>/g)].map((m) => m[0])) expect(b).toMatch(/min-height:44px/);
  });
  it("offers Split… only when exactly one line is ticked", () => {
    expect(bar(1, noop)).toContain("Split…");
    expect(bar(2, noop)).not.toContain("Split…");
    expect(bar(1)).not.toContain("Split…");
  });
  it("renders nothing when nothing is ticked", () => {
    expect(bar(0)).toBe("");
  });
});

describe("the split panel", () => {
  type SplitLine = { id: string; item_no: string | null; row_no: number; description: string; uom: string | null; qty: number; amount: number; priced: boolean; wbs_item_id?: string | null; wbs_parts?: readonly { wbs_item_id: string; share_pct: number }[] };
  const stair: SplitLine = { id: "b1", item_no: "2.4", row_no: 8, description: "Steel access stair", uom: "m", qty: 337.1, amount: 141582, priced: true, wbs_item_id: null, wbs_parts: STAIR_PARTS };
  const panel = (rows: { key: string; item: string; newName: string; pct: string; qty: string }[], line: SplitLine = stair) => clean(renderToString(createElement(SplitPanel, { base: WBS_BASE, line, items: ITEMS, onClose: noop, onDone: noop, onError: noop, initialRows: rows })));
  const R = (k: string, itemId: string, pct: string) => ({ key: k, item: itemId, newName: "", pct, qty: String(Math.round(337.1 * Number(pct)) / 100) });

  it("opens as a dialog headed with the line, its quantity and its amount, with the % / Quantity toggle", () => {
    const out = panel([R("a", "i11", "60"), R("b", "i12", "15"), R("c", "i2", "25")]);
    expect(out).toContain('role="dialog"');
    expect(out).toContain("Edit split 2.4");
    expect(out).toContain("Steel access stair · 337.1 m · 141,582");
    expect(out).toMatch(/aria-label="Share as"/);
    expect(out).toContain('data-guide="boq.split.mode_pct"');
    expect(out).toContain('data-guide="boq.split.mode_qty"');
    expect(out).toContain('aria-label="About Shares"');
  });

  it("Save is disabled until the shares balance, the remainder is printed in amber, and the reason is visible", () => {
    const open = panel([R("a", "i11", "60"), R("b", "i12", "25")]);
    expect(open).toMatch(/<button[^>]*disabled=""[^>]*data-guide="boq\.split\.save"|<button[^>]*data-guide="boq\.split\.save"[^>]*disabled=""/);
    expect(open).toContain("Total 85.00 % · 286.535 m — 15.00 % remaining");
    expect(open).toContain("15.00 % still to share");
    expect(open).toMatch(/class="[^"]*totalWarn[^"]*"[^>]*>Total 85/);
    const balanced = panel([R("a", "i11", "60"), R("b", "i12", "15"), R("c", "i2", "25")]);
    expect(balanced).toContain("Balanced");
    expect(balanced).toMatch(/class="[^"]*totalOk[^"]*"[^>]*>Balanced/);
    expect(balanced).not.toMatch(/<button[^>]*disabled=""[^>]*data-guide="boq\.split\.save"|<button[^>]*data-guide="boq\.split\.save"[^>]*disabled=""/);
    expect(balanced).not.toContain('data-guide="boq.split.blocker"');
  });

  it("blocks a part with no item and says so; an empty split waits with 100 % remaining", () => {
    const out = panel([R("a", "", "50"), R("b", "i12", "50")]);
    expect(out).toContain("Choose a WBS item for every part");
    const empty = panel([{ key: "a", item: "", newName: "", pct: "", qty: "" }, { key: "b", item: "", newName: "", pct: "", qty: "" }], { ...stair, wbs_parts: [] });
    expect(empty).toContain("Total 0.00 % · 0 m — 100.00 % remaining");
  });

  it("has + Add part, a remove per part (disabled on the last), Unsplit only for a split line, and 44 px controls", () => {
    const out = panel([R("a", "i11", "60"), R("b", "i12", "40")]);
    expect(out).toContain("+ Add part");
    expect(out).toContain('data-guide="boq.split.unsplit"');
    expect(panel([R("a", "i11", "100")], { ...stair, wbs_parts: [], wbs_item_id: "i11" })).not.toContain('data-guide="boq.split.unsplit"');
    const last = panel([R("a", "i11", "100")], { ...stair, wbs_parts: [], wbs_item_id: "i11" });
    expect(last).toMatch(/aria-label="Remove part 1"[^>]*disabled=""|disabled=""[^>]*aria-label="Remove part 1"/);
    for (const b of buttons(out, "boq.split.")) expect(b).toMatch(/min-height:44px/);
    for (const i of [...out.matchAll(/<input[^>]*type="number"[^>]*>/g)].map((m) => m[0])) expect(i).toMatch(/min-height:44px/);
  });

  it("offers the leaf items and a new one, never a branch", () => {
    const out = panel([R("a", "i11", "100")]);
    expect(out).toContain("1.1 Fabrication");
    expect(out).toContain("1.2 Galvanising");
    expect(out).toContain("2 Erection");
    expect(out).not.toMatch(/<option[^>]*value="i1"/);
    expect(out).toContain("New WBS item…");
  });

  it("shows each part's derived quantity and amount under its share", () => {
    const out = panel([R("a", "i11", "60"), R("b", "i12", "15"), R("c", "i2", "25")]);
    expect(out).toMatch(/202\.26 m · 84,949\.2/);
  });
});

describe("the row panel", () => {
  const open = (state0: BoqScreenState, id: string) => html({ initialOpenRow: id, initialData: state0 });
  it("has a WBS field between Details and Quantity: the leaf items, Unassigned, and Split…", () => {
    const out = open(state(), "b2");
    expect(out).toContain('data-guide="boq.row.wbs"');
    expect(out.indexOf('data-guide="boq.row.wbs"')).toBeLessThan(out.indexOf('data-guide="boq.row.qty"'));
    expect(out).toContain("Unassigned");
    expect(out).toContain("1.1 Fabrication");
    expect(out).toContain("Split…");
    expect(out).not.toMatch(/<option[^>]*value="i1">/);
    expect(out).toMatch(/<option[^>]*value="i11"[^>]*selected|<option value="i11" selected/);
  });
  it("is disabled and names the parts when the line is split, with Edit split and Unsplit beside it", () => {
    const out = open(state(), "b1");
    expect(out).toMatch(/<select[^>]*disabled=""[^>]*data-guide="boq\.row\.wbs_select"|<select[^>]*data-guide="boq\.row\.wbs_select"[^>]*disabled=""/);
    expect(out).toContain("Split 3: 1.1, 1.2, 2");
    expect(out).toContain(">Edit split<");
    expect(out).toContain(">Unsplit<");
  });
  it("while 0243 is pending the field is the one amber line", () => {
    const out = open(state({ wbs: { pending: true, items: [], rollup: {}, total: { part_count: 0, shared_count: 0, client_amount: 0, cost: null, priced_count: 0, costed_count: 0 } } }), "b2");
    expect(out).toContain('data-guide="boq.row.wbs_pending"');
    expect(out).not.toContain('data-guide="boq.row.wbs"');
  });
  it("a tender with no WBS data at all has no field", () => {
    expect(open(state({ wbs: undefined }), "b2")).not.toContain("boq.row.wbs");
  });
  it("a view-only person cannot change it", () => {
    const out = html({ initialOpenRow: "b2", canEdit: false });
    expect(out).toMatch(/<select[^>]*disabled=""[^>]*data-guide="boq\.row\.wbs_select"|<select[^>]*data-guide="boq\.row\.wbs_select"[^>]*disabled=""/);
    expect(out).not.toContain("Split…");
  });
  it("the standalone panel renders without a WBS prop exactly as before", () => {
    const out = clean(renderToString(createElement(BoqRowPanel, { base: "/x", row: LINES[1] as BoqRow, links: [], canEdit: true, markup: 15, validityDays: 180, onClose: noop, onChanged: noop, onError: noop, onNotice: noop })));
    expect(out).not.toContain("boq.row.wbs");
  });
});

describe("the tree", () => {
  const lines = LINES.map((l) => ({ id: l.id, item_no: l.item_no, row_no: l.row_no, description: l.description, uom: l.uom, qty: l.qty, amount: l.amount, priced: l.priced, removed: l.removed, wbs_item_id: l.wbs_item_id ?? null, wbs_parts: l.wbs_parts ?? [] }));
  const st = wbsState();
  const tree = clean(renderToString(createElement(WbsTree, {
    base: WBS_BASE, opportunityId: OPP, items: st.items, rollup: st.rollup, lines, canEdit: true, selected: new Set<string>(), onToggle: noop, onChanged: noop, onError: noop, onNotice: noop, onSplit: noop, onOpenLine: noop,
  } as never)));

  it("draws the items in order with their codes, names and roll-ups: the branch holds its sub-items' lines, a shared line is counted in each", () => {
    for (const w of ["Steel", "Fabrication", "Galvanising", "Erection"]) expect(tree, w).toContain(w);
    expect(tree.match(/data-guide="boq\.wbs_item"/g)?.length).toBe(4);
    // 1.1: the handrail whole, the stair part, the partly shared line (2.9) -> 3 lines, 2 shared
    expect(tree).toContain("3 (2 shared)");
    // client amount of the branch: 84,949.20 + 2,000 + 600 + 21,237.30
    expect(tree).toContain("108,786.50");
    expect(st.total.client_amount).toBe(141582 + 2000 + 850);
  });

  it("each root has a bar of its share of the client amount", () => {
    expect(tree).toContain('data-guide="boq.wbs_bars"');
    expect(tree.match(/class="[^"]*barLine[^"]*"/g)?.length).toBe(2);
    expect(tree).toMatch(/\d+%/);
  });

  it("has New WBS item and Renumber, an i for the codes and one for the roll-up, and a menu per item", () => {
    expect(tree).toContain('data-guide="boq.wbs_new"');
    expect(tree).toContain('data-guide="boq.wbs_renumber"');
    expect(tree).toContain('aria-label="About WBS codes"');
    expect(tree).toContain('aria-label="About WBS totals"');
    expect(tree.match(/aria-label="Actions for \d/g)?.length).toBe(4);
    for (const b of buttons(tree, "boq.wbs_new")) expect(b).toMatch(/min-height:44px/);
  });

  it("branches and leaves with lines have a 44 px toggle; the Unassigned list is amber, holds the tickable lines and the remainder", () => {
    expect(tree).toContain('aria-label="Fold 1 Steel"');
    expect(tree).toContain('data-guide="boq.wbs_unassigned"');
    expect(tree).toContain("Unassigned: 3 lines");
    expect(tree).toContain('aria-label="Select item 2.6"');
    expect(tree).toContain('aria-label="Select item 2.7"');
    expect(tree).toContain("15 % unassigned");
    expect(tree).toContain(">Edit split<");
    expect(tree).not.toContain('aria-label="Select item 2.9"');
    const css = read("src/components/tender/wbs/Wbs.module.css");
    expect(css).toMatch(/\.toggle \{[^}]*min-width: 44px; min-height: 44px/);
    expect(css).toMatch(/\.unassigned \{[^}]*var\(--amberink\)/);
  });

  it("an open leaf lists its lines, a split line as its share of the quantity, and a dropped priced line flagged", () => {
    const leaf = st.items.find((i) => i.id === "i11")!;
    const held = lines.filter((l) => l.wbs_item_id === "i11" || l.wbs_parts.some((p) => p.wbs_item_id === "i11"));
    const out = clean(renderToString(createElement("ul", null, createElement(WbsRow, { item: leaf, figures: st.rollup.i11, items: ITEMS, lines: held, branchOpen: true, leafOpen: true, hasContent: true, canEdit: true, onToggle: noop, onAction: noop, onOpenLine: noop }))));
    expect(out).toContain("60 % of 337.1 m · 202.26 m · 84,949.20");
    expect(out).toContain("Handrail");
    const gone = st.items.find((i) => i.id === "i2")!;
    const out2 = clean(renderToString(createElement("ul", null, createElement(WbsRow, { item: gone, figures: st.rollup.i2, items: ITEMS, lines: lines.filter((l) => l.id === "b5"), branchOpen: true, leafOpen: true, hasContent: true, canEdit: true, onToggle: noop, onAction: noop, onOpenLine: noop }))));
    expect(out2).toContain("no longer in the file");
  });

  it("the Unassigned list shows five and 'Show all'", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ line: { ...lines[3], id: `u${i}`, item_no: `9.${i}` }, remainder: 100, split: false }));
    const out = clean(renderToString(createElement(UnassignedList, { entries: many, selected: new Set<string>(), onToggle: noop, canEdit: true, onSplit: noop, onOpenLine: noop })));
    expect(out.match(/data-guide="boq\.wbs_unassigned_line"/g)?.length).toBe(5);
    expect(out).toContain("Show all 8");
    expect(clean(renderToString(createElement(UnassignedList, { entries: [], selected: new Set<string>(), onToggle: noop, canEdit: true, onSplit: noop, onOpenLine: noop })))).toBe("");
  });

  it("an empty WBS says what to do next, and the BOQ's Group button is the way in", () => {
    const empty = clean(renderToString(createElement(WbsTree, { base: WBS_BASE, opportunityId: OPP, items: [], rollup: {}, lines, canEdit: true, selected: new Set<string>(), onToggle: noop, onChanged: noop, onError: noop, onNotice: noop, onSplit: noop, onOpenLine: noop } as never)));
    expect(empty).toContain("No WBS yet. Tick lines on the BOQ view and choose Group into WBS, or Split one line across items.");
    expect(empty).toContain('data-guide="boq.wbs_new"');
    expect(empty).not.toContain('data-guide="boq.wbs_renumber"');
  });
});

describe("the item form", () => {
  const form = (p: Record<string, unknown>) => clean(renderToString(createElement(WbsItemForm, { base: WBS_BASE, items: ITEMS, holders: new Set<string>(), onClose: noop, onDone: noop, onError: noop, initialOwners: [{ id: "e1", name: "Anas K", has_login: false }, { id: "e2", name: "Mona R", has_login: true }], ...p } as never)));
  it("a new item shows the code it will get and offers the owner as optional", () => {
    const out = form({ mode: "new" });
    expect(out).toContain('role="dialog"');
    expect(out).toContain("New WBS item");
    expect(out).toMatch(/placeholder="3"/);
    expect(out).toContain("No owner yet");
    expect(out).toContain("Anas K · no login yet");
    expect(out).toContain('aria-label="About Code"');
    expect(out).toContain('aria-label="About Parent"');
    expect(out).toContain('aria-label="About Owner"');
  });
  it("a new item under an item that holds lines says they move", () => {
    const out = form({ mode: "new", parentId: "i11", holders: new Set(["i11"]) });
    expect(out).toContain("1.1 holds lines. They move into this new item.");
  });
  it("an edited item cannot be moved under itself, its own sub-items or an item that holds lines", () => {
    const out = form({ mode: "edit", item: ITEMS[0], holders: new Set(["i2"]) });
    expect(out).not.toMatch(/<option[^>]*value="i1"/);
    expect(out).not.toMatch(/<option[^>]*value="i11"/);
    expect(out).toMatch(/<option[^>]*value="i2"[^>]*disabled=""/);
  });
});

describe("hygiene", () => {
  it("every WBS and BOQ tip fits the InfoTip limit", () => {
    for (const [k, t] of [...Object.entries(WBS_TIPS), ...Object.entries(BOQ_TABLE_TIPS)]) expect(tipTextProblems(t), k).toEqual([]);
    expect(tipTextProblems(WBS_PENDING)).toEqual([]);
  });
  it("carries no colour literal", () => {
    const files = ["BoqTab.tsx", "BoqRows.tsx", "BoqRowPanel.tsx", "wbs/GroupIntoWbs.tsx", "wbs/SplitPanel.tsx", "wbs/UnassignedList.tsx", "wbs/WbsItemForm.tsx", "wbs/WbsRow.tsx", "wbs/WbsTree.tsx", "wbs/Wbs.module.css"];
    for (const f of files) expect(read(`src/components/tender/${f}`).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const rendered = html({}, "boqview=wbs");
    expect(Object.values(pillar).reduce((h, p) => h.split(p.base).join(""), rendered)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it("prints no explanation as running text", () => {
    const out = html() + html({}, "boqview=wbs");
    for (const t of Object.values(WBS_TIPS)) expect(out.split(t).length - 1, t).toBe(0);
  });
  it("membershipOf reads a line's item and parts", () => {
    expect(membershipOf({ item: new Map([["a", "x"]]), parts: new Map([["b", [{ wbs_item_id: "y", share_pct: 100 }]]]) }, "b")).toEqual({ wbs_item_id: null, parts: [{ wbs_item_id: "y", share_pct: 100 }] });
  });
});

void BoqCards;
