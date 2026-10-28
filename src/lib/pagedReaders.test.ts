import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryDb, type Row } from "@/lib/inbox/testing/memoryDb";
import { readAllPages } from "@/lib/pagedRead";

// The readers below used `.limit(2000)` or no limit at all, which PostgREST answers with 1000 rows and no error. Every test runs
// the reader against a MemoryDb that clamps every response to 1000 rows like PostgREST does, with more rows than that.

const mocks = vi.hoisted(() => ({ db: null as unknown as MemoryDb }));
vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => mocks.db,
  requireTenantUser: vi.fn(),
  getAuthUser: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => true, getTenant: async () => null }));

import { boqRowOrder, snapshotBoqLinks } from "@/lib/tender/boq/lineSync";
import { loadOpportunityLines } from "@/lib/sales/opportunityServer";
import { loadLines, replaceLines } from "@/lib/contractProjects/server";
import { loadPackageLines } from "@/lib/contractProjects/buyout/server";
import { openQuestionCounts } from "@/lib/tender/roomServer";
import { sendTenderReminders } from "@/lib/tender/reminders";
import { wfmEmployeesPayload } from "@/lib/wfm/bootstrap";
import { loadGroups } from "@/lib/supplierGroups/server";
import { generateNextWorkOrderRef } from "@/lib/workOrderRef";
import { loadOrderRows } from "@/app/(app)/sales-orders/loadOrders";
import { loadSalesOrdersForApi } from "@/lib/api/salesOrderRows";
import { loadStandardQuotesForApi } from "@/lib/api/standardQuoteRows";
import { loadResults } from "@/lib/marketing/events/server";

const T1 = "tenant-1";
const T2 = "tenant-2";
const OPP = "opp-1";
const N = 1250;
const pad = (i: number) => String(i).padStart(5, "0");
const many = (n: number, make: (i: number) => Row): Row[] => Array.from({ length: n }, (_, i) => make(i));
const as = (d: MemoryDb) => d as unknown as SupabaseClient;

function clamped(seed: Record<string, Row[]>): MemoryDb {
  const db = new MemoryDb(seed);
  db.maxRows = 1000;
  mocks.db = db;
  return db;
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("readAllPages", () => {
  it("pages until a short page, and stops on the first error", async () => {
    const db = clamped({ t: many(2500, (i) => ({ id: pad(i), tenant_id: T1 })) });
    const got = await readAllPages((lo, hi) => db.from("t").select("id").eq("tenant_id", T1).order("id", { ascending: true }).range(lo, hi));
    expect(got.error).toBeNull();
    expect(got.data).toHaveLength(2500);
    expect(new Set(got.data!.map((r: Row) => r.id)).size).toBe(2500);
    db.missing.add("t");
    const bad = await readAllPages((lo, hi) => db.from("t").select("id").range(lo, hi));
    expect(bad.data).toBeNull();
    expect(bad.error?.code).toBe("42P01");
  });
});

describe("tender and contract-project readers", () => {
  it("boqRowOrder and snapshotBoqLinks see every BOQ row of a big bid, not the first 1000", async () => {
    const db = clamped({
      tender_boq_lines: [
        ...many(N, (i) => ({ id: `b${pad(i)}`, tenant_id: T1, opportunity_id: OPP, line_id: `l${pad(i)}`, row_no: i + 1 })),
        ...many(30, (i) => ({ id: `x${pad(i)}`, tenant_id: T2, opportunity_id: OPP, line_id: `xl${pad(i)}`, row_no: i + 1 })),
      ],
    });
    expect((await boqRowOrder(as(db), T1, OPP)).size).toBe(N);
    expect((await snapshotBoqLinks(as(db), T1, OPP)).size).toBe(N);
  });

  it("loadOpportunityLines returns every line of a deal", async () => {
    const db = clamped({ opportunity_lines: many(N, (i) => ({ id: `ln${pad(i)}`, tenant_id: T1, opportunity_id: OPP, sl_no: String(i + 1), description: "x" })) });
    expect(await loadOpportunityLines(as(db), T1, OPP)).toHaveLength(N);
  });

  it("loadLines returns every budget line of a revision, and replaceLines removes every old one", async () => {
    const db = clamped({ project_budget_lines: many(N, (i) => ({ id: `pb${pad(i)}`, tenant_id: T1, revision_id: "rev-1", project_id: "p1", line_no: i + 1, qty: 1, unit_cost: 1, amount: 1 })) });
    expect(await loadLines(as(db), T1, "rev-1")).toHaveLength(N);
    const draft = { resource_code: null, cost_code: null, wbs: null, description: "new", qty: 2, unit: null, unit_cost: 3, cost_known: true, source_ref: null, reserve: false };
    const res = await replaceLines(as(db), T1, "p1", "rev-1", [draft, { ...draft, description: "new 2" }]);
    expect(res.ok).toBe(true);
    expect(db.rows("project_budget_lines").filter((r) => r.revision_id === "rev-1")).toHaveLength(2);
  });

  it("loadPackageLines returns every package line of a project", async () => {
    const db = clamped({ project_buyout_package_lines: many(N, (i) => ({ id: `pl${pad(i)}`, tenant_id: T1, project_id: "p1", package_id: "pk", budget_line_id: null, line_key: `k${i}`, sort_order: i })) });
    expect(await loadPackageLines(as(db), T1, "p1")).toHaveLength(N);
  });

  it("openQuestionCounts counts every open question", async () => {
    const db = clamped({ deal_room_messages: many(N, (i) => ({ id: `m${pad(i)}`, tenant_id: T1, room_id: "room-1", kind: "question", question_status: "open", deleted_at: null })) });
    expect((await openQuestionCounts(as(db), T1, ["room-1"])).get("room-1")).toBe(N);
  });

  it("the reminder job considers a tender that sits past the first 1000 rows", async () => {
    const closing = "2026-10-30T09:00:00.000Z";
    const db = clamped({
      tenants: [{ id: T1, slug: "kamco", name: "KAMCO", is_demo: false, config: {}, custom_domain: "k.example.com", features: { gcc_tender: true, pipeline: true } }],
      tenant_users: [{ id: "u", tenant_id: T1, user_id: "owner" }],
      opportunities: many(1100, (i) => ({ id: `d${pad(i)}`, tenant_id: T1, ref: `OPP-${i}`, title: "Deal", outcome: "open", stage: "estimating", owner_id: "owner", team: [] })),
      opportunity_tenders: many(1100, (i) => ({ opportunity_id: `d${pad(i)}`, tenant_id: T1, tender_no: "T", issuer_name: "I", closing_at: closing, decision: null, reminders_sent: [], updated_at: "2026-10-01T00:00:00.000Z" })),
    });
    db.users.set("owner", { email: "o@k.test" });
    const sent: string[] = [];
    const out = await sendTenderReminders(as(db) as unknown as Parameters<typeof sendTenderReminders>[0], { now: new Date("2026-10-29T05:00:00Z"), mailer: { send: async (p) => { sent.push(p.subject); return { error: null }; } } });
    expect(out.considered).toBe(1100);
    expect(sent).toHaveLength(1100);
  });
});

describe("other silent loaders", () => {
  it("wfmEmployeesPayload lists every employee", async () => {
    const db = clamped({ employees: many(N, (i) => ({ id: `e${pad(i)}`, tenant_id: T1, employee_code: `E${pad(i)}`, first_name: "A", last_name: "B", custom_data: {} })) });
    expect(await wfmEmployeesPayload(as(db), T1)).toHaveLength(N);
  });

  it("loadGroups reads every membership", async () => {
    const db = clamped({
      supplier_groups: [{ id: "g1", tenant_id: T1, name: "Approved", account_id: "a1", active: true }],
      supplier_group_members: many(N, (i) => ({ group_id: "g1", supplier_id: `s${pad(i)}`, tenant_id: T1 })),
    });
    const { groups } = await loadGroups(as(db), T1);
    expect(groups[0].member_count).toBe(N);
    expect(groups[0].supplier_ids).toHaveLength(N);
  });

  it("generateNextWorkOrderRef continues from the newest refs even with more than 1000 this year", async () => {
    const year = new Date().getFullYear();
    const db = clamped({ work_orders: many(1500, (i) => ({ id: `w${pad(i)}`, tenant_id: T1, ref: `WO-${year}-${String(i + 1).padStart(4, "0")}`, created_at: new Date(Date.UTC(year, 0, 1, 0, 0, i)).toISOString() })) });
    expect(await generateNextWorkOrderRef(as(db), T1)).toBe(`WO-${year}-1501`);
  });

  it("loadOrderRows lists every order and its ERP number", async () => {
    const db = clamped({
      sales_orders: many(N, (i) => ({ id: `o${pad(i)}`, tenant_id: T1, ref: `SO-${i}`, status: "draft", total: 1, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() })),
      connector_links: many(N, (i) => ({ id: `c${pad(i)}`, tenant_id: T1, object_type: "sales_orders", object_id: `o${pad(i)}`, external_key: `ERP-${i}` })),
    });
    const { rows } = await loadOrderRows(as(db), T1);
    expect(rows).toHaveLength(N);
    expect(rows.filter((r) => r.erp_number).length).toBe(N);
  });

  it("the v1 sales-order list returns every order with its line count", async () => {
    clamped({
      sales_orders: many(N, (i) => ({ id: `o${pad(i)}`, tenant_id: T1, ref: `SO-${i}`, status: "draft", total: 1, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() })),
      sales_order_lines: many(N, (i) => ({ id: `sl${pad(i)}`, tenant_id: T1, order_id: `o${pad(i)}` })),
    });
    const rows = await loadSalesOrdersForApi(T1);
    expect(rows).toHaveLength(N);
    expect(rows.every((r) => Number(r.line_count ?? 1) === 1)).toBe(true);
  });

  it("the v1 standard-quote list returns every quote", async () => {
    clamped({
      standard_quotes: many(N, (i) => ({ id: `q${pad(i)}`, tenant_id: T1, ref: `SQ-${i}`, status: "draft", created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() })),
      standard_quote_lines: many(N, (i) => ({ id: `ql${pad(i)}`, tenant_id: T1, standard_quote_id: `q${pad(i)}` })),
    });
    expect(await loadStandardQuotesForApi(T1)).toHaveLength(N);
  });

  it("an event's results count every registration", async () => {
    const db = clamped({
      event_registrations: [
        ...many(900, (i) => ({ id: `r${pad(i)}`, tenant_id: T1, event_id: "ev", status: "attended" })),
        ...many(400, (i) => ({ id: `n${pad(i)}`, tenant_id: T1, event_id: "ev", status: "no_show" })),
      ],
    });
    const ctx = { supabase: db, admin: db, tenantId: T1 } as unknown as Parameters<typeof loadResults>[0];
    const r = await loadResults(ctx, { id: "ev", capacity: null });
    expect(r.attended).toBe(900);
    expect(r.noShow).toBe(400);
  });
});
