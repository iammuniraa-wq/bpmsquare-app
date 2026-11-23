import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { ELEMENT_TIPS } from "./tips";
import { DEFAULT_PATTERN, resolveElementsSettings } from "./types";
import {
  cleanElementCode, extractSeq, insidePattern, maxCodeLength, nextSeq, parsePattern, planIssue, planReissue, previewCodes, renderCode, validatePattern, type IssueLine, type PatternPart,
} from "./pattern";
import {
  buildingCodeProblem, buildingOfItem, buildingOfLine, buildingsView, elementSplitProblem, normaliseBuildingCode, topItemOf, type BuildingItem, type ViewLine,
} from "./buildings";
import { budgetUses, clientQtyOf, repriceForQty, toleranceBand, varianceOf } from "./quantity";
import { matchRows, missingFromModel, parseBatch, planApply, type BatchRow, type CompareLine } from "./compare";
import { carryElements } from "./lines";
import { editProblem, parseElementEdit } from "./edit";
import { buildPayload, linesUnder, type NeutralLine } from "./rows";

const parts = (p = DEFAULT_PATTERN): PatternPart[] => {
  const r = parsePattern(p);
  if (!r.ok) throw new Error(r.error);
  return r.parts;
};

const item = (id: string, parent: string | null, over: Partial<BuildingItem> = {}): BuildingItem => ({
  id, code: id, name: `Item ${id}`, parent_id: parent, sort_order: 10, code_is_manual: false, owner_employee_id: null, created_at: "2026-11-01T00:00:00Z", building_code: null, ...over,
});

describe("tips", () => {
  it("every tip fits the InfoTip limit", () => {
    for (const [k, text] of Object.entries(ELEMENT_TIPS)) expect(tipTextProblems(text), k).toEqual([]);
  });
});

describe("settings", () => {
  it("fills every default and refuses a bad stored value", () => {
    const s = resolveElementsSettings(undefined);
    expect(s).toMatchObject({ pattern: DEFAULT_PATTERN, code_max: 20, qty_tolerance_pct: 5 });
    expect(s.level_names.building).toBe("Building");
    expect(resolveElementsSettings({ code_max: 3, qty_tolerance_pct: -4, pattern: "  " })).toMatchObject({ pattern: DEFAULT_PATTERN, code_max: 20, qty_tolerance_pct: 5 });
    expect(resolveElementsSettings({ code_max: 30, level_names: { building: "Area" } })).toMatchObject({ code_max: 30, level_names: { building: "Area", activity: "Activity" } });
  });
});

describe("the pattern", () => {
  it("parses the default and renders B01-HCS-0007", () => {
    expect(renderCode(parts(), { project: "CPR-0001", building: "B01", type: "HCS" }, 7)).toBe("B01-HCS-0007");
  });
  it("needs exactly one {seq}", () => {
    expect(parsePattern("{building}-{type}")).toEqual({ ok: false, error: "The pattern needs {seq:4}, the running number" });
    expect(parsePattern("{seq}-{seq:3}").ok).toBe(false);
    expect(parsePattern("{seq}").ok).toBe(true);
  });
  it("refuses unknown tokens, other literals and loose braces", () => {
    expect(parsePattern("{foo}-{seq:4}").ok).toBe(false);
    expect(parsePattern("{building}#{seq:4}").ok).toBe(false);
    expect(parsePattern("{building}ABC{seq:4}").ok).toBe(false);
    expect(parsePattern("{building-{seq:4}").ok).toBe(false);
    expect(parsePattern("{seq:7}").ok).toBe(false);
    expect(parsePattern("").ok).toBe(false);
  });
  it("checks the longest possible code against the limit", () => {
    expect(maxCodeLength(parts())).toBe(17);
    expect(validatePattern(DEFAULT_PATTERN, 20)).toMatchObject({ ok: true, max_length: 17 });
    const long = validatePattern("{project}-{building}-{type}-{seq:4}", 20);
    expect(long.ok).toBe(false);
    expect(validatePattern("{project}-{building}-{type}-{seq:4}", 40).ok).toBe(true);
    expect(validatePattern(DEFAULT_PATTERN, 12).ok).toBe(false);
  });
  it("previews two sample codes", () => {
    expect(previewCodes(parts())).toEqual(["B01-HCS-0001", "B01-HCS-0002"]);
  });
  it("reads the running number back out of a code of that pattern only", () => {
    const ctx = { project: null, building: "B01", type: "HCS" };
    expect(extractSeq(parts(), ctx, "B01-HCS-0007")).toBe(7);
    expect(extractSeq(parts(), ctx, "B02-HCS-0007")).toBeNull();
    expect(extractSeq(parts(), ctx, "B01-WAL-0007")).toBeNull();
    expect(extractSeq(parts(), ctx, "CLIENT-77")).toBeNull();
  });
  it("the next number is the highest issued plus one, and gaps are never refilled", () => {
    const ctx = { project: null, building: "B01", type: "HCS" };
    expect(nextSeq(parts(), ctx, [])).toBe(1);
    expect(nextSeq(parts(), ctx, ["B01-HCS-0001", "B01-HCS-0004", "B01-WAL-0009"])).toBe(5);
  });
  it("tells a code outside the pattern", () => {
    expect(insidePattern(parts(), "B01-HCS-0007")).toBe(true);
    expect(insidePattern(parts(), "PC-SLAB-77")).toBe(false);
  });
  it("cleans a typed code", () => {
    expect(cleanElementCode(" b01-hcs-7 ")).toEqual({ ok: true, code: "B01-HCS-7" });
    expect(cleanElementCode("bad code").ok).toBe(false);
    expect(cleanElementCode("-X").ok).toBe(false);
    expect(cleanElementCode("A".repeat(21), 20).ok).toBe(false);
    expect(cleanElementCode("", 20).ok).toBe(false);
  });
});

describe("issuing codes", () => {
  const line = (key: string, n: number, b: string | null, t: string | null, code: string | null = null, extra: Partial<IssueLine> = {}): IssueLine => ({ key, line_no: n, building_code: b, element_type: t, element_code: code, ...extra });
  const args = (lines: IssueLine[], existing: string[] = []) => ({ parts: parts(), codeMax: 20, project: "CPR-0001", lines, existing });

  it("numbers per building and type, in line order", () => {
    const plan = planIssue(args([line("a", 2, "B01", "HCS"), line("b", 1, "B01", "HCS"), line("c", 3, "B01", "WAL"), line("d", 4, "B02", "HCS")]));
    expect(plan.assignments.map((x) => [x.key, x.code])).toEqual([["b", "B01-HCS-0001"], ["a", "B01-HCS-0002"], ["c", "B01-WAL-0001"], ["d", "B02-HCS-0001"]]);
    expect(plan.summary).toContain("2 codes: B01-HCS-0001 to B01-HCS-0002");
    expect(plan.summary).toContain("1 code: B01-WAL-0001");
  });
  it("is idempotent: a line with a code is skipped and the next number goes on from the highest", () => {
    const plan = planIssue(args([line("a", 1, "B01", "HCS", "B01-HCS-0003"), line("b", 2, "B01", "HCS")], ["B01-HCS-0003"]));
    expect(plan.assignments).toEqual([{ key: "b", code: "B01-HCS-0004", building: "B01", type: "HCS" }]);
    expect(plan.skipped).toEqual([]);
  });
  it("never refills a gap", () => {
    const plan = planIssue(args([line("n", 9, "B01", "HCS")], ["B01-HCS-0001", "B01-HCS-0006"]));
    expect(plan.assignments[0].code).toBe("B01-HCS-0007");
  });
  it("skips a line with no building or no type and says why; a category line is not an element", () => {
    const plan = planIssue(args([line("a", 1, null, "HCS"), line("b", 2, "B01", null), line("c", 3, "B01", "HCS", null, { is_category: true })]));
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["Not in a building", "No element type"]);
  });
  it("steps over a code that is already taken and refuses what no longer fits", () => {
    const taken = planIssue(args([line("a", 1, "B01", "HCS")], ["B01-HCS-0001-X"]));
    expect(taken.assignments[0].code).toBe("B01-HCS-0001");
    const short = planIssue({ ...args([line("a", 1, "B01", "HCS")]), codeMax: 10 });
    expect(short.assignments).toEqual([]);
    expect(short.skipped[0].reason).toMatch(/limit is 10/);
    const full = planIssue({ parts: parts("{building}-{seq:1}"), codeMax: 20, project: null, lines: [line("a", 1, "B01", "HCS")], existing: Array.from({ length: 9 }, (_, i) => `B01-${i + 1}`) });
    expect(full.skipped[0].reason).toMatch(/Out of numbers/);
  });
  it("two runs give the same codes (deterministic)", () => {
    const lines = [line("a", 1, "B01", "HCS"), line("b", 2, "B01", "HCS")];
    expect(planIssue(args(lines)).assignments).toEqual(planIssue(args(lines)).assignments);
  });
  it("the same code in two revisions is the same element: reissue keeps the running number and flags clashes", () => {
    const lines = [{ key: "a", element_code: "B01-HCS-0007", building_code: "B03", element_type: "HCS" }, { key: "b", element_code: "CLIENT-9", building_code: "B03", element_type: "HCS" }];
    const r = planReissue({ parts: parts(), project: null, lines, change: { building: { from: "B01", to: "B03" } } });
    expect(r.rows).toEqual([{ key: "a", from: "B01-HCS-0007", to: "B03-HCS-0007" }]);
    expect(r.clashes).toEqual([]);
    const clash = planReissue({ parts: parts(), project: null, lines: [...lines, { key: "c", element_code: "B03-HCS-0007", building_code: "B03", element_type: "HCS" }], change: { building: { from: "B01", to: "B03" } } });
    expect(clash.clashes).toEqual(["B03-HCS-0007"]);
  });
});

describe("buildings", () => {
  const items: BuildingItem[] = [item("b1", null, { building_code: "B01", name: "Building 1" }), item("a1", "b1"), item("b2", null, { building_code: "B02", name: "Building 2" }), item("x", null)];
  it("derives a line's building from its WBS item, never stored", () => {
    expect(topItemOf(items, "a1")?.id).toBe("b1");
    expect(buildingOfItem(items, "a1")?.building_code).toBe("B01");
    expect(buildingOfItem(items, "x")).toBeNull();
    expect(buildingOfLine(items, { wbs_item_id: "a1", parts: [] })).toEqual({ kind: "one", code: "B01", item_id: "b1" });
    expect(buildingOfLine(items, { wbs_item_id: null, parts: [] })).toEqual({ kind: "none" });
    expect(buildingOfLine(items, { wbs_item_id: null, parts: [{ wbs_item_id: "b1", share_pct: 50 }, { wbs_item_id: "b2", share_pct: 50 }] })).toEqual({ kind: "mixed", codes: ["B01", "B02"] });
  });
  it("a building is level 1 only, unique, and 1 to 6 characters", () => {
    expect(buildingCodeProblem(items, null, null, "B03")).toBeNull();
    expect(buildingCodeProblem(items, null, "b1", "B03")).toBe("A building is a top-level item");
    expect(buildingCodeProblem(items, "a1", null, "B03")).toBe("A building is a top-level item");
    expect(buildingCodeProblem(items, null, null, "B01")).toBe("B01 is already a building here");
    expect(buildingCodeProblem(items, "b1", null, "B01")).toBeNull();
    expect(buildingCodeProblem(items, null, null, "TOOLONG1")).toMatch(/1 to 6/);
    expect(normaliseBuildingCode(" b01 ")).toBe("B01");
    expect(normaliseBuildingCode("b 1")).toBeNull();
  });
  it("an element cannot be split across buildings, but can be split across activities of one", () => {
    const wide = { wbs_item_id: null, parts: [{ wbs_item_id: "b1", share_pct: 50 }, { wbs_item_id: "b2", share_pct: 50 }] };
    expect(elementSplitProblem(items, wide, true)).toBe("An element belongs to one building");
    expect(elementSplitProblem(items, wide, false)).toBeNull();
    const two = [...items, item("a2", "b1")];
    expect(elementSplitProblem(two, { wbs_item_id: null, parts: [{ wbs_item_id: "a1", share_pct: 50 }, { wbs_item_id: "a2", share_pct: 50 }] }, true)).toBeNull();
  });
  const vl = (key: string, where: string | null, over: Partial<ViewLine> = {}): ViewLine => ({
    key, wbs_item_id: where, parts: [], qty: 10, client_amount: 1000, cost: 800, client_rate: 100, element_type: "HCS", element_code: null, client_qty: 10, model_qty: null, ...over,
  });
  it("sums lines, elements, money and variance per building", () => {
    const view = buildingsView(items, [
      vl("1", "a1", { model_qty: 11 }), vl("2", "b2", { model_qty: 10 }), vl("3", null), vl("4", "x"), vl("5", "a1", { element_type: null }), vl("6", "a1", { is_category: true, client_amount: 0, client_rate: null, cost: 50 }),
    ], 5);
    const b1 = view.buildings.find((b) => b.code === "B01")!;
    expect(b1.line_count).toBe(3);
    expect(b1.element_count).toBe(1);
    expect(b1.client_amount).toBe(2000);
    expect(b1.variance_amount).toBe(100);
    expect(b1.outside_tolerance).toBe(1);
    expect(b1.worst_band).toBe("over");
    expect(b1.types).toEqual([{ type: "HCS", count: 1, client_qty: 10, model_qty: 11, outside: 1 }]);
    expect(view.buildings.find((b) => b.code === "B02")!.worst_band).toBe("within");
    expect(view.no_building).toEqual({ line_count: 2, client_amount: 2000 });
    expect(view.totals.line_count).toBe(4);
  });
  it("a split line counts in each building by its share, and the removed one not at all", () => {
    const view = buildingsView(items, [vl("s", null, { parts: [{ wbs_item_id: "b1", share_pct: 60 }, { wbs_item_id: "b2", share_pct: 40 }], element_type: null }), vl("r", "a1", { removed: true })], 5);
    expect(view.buildings.map((b) => [b.code, b.line_count, b.client_amount])).toEqual([["B01", 1, 600], ["B02", 1, 400]]);
  });
});

describe("quantities", () => {
  it("the contracted quantity is the client's, else the budget's while the line is a contract line", () => {
    expect(clientQtyOf({ client_qty: 100, qty: 120, client_rate: 5 })).toBe(100);
    expect(clientQtyOf({ client_qty: null, qty: 120, client_rate: 5 })).toBe(120);
    expect(clientQtyOf({ client_qty: null, qty: 120, client_rate: null })).toBeNull();
  });
  it("budget uses the model quantity only once accepted", () => {
    expect(budgetUses({ qty: 100, client_qty: 100, model_qty: 110, client_rate: 5 })).toBe("client");
    expect(budgetUses({ qty: 110, client_qty: 100, model_qty: 110, client_rate: 5 })).toBe("model");
    expect(budgetUses({ qty: 100, client_qty: 100, model_qty: 100, client_rate: 5 })).toBe("client");
    expect(budgetUses({ qty: 7, client_qty: 100, model_qty: null, client_rate: 5 })).toBe("client");
  });
  it("variance in quantity, percent and money at the client rate", () => {
    expect(varianceOf(100, 106, 12.5)).toEqual({ qty: 6, pct: 6, money: 75 });
    expect(varianceOf(0, 5, 10)).toEqual({ qty: 5, pct: null, money: 50 });
    expect(varianceOf(3, 2, 1.5).money).toBe(-1.5);
  });
  it("tolerance bands: within, over, red at twice", () => {
    expect(toleranceBand(5, 5)).toBe("within");
    expect(toleranceBand(-5, 5)).toBe("within");
    expect(toleranceBand(5.01, 5)).toBe("over");
    expect(toleranceBand(10, 5)).toBe("over");
    expect(toleranceBand(10.01, 5)).toBe("red");
    expect(toleranceBand(null, 5)).toBe("none");
    expect(toleranceBand(0, 0)).toBe("within");
  });
  it("accepting a model quantity re-prices by line, keeps the typed WBS cost, and never touches the contract side", () => {
    expect(repriceForQty({ qty: 100, unit_cost: 10, amount: 1000, allocated: true }, 110, "line")).toEqual({ qty: 110, amount: 1100, unit_cost: 10 });
    expect(repriceForQty({ qty: 100, unit_cost: 10, amount: 1000, allocated: true }, 110, "package")).toEqual({ qty: 110, amount: 1000, unit_cost: 9.0909 });
    expect(repriceForQty({ qty: 100, unit_cost: 0, amount: 0, allocated: false }, 110, "line")).toEqual({ qty: 110, amount: 0, unit_cost: 0 });
  });
});

describe("the model comparison", () => {
  const lines: CompareLine[] = [
    { key: "k1", line_no: 1, building_code: "B01", element_type: "HCS", element_code: "B01-HCS-0001", qty: 100, unit: "m2" },
    { key: "k2", line_no: 2, building_code: "B01", element_type: "WAL", element_code: null, qty: 40, unit: "m2" },
    { key: "k3", line_no: 3, building_code: "B01", element_type: "COL", element_code: "B01-COL-0001", qty: 8, unit: "no" },
    { key: "k4", line_no: 4, building_code: "B02", element_type: "HCS", element_code: "B02-HCS-0001", qty: 30, unit: "m2" },
    { key: "k5", line_no: 5, building_code: "B01", element_type: "HCS", element_code: null, qty: 1, unit: "m2", is_category: true },
  ];
  const row = (over: Partial<BatchRow>): BatchRow => ({ building_code: "B01", building_name: null, element_type: "HCS", element_code: null, qty: 1, unit: "m2", drawing_no: null, drawing_rev: null, ...over });

  it("matches by element code first", () => {
    const m = matchRows([row({ element_code: "B01-HCS-0001", qty: 100 }), row({ element_code: "B01-HCS-0001", qty: 130 })], lines, new Set(["B01", "B02"]));
    expect(m[0]).toMatchObject({ kind: "same", matched_key: "k1" });
    // two rows fit one line: neither is applied on its own
    expect(m.every((x) => x.ambiguous)).toBe(true);
    const one = matchRows([row({ element_code: "B01-HCS-0001", qty: 130 })], lines, new Set(["B01"]));
    expect(one[0]).toMatchObject({ kind: "qty_changed", matched_key: "k1", current_qty: 100, ambiguous: false });
  });
  it("else by building, type and unit, when exactly one uncoded line fits", () => {
    const m = matchRows([row({ element_type: "WAL", qty: 44 })], lines, new Set(["B01"]));
    expect(m[0]).toMatchObject({ kind: "qty_changed", matched_key: "k2" });
    const none = matchRows([row({ element_type: "BEM", qty: 4 })], lines, new Set(["B01"]));
    expect(none[0]).toMatchObject({ kind: "new_element", matched_key: null });
  });
  it("never matches a cost-only category line, and flags several candidates as ambiguous", () => {
    const m = matchRows([row({ element_type: "HCS", qty: 5 })], lines, new Set(["B01"]));
    expect(m[0].matched_key).toBeNull();
    const two = [...lines, { key: "k6", line_no: 6, building_code: "B01", element_type: "WAL", element_code: null, qty: 2, unit: "m2" }];
    expect(matchRows([row({ element_type: "WAL", qty: 5 })], two, new Set(["B01"]))[0]).toMatchObject({ kind: "new_element", ambiguous: true });
  });
  it("an unknown building makes a new building row", () => {
    const m = matchRows([row({ building_code: "B09", building_name: "Block 9", element_code: "B09-HCS-0001" })], lines, new Set(["B01"]));
    expect(m[0].kind).toBe("new_building");
  });
  it("flags what the model leaves out, only in the buildings it mentions, never deleting", () => {
    const rows = [row({ element_code: "B01-HCS-0001", qty: 100 })];
    const matched = matchRows(rows, lines, new Set(["B01", "B02"]));
    const gone = missingFromModel(rows, matched, lines);
    expect(gone.map((g) => g.matched_key)).toEqual(["k2", "k3"]);
    expect(gone.every((g) => g.kind === "not_in_model" && g.qty === 0)).toBe(true);
  });
  it("applies only ticked, unambiguous rows and never a same or a not-in-model row", () => {
    const rows = [row({ element_code: "B01-HCS-0001", qty: 130 }), row({ element_code: "B01-COL-0001", qty: 8 }), row({ building_code: "B09", building_name: "Block 9", element_code: "B09-WAL-0001", element_type: "WAL", qty: 12 }), row({ element_type: "BEM", qty: 4 })];
    const matched = [...matchRows(rows, lines, new Set(["B01"])), ...missingFromModel(rows, matchRows(rows, lines, new Set(["B01"])), lines)];
    const plan = planApply(matched, new Set(matched.map((m) => m.row_no)));
    expect(plan.quantities).toEqual([{ row_no: 1, line_key: "k1", from: 100, to: 130 }]);
    expect(plan.newElements.map((n) => n.element_code ?? n.element_type)).toEqual(["B09-WAL-0001", "BEM"]);
    expect(plan.newBuildings).toEqual([{ code: "B09", name: "Block 9" }]);
    expect(plan.skipped.length).toBeGreaterThan(0);
    expect(planApply(matched, new Set()).quantities).toEqual([]);
  });
  it("parses a batch in the connector's shape and names the bad row", () => {
    const ok = parseBatch({ source: "connector", model_ref: "Revit v3", rows: [{ building_code: "b01", element_type: "hcs", element_code: "b01-hcs-0001", qty: "12.5", unit: "m2" }] });
    expect(ok).toMatchObject({ ok: true, batch: { source: "connector", model_ref: "Revit v3", rows: [{ building_code: "B01", element_type: "HCS", element_code: "B01-HCS-0001", qty: 12.5 }] } });
    expect(parseBatch({ rows: [{ element_type: "HCS", qty: -1 }] })).toMatchObject({ ok: false, row: 1 });
    expect(parseBatch({ rows: [{ qty: 1 }] })).toMatchObject({ ok: false, row: 1, error: "A row needs an element type or an element code" });
    expect(parseBatch({ rows: [] }).ok).toBe(false);
    expect(parseBatch({ rows: [{ element_type: "H", qty: 1 }] })).toMatchObject({ ok: false });
  });
});

describe("carrying the element fields", () => {
  it("a grid save keeps each stored line's element and gives a new line none", () => {
    const before = [{ line_key: "k1", element_type: "HCS", element_code: "B01-HCS-0001", client_qty: 100, model_qty: 110 }];
    const saved = carryElements([
      { line_key: "k1", resource_code: null, cost_code: null, wbs: null, description: "a", qty: 1, unit: null, unit_cost: 0, cost_known: true, source_ref: null, reserve: false, element_code: "HACKED" },
      { line_key: null, resource_code: null, cost_code: null, wbs: null, description: "b", qty: 1, unit: null, unit_cost: 0, cost_known: true, source_ref: null, reserve: false, element_code: "HACKED" },
    ], before);
    expect(saved[0]).toMatchObject({ element_type: "HCS", element_code: "B01-HCS-0001", client_qty: 100, model_qty: 110 });
    expect(saved[1]).toMatchObject({ element_type: null, element_code: null, client_qty: null, model_qty: null });
  });
});

describe("editing one line", () => {
  const types = new Set(["HCS", "WAL"]);
  const target = { element_type: "HCS", element_code: "B01-HCS-0001", model_qty: null, is_category: false, mixed: false, building_code: "B01" };
  it("parses type, code and model quantity, and refuses a type that is not in the list", () => {
    expect(parseElementEdit({ element_type: "wal", element_code: "x-1", model_qty: "4.5" }, { types })).toEqual({ ok: true, edit: { element_type: "WAL", element_code: "X-1", model_qty: 4.5 } });
    expect(parseElementEdit({ element_type: "ZZZ" }, { types }).ok).toBe(false);
    expect(parseElementEdit({ element_type: "ZZZ" }, { types, keep: "ZZZ" }).ok).toBe(true);
    expect(parseElementEdit({ element_code: null, model_qty: "" }, { types })).toEqual({ ok: true, edit: { element_code: null, model_qty: null } });
    expect(parseElementEdit({}, { types })).toEqual({ ok: false, error: "Nothing to change" });
    expect(parseElementEdit({ accept_model: true, use_client: true }, { types }).ok).toBe(false);
    expect(parseElementEdit({ model_qty: -2 }, { types }).ok).toBe(false);
  });
  it("refuses a code on a category line, on a line split across buildings, and a type change under an issued code", () => {
    expect(editProblem({ ...target, is_category: true }, { element_code: "A-1" })).toMatch(/contract line/);
    expect(editProblem({ ...target, mixed: true, element_code: null }, { element_code: "A-1" })).toBe("An element belongs to one building. Put the line in one building first");
    expect(editProblem(target, { element_type: "WAL" })).toMatch(/Clear the code first/);
    expect(editProblem(target, { element_type: "WAL", element_code: null })).toBeNull();
    expect(editProblem({ ...target, element_code: null }, { element_type: "WAL" })).toBeNull();
    expect(editProblem(target, { accept_model: true })).toBe("There is no model quantity to accept yet");
    expect(editProblem({ ...target, model_qty: 5 }, { accept_model: true })).toBeNull();
  });
});

describe("the payload", () => {
  const items: BuildingItem[] = [item("b1", null, { building_code: "B01", name: "Building 1" }), item("a1", "b1")];
  const nl = (key: string, over: Partial<NeutralLine> = {}): NeutralLine => ({
    key, line_no: 1, ref: null, description: key, unit: "m2", qty: 10, client_qty: 10, model_qty: null, client_rate: 5, client_amount: 50, cost: null, element_type: "HCS", element_code: null,
    wbs_item_id: "a1", parts: [], ...over,
  });
  it("counts what Issue codes would do and what lacks a type, and flags a client's own code outside the pattern", () => {
    const p = buildPayload(items, [nl("a"), nl("b", { element_type: null }), nl("c", { element_code: "PC-77" }), nl("d", { element_code: "B01-HCS-0001" }), nl("e", { wbs_item_id: null })], { pattern: DEFAULT_PATTERN, qty_tolerance_pct: 5 });
    expect(p.issuable).toBe(1);
    expect(p.untyped).toBe(1);
    const byKey = new Map(p.rows.map((r) => [r.key, r]));
    expect(byKey.get("c")?.outside_pattern).toBe(true);
    expect(byKey.get("d")?.outside_pattern).toBe(false);
    expect(byKey.get("a")).toMatchObject({ building_code: "B01", building_name: "Building 1", uses: "client" });
    expect(byKey.get("e")?.building_code).toBeNull();
  });
  it("counts the lines under a building, for the refusal to remove one that holds some", () => {
    expect(linesUnder(items, [{ wbs_item_id: "a1", parts: [] }, { wbs_item_id: null, parts: [] }], "b1")).toBe(1);
    expect(linesUnder(items, [{ wbs_item_id: null, parts: [] }], "b1")).toBe(0);
  });
});
