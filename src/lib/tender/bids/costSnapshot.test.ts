import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { buildSnapshot, type SnapshotSource } from "./rules";
import {
  bidVsBudget, budgetNote, buildCostSnapshot, parseCostSnapshot, snapshotCostCodes, snapshotCostTotal, snapshotToBudget, type CostBoqInfo,
} from "./costSnapshot";

// After award: the internal cost of a bid version. The pure rules (what is kept, how a project starts from it, what it is compared with)
// and the promise that the cost never leaves the building.

const dl = (id: string, sl: string, description: string, qty: number, rate: number): SnapshotSource & { id: string } => ({
  id, sl_no: sl, description, uom: "m", qty, rate, discount_pct: 0, amount: qty * rate, product_id: null, is_selected: true, group_id: null, group_type: null, break_of: null,
});
const A = dl("a", "1.1", "Fence", 100, 200);
const B = dl("b", "1.2", "Excavation", 50, 40);
const C = dl("c", "1.3", "Gate", 2, 900);

const info = (over: Partial<CostBoqInfo> = {}): CostBoqInfo => ({ item_no: null, cost_code: null, unit_cost: null, markup_pct: null, price_source: null, price_source_ref: null, ...over });

function snapshot() {
  const snap = buildSnapshot([A, B, C]);
  const dealLines = new Map([A, B, C].map((l) => [l.id, { id: l.id, sl_no: l.sl_no ?? null, description: l.description, uom: l.uom ?? null, qty: Number(l.qty), rate: Number(l.rate), discount_pct: 0, is_selected: true, break_of: null }]));
  const boq = new Map<string, CostBoqInfo>([
    ["a", info({ item_no: "1.1", cost_code: "32 31 13", unit_cost: 120, markup_pct: 66.67, price_source: "supplier", price_source_ref: "RFQ-0004" })],
    ["b", info({ item_no: "1.2", cost_code: "99 99 99" })],
  ]);
  return { snap, dealLines, boq };
}

describe("buildSnapshot keeps the deal line behind every bid line", () => {
  it("source_ids runs parallel to lines, in the same order, and is not part of a line", () => {
    const snap = buildSnapshot([C, A, B]);
    expect(snap.source_ids).toEqual(["c", "a", "b"]);
    expect(snap.lines.map((l) => l.item_no)).toEqual(["1.3", "1.1", "1.2"]);
    expect(Object.keys(snap.lines[0])).not.toContain("source_ids");
  });
});

describe("the cost snapshot of a bid", () => {
  it("keeps, per bid line, the recorded cost, the markup and the budget lines it becomes", () => {
    const { snap, dealLines, boq } = snapshot();
    const cost = buildCostSnapshot({ snapshot: snap, dealLines, boq, defaultMarginPct: 15 });
    expect(cost.lines).toHaveLength(3);
    expect(cost.lines.map((l) => l.key)).toEqual(snap.lines.map((l) => l.key));
    const [fence, dig, gate] = cost.lines;
    expect(fence).toMatchObject({ unit_cost: 120, markup_pct: 66.67, cost_code: "32 31 13", estimated: false, cost_total: 12000 });
    expect(fence.lines[0]).toMatchObject({ resource_code: "11", unit_cost: 120, qty: 100, cost_known: true, cost_code: "32 31 13" });
    // No recorded cost: the rate less the default margin, marked as a guess.
    expect(dig).toMatchObject({ unit_cost: null, estimated: true, cost_total: 1700 });
    expect(dig.lines[0]).toMatchObject({ unit_cost: 34, cost_known: false });
    expect(gate).toMatchObject({ estimated: true, cost_total: 1530, cost_code: null });
    expect(snapshotCostTotal(cost)).toBe(15230);
    expect(cost.margin_pct).toBe(15);
  });

  it("a bid line whose deal line cannot be found keeps an empty entry so the two lists stay parallel", () => {
    const { snap, dealLines, boq } = snapshot();
    dealLines.delete("b");
    const cost = buildCostSnapshot({ snapshot: snap, dealLines, boq, defaultMarginPct: 15 });
    expect(cost.lines).toHaveLength(3);
    expect(cost.lines[1]).toMatchObject({ lines: [], cost_total: 0, unit_cost: null });
  });

  it("is read back defensively: a wrong version, a missing list and malformed rows give nothing or are skipped", () => {
    const { snap, dealLines, boq } = snapshot();
    const cost = buildCostSnapshot({ snapshot: snap, dealLines, boq, defaultMarginPct: 15 });
    expect(parseCostSnapshot(JSON.parse(JSON.stringify(cost)))).toEqual(cost);
    expect(parseCostSnapshot(null)).toBeNull();
    expect(parseCostSnapshot({ v: 2, lines: [] })).toBeNull();
    expect(parseCostSnapshot({ v: 1, lines: "x" })).toBeNull();
    const odd = parseCostSnapshot({ v: 1, margin_pct: 15, lines: [null, { key: 1 }, { key: "k", lines: [{ description: "ok", qty: 1, unit_cost: 5 }, { description: "", qty: 1, unit_cost: 5 }, "x"] }] });
    expect(odd?.lines).toHaveLength(1);
    expect(odd?.lines[0].lines).toHaveLength(1);
    expect(odd?.lines[0].cost_total).toBe(5);
  });
});

describe("the project budget a snapshot gives", () => {
  it("keeps a cost code the workspace's list holds (in its own spelling), drops and lists one it does not, and counts the guessed lines", () => {
    const { snap, dealLines, boq } = snapshot();
    const cost = buildCostSnapshot({ snapshot: snap, dealLines, boq, defaultMarginPct: 15 });
    expect(snapshotCostCodes(cost)).toEqual(["32 31 13", "99 99 99"]);
    const out = snapshotToBudget(cost, new Set(["32 31 13"]));
    expect(out.lines).toHaveLength(3);
    expect(out.lines[0]).toMatchObject({ cost_code: "32 31 13", unit_cost: 120, line_key: null });
    expect(out.lines[1]).toMatchObject({ cost_code: null });
    expect(out.lines[1].source_ref).toContain("BOQ cost code 99 99 99 is not in your cost codes");
    expect(out.unmappedCodes).toEqual(["99 99 99"]);
    expect(out.estimated).toBe(2);
    const lower = snapshotToBudget(cost, new Set(["32 31 13".toUpperCase()]));
    expect(lower.lines[0].cost_code).toBe("32 31 13");
  });

  it("the cost recorded with the bid wins over a BOQ that was edited afterwards", () => {
    const { snap, dealLines, boq } = snapshot();
    const cost = buildCostSnapshot({ snapshot: snap, dealLines, boq, defaultMarginPct: 15 });
    boq.set("a", info({ item_no: "1.1", cost_code: "32 31 13", unit_cost: 999 }));
    expect(snapshotToBudget(cost, new Set(["32 31 13"])).lines[0].unit_cost).toBe(120);
  });
});

describe("the budget note says which source the budget started from", () => {
  it("names the bid version and its date, or the BOQ and why", () => {
    expect(budgetNote({ kind: "bid_version", version_no: 2, submitted_at: "2026-10-12T08:00:00Z" })).toBe("Started from bid version 2 (submitted 2026-10-12): the cost recorded when the bid went in.");
    expect(budgetNote({ kind: "boq", reason: "no_version", version_no: null })).toBe("Started from the current BOQ: no bid version was submitted for this tender.");
    expect(budgetNote({ kind: "boq", reason: "no_snapshot", version_no: 3 })).toBe("Started from the current BOQ: bid version 3 was submitted before bid costs were stored.");
  });
});

describe("bid against budget", () => {
  it("compares the bid's cost with the budget now, and the margin at the bid with the planned margin now", () => {
    const r = bidVsBudget({ bidPrice: 100000, bidCost: 80000, budget: 84000, contractValue: 104000 });
    expect(r).toMatchObject({ bid_price: 100000, bid_cost: 80000, budget: 84000, delta: 4000, delta_pct: 5, bid_margin_pct: 20, planned_margin_pct: 19.2 });
    expect(bidVsBudget({ bidPrice: 0, bidCost: 0, budget: 10, contractValue: 0 })).toMatchObject({ delta_pct: null, bid_margin_pct: null, planned_margin_pct: null });
  });
});

describe("the cost never leaves the building", () => {
  const ROOT = path.resolve(__dirname, "../../../..");
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const src = walk(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");
  // Every source file is read once for the two whole-tree checks (a full read per check is slow when the machine is busy).
  const texts = new Map<string, string>();
  const text = (f: string) => { let t = texts.get(f); if (t === undefined) { t = readFileSync(f, "utf8"); texts.set(f, t); } return t; };

  it("only the bid cost module, the submit route and the project creation ever name the table", () => {
    const named = src.filter((f) => text(f).includes("tender_bid_version_costs")).map(rel).sort();
    expect(named).toEqual([
      "src/lib/objectFeatures.ts",
      "src/lib/tender/bids/costServer.ts",
    ]);
  }, 60_000);

  it("only the project creation, the project screen's origin card and the submit route import the cost module", () => {
    const importers = src.filter((f) => /from "(@\/lib\/tender\/bids\/costServer|\.\/costServer)"/.test(text(f))).map(rel).sort();
    expect(importers).toEqual([
      "src/app/api/opportunities/[id]/tender/bids/route.ts",
      "src/lib/contractProjects/create.ts",
      "src/lib/contractProjects/originServer.ts",
    ]);
  }, 60_000);

  it("no export, print page, public link, answer sheet, Standard Quote conversion, list source or v1 route reads the cost snapshot or its type", () => {
    const roots = ["src/app/(print)", "src/app/api/v1", "src/lib/api", "src/lib/quotePublicLink.ts", "src/lib/salesOrderPublicLink.ts", "src/lib/tender/boq", "src/app/api/opportunities/[id]/boq", "src/lib/sales"];
    for (const r of roots) {
      const full = path.join(ROOT, r);
      const files = full.endsWith(".ts") ? [full] : walk(full).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
      for (const f of files) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/tender_bid_version_costs|costSnapshot|costServer|cost_snapshot|CostSnapshot|loadWinningBid/);
    }
  }, 60_000);

  it("the bid version routes that read versions never select the cost, and the compare route does not touch it", () => {
    for (const f of ["src/lib/tender/bids/server.ts", "src/app/api/opportunities/[id]/tender/bids/compare/route.ts"]) {
      expect(readFileSync(path.join(ROOT, f), "utf8"), f).not.toMatch(/tender_bid_version_costs|costSnapshot|costServer|CostSnapshot/);
    }
  });

  it("Talk to data and the v1 API know nothing of bid versions at all (a bid version is not a list source)", () => {
    expect(Object.keys(LIST_SOURCES).filter((k) => /bid|cost/i.test(k))).toEqual([]);
  });

  it("the version row itself still has no cost, markup or margin in its lines", () => {
    const rules = readFileSync(path.join(ROOT, "src/lib/tender/bids/rules.ts"), "utf8").replace(/\/\/[^\n]*|\/\*\*[\s\S]*?\*\//g, "");
    expect(rules).not.toMatch(/unit_cost|markup|margin|cost_price/i);
  });
});
