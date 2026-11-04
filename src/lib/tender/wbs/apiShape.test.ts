import { describe, expect, it } from "vitest";
import { annotator, buildWbsApi, parseWbsCell, pctCell, sameShares, TENDER_WBS_FIELDS, wbsCodeText } from "./apiShape";
import type { LineMembers, WbsItemRow } from "./types";

// The text format of "where a BOQ line sits" (one for Data Workbench, the v1 API and the MCP tool) and the API's view of the tree. PURE.
// What a machine may see of the WBS is a code, a name, a share and a CLIENT amount; no test below needs a cost to exist for the rule to hold.

const item = (id: string, code: string, name: string, parent: string | null, sort: number, over: Partial<WbsItemRow> = {}): WbsItemRow => ({
  id, code, name, parent_id: parent, sort_order: sort, code_is_manual: false, owner_employee_id: null, opportunity_id: "o1", note: null, ...over,
});
const ITEMS = [
  item("A", "1", "Civil", null, 10), item("B", "2", "Mechanical", null, 20), item("B1", "2.1", "Fabrication", "B", 10), item("B2", "2.2", "Galvanising", "B", 20), item("B3", "2.3", "Erection", "B", 30),
  item("C", "C-100", "ERP code", null, 30, { code_is_manual: true }),
];
const members = (item: Record<string, string | null>, parts: Record<string, { wbs_item_id: string; share_pct: number }[]> = {}): LineMembers =>
  ({ item: new Map(Object.entries(item)), parts: new Map(Object.entries(parts)) });
const codeOf = (id: string) => ITEMS.find((i) => i.id === id)?.code;

describe("the cell text", () => {
  it("is empty for an unassigned line, the code for a whole line and code:percent joined by ; for a split one", () => {
    expect(wbsCodeText([], codeOf)).toBe("");
    expect(wbsCodeText([{ wbs_item_id: "A", share_pct: 100 }], codeOf)).toBe("1");
    expect(wbsCodeText([{ wbs_item_id: "B1", share_pct: 60 }, { wbs_item_id: "B2", share_pct: 15 }, { wbs_item_id: "B3", share_pct: 25 }], codeOf)).toBe("2.1:60;2.2:15;2.3:25");
    // A left-over share after an item was removed is written as it stands, so it is never printed as a whole line.
    expect(wbsCodeText([{ wbs_item_id: "B1", share_pct: 60 }], codeOf)).toBe("2.1:60");
  });

  it("writes a share without trailing zeros", () => {
    expect([60, 12.5, 33.3333, 0.25].map(pctCell)).toEqual(["60", "12.5", "33.3333", "0.25"]);
  });

  it("reads back what it writes", () => {
    for (const text of ["1", "2.1:60;2.2:15;2.3:25", "C-100", "2.1:12.5;2.2:87.5"]) {
      const cell = parseWbsCell(text, ITEMS);
      expect(cell.ok, text).toBe(true);
      if (cell.ok && cell.kind === "shares") expect(wbsCodeText(cell.shares, codeOf), text).toBe(text);
    }
  });
});

describe("reading a cell", () => {
  const ok = (t: string) => parseWbsCell(t, ITEMS);
  const err = (t: string) => { const c = ok(t); if (c.ok) throw new Error(`expected an error for ${t}`); return c.error; };

  it("empty is Unassigned, a code is the whole line, and spaces, %, a decimal comma and case do not matter", () => {
    expect(ok("  ")).toEqual({ ok: true, kind: "clear" });
    expect(ok("2.1")).toEqual({ ok: true, kind: "shares", shares: [{ wbs_item_id: "B1", share_pct: 100 }] });
    expect(ok("c-100")).toEqual({ ok: true, kind: "shares", shares: [{ wbs_item_id: "C", share_pct: 100 }] });
    expect(ok(" 2.1 : 60 % ; 2.2:40 ")).toEqual({ ok: true, kind: "shares", shares: [{ wbs_item_id: "B1", share_pct: 60 }, { wbs_item_id: "B2", share_pct: 40 }] });
    expect(ok("2.1:12,5;2.2:87,5")).toMatchObject({ ok: true });
  });

  it("one share at 100 is a whole line, not a split", () => {
    expect(ok("2.1:100")).toEqual({ ok: true, kind: "shares", shares: [{ wbs_item_id: "B1", share_pct: 100 }] });
  });

  it("refuses a sum that is not 100 and says what it was", () => {
    expect(err("2.1:60;2.2:30")).toBe("WBS shares add up to 90 %, not 100 %");
    expect(err("2.1:60;2.2:50")).toBe("WBS shares add up to 110 %, not 100 %");
    expect(err("2.1:60")).toBe("WBS shares add up to 60 %, not 100 %");
    expect(parseWbsCell("2.1:60", ITEMS)).toMatchObject({ ok: false, partial: [{ wbs_item_id: "B1", share_pct: 60 }] });
    expect(ok("2.1:99.995;2.2:0.01")).toMatchObject({ ok: true });
  });

  it("names the problem: unknown code, missing share, repeated code, a share that is not a number, zero", () => {
    expect(err("9.9")).toBe("WBS 9.9 does not exist on this tender");
    expect(err("9.9:50;2.1:50")).toBe("WBS 9.9 does not exist on this tender");
    expect(err("2.1;2.2:50")).toBe("WBS 2.1 needs a share, like 2.1:60");
    expect(err("2.1:50;2.1:50")).toBe("WBS 2.1 appears twice");
    expect(err("2.1:lots;2.2:50")).toBe('WBS 2.1: "lots" is not a share');
    expect(err("2.1:0;2.2:100")).toBe("Every WBS share must be more than 0 %");
    expect(err(":50;2.2:50")).toBe('":50" has no WBS code');
  });

  it("matches the exact code first and a different case only when it names one item", () => {
    const twins = [item("X", "a1", "lower", null, 10), item("Y", "A1", "upper", null, 20), item("Z", "b1", "only", null, 30)];
    expect(parseWbsCell("a1", twins)).toMatchObject({ shares: [{ wbs_item_id: "X" }] });
    expect(parseWbsCell("A1", twins)).toMatchObject({ shares: [{ wbs_item_id: "Y" }] });
    expect(parseWbsCell("B1", twins)).toMatchObject({ shares: [{ wbs_item_id: "Z" }] });
  });

  it("compares two sets of shares without regard to order", () => {
    expect(sameShares([{ wbs_item_id: "A", share_pct: 60 }, { wbs_item_id: "B", share_pct: 40 }], [{ wbs_item_id: "B", share_pct: 40 }, { wbs_item_id: "A", share_pct: 60 }])).toBe(true);
    expect(sameShares([{ wbs_item_id: "A", share_pct: 60 }], [{ wbs_item_id: "A", share_pct: 61 }])).toBe(false);
    expect(sameShares([], [])).toBe(true);
    expect(sameShares([{ wbs_item_id: "A", share_pct: 100 }], [])).toBe(false);
  });
});

describe("the two WBS fields of a BOQ row", () => {
  it("a whole line has its code and no parts; an unassigned one has neither", () => {
    const at = annotator(ITEMS, members({ l1: "A", l2: null }));
    expect(at("l1", 10, 500)).toEqual({ wbs_code: "1", wbs_parts: [] });
    expect(at("l2", 10, 500)).toEqual({ wbs_code: null, wbs_parts: [] });
    expect(at("unknown", 10, 500)).toEqual({ wbs_code: null, wbs_parts: [] });
  });

  it("a split line lists each share with its quantity and client amount, and the parts add up to the line exactly", () => {
    const parts = [{ wbs_item_id: "B1", share_pct: 60 }, { wbs_item_id: "B2", share_pct: 15 }, { wbs_item_id: "B3", share_pct: 25 }];
    const at = annotator(ITEMS, members({ stair: null }, { stair: parts }));
    const r = at("stair", 337.1, 141582);
    expect(r.wbs_code).toBe("2.1:60;2.2:15;2.3:25");
    expect(r.wbs_parts.map((p) => p.wbs_code)).toEqual(["2.1", "2.2", "2.3"]);
    expect(r.wbs_parts.map((p) => p.share_pct)).toEqual([60, 15, 25]);
    expect(r.wbs_parts[0]).toMatchObject({ quantity: 202.26, amount: 84949.2 });
    expect(Math.round(r.wbs_parts.reduce((s, p) => s + p.quantity, 0) * 100) / 100).toBe(337.1);
    expect(Math.round(r.wbs_parts.reduce((s, p) => s + (p.amount ?? 0), 0) * 100) / 100).toBe(141582);
  });

  it("an unpriced split line has a share of the quantity and no amount", () => {
    const at = annotator(ITEMS, members({ l: null }, { l: [{ wbs_item_id: "B1", share_pct: 50 }, { wbs_item_id: "B2", share_pct: 50 }] }));
    expect(at("l", 10, null).wbs_parts).toEqual([
      { wbs_code: "2.1", share_pct: 50, quantity: 5, amount: null }, { wbs_code: "2.2", share_pct: 50, quantity: 5, amount: null },
    ]);
  });

  it("while the WBS is pending (no members) every line is unassigned", () => {
    expect(annotator([], null)("l1", 1, 1)).toEqual({ wbs_code: null, wbs_parts: [] });
  });
});

describe("the tree as the v1 endpoint answers it", () => {
  const rows = [
    { id: "stair", item_no: "2.4", quantity: 337.1, amount: 141582, status: "priced" },
    { id: "slab", item_no: "1.1", quantity: 100, amount: 2000, status: "priced" },
    { id: "pipe", item_no: "1.2", quantity: 5, amount: null, status: "unpriced", unit_cost: 77, markup_pct: 12 },
    { id: "gone", item_no: "9.9", quantity: 1, amount: 700, status: "removed" },
    { id: "loose", item_no: "3.1", quantity: 4, amount: 400, status: "priced" },
  ];
  const m = members(
    { stair: null, slab: "A", pipe: "A", gone: "C", loose: null },
    { stair: [{ wbs_item_id: "B1", share_pct: 60 }, { wbs_item_id: "B2", share_pct: 15 }, { wbs_item_id: "B3", share_pct: 25 }] },
  );
  const names = new Map([["emp1", "Anas Khan"]]);
  const answer = buildWbsApi("o1", [{ ...ITEMS[0], owner_employee_id: "emp1" }, ...ITEMS.slice(1)], names, rows, m);
  const by = (code: string) => answer.items.find((i) => i.code === code)!;

  it("lists the items in tree order with level, parent code and the owner's name", () => {
    expect(answer.items.map((i) => [i.code, i.level, i.parent_code])).toEqual([["1", 1, null], ["2", 1, null], ["2.1", 2, "2"], ["2.2", 2, "2"], ["2.3", 2, "2"], ["C-100", 1, null]]);
    expect(by("1").owner_name).toBe("Anas Khan");
    expect(by("2").owner_name).toBeNull();
    expect(by("1").tender_id).toBe("o1");
  });

  it("rolls the client amount up the tree by share, and the whole equals the lines assigned (no double count)", () => {
    expect(by("2.1").client_amount).toBe(84949.2);
    expect(by("2.2").client_amount).toBe(21237.3);
    expect(by("2.3").client_amount).toBe(35395.5);
    expect(by("2").client_amount).toBe(141582);
    expect(by("1").client_amount).toBe(2000);
    expect(answer.total.client_amount).toBe(143582);
    expect(by("2").line_count).toBe(3);
    expect(by("2").shared_count).toBe(3);
    expect(by("1").line_count).toBe(2);
    expect(by("1").priced_count).toBe(1);
  });

  it("each item lists its own parts: a share of a line with its quantity and client amount", () => {
    expect(by("2.1").parts).toEqual([{ boq_line_id: "stair", item_no: "2.4", share_pct: 60, quantity: 202.26, amount: 84949.2, status: "priced" }]);
    expect(by("1").parts.map((p) => [p.item_no, p.share_pct, p.amount])).toEqual([["1.1", 100, 2000], ["1.2", 100, null]]);
  });

  it("a line no longer in the file is listed with its status but is not counted", () => {
    expect(by("C-100").parts).toEqual([{ boq_line_id: "gone", item_no: "9.9", share_pct: 100, quantity: 1, amount: 700, status: "removed" }]);
    expect(by("C-100").client_amount).toBe(0);
    expect(by("C-100").line_count).toBe(0);
  });

  it("counts what sits in no item", () => {
    expect(answer.unassigned).toEqual({ lines: 1, client_amount: 400 });
    const left = buildWbsApi("o1", ITEMS, names, rows, members({ stair: null, slab: "A", pipe: "A", gone: "C", loose: null }, { stair: [{ wbs_item_id: "B1", share_pct: 60 }] }));
    expect(left.unassigned).toEqual({ lines: 2, client_amount: 56632.8 + 400 });
  });

  it("carries no cost, no margin and no employee id, however the rows came", () => {
    const text = JSON.stringify(answer.items);
    for (const secret of ["unit_cost", "markup", "margin", "cost", "77", "emp1", "owner_employee_id"]) expect(text, secret).not.toContain(secret);
    // The key set of an item is exactly what the endpoint declares queryable.
    for (const i of answer.items) expect(Object.keys(i).sort()).toEqual(TENDER_WBS_FIELDS.map((f) => f.path).sort());
    // The owner's id is kept apart for the Data Workbench export only.
    expect(answer.ownerIds.get("A")).toBe("emp1");
  });
});
