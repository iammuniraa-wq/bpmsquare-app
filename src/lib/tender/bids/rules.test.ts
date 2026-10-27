import { describe, expect, it } from "vitest";
import { defaultQuoteVersion, BID_LINE_FIELDS, buildSnapshot, deltaText, diffBids, lineKeys, parseStoredLines, parseSubmit, snapshotLine, submitProblem, type BidLine, type SnapshotSource } from "./rules";

// Bid versions (slice 4): what a snapshot keeps, how two versions are compared, and the rules for submitting.

const dl = (id: string, sl_no: string | null, description: string, qty: number, rate: number, over: Record<string, unknown> = {}): SnapshotSource & Record<string, unknown> =>
  ({ id, sl_no, description, uom: "Nos", qty, rate, discount_pct: 0, amount: qty * rate, product_id: null, group_id: null, group_type: null, break_of: null, is_selected: true, ...over });

const bid = (lines: BidLine[]) => ({ lines, total: lines.reduce((s, l) => s + l.amount, 0) });
const L = (item_no: string | null, description: string, qty: number, rate: number, unit: string | null = "Nos"): BidLine =>
  ({ key: item_no ? `no:${item_no}` : `tx:${description.toLowerCase()}|${(unit ?? "").toLowerCase()}`, item_no, description, unit, qty, rate, amount: Math.round(qty * rate * 100) / 100, product_ref: null, price_source: null });

describe("the snapshot", () => {
  it("keeps the order it is given (the client's file order) and the total of the counted lines", () => {
    const snap = buildSnapshot([dl("c", "1.10", "Third", 1, 30), dl("a", "1.2", "First", 2, 10), dl("b", "1.3", "Second", 3, 5)]);
    expect(snap.lines.map((l) => l.description)).toEqual(["Third", "First", "Second"]);
    expect(snap.total).toBe(65);
    expect(snap.line_count).toBe(3);
  });

  it("never carries a cost, a markup, a margin or a pricing flag, whatever the row holds", () => {
    const row = dl("a", "1.1", "Gate valve", 2, 100, { unit_cost: 60, markup_pct: 66.6, cost_price: 55, margin: 0.4, pricing_flags: [{ code: "floor" }], pricing_document_id: "pd1", cost: 1, rfq_line_id: "r1" });
    const snap = buildSnapshot([row], { productRef: new Map(), priceSource: new Map([["a", "Supplier"]]) });
    expect(Object.keys(snap.lines[0]).sort()).toEqual([...BID_LINE_FIELDS].sort());
    const text = JSON.stringify(snap);
    for (const leak of ["unit_cost", "markup", "cost_price", "margin", "pricing_flags", "pricing_document_id", "rfq_line_id", "66.6"]) expect(text, leak).not.toContain(leak);
    expect(snap.lines[0].price_source).toBe("Supplier");
  });

  it("counts only the lines that count toward the deal total (a non-chosen alternative and a quantity break do not)", () => {
    const snap = buildSnapshot([
      dl("base", "1", "Pipe", 10, 5),
      dl("alt1", "2", "Option A", 1, 100, { group_id: "g", group_type: "alternative", is_selected: true }),
      dl("alt2", "3", "Option B", 1, 900, { group_id: "g", group_type: "alternative", is_selected: false }),
      dl("brk", "4", "Pipe 100+", 100, 4, { break_of: "base" }),
    ]);
    expect(snap.lines.map((l) => l.description)).toEqual(["Pipe", "Option A"]);
    expect(snap.total).toBe(150);
  });

  it("gives repeated item numbers or wordings their own key, and an item-less line a key from its wording and unit", () => {
    const keys = lineKeys([
      { item_no: "1.1", description: "A", unit: null }, { item_no: "1.1", description: "A", unit: null },
      { item_no: null, description: "Mobilisation", unit: "lot" }, { item_no: null, description: "  mobilisation ", unit: "LOT" },
    ]);
    expect(new Set(keys).size).toBe(4);
    expect(keys[2]).toBe("tx:mobilisation|lot");
  });

  it("reads stored lines back through the same whitelist and drops malformed rows", () => {
    const stored = [{ key: "no:1", description: "Pipe", qty: "2", rate: "5", amount: "10", unit_cost: 3, item_no: "1" }, "junk", { description: "no key" }, null];
    const parsed = parseStoredLines(stored);
    expect(parsed).toHaveLength(1);
    expect(Object.keys(parsed[0]).sort()).toEqual([...BID_LINE_FIELDS].sort());
    expect(parsed[0]).toMatchObject({ qty: 2, rate: 5, amount: 10 });
    expect(snapshotLine({ ...parsed[0], ...{ unit_cost: 3 } } as BidLine)).not.toHaveProperty("unit_cost");
    expect(parseStoredLines("nope")).toEqual([]);
  });
});

describe("comparing two versions", () => {
  const v1 = bid([L("1", "Gate valve", 4, 100), L("2", "Pipe 110mm", 100, 12), L("3", "Mobilisation", 1, 5000, "lot")]);

  it("finds lines added, removed and changed (rate and quantity), and the total's change in amount and percent", () => {
    const v2 = bid([L("1", "Gate valve", 4, 90), L("2", "Pipe 110mm", 120, 12), L("4", "Testing", 1, 800, "lot")]);
    const d = diffBids(v1, v2);
    expect(d.added.map((l) => l.item_no)).toEqual(["4"]);
    expect(d.removed.map((l) => l.item_no)).toEqual(["3"]);
    expect(d.changed.map((c) => [c.item_no, c.fields])).toEqual([["1", ["rate"]], ["2", ["qty"]]]);
    expect(d.changed[0].amount_delta).toBe(-40);
    expect(d.total_from).toBe(6600);
    expect(d.total_to).toBe(2600);
    expect(d.delta).toBe(d.total_to - d.total_from);
    expect(d.delta_pct).toBe(Math.round((d.delta / d.total_from) * 10000) / 100);
    expect(d.unchanged).toBe(0);
  });

  it("is not fooled by reordering: moved lines are neither added nor removed nor changed", () => {
    const v2 = bid([v1.lines[2], v1.lines[0], v1.lines[1]]);
    const d = diffBids(v1, v2);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(3);
    expect(d.delta).toBe(0);
    expect(d.delta_pct).toBe(0);
  });

  it("notices a changed unit or wording, and ignores an amount that differs only by rounding", () => {
    const v2 = bid([{ ...v1.lines[0], unit: "Set" }, { ...v1.lines[1], description: "Pipe 110mm PVC" }, { ...v1.lines[2], amount: 5000.004 }]);
    const d = diffBids(v1, { lines: v2.lines, total: v2.total });
    expect(d.changed.map((c) => c.fields)).toEqual([["unit"], ["description"]]);
    expect(d.unchanged).toBe(1);
  });

  it("gives no percent when the older total is zero, and signs a fall", () => {
    expect(diffBids(bid([]), bid([L("1", "A", 1, 10)])).delta_pct).toBeNull();
    const d = diffBids(bid([L("1", "A", 1, 200)]), bid([L("1", "A", 1, 150)]));
    expect(d.delta).toBe(-50);
    expect(d.delta_pct).toBe(-25);
    expect(deltaText(d.delta, d.delta_pct, (n) => n.toFixed(2))).toBe("-50.00 (-25.00%)");
    expect(deltaText(12.5, 2.5, (n) => n.toFixed(1))).toBe("+12.5 (+2.50%)");
    expect(deltaText(0, 0, (n) => String(n))).toBe("0 (0.00%)");
  });

  it("compares a diff of a diff with itself as nothing", () => {
    const d = diffBids(v1, v1);
    expect([d.added.length, d.removed.length, d.changed.length, d.unchanged]).toEqual([0, 0, 0, 3]);
  });
});

describe("submitting", () => {
  it("version 1 needs no reason; every later version must say why (3 to 1000 characters)", () => {
    expect(parseSubmit({}, 1)).toEqual({ ok: true, value: { revision_reason: null, note: null } });
    expect(parseSubmit({ revision_reason: "ignored on v1", note: " first " }, 1)).toEqual({ ok: true, value: { revision_reason: null, note: "first" } });
    expect(parseSubmit({}, 2)).toMatchObject({ ok: false, code: "reason_required" });
    expect(parseSubmit({ revision_reason: "  " }, 3)).toMatchObject({ ok: false, code: "reason_required" });
    expect(parseSubmit({ revision_reason: "ab" }, 2)).toMatchObject({ ok: false });
    expect(parseSubmit({ revision_reason: "Addendum 2: scope changed" }, 2)).toEqual({ ok: true, value: { revision_reason: "Addendum 2: scope changed", note: null } });
    expect(parseSubmit({ revision_reason: "x".repeat(1001) }, 2)).toMatchObject({ ok: false });
    expect(parseSubmit({ note: "x".repeat(1001) }, 1)).toMatchObject({ ok: false });
  });

  it("has no cap on the number of versions", () => {
    expect(parseSubmit({ revision_reason: "Another round" }, 250)).toMatchObject({ ok: true });
  });

  it("a bid goes in from Estimating or Clarifications, while the tender is open and has lines", () => {
    expect(submitProblem({ stage: "estimating", outcome: "open", lineCount: 3 })).toBeNull();
    expect(submitProblem({ stage: "clarifications", outcome: "open", lineCount: 3 })).toBeNull();
    expect(submitProblem({ stage: "submitted", outcome: "open", lineCount: 3 })).toMatch(/Revise bid/);
    expect(submitProblem({ stage: "received", outcome: "open", lineCount: 3 })).toMatch(/Estimating or Clarifications/);
    expect(submitProblem({ stage: "estimating", outcome: "lost", lineCount: 3 })).toMatch(/closed/);
    expect(submitProblem({ stage: "estimating", outcome: "open", lineCount: 0 })).toMatch(/lines/);
  });
});

describe("the version a Standard Quote is made from", () => {
  const v = (n: number) => ({ version_no: n });
  it("is the latest unless the person picked one that exists", () => {
    expect(defaultQuoteVersion([v(3), v(2), v(1)])).toBe("3");
    expect(defaultQuoteVersion([v(2), v(3), v(1)])).toBe("3");
    expect(defaultQuoteVersion([v(3), v(2), v(1)], "2")).toBe("2");
    expect(defaultQuoteVersion([v(3), v(2)], "7")).toBe("3");
    expect(defaultQuoteVersion([])).toBe("");
  });
});
