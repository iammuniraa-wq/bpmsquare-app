import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { SEARCH_OBJECTS } from "@/lib/globalSearch";
import {
  GROUP_LIMITS, isUuid as isGroupUuid, outsideRestriction, parseGroup, parseMembers, restrictionFrom, restrictionMessage, NOT_RESTRICTED,
} from "@/lib/supplierGroups/rules";
import {
  PACKAGE_LIMITS, againstBudget, awardProblem, buyoutTiles, canDownloadHandover, cleanPackageReason, deleteProblem, effectiveStatus, handoverState,
  linesLocked, lineQty, lowestValidTotal, markSentProblem, overBudget, packageAwardDecision, parsePackage, parseRound, roundProblem, roundQuotes, roundTitle, unawardProblem,
  type RoundQuote, type RoundResponseInput,
} from "./rules";
import { buildPackageHandoverWorkbook, handoverFileName, handoverTotal } from "./handover";

// Contract buy-out (docs/design/contract-buyout.md): the pure rules, the shape of migrations 0233 and 0234, the bundle that carries them, the
// ledger and the gating map.

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const strip = (sql: string) => lf(sql).replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

const UUID = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const resp = (rs: string, line: string, price: number | null, over: Partial<RoundResponseInput> = {}): RoundResponseInput => ({
  id: `${rs}-${line}`, rfq_supplier_id: rs, rfq_line_id: line, status: price === null ? "no_quote" : "quoted", unit_price: price, fx_rate: null, currency: "SAR",
  lead_time_days: 10, moq: null, valid_until: "2026-12-31", note: null, submitted_at: "2026-10-20T08:00:00Z", ...over,
});
const lines = [{ id: "l1", qty: 100 }, { id: "l2", qty: 4 }];
const sups = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `rs${i + 1}`, supplier_id: `s${i + 1}`, name: `Supplier ${i + 1}`, status: "replied", replied_at: null }));

describe("package input", () => {
  it("a new package needs a name and at least one budget line; kind defaults to supplier", () => {
    expect(parsePackage({}, "create")).toMatchObject({ ok: false });
    expect(parsePackage({ name: "  " , budget_line_ids: [UUID(1)] }, "create")).toMatchObject({ ok: false });
    expect(parsePackage({ name: "Pipes", budget_line_ids: [] }, "create")).toMatchObject({ ok: false });
    expect(parsePackage({ name: "Pipes" }, "create")).toMatchObject({ ok: false });
    expect(parsePackage({ name: "Pipes", budget_line_ids: ["nope"] }, "create")).toMatchObject({ ok: false });
    expect(parsePackage({ name: "Pipes", budget_line_ids: [UUID(1), UUID(1)] }, "create")).toMatchObject({ ok: false });
    expect(parsePackage({ name: "Pipes", kind: "purchase", budget_line_ids: [UUID(1)] }, "create")).toMatchObject({ ok: false });
    expect(parsePackage({ name: "Pipes", budget_line_ids: [UUID(1)] }, "create")).toMatchObject({ ok: true, value: { name: "Pipes", kind: "supplier", budget_line_ids: [UUID(1)] } });
    expect(parsePackage({ name: "Piling", kind: "subcontract", budget_line_ids: [UUID(1)] }, "create")).toMatchObject({ ok: true, value: { kind: "subcontract" } });
  });

  it("an update changes only what is sent; a name cannot be blanked; a note may be cleared", () => {
    expect(parsePackage({}, "update")).toMatchObject({ ok: true, value: {} });
    expect(parsePackage({ name: "" }, "update")).toMatchObject({ ok: false });
    expect(parsePackage({ note: null }, "update")).toMatchObject({ ok: true, value: { note: null } });
    expect(parsePackage({ budget_line_ids: [] }, "update")).toMatchObject({ ok: true, value: { budget_line_ids: [] } });
    const many = Array.from({ length: PACKAGE_LIMITS.maxLines + 1 }, (_, i) => UUID(i + 1));
    expect(parsePackage({ name: "x", budget_line_ids: many }, "create")).toMatchObject({ ok: false });
  });

  it("a round needs suppliers; a reply-by must be a real date", () => {
    expect(parseRound({})).toMatchObject({ ok: false });
    expect(parseRound({ supplier_ids: [] })).toMatchObject({ ok: false });
    expect(parseRound({ supplier_ids: ["x"] })).toMatchObject({ ok: false });
    expect(parseRound({ supplier_ids: [UUID(1)], reply_by: "next week" })).toMatchObject({ ok: false });
    expect(parseRound({ supplier_ids: [UUID(1)], reply_by: "2026-13-45" })).toMatchObject({ ok: false });
    expect(parseRound({ supplier_ids: [UUID(1), UUID(1), UUID(2)], reply_by: "2026-11-05", note: " please quote ex-works " })).toMatchObject({ ok: true, value: { supplier_ids: [UUID(1), UUID(2)], reply_by: "2026-11-05", note: "please quote ex-works" } });
  });
});

describe("the quotes of a round", () => {
  it("a supplier's total needs every line; the cheapest valid complete total is marked", () => {
    const q = roundQuotes({
      lines, suppliers: sups(3), today: "2026-10-27", staleDays: 180,
      responses: [
        resp("rs1", "l1", 100), resp("rs1", "l2", 50),   // 10000 + 200 = 10200
        resp("rs2", "l1", 90), resp("rs2", "l2", 60),    // 9000 + 240 = 9240
        resp("rs3", "l1", 80),                           // one line only: no total
      ],
    });
    expect(q.map((x) => x.total)).toEqual([10200, 9240, null]);
    expect(q[2]).toMatchObject({ lines_quoted: 1, lines_total: 2, valid: false, lowest_valid: false });
    expect(q.map((x) => x.lowest_valid)).toEqual([false, true, false]);
    expect(lowestValidTotal(q)).toBe(9240);
  });

  it("an expired or a stale answer makes the quote not valid, and it is never the lowest valid one", () => {
    const q = roundQuotes({
      lines, suppliers: sups(3), today: "2026-10-27", staleDays: 180,
      responses: [
        resp("rs1", "l1", 100), resp("rs1", "l2", 50),
        resp("rs2", "l1", 10, { valid_until: "2026-09-01" }), resp("rs2", "l2", 10),                       // cheapest, but expired
        resp("rs3", "l1", 20, { valid_until: null, submitted_at: "2026-01-01T00:00:00Z" }), resp("rs3", "l2", 20, { valid_until: null, submitted_at: "2026-01-01T00:00:00Z" }), // stale
      ],
    });
    expect(q.map((x) => x.valid)).toEqual([true, false, false]);
    expect(q.map((x) => x.lowest_valid)).toEqual([true, false, false]);
    expect(q[1].total).toBe(1040);
  });

  it("a tie marks both; a removed supplier and a cancelled line are left out; a line with no quantity counts as 1", () => {
    const q = roundQuotes({
      lines: [{ id: "l1", qty: 2 }, { id: "l2", qty: null }, { id: "l3", qty: 5, status: "cancelled" }],
      suppliers: [...sups(2), { id: "rs3", supplier_id: "s3", name: "Gone", status: "cancelled", replied_at: null }],
      responses: [resp("rs1", "l1", 10), resp("rs1", "l2", 5), resp("rs2", "l1", 10), resp("rs2", "l2", 5), resp("rs3", "l1", 1), resp("rs3", "l2", 1)],
      today: "2026-10-27", staleDays: 180,
    });
    expect(q).toHaveLength(2);
    expect(q.map((x) => x.total)).toEqual([25, 25]);
    expect(q.every((x) => x.lowest_valid)).toBe(true);
    expect(lineQty(null)).toBe(1);
    expect(lineQty(0)).toBe(1);
    expect(lineQty(7)).toBe(7);
  });

  it("a supplier's own exchange rate is applied to the price, and the awarded supplier is flagged", () => {
    const q = roundQuotes({
      lines: [{ id: "l1", qty: 10 }], suppliers: sups(1), today: "2026-10-27", staleDays: 180, awarded: { supplier_id: "s1" },
      responses: [resp("rs1", "l1", 100, { fx_rate: 3.75, currency: "USD" })],
    });
    expect(q[0].total).toBe(3750);
    expect(q[0].awarded).toBe(true);
  });
});

describe("the reason rule of a package award", () => {
  const quote = (total: number | null, valid = true): Pick<RoundQuote, "total" | "valid"> => ({ total, valid });
  it("the lowest valid total of the current round needs no reason; a dearer one does; a tie does not", () => {
    const round = [quote(9000), quote(9500), quote(9000)];
    expect(packageAwardDecision({ chosen: round[0], chosenRound: round, currentRound: round })).toMatchObject({ needsReason: false, why: null, lowestValid: 9000 });
    expect(packageAwardDecision({ chosen: round[2], chosenRound: round, currentRound: round }).needsReason).toBe(false);
    expect(packageAwardDecision({ chosen: round[1], chosenRound: round, currentRound: round })).toMatchObject({ needsReason: true, why: "higher", lowestValid: 9000 });
  });

  it("an answer that is itself out of date needs a reason while a valid one exists", () => {
    const round = [quote(8000, false), quote(9000, true)];
    expect(packageAwardDecision({ chosen: round[0], chosenRound: round, currentRound: round })).toMatchObject({ needsReason: true, why: "expired" });
  });

  it("with nothing valid anywhere the cheapest quote that exists is the baseline", () => {
    const round = [quote(8000, false), quote(9000, false)];
    expect(packageAwardDecision({ chosen: round[0], chosenRound: round, currentRound: round }).needsReason).toBe(false);
    expect(packageAwardDecision({ chosen: round[1], chosenRound: round, currentRound: round }).needsReason).toBe(true);
  });

  it("an older round is held against the CURRENT round: a dearer old quote needs a reason, a cheaper one does not", () => {
    const oldRound = [quote(9800), quote(9400)];
    const current = [quote(9000), quote(9200)];
    expect(packageAwardDecision({ chosen: oldRound[1], chosenRound: oldRound, currentRound: current })).toMatchObject({ needsReason: true, why: "higher", lowestValid: 9000 });
    const cheaperOld = [quote(8500)];
    expect(packageAwardDecision({ chosen: cheaperOld[0], chosenRound: cheaperOld, currentRound: current }).needsReason).toBe(false);
  });

  it("with no answer at all in the current round, the round chosen from is the baseline", () => {
    const oldRound = [quote(9800), quote(9400)];
    expect(packageAwardDecision({ chosen: oldRound[1], chosenRound: oldRound, currentRound: [] }).needsReason).toBe(false);
    expect(packageAwardDecision({ chosen: oldRound[0], chosenRound: oldRound, currentRound: [quote(null)] }).needsReason).toBe(true);
  });

  it("an incomplete quote has no decision to make", () => {
    expect(packageAwardDecision({ chosen: quote(null), chosenRound: [], currentRound: [] })).toMatchObject({ needsReason: false });
  });

  it("a reason is trimmed, capped and needs 3 characters", () => {
    expect(cleanPackageReason("  ok ")).toBeNull();
    expect(cleanPackageReason("  sole source  ")).toBe("sole source");
    expect(cleanPackageReason("x".repeat(5000))).toHaveLength(PACKAGE_LIMITS.reason);
    expect(cleanPackageReason(42)).toBeNull();
  });
});

describe("status, tiles and the locks", () => {
  it("awarded and handed over are stored; the rest follow the rounds", () => {
    expect(effectiveStatus({ stored: "draft", rounds: 0, best_quote: null })).toBe("draft");
    expect(effectiveStatus({ stored: "out", rounds: 1, best_quote: null })).toBe("out");
    expect(effectiveStatus({ stored: "out", rounds: 2, best_quote: 9000 })).toBe("ready");
    expect(effectiveStatus({ stored: "awarded", rounds: 2, best_quote: 9000 })).toBe("awarded");
    expect(effectiveStatus({ stored: "handed_over", rounds: 1, best_quote: null })).toBe("handed_over");
  });

  it("an award is refused when already awarded, handed over or empty; an un-award only while awarded", () => {
    expect(awardProblem({ status: "ready", line_count: 2 })).toBeNull();
    expect(awardProblem({ status: "awarded", line_count: 2 })).toMatchObject({ status: 409, code: "already_awarded" });
    expect(awardProblem({ status: "handed_over", line_count: 2 })).toMatchObject({ code: "handed_over" });
    expect(awardProblem({ status: "draft", line_count: 0 })).toMatchObject({ code: "no_lines" });
    expect(unawardProblem({ status: "awarded" })).toBeNull();
    expect(unawardProblem({ status: "handed_over" })).toMatchObject({ status: 409, code: "handed_over" });
    expect(unawardProblem({ status: "out" })).toMatchObject({ code: "not_awarded" });
  });

  it("the handover: not ready until awarded, ready when awarded, sent once; marking it sent twice is a conflict", () => {
    expect(handoverState({ status: "ready", handover_sent_at: null })).toEqual({ state: "not_ready", sent_at: null });
    expect(handoverState({ status: "awarded", handover_sent_at: null })).toEqual({ state: "ready", sent_at: null });
    expect(handoverState({ status: "handed_over", handover_sent_at: "2026-10-28T10:00:00Z" })).toEqual({ state: "sent", sent_at: "2026-10-28T10:00:00Z" });
    expect(markSentProblem({ status: "awarded", handover_sent_at: null })).toBeNull();
    expect(markSentProblem({ status: "out", handover_sent_at: null })).toMatchObject({ code: "not_awarded" });
    expect(markSentProblem({ status: "handed_over", handover_sent_at: "x" })).toMatchObject({ code: "handed_over" });
    expect(canDownloadHandover("awarded")).toBe(true);
    expect(canDownloadHandover("handed_over")).toBe(true);
    expect(canDownloadHandover("ready")).toBe(false);
  });

  it("lines are fixed after a round; a package with rounds cannot be deleted; a round needs an open package", () => {
    expect(linesLocked({ status: "draft", rounds: 0 })).toBe(false);
    expect(linesLocked({ status: "out", rounds: 1 })).toBe(true);
    expect(linesLocked({ status: "awarded", rounds: 1 })).toBe(true);
    expect(deleteProblem({ status: "draft", rounds: 0 })).toBeNull();
    expect(deleteProblem({ status: "out", rounds: 1 })).toMatchObject({ code: "has_rounds" });
    expect(deleteProblem({ status: "awarded", rounds: 0 })).toMatchObject({ code: "not_draft" });
    expect(roundProblem({ status: "draft", line_count: 1, rounds: 0 })).toBeNull();
    expect(roundProblem({ status: "awarded", line_count: 1, rounds: 1 })).toMatchObject({ code: "already_awarded" });
    expect(roundProblem({ status: "draft", line_count: 0, rounds: 0 })).toMatchObject({ code: "no_lines" });
    expect(roundProblem({ status: "out", line_count: 1, rounds: PACKAGE_LIMITS.maxRounds })).toMatchObject({ code: "too_many_rounds" });
    expect(roundTitle({ ref: "PKG-0003", name: "Valves" }, 2)).toBe("PKG-0003 Valves · round 2");
  });

  it("against budget is budget less what we pay (committed first, else the best quote); positive is a saving; over budget warns", () => {
    expect(againstBudget(10000, 9500, 9000)).toBe(500);
    expect(againstBudget(10000, null, 9000)).toBe(1000);
    expect(againstBudget(10000, 10400, null)).toBe(-400);
    expect(againstBudget(10000, null, null)).toBeNull();
    expect(overBudget(10000, 10400)).toBe(true);
    expect(overBudget(10000, 10000)).toBe(false);
    expect(overBudget(10000, null)).toBe(false);
  });

  it("the tiles add up the packages and say what needs a decision", () => {
    const t = buyoutTiles([
      { status: "awarded", budget: 10000, committed: 9500, best_quote: 9000 },
      { status: "ready", budget: 4000, committed: null, best_quote: 4400 },
      { status: "draft", budget: 1000, committed: null, best_quote: null },
    ], 20000);
    expect(t).toEqual({ budget: 15000, committed: 9500, best_vs_budget: 100, needs_decision: 1, packages: 3, project_budget: 20000, unassigned_budget: 5000 });
  });
});

describe("supplier groups", () => {
  it("a group needs a name; the account must be an id; members are unique ids", () => {
    expect(parseGroup({}, "create")).toMatchObject({ ok: false });
    expect(parseGroup({ name: "Aramco approved vendors", account_id: "x" }, "create")).toMatchObject({ ok: false });
    expect(parseGroup({ name: "x".repeat(300) }, "create")).toMatchObject({ ok: true });
    expect(parseGroup({ name: "Aramco", account_id: null, active: false }, "create")).toMatchObject({ ok: true, value: { name: "Aramco", account_id: null, active: false } });
    expect(parseGroup({ active: "yes" }, "update")).toMatchObject({ ok: false });
    expect(parseGroup({ supplier_ids: ["x"] }, "update")).toMatchObject({ ok: false });
    expect(parseMembers({ supplier_ids: [UUID(1), UUID(1), UUID(2)] })).toEqual({ ok: true, value: [UUID(1), UUID(2)] });
    expect(parseMembers({ supplier_ids: [] })).toEqual({ ok: true, value: [] });
    expect(parseMembers({})).toMatchObject({ ok: false });
    expect(isGroupUuid(UUID(3))).toBe(true);
    expect(GROUP_LIMITS.name).toBe(120);
  });

  it("only an ACTIVE group WITH members restricts; no group, an inactive one or an empty one leaves all suppliers open", () => {
    expect(restrictionFrom(null, [])).toEqual(NOT_RESTRICTED);
    expect(restrictionFrom({ id: "g", name: "A", active: false }, ["s1"])).toEqual(NOT_RESTRICTED);
    expect(restrictionFrom({ id: "g", name: "A", active: true }, [])).toEqual(NOT_RESTRICTED);
    const r = restrictionFrom({ id: "g", name: "Aramco approved vendors", active: true }, ["s1", "s2", "s1"]);
    expect(r).toEqual({ restricted: true, group: { id: "g", name: "Aramco approved vendors" }, supplier_ids: ["s1", "s2"] });
    expect(outsideRestriction(r, ["s1", "s3", "s4", "s3"])).toEqual(["s3", "s4"]);
    expect(outsideRestriction(NOT_RESTRICTED, ["s3"])).toEqual([]);
    expect(restrictionMessage("Aramco approved vendors", ["A", "B", "C", "D", "E", "F", "G"])).toBe('Not on the approved list "Aramco approved vendors": A, B, C, D, E and 2 more. Add them to the group in Suppliers, or choose suppliers from the list.');
  });
});

describe("the handover workbook", () => {
  it("lists the awarded lines and the total, and nothing of the budget, the bid cost or a markup", async () => {
    const lines = [
      { no: 1, item: "1.1", cost_code: "22 11 13", cost_code_name: "Facility Water Distribution Piping", description: "HDPE pipe 110mm", qty: 100, unit: "m", rate: 91.5 },
      { no: 2, item: "1.2", cost_code: null, cost_code_name: null, description: "Gate valve DN100", qty: 4, unit: "no", rate: 60 },
    ];
    expect(handoverTotal(lines)).toBe(9390);
    const buf = await buildPackageHandoverWorkbook({
      project: { ref: "CPR-0001", name: "Plant 4 fence", currency: "SAR" }, clientName: "Aramco", pkg: { ref: "PKG-0001", name: "Pipes", kind: "supplier" },
      supplier: { name: "Gulf Pipes", ref: "SUP-0007", email: "sales@gulfpipes.test", phone: null }, round: { rfq_ref: "RFQ-0031", round: 2, supplier_quote_ref: "Q-77" },
      awarded_at: "2026-10-28T09:00:00Z", awarded_by: "A. Nasser", lines,
    });
    const { default: Excel } = await import("exceljs");
    const wb = new Excel.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Order", "Lines"]);
    const text: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => text.push(String(c.value)))));
    const all = text.join("|");
    for (const needed of ["Gulf Pipes", "RFQ-0031", "HDPE pipe 110mm", "91.5", "9390", "22 11 13", "A. Nasser", "2026-10-28"]) expect(all).toContain(needed);
    for (const leak of ["Budget", "Bid cost", "Markup", "margin", "Margin"]) expect(all).not.toContain(leak);
    expect(handoverFileName("PKG-0001")).toBe("PKG-0001-handover.xlsx");
    expect(handoverFileName(null)).toBe("package-handover.xlsx");
  }, 120_000);
});

describe("migrations 0233 and 0234, the bundle, the ledger, the gating map", () => {
  const m33 = lf(read("supabase/migrations/0233_supplier_groups.sql"));
  const m34 = lf(read("supabase/migrations/0234_contract_buyout.sql"));

  it("supplier groups: tenant on every row, one group per client, unique pairs, RLS with a SELECT policy and nothing that writes", () => {
    const s = strip(m33);
    expect(s).toMatch(/create table if not exists supplier_groups \( id uuid primary key default gen_random_uuid\(\), tenant_id uuid not null references tenants\(id\)/);
    expect(s).toMatch(/create unique index if not exists supplier_groups_one_per_account on supplier_groups \(tenant_id, account_id\) where account_id is not null/);
    expect(s).toContain("primary key (group_id, supplier_id)");
    expect(s).toMatch(/supplier_group_members \( group_id uuid not null references supplier_groups\(id\) on delete cascade, supplier_id uuid not null references suppliers\(id\) on delete cascade, tenant_id uuid not null/);
    for (const t of ["supplier_groups", "supplier_group_members"]) {
      expect(s).toContain(`alter table ${t} enable row level security`);
      expect(s).toMatch(new RegExp(`create policy "${t}: tenant read" on ${t} for select using \\(tenant_id in \\(select tenant_id from tenant_users where user_id = auth.uid\\(\\)\\)\\)`));
    }
    expect(s).not.toMatch(/for (all|insert|update|delete)/);
  });

  it("buy-out: ref index the generator recognises, statuses and kinds, one package per budget line, select-only policies, the two added columns", () => {
    const s = strip(m34);
    expect(s).toContain("project_buyout_packages_tenant_ref_uniq");
    expect(s).toMatch(/kind in \('supplier', 'subcontract'\)/);
    expect(s).toMatch(/status in \('draft', 'out', 'ready', 'awarded', 'handed_over'\)/);
    expect(s).toMatch(/create unique index if not exists project_buyout_package_lines_one_package on project_buyout_package_lines \(project_id, line_key\)/);
    expect(s).toMatch(/alter table rfqs add column if not exists package_id uuid references project_buyout_packages\(id\) on delete set null/);
    expect(s).toMatch(/alter table rfq_lines add column if not exists package_line_id uuid references project_buyout_package_lines\(id\) on delete set null/);
    for (const t of ["project_buyout_packages", "project_buyout_package_lines"]) {
      expect(s).toContain(`alter table ${t} enable row level security`);
      expect(s).toMatch(new RegExp(`create policy "${t}: tenant read" on ${t} for select`));
    }
    expect(s).not.toMatch(/for (all|insert|update|delete)/);
    expect(s).toContain("tenant_id uuid not null references tenants(id)");
  });

  it("the bundle carries both migrations verbatim, the ledger lists them as pending on both databases", () => {
    const bundle = lf(read("scripts/run-bundle-42-contract-buyout-2026-10-28.sql"));
    expect(bundle).toContain(m33.trim());
    expect(bundle).toContain(m34.trim());
    expect(bundle.indexOf(m33.trim())).toBeLessThan(bundle.indexOf(m34.trim()));
    const project = read("PROJECT.md");
    expect(project).toContain("run-bundle-42-contract-buyout-2026-10-28.sql");
    expect(project).toMatch(/0233_supplier_groups\.sql -- PENDING/);
    expect(project).toMatch(/0234_contract_buyout\.sql -- PENDING/);
  });

  it("the new objects are owned by their modules, and packages have a PKG ref and a search entry", () => {
    expect(featureForObject("project_buyout_packages")).toBe("contract_projects");
    expect(featureForObject("project_buyout_package_lines")).toBe("contract_projects");
    expect(featureForObject("supplier_groups")).toBe("suppliers");
    expect(featureForObject("supplier_group_members")).toBe("suppliers");
    const ref = read("src/lib/masterRef.ts");
    expect(ref).toContain('"project_buyout_packages"');
    expect(ref).toContain('project_buyout_packages: "PKG"');
    expect(SEARCH_OBJECTS.find((o) => o.type === "buyout_package")).toMatchObject({ featureKeys: ["contract_projects"], workcenters: ["contract_projects"] });
  });

  it("cost never leaves the building: no v1 route, MCP tool, Data Workbench route or list source mentions the buy-out tables", () => {
    for (const f of ["src/lib/api/listSources.ts", "mcp-server/mcp.json", "src/lib/import/registrySchema.ts", "src/lib/api/openapi.ts"]) {
      const src = read(f);
      expect(src, f).not.toContain("project_buyout");
      expect(src, f).not.toContain("supplier_group");
    }
  });
});
