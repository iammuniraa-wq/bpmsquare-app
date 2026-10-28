import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb, type Row } from "@/lib/inbox/testing/memoryDb";

const state = vi.hoisted(() => ({ db: null as unknown as MemoryDb, reads: [] as { table: string; tenantScoped: boolean; foreignTenant: boolean }[] }));

/** PostgREST never answers more than this many rows in one response, whatever `.limit()` or `.range()` asked for (Supabase's max-rows). */
const POSTGREST_MAX_ROWS = 1000;

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => {
      const q = state.db.from(table) as unknown as { eq: (c: string, v: unknown) => unknown; limit: (n: number) => unknown; range: (a: number, b: number) => unknown };
      const rec = { table, tenantScoped: false, foreignTenant: false };
      state.reads.push(rec);
      const eq = q.eq.bind(q);
      // The tenants table is keyed by `id`; every other table must be filtered on tenant_id.
      q.eq = (c: string, v: unknown) => {
        if (c === "tenant_id" || (table === "tenants" && c === "id")) { if (v === T1) rec.tenantScoped = true; else rec.foreignTenant = true; }
        return eq(c, v);
      };
      const limit = q.limit.bind(q);
      const range = q.range.bind(q);
      q.limit = (n: number) => limit(Math.min(n, POSTGREST_MAX_ROWS));
      q.range = (a: number, b: number) => range(a, Math.min(b, a + POSTGREST_MAX_ROWS - 1));
      return q;
    },
    auth: state.db.auth,
  }),
  requireTenantUser: vi.fn(),
  getAuthUser: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => true, getTenant: async () => null }));

import { getTenderDeskData } from "./server";

const T1 = "tenant-1";
const T2 = "tenant-2";
const NOW = new Date("2026-10-28T09:00:00Z"); // 12:00 on 28 October in Riyadh
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const dateOnly = (n: number) => day(n).slice(0, 10);

function opp(id: string, tenant: string, over: Row = {}): Row {
  return {
    id, tenant_id: tenant, ref: `OPP-${id}`, title: `Deal ${id}`, account_id: `acc-${tenant}`, stage: "estimating", outcome: "open", amount: 1_000_000, probability: 50,
    created_at: "2026-09-01T08:00:00Z", closed_at: null, ...over,
  };
}
function tender(id: string, tenant: string, over: Row = {}): Row {
  return {
    opportunity_id: id, tenant_id: tenant, deal_type_id: null, tender_no: `TN-${id}`, issuer_name: null, issuer_account_id: `acc-${tenant}`, portal: "email", closing_at: null,
    bid_bond_amount: null, bid_bond_currency: null, bid_bond_expiry: null, addenda_count: 0, decision: null, decision_reason: null, decided_by: null, decided_at: null,
    source_email_id: null, custom_data: null, reminders_sent: [], bond_status: "held", bond_released_at: null, bond_released_by: null, award_value: null, winning_bidder: null,
    award_date: null, outcome_note: null, created_at: "2026-09-01T08:00:00Z", updated_at: "2026-09-01T08:00:00Z", ...over,
  };
}

function world(): MemoryDb {
  return new MemoryDb({
    tenants: [
      { id: T1, config: { currency: "SAR", wfm: { timezone: "Asia/Riyadh" } } },
      { id: T2, config: { currency: "QAR" } },
    ],
    accounts: [{ id: `acc-${T1}`, tenant_id: T1, name: "Ministry of Works" }, { id: `acc-${T2}`, tenant_id: T2, name: "Other Tenant Client" }],
    opportunities: [
      opp("o1", T1, { amount: 8_000_000, probability: 50 }),
      opp("o2", T1, { amount: 3_000_000, probability: 15, stage: "bid_no_bid" }),
      opp("o5", T1, { amount: 2_000_000, probability: 40, stage: "submitted" }),
      opp("o3", T1, { amount: 5_000_000, stage: "awarded", outcome: "won", closed_at: "2026-10-10T08:00:00Z" }),
      opp("o4", T1, { amount: 4_000_000, stage: "bid_lost", outcome: "lost", closed_at: "2026-09-12T08:00:00Z" }),
      opp("x1", T2, { amount: 99_000_000, probability: 90, title: "Foreign deal" }),
    ],
    opportunity_tenders: [
      tender("o1", T1, { closing_at: day(2), bid_bond_amount: 75000, bid_bond_expiry: dateOnly(9), bond_status: "issued" }),
      tender("o2", T1, { closing_at: day(12) }),
      tender("o5", T1, { closing_at: day(-1) }),
      tender("o3", T1), tender("o4", T1),
      tender("x1", T2, { closing_at: day(1), bid_bond_expiry: dateOnly(2) }),
    ],
    approval_requests: [
      { id: "ap1", tenant_id: T1, object_type: "opportunity_tenders", object_id: "o2", kind: "tender_bid_decision", proposed_value: "go", status: "pending", created_at: day(-2) },
      { id: "ap2", tenant_id: T2, object_type: "opportunity_tenders", object_id: "x1", kind: "tender_bid_decision", proposed_value: "go", status: "pending", created_at: day(-2) },
      { id: "ap3", tenant_id: T1, object_type: "opportunity_tenders", object_id: "o4", kind: "tender_bid_decision", proposed_value: "go", status: "approved", created_at: day(-30) },
    ],
    rfqs: [
      { id: "r1", tenant_id: T1, ref: "RFQ-0001", title: "Pipes", status: "sent", respond_by: dateOnly(-3) },
      { id: "r2", tenant_id: T2, ref: "RFQ-0002", title: "Foreign RFQ", status: "sent", respond_by: dateOnly(-3) },
      { id: "r3", tenant_id: T1, ref: "RFQ-0003", title: "Not late", status: "sent", respond_by: dateOnly(3) },
    ],
    rfq_suppliers: [
      { id: "s1", tenant_id: T1, rfq_id: "r1", status: "sent" }, { id: "s2", tenant_id: T1, rfq_id: "r1", status: "viewed" }, { id: "s3", tenant_id: T1, rfq_id: "r1", status: "replied" },
      { id: "s4", tenant_id: T2, rfq_id: "r2", status: "sent" },
    ],
    tender_boq_lines: [
      { id: "b1", tenant_id: T1, opportunity_id: "o1", price_source: "supplier", price_as_of: "2026-01-01", stale_accepted: false, removed_in_revision: false },
      { id: "b2", tenant_id: T1, opportunity_id: "o1", price_source: "manual", price_as_of: "2026-10-20", stale_accepted: false, removed_in_revision: false },
    ],
    opportunity_lines: [{ id: "l1", tenant_id: T1, opportunity_id: "o2", rate: 0 }],
    contract_projects: [
      { id: "p1", tenant_id: T1, source_opportunity_id: "o3", name: "Package B works", status: "active", contract_value: 5_000_000, currency: "SAR", created_at: "2026-10-11T08:00:00Z" },
      { id: "px", tenant_id: T2, source_opportunity_id: "x1", name: "Foreign project", status: "active", contract_value: 1, currency: "QAR", created_at: "2026-10-11T08:00:00Z" },
    ],
    project_budget_revisions: [
      { id: "rev-p1", tenant_id: T1, project_id: "p1", rev_no: 0, status: "approved", total: 150000 },
      { id: "rev-px", tenant_id: T2, project_id: "px", rev_no: 0, status: "approved", total: 777 },
    ],
    project_budget_lines: [
      { id: "bl1", tenant_id: T1, revision_id: "rev-p1", line_key: "k1", line_no: 1, description: "Pipes", qty: 1, unit_cost: 100000, amount: 100000, reserve: false },
      { id: "bl2", tenant_id: T1, revision_id: "rev-p1", line_key: "k2", line_no: 2, description: "Steel", qty: 1, unit_cost: 50000, amount: 50000, reserve: false },
      { id: "blx", tenant_id: T2, revision_id: "rev-px", line_key: "kx", line_no: 1, description: "Foreign", qty: 1, unit_cost: 777, amount: 777, reserve: false },
    ],
    project_buyout_packages: [
      { id: "pk1", tenant_id: T1, project_id: "p1", name: "Pipes", kind: "supplier", status: "awarded", committed_amount: 90000, awarded_rfq_id: null, created_at: "2026-10-12T08:00:00Z" },
      { id: "pk2", tenant_id: T1, project_id: "p1", name: "Steel", kind: "supplier", status: "draft", committed_amount: null, created_at: "2026-10-12T09:00:00Z" },
      { id: "pkx", tenant_id: T2, project_id: "px", name: "Foreign package", kind: "supplier", status: "awarded", committed_amount: 555, created_at: "2026-10-12T09:00:00Z" },
    ],
    project_buyout_package_lines: [
      { id: "pl1", tenant_id: T1, project_id: "p1", package_id: "pk1", line_key: "k1", sort_order: 1 },
      { id: "pl2", tenant_id: T1, project_id: "p1", package_id: "pk2", line_key: "k2", sort_order: 1 },
      { id: "plx", tenant_id: T2, project_id: "px", package_id: "pkx", line_key: "kx", sort_order: 1 },
    ],
  });
}

beforeEach(() => { state.db = world(); state.reads = []; });

describe("getTenderDeskData", () => {
  it("builds the desk of the workspace from its own rows", async () => {
    const d = await getTenderDeskData(T1, { now: NOW });
    expect(d.pending).toBe(false);
    expect(d.currency).toBe("SAR");
    expect(d.asOf).toBe(NOW.toISOString());
    expect(d.kpis).toMatchObject({ openCount: 3, openValue: 13_000_000, weightedValue: 4_000_000 + 450_000 + 800_000, closingSoonCount: 2, closingSoonValue: 11_000_000, won12: 1, lost12: 1, winRate: 0.5 });
    expect(d.stages.map((s) => [s.stage, s.count])).toEqual([["received", 0], ["bid_no_bid", 1], ["estimating", 1], ["submitted", 1], ["clarifications", 0]]);
    expect(d.closing.map((c) => [c.id, c.daysLeft])).toEqual([["o1", 2], ["o2", 12]]);
    expect(d.closing[0]).toMatchObject({ client: "Ministry of Works", ref: "OPP-o1", href: "/pipeline/o1", value: 8_000_000 });
    expect(d.months.find((m) => m.key === "2026-10")).toMatchObject({ won: 1, lost: 0 });
    expect(d.months.find((m) => m.key === "2026-09")).toMatchObject({ won: 0, lost: 1 });
    expect(d.clients).toEqual([{ accountId: `acc-${T1}`, name: "Ministry of Works", value: 13_000_000, count: 3 }]);
    expect(d.trend).toHaveLength(12);
    expect(d.trend[11]).toMatchObject({ weekEnd: "2026-10-28", openValue: 13_000_000 });
  });

  it("flags what needs the person: the waiting decision, the late RFQ, the expiring guarantee, the old prices and the unpriced bid", async () => {
    const d = await getTenderDeskData(T1, { now: NOW });
    const byKind = Object.fromEntries(d.attention.map((a) => [a.kind, a]));
    expect(byKind.decision).toMatchObject({ title: "Bid decision: Deal o2", action: "Decide", href: "/pipeline/o2" });
    expect(byKind.supplier_reply).toMatchObject({ title: "Supplier reply overdue: RFQ-0001", sub: "2 suppliers not replied, due 3 days ago", href: "/rfqs/r1" });
    expect(byKind.bond_expiry).toMatchObject({ title: "Bid guarantee: Deal o1", sub: "Expires in 9 days" });
    expect(byKind.stale_price).toMatchObject({ title: "Old prices: Deal o1", href: "/pipeline/o1?tab=boq" });
    expect(d.attention.length).toBeLessThanOrEqual(5);
    // o1 closes in 2 days and has a priced line, so it is not "not priced yet"; o2 closes in 12 days, which is beyond that check.
    expect(d.attention.map((a) => a.kind)).not.toContain("closing_unpriced");
  });

  it("flags a bid closing within three days with no price on any line", async () => {
    state.db.rows("tender_boq_lines").length = 0;
    const d = await getTenderDeskData(T1, { now: NOW });
    expect(d.attention.map((a) => a.title)).toContain("Not priced yet: Deal o1");
    state.db.rows("opportunity_lines").push({ id: "l2", tenant_id: T1, opportunity_id: "o1", rate: 120 });
    expect((await getTenderDeskData(T1, { now: NOW })).attention.map((a) => a.title)).not.toContain("Not priced yet: Deal o1");
  });

  it("reads every BOQ line past PostgREST's 1000-row page, so a big fortnight is neither 'not priced' nor fresh by accident", async () => {
    // o1 closes in 2 days. 1,200 BOQ rows: the first 1,100 are unpriced; then 50 stale supplier prices, then 50 manual prices. Only the
    // rows past the first page say the deal is priced at all, and only they carry the stale prices.
    const lines = state.db.rows("tender_boq_lines");
    lines.length = 0;
    for (let i = 0; i < 1200; i++) {
      const source = i < 1100 ? null : i < 1150 ? "supplier" : "manual";
      lines.push({ id: `b${String(i).padStart(4, "0")}`, tenant_id: T1, opportunity_id: "o1", price_source: source, price_as_of: source === "supplier" ? "2026-01-01" : source ? "2026-10-20" : null, stale_accepted: false, removed_in_revision: false });
    }
    const d = await getTenderDeskData(T1, { now: NOW });
    expect(d.attention.map((a) => a.title)).not.toContain("Not priced yet: Deal o1");
    expect(d.attention.find((a) => a.kind === "stale_price")).toMatchObject({ title: "Old prices: Deal o1", sub: "50 lines priced from a source older than 180 days, bid ends in 2 days" });
    // The same cap on the deal lines: the only line with a rate is the 1,001st.
    lines.length = 0;
    const deal = state.db.rows("opportunity_lines");
    deal.length = 0;
    for (let i = 0; i < 1001; i++) deal.push({ id: `l${String(i).padStart(4, "0")}`, tenant_id: T1, opportunity_id: "o1", rate: i === 1000 ? 120 : 0 });
    expect((await getTenderDeskData(T1, { now: NOW })).attention.map((a) => a.title)).not.toContain("Not priced yet: Deal o1");
  });

  it("reads the buy-out through the Buy-out tab's own summary", async () => {
    const d = await getTenderDeskData(T1, { now: NOW });
    expect(d.kpis).toMatchObject({ buyoutCommitted: 90000, buyoutBudget: 150000 });
    expect(d.buyout).toMatchObject({ projectId: "p1", projectName: "Package B works", href: "/contract-projects/p1" });
    expect(d.buyout?.packages.map((p) => [p.name, p.budget, p.committed, p.status])).toEqual([["Pipes", 100000, 90000, "awarded"], ["Steel", 50000, null, "waiting"]]);
  });

  it("never shows another workspace's rows", async () => {
    const d = await getTenderDeskData(T1, { now: NOW });
    const text = JSON.stringify(d);
    for (const foreign of ["Foreign", "Other Tenant Client", "x1", "RFQ-0002", "px", "QAR"]) expect(text, foreign).not.toContain(foreign);
    expect(d.kpis.openValue).toBe(13_000_000);

    const other = await getTenderDeskData(T2, { now: NOW });
    expect(other.currency).toBe("QAR");
    expect(other.kpis.openValue).toBe(99_000_000);
    expect(other.kpis.openCount).toBe(1);
    expect(JSON.stringify(other)).not.toContain("Deal o1");
    expect(JSON.stringify(other)).not.toContain("Ministry of Works");
    expect(other.buyout?.projectId).toBe("px");
    expect(other.buyout?.packages.map((p) => p.name)).toEqual(["Foreign package"]);
  });

  it("filters every single read on the caller's tenant", async () => {
    await getTenderDeskData(T1, { now: NOW });
    expect(state.reads.length).toBeGreaterThan(10);
    const bad = state.reads.filter((r) => !r.tenantScoped || r.foreignTenant);
    expect(bad).toEqual([]);
  });

  it("shows only what the workspace is scoped for: no RFQ module, no RFQ item and no RFQ read; no Contract projects, no buy-out and no project read", async () => {
    const full = await getTenderDeskData(T1, { now: NOW });
    expect(full.attention.map((a) => a.kind)).toContain("supplier_reply");
    expect(full.buyout).not.toBeNull();

    state.reads = [];
    const d = await getTenderDeskData(T1, { now: NOW, modules: { rfq: false, contract_projects: false } });
    expect(d.attention.map((a) => a.kind)).not.toContain("supplier_reply");
    expect(d.buyout).toBeNull();
    expect(d.kpis.buyoutBudget).toBeNull();
    expect(d.kpis.buyoutCommitted).toBe(0);
    expect(d.kpis.openCount).toBe(full.kpis.openCount);
    const tables = JSON.stringify(state.reads);
    for (const t of ["rfqs", "rfq_suppliers", "contract_projects", "project_buyout_packages", "project_budget_lines"]) expect(tables, t).not.toContain(t);
  });

  it("answers pending, not an error, when the tender table is not there yet", async () => {
    state.db.missing.add("opportunity_tenders");
    const d = await getTenderDeskData(T1, { now: NOW });
    expect(d.pending).toBe(true);
    expect(d.currency).toBe("SAR");
    expect(d.kpis.openCount).toBe(0);
  });

  it("hides a part whose table is missing and keeps the rest", async () => {
    for (const t of ["approval_requests", "rfqs", "tender_boq_lines", "project_buyout_packages", "contract_projects"]) state.db.missing.add(t);
    const d = await getTenderDeskData(T1, { now: NOW });
    expect(d.pending).toBe(false);
    expect(d.kpis.openCount).toBe(3);
    expect(d.buyout).toBeNull();
    expect(d.kpis.buyoutBudget).toBeNull();
    // No decision, RFQ or old-price item without their tables; the guarantee comes from the tender row, and o1 (no BOQ, no deal line with a rate) is unpriced.
    expect(d.attention.map((a) => a.kind).sort()).toEqual(["bond_expiry", "closing_unpriced"]);
  });

  it("survives columns that a pending migration has not added (bond status, outcome facts)", async () => {
    state.db.missingColumns.opportunity_tenders = new Set(["award_value", "bond_status", "bond_released_at"]);
    const d = await getTenderDeskData(T1, { now: NOW });
    expect(d.pending).toBe(false);
    expect(d.kpis.openCount).toBe(3);
  });

  it("is complete and empty for a workspace with no tenders", async () => {
    state.db = new MemoryDb({ tenants: [{ id: "t-empty", config: {} }] });
    const d = await getTenderDeskData("t-empty", { now: NOW });
    expect(d.pending).toBe(false);
    expect(d.kpis.openCount).toBe(0);
    expect(d.closing).toEqual([]);
    expect(d.buyout).toBeNull();
    expect(d.trend).toEqual([]);
    expect(d.currency).toBe("INR");
  });

  it("reads dates in the workspace time zone, Asia/Riyadh when it has not set one", async () => {
    state.db.rows("tenants").find((t) => t.id === T1)!.config = { currency: "SAR" };
    // 22:00 UTC the day before is already today in Riyadh, but still yesterday in Kolkata or UTC.
    const late = new Date("2026-10-27T21:30:00Z");
    state.db.rows("opportunity_tenders").find((t) => t.opportunity_id === "o5")!.closing_at = "2026-10-27T22:00:00Z";
    const d = await getTenderDeskData(T1, { now: late });
    expect(d.closing.find((c) => c.id === "o5")?.daysLeft).toBe(0);
  });

  it("falls back to Riyadh time for a zone the system does not know", async () => {
    state.db.rows("tenants").find((t) => t.id === T1)!.config = { currency: "SAR", wfm: { timezone: "Nowhere/Land" } };
    const d = await getTenderDeskData(T1, { now: NOW });
    expect(d.closing[0].daysLeft).toBe(2);
  });
});
