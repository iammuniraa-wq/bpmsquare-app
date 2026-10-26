import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";
import { messyWorkbook } from "@/lib/tender/boq/testing/workbooks";

// GCC tender deals, slice 3c-1: estimates that price the BOQ, against the real routes and an in-memory database. The questions asked
// are the ones that matter for money and for another workspace: every id is looked up in the caller's workspace and deal, the cost is
// worked out on the server from the estimate as it is now, an output is never given out above 100 percent, a changed estimate is
// flagged and re-priced only on purpose, and a workspace without the edition meets a 404 that reads no table.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  tenantId: "t1",
  features: {} as Record<string, boolean>,
  owned: {} as Record<string, boolean>,
  user: { id: "u1", email: "me@t1.test" },
  canEdit: true,
  canCreate: true,
  canViewEstimates: true,
  changes: [] as { objectType: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  created: [] as Record<string, unknown>[],
  buildError: null as null | { status: number; error: string },
}));

const T1 = "t1";
const T2 = "t2";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPP_OTHER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const OPP_TWO = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const EST = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const EST_TWO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const EST_FOREIGN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";
const EST_SMALL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04";
const TPL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const LN_PIPE = "11111111-1111-4111-8111-111111111111";
const LN_CREW = "22222222-2222-4222-8222-222222222222";
const LN_HAUL = "33333333-3333-4333-8333-333333333333";
const LN_SMALL = "44444444-4444-4444-8444-444444444444";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: state.tenantId, userId: state.user.id, role: "member", supabase: { from: (t: string) => state.db.from(t) } }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({}),
  canViewWorkcenter: (_p: unknown, wc: string) => (wc === "estimates" ? state.canViewEstimates : true),
  canEditWorkcenter: () => state.canEdit,
  canCreateWorkcenter: () => state.canCreate,
}));
vi.mock("@/lib/objectFeatures", async (orig) => ({ ...(await orig<typeof import("@/lib/objectFeatures")>()), tenantOwnsObject: async (_t: string, o: string) => !!state.owned[o] }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-10-26", tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [], diffLineItems: () => [],
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
// The estimate itself is made by the ordinary estimate route (tested in estimates.tender.routes.test.ts); here it is a stand-in that
// records what it was asked and makes the row the real one would.
vi.mock("@/app/api/estimates/route", () => ({
  POST: async (req: Request) => {
    const b = (await req.json()) as Record<string, unknown>;
    state.created.push(b);
    if (state.buildError) return Response.json({ error: state.buildError.error }, { status: state.buildError.status });
    const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee99";
    state.db.rows("estimates").push({ id, tenant_id: state.tenantId, opportunity_id: b.opportunity_id ?? null, ref: "EST-0099", name: b.name, status: "draft", template_id: b.template_id, margin_pct: 0, totals: { cost_total: 0, price: 0 }, standard_quote_id: null, created_at: "2026-10-26T08:00:00.000Z", updated_at: "2026-10-26T08:00:00.000Z" });
    return Response.json({ id, ref: "EST-0099" }, { status: 201 });
  },
}));

import { NextRequest } from "next/server";
import { GET as boqGet, POST as boqPost } from "./[id]/boq/route";
import { POST as pricePost } from "./[id]/boq/price/route";
import { GET as estGet, POST as estPost } from "./[id]/tender/estimates/links/route";
import { DELETE as linkDelete, PATCH as linkPatch } from "./[id]/tender/estimates/links/[linkId]/route";
import { POST as buildPost } from "./[id]/tender/estimates/build/route";
import { GET as allocateGet } from "./[id]/tender/estimates/allocate/route";
import { POST as repricePost } from "./[id]/tender/estimates/reprice/route";
import { GET as missingGet } from "./[id]/tender/estimates/missing/route";
import { GET as tabGet } from "./[id]/tender/estimates/route";

const url = () => new URL("http://internal.invalid/x");
const ctx = (id = OPP, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, linkId: "", ...extra }) });
const get = (q = "") => new NextRequest(new URL(`http://internal.invalid/x${q}`), { method: "GET" });
const json = (method: string, body: unknown) => new NextRequest(url(), { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const upload = (buf: Buffer) => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(buf)], "client boq.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return new NextRequest(url(), { method: "POST", body: form });
};

const links = () => state.db.rows("tender_boq_estimate_links");
const boqRow = (item: string) => state.db.rows("tender_boq_lines").find((b) => b.opportunity_id === OPP && b.item_no === item)!;
const dealLine = (item: string) => state.db.rows("opportunity_lines").find((l) => l.id === boqRow(item).line_id)!;
const estRow = (id = EST) => state.db.rows("estimates").find((e) => e.id === id)!;
const snapshot = () => JSON.stringify([state.db.rows("opportunity_lines"), state.db.rows("tender_boq_lines"), links(), state.db.rows("estimates"), state.db.rows("estimate_lines")]);
const link = (item: string, over: Record<string, unknown> = {}) => ({ boq_id: boqRow(item).id as string, estimate_id: EST, output: "total", basis: "total", share_pct: 100, ...over });
async function price(items: unknown[], extra: Record<string, unknown> = {}, id = OPP) {
  const res = await estPost(json("POST", { items, ...extra }), ctx(id));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { error?: string; code?: string; repriced?: { boq_id: string; to_rate: number; cost: number }[]; failed?: unknown[] } };
}

const NEW_TABLES = ["tender_boq_estimate_links"];

beforeEach(async () => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: {} }, { id: T2, config: {} }],
    opportunities: [
      { id: OPP_STD, tenant_id: T1, ref: "OPP-1", title: "Standard deal", account_id: "acc", stage: "qualify", outcome: "open", owner_id: "u1", team: [], amount: 0 },
      { id: OPP, tenant_id: T1, ref: "OPP-2", title: "Pipeline package 4", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0, probability: 25 },
      { id: OPP_TWO, tenant_id: T1, ref: "OPP-4", title: "Another tender", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0 },
      { id: OPP_OTHER, tenant_id: T2, ref: "OPP-9", title: "Someone else's tender", account_id: "acc2", stage: "estimating", outcome: "open", owner_id: "u9", team: [], amount: 0 },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { opportunity_id: OPP_TWO, tenant_id: T1, tender_no: "ARB-2", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { opportunity_id: OPP_OTHER, tenant_id: T2, tender_no: "ZZ-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ],
    opportunity_lines: [],
    estimate_templates: [
      { id: TPL, tenant_id: T1, name: "Pipe run", description: "Pipes", is_active: true, inputs: [{ key: "length_m", label: "Length", type: "number", unit: "m", min: 1, max: 5000, default: 10 }] },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02", tenant_id: T1, name: "Retired", description: null, is_active: false, inputs: [] },
    ],
    estimates: [
      { id: EST, tenant_id: T1, opportunity_id: OPP, ref: "EST-0007", name: "Pipe run, route 4", status: "draft", template_id: TPL, margin_pct: 0, totals: { cost_total: 5006, price: 5006 }, standard_quote_id: null, created_at: "2026-10-20T08:00:00.000Z", updated_at: "2026-10-20T08:00:00.000Z" },
      { id: EST_SMALL, tenant_id: T1, opportunity_id: OPP, ref: "EST-0008", name: "Survey", status: "draft", template_id: null, margin_pct: 0, totals: { cost_total: 300, price: 300 }, standard_quote_id: null, created_at: "2026-10-21T08:00:00.000Z", updated_at: "2026-10-21T08:00:00.000Z" },
      { id: EST_TWO, tenant_id: T1, opportunity_id: OPP_TWO, ref: "EST-0009", name: "Other tender's estimate", status: "draft", template_id: null, margin_pct: 0, totals: { cost_total: 111, price: 111 }, standard_quote_id: null, created_at: "2026-10-21T08:00:00.000Z", updated_at: "2026-10-21T08:00:00.000Z" },
      { id: EST_FOREIGN, tenant_id: T2, opportunity_id: OPP_OTHER, ref: "EST-0001", name: "Theirs", status: "draft", template_id: null, margin_pct: 0, totals: { cost_total: 9, price: 9 }, standard_quote_id: null, created_at: "2026-10-21T08:00:00.000Z", updated_at: "2026-10-21T08:00:00.000Z" },
    ],
    estimate_lines: [
      { id: LN_PIPE, tenant_id: T1, estimate_id: EST, sort_order: 1, code: "pipe_110", description: "HDPE pipe 110mm", uom: "m", qty: 120, waste_pct: 5, unit_cost: 31, cost_total: 3906, component: "materials", product_id: null, source: "rule", wbs_code: "1.1", custom_data: { group: "Supply" }, updated_at: "2026-10-20T08:00:00.000Z" },
      { id: LN_CREW, tenant_id: T1, estimate_id: EST, sort_order: 2, code: "lay_crew", description: "Laying crew", uom: "day", qty: 10, waste_pct: 0, unit_cost: 60, cost_total: 600, component: "labour", product_id: null, source: "rule", wbs_code: "2.1", custom_data: { group: "Installation" }, updated_at: "2026-10-20T08:00:00.000Z" },
      { id: LN_HAUL, tenant_id: T1, estimate_id: EST, sort_order: 3, code: "haulage", description: "Haulage to site", uom: "trip", qty: 5, waste_pct: 0, unit_cost: 100, cost_total: 500, component: "transport", product_id: null, source: "rule", wbs_code: "2.2", custom_data: { group: "Installation" }, updated_at: "2026-10-20T08:00:00.000Z" },
      { id: LN_SMALL, tenant_id: T1, estimate_id: EST_SMALL, sort_order: 1, code: "survey", description: "Route survey", uom: "ls", qty: 1, waste_pct: 0, unit_cost: 300, cost_total: 300, component: "other", product_id: null, source: "manual", wbs_code: "1.1", custom_data: null, updated_at: "2026-10-21T08:00:00.000Z" },
    ],
    tender_boq_estimate_links: [],
  });
  state.tenantId = T1;
  state.features = { pipeline: true, gcc_tender: true, rfq: true };
  state.owned = { estimates: true };
  state.canEdit = true; state.canCreate = true; state.canViewEstimates = true;
  state.changes = []; state.created = []; state.buildError = null;
  vi.spyOn(console, "error").mockImplementation(() => {});

  const file = await messyWorkbook({
    rows: [
      ["1.1", "Supply and install gate valve 100mm DN100", "no", 4, "cc1"],
      ["1.2", "Survey of the route", "ls", 1, "cc2"],
      ["1.3", "HDPE pipe 110mm, laid in trench", "m", 120, "cc3"],
      ["1.4", "Mobilisation", "lot", 1, "cc4"],
    ],
  });
  expect((await boqPost(upload(file), ctx())).status).toBe(200);
});

describe("the gate", () => {
  const every = async (id = OPP) => {
    const b = boqRow("1.3").id as string;
    return [
      (await estGet(get(), ctx(id))).status,
      (await estGet(get(`?estimate=${EST}&boq=${b}`), ctx(id))).status,
      (await estPost(json("POST", { items: [link("1.3")] }), ctx(id))).status,
      (await linkDelete(json("DELETE", {}), ctx(id, { linkId: "99999999-9999-4999-8999-999999999999" }))).status,
      (await linkPatch(json("PATCH", { reviewed: true }), ctx(id, { linkId: "99999999-9999-4999-8999-999999999999" }))).status,
      (await buildPost(json("POST", { boq_id: b, template_id: TPL }), ctx(id))).status,
      (await allocateGet(get(`?estimate=${EST}`), ctx(id))).status,
      (await repricePost(json("POST", { all_stale: true }), ctx(id))).status,
      (await missingGet(get(), ctx(id))).status,
      (await tabGet(get(), ctx(id))).status,
    ];
  };

  it("a workspace without the tender edition meets a 404 on every route and no new table is read or written", async () => {
    state.features.gcc_tender = false;
    const touched: string[] = [];
    const orig = state.db.from.bind(state.db);
    vi.spyOn(state.db, "from").mockImplementation((t: string) => { touched.push(t); return orig(t); });
    const before = snapshot();
    expect(await every()).toEqual(Array(10).fill(404));
    expect(touched.filter((t) => NEW_TABLES.includes(t) || t === "estimates" || t === "estimate_lines")).toEqual([]);
    expect(snapshot()).toBe(before);
  });

  it("a standard deal, another workspace's deal and an id that is not a deal are the same 404", async () => {
    const before = snapshot();
    expect(await every(OPP_STD)).toEqual(Array(10).fill(404));
    expect(await every(OPP_OTHER)).toEqual(Array(10).fill(404));
    expect(await every("not-an-id")).toEqual(Array(10).fill(404));
    expect(snapshot()).toBe(before);
  });

  it("without the estimator module, or without the Estimates view, there is nothing to see", async () => {
    state.owned.estimates = false;
    expect(await every()).toEqual(Array(10).fill(404));
    state.owned.estimates = true; state.canViewEstimates = false;
    expect(await every()).toEqual(Array(10).fill(404));
  });

  it("a view-only person reads but cannot write; creating needs the create right", async () => {
    state.canEdit = false;
    expect((await estGet(get(), ctx())).status).toBe(200);
    const statuses = [
      (await estPost(json("POST", { items: [link("1.3")] }), ctx())).status,
      (await repricePost(json("POST", { all_stale: true }), ctx())).status,
    ];
    expect(statuses).toEqual([403, 403]);
    state.canEdit = true; state.canCreate = false;
    expect((await buildPost(json("POST", { boq_id: boqRow("1.3").id, template_id: TPL }), ctx())).status).toBe(403);
    expect(links()).toEqual([]);
  });

  it("a tender that has no BOQ yet cannot be linked", async () => {
    const res = await estPost(json("POST", { items: [{ boq_id: "99999999-9999-4999-8999-999999999999", estimate_id: EST_TWO, output: "total", basis: "total", share_pct: 100 }] }), ctx(OPP_TWO));
    expect(res.status).toBe(404);
  });
});

describe("price from estimate", () => {
  it("works the cost out on the server: the whole estimate over the BOQ quantity, plus the markup, on the line, the BOQ row and the link", async () => {
    const r = await price([link("1.3")], { markup_pct: 10 });
    expect(r.status).toBe(200);
    expect(r.body.repriced).toHaveLength(1);
    // 5,006 over 120 m = 41.7167 a metre at cost; 10 percent on top = 45.89.
    expect(dealLine("1.3")).toMatchObject({ rate: 45.89, amount: 5506.8 });
    expect(boqRow("1.3")).toMatchObject({ price_source: "estimate", price_source_ref: "EST-0007", unit_cost: 41.7167, markup_pct: 10, price_as_of: "2026-10-26", stale_accepted: false });
    expect(links()).toHaveLength(1);
    expect(links()[0]).toMatchObject({ tenant_id: T1, opportunity_id: OPP, estimate_id: EST, output: "total", basis: "total", share_pct: 100, applied_cost: 41.7167, estimate_updated_at: "2026-10-20T08:00:00.000Z" });
    expect(links()[0].applied_at).toBeTruthy();
    expect(state.changes.some((c) => c.objectType === "opportunity_tenders" && c.changes?.some((x) => x.field === "BOQ rate source" && String(x.to).startsWith("estimate")))).toBe(true);
  });

  it("a cost, rate, source or tenant in the request is ignored: only the estimate, the part, the basis and the share count", async () => {
    const r = await price([{ ...link("1.3"), applied_cost: 1, unit_cost: 1, cost: 1, rate: 1, price_source: "supplier", tenant_id: T2, cost_per_unit: 1 }], { markup_pct: 0, unit_cost: 1, rate: 1 });
    expect(r.status).toBe(200);
    expect(boqRow("1.3")).toMatchObject({ price_source: "estimate", unit_cost: 41.7167 });
    expect(dealLine("1.3").rate).toBe(41.72);
    expect(links()[0].tenant_id).toBe(T1);
    expect(links()[0].applied_cost).toBe(41.7167);
  });

  it("a share takes part of the cost, and a per-unit basis takes the estimate line's own cost per unit", async () => {
    await price([link("1.3", { share_pct: 50 })]);
    expect(boqRow("1.3").unit_cost).toBe(20.8583);
    await price([link("1.3", { output: `line:${LN_PIPE}`, basis: "per_unit", share_pct: 100 })]);
    // Two links now on the line: their costs add up.
    expect(links()).toHaveLength(2);
    expect(boqRow("1.3").unit_cost).toBe(53.4083);
  });

  it("the same line, estimate and part again updates the share instead of making a second link", async () => {
    await price([link("1.3", { share_pct: 100 })]);
    await price([link("1.3", { share_pct: 40 })]);
    expect(links()).toHaveLength(1);
    expect(links()[0].share_pct).toBe(40);
    expect(boqRow("1.3").unit_cost).toBe(16.6867);
  });

  it("the same link twice in one request, or a bad basis, share or output, is refused and nothing is written", async () => {
    const before = snapshot();
    for (const items of [
      [link("1.3"), link("1.3")],
      [link("1.3", { basis: "per_line" })],
      [link("1.3", { share_pct: 0 })],
      [link("1.3", { share_pct: 120 })],
      [link("1.3", { output: "line:not-an-id" })],
      [link("1.3", { output: "everything" })],
      [],
    ]) {
      const r = await price(items as unknown[]);
      expect(r.status, JSON.stringify(items)).toBe(422);
    }
    expect(snapshot()).toBe(before);
  });

  it("a part of the estimate that is not there, a per-unit basis on the whole estimate and a BOQ line with no quantity are 422", async () => {
    state.db.rows("opportunity_lines").find((l) => l.id === boqRow("1.4").line_id)!.qty = 0;
    const before = snapshot();
    expect((await price([link("1.3", { output: "line:55555555-5555-4555-8555-555555555555" })])).status).toBe(422);
    expect((await price([link("1.3", { output: "wbs:9" })])).status).toBe(422);
    expect((await price([link("1.3", { basis: "per_unit" })])).status).toBe(422);
    expect((await price([link("1.4")])).status).toBe(422);
    expect(snapshot()).toBe(before);
  });

  it("an estimate of another workspace, of another deal, or one that does not exist is a 404, even next to a valid link", async () => {
    const before = snapshot();
    for (const estimate_id of [EST_FOREIGN, EST_TWO, "99999999-9999-4999-8999-999999999999", "nope"]) {
      const r = await price([link("1.3"), link("1.1", { estimate_id })]);
      expect(r.status, estimate_id).toBe(estimate_id === "nope" ? 422 : 404);
    }
    expect(snapshot()).toBe(before);
  });

  it("a BOQ line of another deal or workspace is a 404, and nothing is linked", async () => {
    state.db.rows("tender_boq_lines").push({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", tenant_id: T2, opportunity_id: OPP_OTHER, line_id: null, row_no: 1, item_no: "9", item_key: "9", file_description: "x", removed_in_revision: false });
    state.db.rows("tender_boq_lines").push({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddd02", tenant_id: T1, opportunity_id: OPP_TWO, line_id: null, row_no: 1, item_no: "9", item_key: "9", file_description: "x", removed_in_revision: false });
    const before = snapshot();
    for (const boq_id of ["dddddddd-dddd-4ddd-8ddd-dddddddddd01", "dddddddd-dddd-4ddd-8ddd-dddddddddd02"]) {
      expect((await price([link("1.3"), link("1.3", { boq_id })])).status, boq_id).toBe(404);
    }
    expect(snapshot()).toBe(before);
  });

  it("never gives out more than 100 percent of a part: two lines at 60 percent are refused together, a second request is refused against the first", async () => {
    const before = snapshot();
    const both = await price([link("1.3", { share_pct: 60 }), link("1.1", { share_pct: 60 })]);
    expect(both.status).toBe(409);
    expect(both.body.code).toBe("over_allocated");
    expect(snapshot()).toBe(before);

    expect((await price([link("1.3", { share_pct: 60 })])).status).toBe(200);
    const second = await price([link("1.1", { share_pct: 41 })]);
    expect(second.status).toBe(409);
    expect(links()).toHaveLength(1);
    expect((await price([link("1.1", { share_pct: 40 })])).status).toBe(200);
    expect(links()).toHaveLength(2);
    // Lowering a share on the first makes room.
    expect((await price([link("1.3", { share_pct: 50 }), link("1.1", { share_pct: 50 })])).status).toBe(200);
  });

  it("a per-unit link takes nothing out of the pool", async () => {
    expect((await price([link("1.3", { share_pct: 100 })])).status).toBe(200);
    expect((await price([link("1.1", { output: `line:${LN_PIPE}`, basis: "per_unit", share_pct: 100 }), link("1.2", { output: `line:${LN_PIPE}`, basis: "per_unit", share_pct: 100 })])).status).toBe(200);
  });

  it("the old price route cannot be made to say a rate came from an estimate", async () => {
    const res = await pricePost(json("POST", { line: boqRow("1.3").id, source: "estimate", ref: "EST-0007" }), ctx());
    expect(res.status).toBe(422);
    expect(boqRow("1.3").price_source ?? null).toBeNull();
  });

  it("the cost behind an estimate rate stays out of the priced file's data and the answer sheet", async () => {
    await price([link("1.3")], { markup_pct: 10 });
    const { exportPriced, exportAnswerSheet } = await import("@/lib/tender/boq/server");
    const ExcelJS = (await import("exceljs")).default;
    const gate = await (await import("@/lib/tender/estimates/server")).openEstimatesRequest(OPP, "view");
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    const texts: string[] = [];
    for (const out of [await exportAnswerSheet(gate.req), await exportPriced(gate.req)]) {
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(out.buffer as unknown as ArrayBuffer);
      wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => { texts.push(String(cell.value instanceof Object && "result" in cell.value ? cell.value.result : cell.value)); })));
    }
    const all = texts.join("|");
    expect(all).toContain("45.89");
    expect(all).not.toMatch(/41\.7167|41\.72|5006|EST-0007/);
  });
});

describe("what the screens read", () => {
  it("the Prices tab state lists the estimates with their lines, missing costs and links, and flags nothing that is current", async () => {
    await price([link("1.3")]);
    const s = await (await estGet(get(), ctx())).json();
    expect(s.pending).toBe(false);
    expect(s.rfq_enabled).toBe(true);
    expect(s.estimates.map((e: { ref: string }) => e.ref).sort()).toEqual(["EST-0007", "EST-0008"]);
    expect(s.links).toHaveLength(1);
    expect(s.links[0]).toMatchObject({ estimate_ref: "EST-0007", output_label: "Whole estimate", stale: false, waiting: false, broken: false, needs_review: false });
    expect(JSON.stringify(s)).not.toMatch(/tenant_id|EST-0009|EST-0001/);
  });

  it("an estimate's outputs come with the cost per unit each gives that line, at 100 percent", async () => {
    const r = await (await estGet(get(`?estimate=${EST}&boq=${boqRow("1.3").id}`), ctx())).json();
    const total = r.outputs.find((o: { key: string }) => o.key === "total");
    expect(total).toMatchObject({ cost: 5006, per_unit_total: 41.7167, per_unit_line: null });
    const pipe = r.outputs.find((o: { key: string }) => o.key === `line:${LN_PIPE}`);
    expect(pipe).toMatchObject({ cost: 3906, per_unit_total: 32.55, per_unit_line: 32.55 });
    expect(r.outputs.map((o: { key: string }) => o.key)).toContain("wbs:2");
  });

  it("asking for another deal's estimate is a 404", async () => {
    for (const e of [EST_TWO, EST_FOREIGN]) expect((await estGet(get(`?estimate=${e}&boq=${boqRow("1.3").id}`), ctx())).status).toBe(404);
  });

  it("the Estimates tab lists this deal's estimates and the active templates, and nothing of the other deal's", async () => {
    const t = await (await tabGet(get(), ctx())).json();
    expect(t.estimates.map((e: { ref: string }) => e.ref).sort()).toEqual(["EST-0007", "EST-0008"]);
    expect(t.templates.map((x: { name: string }) => x.name)).toEqual(["Pipe run"]);
    expect(t).toMatchObject({ can_create: true, rfq_enabled: true });
    expect(t.estimates.find((e: { ref: string }) => e.ref === "EST-0007")).toMatchObject({ cost_total: 5006, price: 5006, template_name: "Pipe run", line_count: 3 });
  });

  it("while migration 0227 is pending the tab says so and nothing crashes", async () => {
    state.db.missingColumns.estimates = new Set(["opportunity_id"]);
    const t = await (await tabGet(get(), ctx())).json();
    expect(t.pending).toBe(true);
    expect(t.estimates).toEqual([]);
    state.db.missingColumns.estimates = new Set();
    state.db.missing.add("tender_boq_estimate_links");
    const res = await price([link("1.3")]);
    expect(res.status).toBe(503);
    expect(String(res.body.error)).toMatch(/0227/);
    expect((await boqGet(get(), ctx())).status).toBe(200);
  });
});

describe("estimate changed, re-price", () => {
  const edit = (cost: number) => {
    const l = state.db.rows("estimate_lines").find((x) => x.id === LN_HAUL)!;
    l.cost_total = cost; l.unit_cost = cost / 5;
    estRow().updated_at = "2026-10-26T09:00:00.000Z";
  };

  it("an estimate saved after the line was priced marks the link stale; nothing is re-priced by itself", async () => {
    await price([link("1.3")]);
    const rate = dealLine("1.3").rate;
    edit(1500);
    const s = await (await estGet(get(), ctx())).json();
    expect(s.links[0].stale).toBe(true);
    expect(s.estimates.find((e: { ref: string }) => e.ref === "EST-0007").stale_links).toBe(1);
    expect(dealLine("1.3").rate).toBe(rate);
  });

  it("Re-price picks up the new cost and clears the flag; a line that is current is left alone", async () => {
    await price([link("1.3")]);
    edit(1500);
    const r = await (await repricePost(json("POST", { all_stale: true }), ctx())).json();
    expect(r.repriced).toHaveLength(1);
    // 6,006 over 120 = 50.05.
    expect(boqRow("1.3").unit_cost).toBe(50.05);
    expect(dealLine("1.3").rate).toBe(50.05);
    expect((await (await estGet(get(), ctx())).json()).links[0].stale).toBe(false);
    expect((await repricePost(json("POST", { all_stale: true }), ctx())).status).toBe(422);
  });

  it("re-pricing keeps the line's markup, and a typed markup replaces it", async () => {
    await price([link("1.3")], { markup_pct: 20 });
    edit(1500);
    await repricePost(json("POST", { all_stale: true }), ctx());
    expect(dealLine("1.3").rate).toBe(60.06);
    await repricePost(json("POST", { boq_ids: [boqRow("1.3").id], markup_pct: 25 }), ctx());
    expect(dealLine("1.3").rate).toBe(62.56);
    expect(boqRow("1.3").markup_pct).toBe(25);
  });

  it("an output that is gone is reported and the rate is kept, not zeroed", async () => {
    await price([link("1.3", { output: `line:${LN_HAUL}`, basis: "per_unit" })]);
    const rate = dealLine("1.3").rate;
    state.db.tables.estimate_lines = state.db.rows("estimate_lines").filter((l) => l.id !== LN_HAUL);
    estRow().updated_at = "2026-10-26T09:00:00.000Z";
    const s = await (await estGet(get(), ctx())).json();
    expect(s.links[0]).toMatchObject({ broken: true, stale: true });
    const r = await (await repricePost(json("POST", { all_stale: true }), ctx())).json();
    expect(r.repriced).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(dealLine("1.3").rate).toBe(rate);
  });

  it("only this deal's links are re-priced: an id from another deal does nothing", async () => {
    await price([link("1.3")]);
    edit(1500);
    const other = "99999999-9999-4999-8999-999999999999";
    expect((await repricePost(json("POST", { link_ids: [other], boq_ids: [other] }), ctx())).status).toBe(422);
    expect(boqRow("1.3").unit_cost).toBe(41.7167);
  });

  it("a revised BOQ that changes the quantity also makes the link stale, because the same cost now works out to another cost per unit", async () => {
    await price([link("1.3")]);
    expect((await (await estGet(get(), ctx())).json()).links[0].stale).toBe(false);
    dealLine("1.3").qty = 150;
    expect((await (await estGet(get(), ctx())).json()).links[0].stale).toBe(true);
    const r = await (await repricePost(json("POST", { all_stale: true }), ctx())).json();
    expect(r.repriced).toHaveLength(1);
    // 5,006 over 150 m.
    expect(boqRow("1.3").unit_cost).toBe(33.3733);
    expect((await (await estGet(get(), ctx())).json()).links[0].stale).toBe(false);
  });

  it("the state says when the bid is already in", async () => {
    state.db.rows("opportunities").find((o) => o.id === OPP)!.stage = "submitted";
    expect((await (await estGet(get(), ctx())).json()).bid_locked).toBe(true);
    state.db.rows("opportunities").find((o) => o.id === OPP)!.stage = "estimating";
    expect((await (await estGet(get(), ctx())).json()).bid_locked).toBe(false);
  });
});

describe("unlinking and review", () => {
  it("unlinking the only link keeps the rate and makes it a manual rate", async () => {
    await price([link("1.3")], { markup_pct: 10 });
    const id = links()[0].id as string;
    const res = await linkDelete(json("DELETE", {}), ctx(OPP, { linkId: id }));
    expect(res.status).toBe(200);
    expect(links()).toEqual([]);
    expect(dealLine("1.3").rate).toBe(45.89);
    expect(boqRow("1.3")).toMatchObject({ price_source: "manual", unit_cost: null, markup_pct: null });
  });

  it("unlinking one of two re-prices the line from the other", async () => {
    await price([link("1.3", { share_pct: 50 }), link("1.3", { output: `line:${LN_PIPE}`, basis: "per_unit" })]);
    const first = links().find((l) => l.output === "total")!;
    await linkDelete(json("DELETE", {}), ctx(OPP, { linkId: first.id as string }));
    expect(boqRow("1.3").unit_cost).toBe(32.55);
  });

  it("another deal's or workspace's link cannot be removed or marked reviewed", async () => {
    links().push({ id: "99999999-9999-4999-8999-999999999991", tenant_id: T2, opportunity_id: OPP_OTHER, boq_line_id: "x", estimate_id: EST_FOREIGN, output: "total", basis: "total", share_pct: 100 });
    links().push({ id: "99999999-9999-4999-8999-999999999992", tenant_id: T1, opportunity_id: OPP_TWO, boq_line_id: "y", estimate_id: EST_TWO, output: "total", basis: "total", share_pct: 100 });
    for (const linkId of ["99999999-9999-4999-8999-999999999991", "99999999-9999-4999-8999-999999999992", "not-an-id"]) {
      expect((await linkDelete(json("DELETE", {}), ctx(OPP, { linkId }))).status, linkId).toBe(404);
      expect((await linkPatch(json("PATCH", { reviewed: true }), ctx(OPP, { linkId }))).status, linkId).toBe(404);
    }
    expect(links()).toHaveLength(2);
  });

  it("marking reviewed clears the review mark and nothing else", async () => {
    await price([link("1.3")]);
    links()[0].needs_review = true;
    links()[0].review_note = "RFQ-0004 was awarded";
    const rate = dealLine("1.3").rate;
    expect((await linkPatch(json("PATCH", { reviewed: true }), ctx(OPP, { linkId: links()[0].id as string }))).status).toBe(200);
    expect(links()[0]).toMatchObject({ needs_review: false, review_note: null });
    expect(dealLine("1.3").rate).toBe(rate);
    expect((await linkPatch(json("PATCH", { reviewed: false }), ctx(OPP, { linkId: links()[0].id as string }))).status).toBe(422);
  });
});

describe("build up this rate", () => {
  it("makes the estimate through the ordinary route with the deal and the line's quantity, and keeps a waiting link", async () => {
    const res = await buildPost(json("POST", { boq_id: boqRow("1.3").id, template_id: TPL }), ctx());
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, ref: "EST-0099" });
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({ template_id: TPL, opportunity_id: OPP, params: { length_m: 120 }, name: "1.3 HDPE pipe 110mm, laid in trench" });
    expect(String(state.created[0].notes)).toContain("120 m");
    expect(links()).toHaveLength(1);
    expect(links()[0]).toMatchObject({ estimate_id: j.estimate_id, boq_line_id: boqRow("1.3").id, output: "total", basis: "total", share_pct: 100 });
    expect(links()[0].applied_at ?? null).toBeNull();
    // Not priced yet: the line only gets a rate when the person comes back and uses the total.
    expect(dealLine("1.3").rate).toBe(0);
    const s = await (await estGet(get(), ctx())).json();
    expect(s.links.find((l: { estimate_id: string }) => l.estimate_id === j.estimate_id)).toMatchObject({ waiting: true, stale: false });
  });

  it("on return the line is priced from the estimate's total divided by the quantity", async () => {
    const j = await (await buildPost(json("POST", { boq_id: boqRow("1.3").id, template_id: TPL }), ctx())).json();
    // The person finished the estimate: 6,000 for the 120 m.
    state.db.rows("estimate_lines").push({ id: "55555555-5555-4555-8555-555555555555", tenant_id: T1, estimate_id: j.estimate_id, sort_order: 1, code: "x", description: "Everything", uom: "m", qty: 120, waste_pct: 0, unit_cost: 50, cost_total: 6000, component: "materials", product_id: null, source: "rule", wbs_code: "1.1", custom_data: null, updated_at: "2026-10-26T09:00:00.000Z" });
    estRow(j.estimate_id).updated_at = "2026-10-26T09:00:00.000Z";
    const r = await (await repricePost(json("POST", { link_ids: [links()[0].id] }), ctx())).json();
    expect(r.repriced).toHaveLength(1);
    expect(boqRow("1.3")).toMatchObject({ price_source: "estimate", unit_cost: 50 });
    expect(dealLine("1.3").rate).toBe(50);
  });

  it("refuses a template that is not this workspace's, an inactive one's missing line and a line with no quantity; nothing is made", async () => {
    const b = boqRow("1.3").id;
    expect((await buildPost(json("POST", { boq_id: b, template_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb99" }), ctx())).status).toBe(404);
    expect((await buildPost(json("POST", { boq_id: "dddddddd-dddd-4ddd-8ddd-dddddddddd09", template_id: TPL }), ctx())).status).toBe(404);
    expect((await buildPost(json("POST", { boq_id: "nope", template_id: TPL }), ctx())).status).toBe(422);
    state.db.rows("opportunity_lines").find((l) => l.id === boqRow("1.4").line_id)!.qty = 0;
    expect((await buildPost(json("POST", { boq_id: boqRow("1.4").id, template_id: TPL }), ctx())).status).toBe(422);
    expect(state.created).toHaveLength(0);
    expect(links()).toEqual([]);
  });

  it("when the estimate cannot be made the answer says why and no link is left", async () => {
    state.buildError = { status: 422, error: "This template has problems and cannot be used yet." };
    const res = await buildPost(json("POST", { boq_id: boqRow("1.3").id, template_id: TPL }), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("template");
    expect(links()).toEqual([]);
  });

  it("if the link cannot be saved the new estimate is taken back out", async () => {
    state.db.missing.add("tender_boq_estimate_links");
    const res = await buildPost(json("POST", { boq_id: boqRow("1.3").id, template_id: TPL }), ctx());
    expect(res.status).toBe(503);
    expect(state.db.rows("estimates").some((e) => e.id === "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee99")).toBe(false);
  });
});

describe("allocate to BOQ", () => {
  it("proposes by wording and by spreading, with shares that add up, and reads nothing from another deal", async () => {
    const m = await (await allocateGet(get(`?estimate=${EST}&mode=match&by=amount`), ctx())).json();
    expect(m.estimate.ref).toBe("EST-0007");
    expect(m.rows.map((r: { boq_id: string }) => r.boq_id)).toContain(boqRow("1.3").id);
    const hit = m.rows.find((r: { boq_id: string }) => r.boq_id === boqRow("1.3").id);
    expect(hit).toMatchObject({ output: `line:${LN_PIPE}`, share_pct: 100, output_cost: 3906 });
    const s = await (await allocateGet(get(`?estimate=${EST}&mode=spread&by=quantity&output=total`), ctx())).json();
    expect(Math.round(s.rows.reduce((t: number, r: { share_pct: number }) => t + r.share_pct, 0) * 100)).toBe(10000);
    expect(s.outputs[0]).toMatchObject({ key: "total", cost: 5006 });
    for (const e of [EST_TWO, EST_FOREIGN]) expect((await allocateGet(get(`?estimate=${e}`), ctx())).status).toBe(404);
    expect((await allocateGet(get(`?estimate=${EST}&mode=spread&output=wbs:9`), ctx())).status).toBe(422);
    expect((await allocateGet(get(), ctx())).status).toBe(422);
  });

  it("applying a spread prices every ticked line in one step and leaves the unallocated cost unlinked", async () => {
    const s = await (await allocateGet(get(`?estimate=${EST}&mode=spread&by=quantity&output=total`), ctx())).json();
    const ticked = s.rows.filter((r: { boq_id: string }) => r.boq_id !== boqRow("1.4").id);
    const items = ticked.map((r: { boq_id: string; share_pct: number }) => ({ boq_id: r.boq_id, estimate_id: EST, output: "total", basis: "total", share_pct: r.share_pct * 0.5 }));
    const res = await price(items);
    expect(res.status).toBe(200);
    expect(res.body.repriced).toHaveLength(items.length);
    expect(links().every((l) => l.estimate_id === EST)).toBe(true);
    const given = links().reduce((t, l) => t + Number(l.share_pct), 0);
    expect(given).toBeLessThanOrEqual(50.01);
    // Half the cost is still free: the estimate's own state says so.
    const next = await (await allocateGet(get(`?estimate=${EST}&mode=spread&by=quantity&output=total`), ctx())).json();
    expect(next.existing).toHaveLength(items.length);
  });
});

describe("missing costs", () => {
  it("lists the estimate lines with no cost or an old one, as RFQ starting lines that carry only wording, unit and quantity", async () => {
    state.db.rows("estimate_lines").push({ id: "66666666-6666-4666-8666-666666666666", tenant_id: T1, estimate_id: EST, sort_order: 9, code: "valve", description: "Gate valve DN100", uom: "no", qty: 4, waste_pct: 0, unit_cost: null, cost_total: null, component: "materials", product_id: null, source: "manual", wbs_code: "1.2", custom_data: null, updated_at: "2026-10-26T08:00:00.000Z" });
    const m = await (await missingGet(get(), ctx())).json();
    expect(m.rfq_enabled).toBe(true);
    expect(m.valid_days).toBe(180);
    expect(m.estimates).toHaveLength(1);
    expect(m.estimates[0]).toMatchObject({ id: EST, count: 1, origin_label: "Estimate EST-0007 (Tender OPP-2)" });
    expect(m.estimates[0].lines[0]).toMatchObject({ source_line_id: "66666666-6666-4666-8666-666666666666", description: "Gate valve DN100", uom: "no", qty: 4, hint: "no cost yet" });
    expect(JSON.stringify(m.estimates[0].lines)).not.toMatch(/cost_total|unit_cost|3906|5006/);
  });

  it("uses the workspace's price validity", async () => {
    const line = state.db.rows("estimate_lines").find((l) => l.id === LN_SMALL)!;
    line.updated_at = "2026-08-01T00:00:00.000Z";
    expect((await (await missingGet(get(), ctx())).json()).estimates).toEqual([]);
    state.db.rows("tenants").find((t) => t.id === T1)!.config = { rfq: { price_valid_days: 60 } };
    const m = await (await missingGet(get(), ctx())).json();
    expect(m.valid_days).toBe(60);
    expect(m.estimates.map((e: { id: string }) => e.id)).toEqual([EST_SMALL]);
  });

  it("a quoted estimate is locked, so it has nothing to raise", async () => {
    state.db.rows("estimate_lines").find((l) => l.id === LN_SMALL)!.unit_cost = null;
    state.db.rows("estimate_lines").find((l) => l.id === LN_SMALL)!.cost_total = null;
    expect((await (await missingGet(get(), ctx())).json()).estimates).toHaveLength(1);
    estRow(EST_SMALL).standard_quote_id = "99999999-9999-4999-8999-999999999999";
    expect((await (await missingGet(get(), ctx())).json()).estimates).toHaveLength(0);
  });
});
