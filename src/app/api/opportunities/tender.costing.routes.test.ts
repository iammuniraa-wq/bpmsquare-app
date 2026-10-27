import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// The Costing tab of a tender deal (docs/design/gcc-tender-deals.md section 25), against the real routes and an in-memory database. The
// questions asked are the ones that matter for money and for another workspace: "Award and price" stores the supplier price as the COST,
// adds the markup, names the RFQ as the source and keeps the date the supplier gave the price; a price is never written for an RFQ that is
// not this deal's; every id is looked up in the caller's workspace and deal; and a workspace without the edition meets a 404.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  owned: {} as Record<string, boolean>,
  user: { id: "u1", email: "me@t1.test" },
  pipelineEdit: true,
  rfqEdit: true,
  canViewEstimates: true,
  canViewRfqs: true,
  config: {} as Record<string, unknown>,
  changes: [] as { objectType: string; objectId: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
}));

const T1 = "t1";
const T2 = "t2";
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = "11111111-1111-4111-8111-111111111111";
const OPP = id(1), OPP_STD = id(2), OPP_OTHER = id(3), OPP_TWO = id(4);
const RFQ = id(10), RFQ_TWO = id(11), RFQ_OTHER = id(12), RFQ_EST = id(13), RFQ_STD = id(14);
const L1 = id(21), L2 = id(22), L3 = id(23), L_TWO = id(24), L_OTHER = id(25), L_EST = id(26);
const RS_A = id(31), RS_B = id(32), RS_C = id(33), RS_TWO = id(34), RS_OTHER = id(35), RS_EST = id(36);
const SA = id(41), SB = id(42), SC = id(43);
const rA1 = id(51), rB1 = id(52), rC1 = id(53), rA2 = id(54), rB2 = id(55), rTwo = id(56), rOther = id(57), rEst = id(58);
const DL1 = id(61), DL2 = id(62), DL3 = id(63), DL_STRAY = id(64);
const BQ1 = id(71), BQ2 = id(72), BQ3 = id(73);
const EST = id(81), EST_OTHER_DEAL = id(82);

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => state.db.from(t), auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: "member", supabase: { from: (t: string) => state.db.from(t) } }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ id: "t1", slug: "kamco", name: "KAMCO", custom_domain: null, config: state.config, features: state.features, company_info: null }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({}),
  canViewWorkcenter: (_p: unknown, wc: string) => (wc === "estimates" ? state.canViewEstimates : wc === "rfqs" ? state.canViewRfqs : true),
  canEditWorkcenter: (_p: unknown, wc: string) => (wc === "rfqs" ? state.rfqEdit : state.pipelineEdit),
  canCreateWorkcenter: () => true,
}));
vi.mock("@/lib/objectFeatures", async (orig) => ({ ...(await orig<typeof import("@/lib/objectFeatures")>()), tenantOwnsObject: async (_t: string, o: string) => !!state.owned[o] }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-10-27", tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [], diffLineItems: () => [],
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
vi.mock("@/lib/events/emitters", () => ({ emitRfqSent: async () => {}, emitRfqReplied: async () => {}, emitRfqAwarded: async () => {} }));
// What an award does for an estimate RFQ is the estimate module's own business (tested in estimateRfq.routes.test.ts).
vi.mock("@/lib/tender/estimates/writeBack", () => ({ writeAwardedCostToEstimate: async () => ({ written: false, reason: "stand-in" }) }));

import { NextRequest } from "next/server";
import { GET as costingGet } from "./[id]/tender/costing/route";
import { GET as compareGet } from "./[id]/tender/costing/rfqs/[rfqId]/route";
import { POST as awardPost } from "./[id]/tender/costing/award/route";

const req = (body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = () => new NextRequest(new URL("http://internal.invalid/x"), { method: "GET" });
const ctx = (deal = OPP, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: deal, rfqId: "", ...extra }) });
const list = async (deal = OPP) => { const r = await costingGet(get(), ctx(deal)); return { status: r.status, json: (await r.json()) as Record<string, any> }; };
const compare = async (rfq: string, deal = OPP) => { const r = await compareGet(get(), ctx(deal, { rfqId: rfq })); return { status: r.status, json: (await r.json()) as Record<string, any> }; };
const award = async (body: Record<string, unknown>, deal = OPP) => { const r = await awardPost(req({ rfq_id: RFQ, ...body }), ctx(deal)); return { status: r.status, json: (await r.json()) as Record<string, any> }; };

const dealLine = (lid: string) => state.db.rows("opportunity_lines").find((l) => l.id === lid)!;
const boq = (bid: string) => state.db.rows("tender_boq_lines").find((b) => b.id === bid)!;
const awards = () => state.db.rows("rfq_line_awards");
const current = () => awards().filter((a) => !a.superseded_at);
const snapshot = () => JSON.stringify([state.db.rows("opportunity_lines"), state.db.rows("tender_boq_lines"), state.db.rows("rfq_line_awards"), state.db.rows("rfq_lines"), state.db.rows("rfq_responses"), state.db.rows("opportunities")]);

const resp = (rid: string, rs: string, lineId: string, price: number, over: Record<string, unknown> = {}) => ({
  id: rid, tenant_id: T1, rfq_supplier_id: rs, rfq_line_id: lineId, status: "quoted", unit_price: price, currency: "SAR", fx_rate: null,
  lead_time_days: 14, moq: 5, offered_description: null, valid_until: "2026-12-31", note: null, source: "buyer", is_awarded: false,
  submitted_at: "2026-10-20T08:00:00Z", updated_at: "2026-10-20T08:00:00Z", ...over,
});
const sup = (rid: string, supplierId: string, name: string, rfq = RFQ, over: Record<string, unknown> = {}) => ({
  id: rid, tenant_id: T1, rfq_id: rfq, supplier_id: supplierId, status: "replied", reminder_count: 0, last_reminded_at: null, email_to: "buyer@x.test", token_nonce: "secret-nonce", suppliers: { id: supplierId, ref: "SUP-1", name, email: "s@x.test", phone: null }, ...over,
});

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: {} }, { id: T2, config: {} }],
    opportunities: [
      { id: OPP, tenant_id: T1, ref: "OPP-2", title: "Pipeline package 4", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0, probability: 25, currency: "SAR" },
      { id: OPP_STD, tenant_id: T1, ref: "OPP-1", title: "Standard deal", account_id: "acc", stage: "qualify", outcome: "open", owner_id: "u1", team: [], amount: 0 },
      { id: OPP_OTHER, tenant_id: T2, ref: "OPP-9", title: "Theirs", account_id: "acc2", stage: "estimating", outcome: "open", owner_id: "u9", team: [], amount: 0 },
      { id: OPP_TWO, tenant_id: T1, ref: "OPP-4", title: "Another tender", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0 },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { opportunity_id: OPP_OTHER, tenant_id: T2, tender_no: "ZZ-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { opportunity_id: OPP_TWO, tenant_id: T1, tender_no: "ARB-2", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ],
    opportunity_lines: [
      { id: DL1, tenant_id: T1, opportunity_id: OPP, sl_no: "1.1", description: "Skirting", uom: "m", qty: 120, rate: 0, discount_pct: 0, amount: 0, rfq_line_id: L1, is_selected: true },
      { id: DL2, tenant_id: T1, opportunity_id: OPP, sl_no: "1.2", description: "Membrane", uom: "m2", qty: 10, rate: 0, discount_pct: 0, amount: 0, rfq_line_id: L2, is_selected: true },
      { id: DL3, tenant_id: T1, opportunity_id: OPP, sl_no: "1.3", description: "Mobilisation", uom: "lot", qty: 1, rate: 50, discount_pct: 0, amount: 50, rfq_line_id: null, is_selected: true },
      // A line of ANOTHER deal that points at this deal's RFQ line: it must never be touched.
      { id: DL_STRAY, tenant_id: T1, opportunity_id: OPP_TWO, sl_no: "9", description: "Stray", uom: "m", qty: 5, rate: 7, discount_pct: 0, amount: 35, rfq_line_id: L1, is_selected: true },
    ],
    tender_boq_lines: [
      { id: BQ1, tenant_id: T1, opportunity_id: OPP, line_id: DL1, item_no: "1.1", row_no: 8, file_description: "Skirting", file_uom: "m", file_qty: 120, price_source: null, price_as_of: null, stale_accepted: false, unit_cost: null, markup_pct: null, removed_in_revision: false },
      { id: BQ2, tenant_id: T1, opportunity_id: OPP, line_id: DL2, item_no: "1.2", row_no: 9, file_description: "Membrane", file_uom: "m2", file_qty: 10, price_source: null, price_as_of: null, stale_accepted: false, unit_cost: null, markup_pct: null, removed_in_revision: false },
      { id: BQ3, tenant_id: T1, opportunity_id: OPP, line_id: DL3, item_no: "1.3", row_no: 10, file_description: "Mobilisation", file_uom: "lot", file_qty: 1, price_source: "boq_rate", price_as_of: "2026-10-01", stale_accepted: false, unit_cost: null, markup_pct: null, removed_in_revision: false },
    ],
    estimates: [
      { id: EST, tenant_id: T1, opportunity_id: OPP, ref: "EST-0016", name: "Floor tiles", status: "draft", template_id: null, margin_pct: 0, totals: { cost_total: 1905.49, price: 2000 }, standard_quote_id: null, created_at: "2026-10-20T08:00:00.000Z", updated_at: "2026-10-25T08:00:00.000Z" },
      { id: EST_OTHER_DEAL, tenant_id: T1, opportunity_id: OPP_TWO, ref: "EST-0017", name: "Not this deal", status: "draft", template_id: null, margin_pct: 0, totals: { cost_total: 1, price: 1 }, standard_quote_id: null, created_at: "2026-10-20T08:00:00.000Z", updated_at: "2026-10-25T08:00:00.000Z" },
    ],
    estimate_lines: [],
    estimate_templates: [{ id: id(90), tenant_id: T1, name: "Floor tiles", description: null, is_active: true, inputs: [] }],
    tender_boq_estimate_links: [
      { id: id(95), tenant_id: T1, opportunity_id: OPP, boq_line_id: BQ1, estimate_id: EST, output: "total", basis: "total", share_pct: 100, applied_cost: 10, applied_at: "2026-10-22T08:00:00.000Z", estimate_updated_at: "2026-10-22T08:00:00.000Z", needs_review: false, review_note: null },
    ],
    rfqs: [
      { id: RFQ, tenant_id: T1, ref: "RFQ-0012", title: "Skirting, membrane", status: "partially_replied", origin_type: "opportunity", origin_id: OPP, origin_label: "Deal OPP-2", respond_by: "2026-11-05", created_at: "2026-10-21T08:00:00.000Z", updated_at: "2026-10-21T08:00:00.000Z" },
      { id: RFQ_TWO, tenant_id: T1, ref: "RFQ-0014", title: "Other tender", status: "sent", origin_type: "opportunity", origin_id: OPP_TWO, origin_label: "Deal OPP-4", respond_by: null, created_at: "2026-10-22T08:00:00.000Z", updated_at: "2026-10-22T08:00:00.000Z" },
      { id: RFQ_OTHER, tenant_id: T2, ref: "RFQ-0001", title: "Theirs", status: "sent", origin_type: "opportunity", origin_id: OPP_OTHER, origin_label: null, respond_by: null, created_at: "2026-10-22T08:00:00.000Z", updated_at: "2026-10-22T08:00:00.000Z" },
      { id: RFQ_EST, tenant_id: T1, ref: "RFQ-0013", title: "Tiles, from EST-0016", status: "sent", origin_type: "estimate", origin_id: EST, origin_label: "Estimate EST-0016", respond_by: null, created_at: "2026-10-23T08:00:00.000Z", updated_at: "2026-10-23T08:00:00.000Z" },
      { id: RFQ_STD, tenant_id: T1, ref: "RFQ-0015", title: "Standard deal's", status: "sent", origin_type: "opportunity", origin_id: OPP_STD, origin_label: null, respond_by: null, created_at: "2026-10-22T08:00:00.000Z", updated_at: "2026-10-22T08:00:00.000Z" },
    ],
    rfq_lines: [
      { id: L1, tenant_id: T1, rfq_id: RFQ, sl_no: 1, product_id: null, description: "Skirting", uom: "m", qty: 120, status: "open", awarded_unit_cost: null, cost_model_code: null, path: "purchase.unit_cost", cost_input_id: null },
      { id: L2, tenant_id: T1, rfq_id: RFQ, sl_no: 2, product_id: null, description: "Membrane", uom: "m2", qty: 10, status: "open", awarded_unit_cost: null, cost_model_code: null, path: "purchase.unit_cost", cost_input_id: null },
      { id: L_TWO, tenant_id: T1, rfq_id: RFQ_TWO, sl_no: 1, product_id: null, description: "Other", uom: "m", qty: 1, status: "open", awarded_unit_cost: null, cost_model_code: null, path: "purchase.unit_cost", cost_input_id: null },
      { id: L_OTHER, tenant_id: T2, rfq_id: RFQ_OTHER, sl_no: 1, product_id: null, description: "Theirs", uom: "m", qty: 1, status: "open", awarded_unit_cost: null, cost_model_code: null, path: "purchase.unit_cost", cost_input_id: null },
      { id: L_EST, tenant_id: T1, rfq_id: RFQ_EST, sl_no: 1, product_id: null, description: "Adhesive", uom: "kg", qty: 40, status: "open", awarded_unit_cost: null, estimate_line_id: id(99), cost_model_code: null, path: "purchase.unit_cost", cost_input_id: null },
    ],
    rfq_suppliers: [
      sup(RS_A, SA, "Gulf Skirting"), sup(RS_B, SB, "Desert Supply"), sup(RS_C, SC, "No Reply Co", RFQ, { status: "sent" }),
      sup(RS_TWO, SA, "Gulf Skirting", RFQ_TWO), { ...sup(RS_OTHER, SA, "Theirs", RFQ_OTHER), tenant_id: T2 }, sup(RS_EST, SB, "Desert Supply", RFQ_EST, { status: "sent" }),
    ],
    rfq_responses: [
      resp(rA1, RS_A, L1, 100), resp(rB1, RS_B, L1, 120),
      resp(rA2, RS_A, L2, 40), resp(rB2, RS_B, L2, 35),
      resp(rTwo, RS_TWO, L_TWO, 5), { ...resp(rOther, RS_OTHER, L_OTHER, 1), tenant_id: T2 },
    ],
    rfq_line_awards: [],
    product_suppliers: [],
  });
  state.db.unique("rfq_line_awards", (e, n) => e.rfq_line_id === n.rfq_line_id && !e.superseded_at && !n.superseded_at);
  state.features = { pipeline: true, gcc_tender: true, rfq: true, estimator: true };
  state.owned = { estimates: true, rfqs: true };
  state.pipelineEdit = true; state.rfqEdit = true; state.canViewEstimates = true; state.canViewRfqs = true;
  state.config = {};
  state.changes = [];
  state.user = { id: ME, email: "me@t1.test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the gate", () => {
  const every = async (deal = OPP) => [
    (await list(deal)).status,
    (await compare(RFQ, deal)).status,
    (await award({ line_id: L1, response_id: rA1 }, deal)).status,
  ];

  it("a workspace without the tender edition meets a 404 and nothing is read or written", async () => {
    state.features.gcc_tender = false;
    const before = snapshot();
    expect(await every()).toEqual([404, 404, 404]);
    expect(snapshot()).toBe(before);
  });

  it("a standard deal, another workspace's deal and an id that is not a deal are the same 404", async () => {
    const before = snapshot();
    expect(await every(OPP_STD)).toEqual([404, 404, 404]);
    expect(await every(OPP_OTHER)).toEqual([404, 404, 404]);
    expect(await every("not-an-id")).toEqual([404, 404, 404]);
    expect(snapshot()).toBe(before);
  });

  it("a person who may see neither Estimates nor RFQs, or a workspace with neither module, gets a 404", async () => {
    state.canViewEstimates = false; state.canViewRfqs = false;
    expect(await every()).toEqual([404, 404, 404]);
    state.canViewEstimates = true; state.canViewRfqs = true;
    state.owned = {};
    expect(await every()).toEqual([404, 404, 404]);
  });

  it("someone who may view the deal but not change it can read Costing and cannot award", async () => {
    state.pipelineEdit = false;
    expect((await list()).status).toBe(200);
    expect((await compare(RFQ)).json.can_award).toBe(false);
    const before = snapshot();
    expect((await award({ line_id: L1, response_id: rA1 })).status).toBe(403);
    expect(snapshot()).toBe(before);
  });

  it("someone who may view RFQs but not edit them cannot award", async () => {
    state.rfqEdit = false;
    expect((await compare(RFQ)).json.can_award).toBe(false);
    const before = snapshot();
    expect((await award({ line_id: L1, response_id: rA1 })).status).toBe(403);
    expect(snapshot()).toBe(before);
  });
});

describe("the list", () => {
  it("shows the deal's estimates and RFQs together, newest first, and nothing of another deal or workspace", async () => {
    const r = await list();
    expect(r.status).toBe(200);
    const items = r.json.items as { kind: string; ref: string }[];
    expect(items.map((x) => x.ref)).toEqual(["EST-0016", "RFQ-0013", "RFQ-0012"]);
    expect(items.map((x) => x.kind)).toEqual(["estimate", "rfq", "rfq"]);
  });

  it("each item names the BOQ rows it prices, its state, its total and its age", async () => {
    const items = (await list()).json.items as Record<string, any>[];
    const est = items.find((x) => x.ref === "EST-0016")!;
    expect(est.rows).toEqual({ count: 1, items: ["1.1"], more: 0 });
    expect(est.cost_total).toBe(1905.49);
    expect(est.updated_at).toBe("2026-10-25T08:00:00.000Z");
    const rfq = items.find((x) => x.ref === "RFQ-0012")!;
    expect(rfq.rows.items).toEqual(["1.1", "1.2"]);
    expect(rfq.suppliers_total).toBe(3);
    expect(rfq.suppliers_replied).toBe(2);
    expect(rfq.state.label).toBe("2 of 3 replied");
    // the best valid price of each line, times its quantity: 100 x 120 + 35 x 10
    expect(rfq.total).toBe(12350);
    expect(rfq.total_is_awarded).toBe(false);
    expect(rfq.created_at).toBe("2026-10-21T08:00:00.000Z");
  });

  it("an RFQ raised from an estimate is listed on the deal and shows on that estimate", async () => {
    const items = (await list()).json.items as Record<string, any>[];
    const fromEstimate = items.find((x) => x.ref === "RFQ-0013")!;
    expect(fromEstimate.origin).toBe("estimate");
    expect(fromEstimate.rows.items).toEqual(["1.1"]);
    const est = items.find((x) => x.ref === "EST-0016")!;
    expect(est.rfqs.map((x: { ref: string }) => x.ref)).toEqual(["RFQ-0013"]);
  });

  it("the four figures: rows priced, rows that still need a cost, RFQs out and replies in", async () => {
    const j = (await list()).json;
    expect(j.boq).toEqual({ rows: 3, priced: 1, unpriced: 2, stale: 0 });
    expect(j.tiles).toEqual({ priced: 1, unpriced: 2, rfqs_out: 2, replies_in: 2 });
  });

  it("starts the New RFQ form from the deal's rows, the unpriced ones ticked, in the client's order", async () => {
    const j = (await list()).json;
    expect(j.rfq_origin_label).toBe("Deal OPP-2");
    const lines = j.rfq_lines as { source_line_id: string; include: boolean; spec?: string; linked_ref?: string | null }[];
    expect(lines.map((l) => l.source_line_id)).toEqual([DL1, DL2, DL3]);
    // 1.1 and 1.2 are already on an RFQ, so they start unticked and are named (the in-memory database does not join the RFQ's ref in)
    expect(lines.map((l) => l.linked_ref ?? null)).toEqual(["another RFQ", "another RFQ", null]);
    expect(lines.map((l) => l.include)).toEqual([false, false, true]);
    expect(lines[0].spec).toBe("Item no. 1.1");
  });

  it("reads the default markup from Settings > Tenders and falls back to 15", async () => {
    expect((await list()).json.markup_default).toBe(15);
    state.db.rows("tenants").find((t) => t.id === T1)!.config = { tender: { default_markup_pct: 22 } };
    expect((await list()).json.markup_default).toBe(22);
  });

  it("degrades while a migration is pending: a missing table is a note, never a crash", async () => {
    state.db.missing.add("rfqs");
    const a = await list();
    expect(a.status).toBe(200);
    expect(a.json.pending_rfqs).toBe(true);
    expect((a.json.items as { kind: string }[]).every((x) => x.kind === "estimate")).toBe(true);
    state.db.missing.delete("rfqs");
    state.db.missingColumns = { estimates: new Set(["opportunity_id"]) };
    const b = await list();
    expect(b.status).toBe(200);
    expect(b.json.pending_estimates).toBe(true);
    expect((b.json.items as { kind: string }[]).every((x) => x.kind === "rfq")).toBe(true);
  });

  it("without the RFQ module the tab still shows the estimates, with no RFQ form", async () => {
    state.owned = { estimates: true };
    const j = (await list()).json;
    expect(j.rfqs_on).toBe(false);
    expect(j.rfq_lines).toEqual([]);
    expect((j.items as { kind: string }[]).every((x) => x.kind === "estimate")).toBe(true);
  });
});

describe("the compare screen", () => {
  it("returns suppliers side by side with their answers, and no token, link or email address", async () => {
    const r = await compare(RFQ);
    expect(r.status).toBe(200);
    expect(r.json.suppliers.map((s: { name: string }) => s.name)).toEqual(["Gulf Skirting", "Desert Supply", "No Reply Co"]);
    expect(r.json.lines.map((l: { rows: string[] }) => l.rows)).toEqual([["1.1"], ["1.2"]]);
    expect(r.json.responses).toHaveLength(4);
    expect(r.json.markup_default).toBe(15);
    expect(r.json.prices_rows).toBe(true);
    expect(r.json.can_award).toBe(true);
    const text = JSON.stringify(r.json);
    for (const secret of ["secret-nonce", "buyer@x.test", "s@x.test", "token_nonce", "reply_link", "email"]) expect(text, secret).not.toContain(secret);
  });

  it("an RFQ raised from an estimate of this deal opens, and says it does not price the rows itself", async () => {
    const r = await compare(RFQ_EST);
    expect(r.status).toBe(200);
    expect(r.json.prices_rows).toBe(false);
    expect(r.json.rfq.origin).toBe("estimate");
  });

  it("another deal's RFQ, another workspace's RFQ, a standard deal's RFQ and a bad id are all the same 404", async () => {
    for (const rfq of [RFQ_TWO, RFQ_OTHER, RFQ_STD, "nope", id(999)]) expect((await compare(rfq)).status, rfq).toBe(404);
  });

  it("an estimate RFQ of ANOTHER deal's estimate is not opened on this deal", async () => {
    state.db.rows("rfqs").push({ id: id(15), tenant_id: T1, ref: "RFQ-0099", title: "x", status: "sent", origin_type: "estimate", origin_id: EST_OTHER_DEAL, created_at: "2026-10-23T08:00:00.000Z" });
    expect((await compare(id(15))).status).toBe(404);
  });
});

describe("Award and price", () => {
  it("stores the supplier price as the cost, adds 15 percent, names the RFQ, and keeps the date the supplier gave the price", async () => {
    const r = await award({ line_id: L1, response_id: rA1 });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.priced).toEqual([{ rfq_line_id: L1, item: "1.1", from: 0, to: 115, cost: 100, markup_pct: 15 }]);
    expect(boq(BQ1)).toMatchObject({
      unit_cost: 100, markup_pct: 15, price_source: "supplier", price_source_ref: "RFQ-0012, awarded", price_as_of: "2026-10-20", stale_accepted: false, priced_by: ME,
    });
    expect(dealLine(DL1)).toMatchObject({ rate: 115, amount: 13800 });
    expect(current()).toHaveLength(1);
    expect(current()[0]).toMatchObject({ rfq_line_id: L1, response_id: rA1, chosen_by: ME, not_lowest: false, applied_rate: 115 });
    expect(typeof current()[0].applied_to_deal_at).toBe("string");
  });

  it("the cost is 22 and the rate 25.30 for the prototype's example", async () => {
    state.db.rows("rfq_responses").find((x) => x.id === rA2)!.unit_price = 22;
    state.db.rows("rfq_responses").find((x) => x.id === rB2)!.unit_price = 24;
    const r = await award({ line_id: L2, response_id: rA2 });
    expect(r.status).toBe(200);
    expect(boq(BQ2)).toMatchObject({ unit_cost: 22, markup_pct: 15 });
    expect(dealLine(DL2).rate).toBe(25.3);
    expect(dealLine(DL2).amount).toBe(253);
  });

  it("uses the markup typed on the screen, 0 included, and refuses one that is not a number from 0 to 1000 before anything changes", async () => {
    expect((await award({ line_id: L1, response_id: rA1, markup_pct: 10 })).status).toBe(200);
    expect(dealLine(DL1).rate).toBe(110);
    expect(boq(BQ1).markup_pct).toBe(10);
    expect((await award({ line_id: L2, response_id: rB2, markup_pct: 0 })).status).toBe(200);
    expect(dealLine(DL2).rate).toBe(35);
    expect(boq(BQ2).markup_pct).toBe(0);
    const before = snapshot();
    for (const bad of ["abc", -5, 1001]) expect((await award({ line_id: id(21), response_id: rB1, markup_pct: bad, replace: true, reason: "because" })).status, String(bad)).toBe(422);
    expect(snapshot()).toBe(before);
  });

  it("uses the row's own markup when the screen sends none, else the workspace default", async () => {
    boq(BQ1).markup_pct = 20;
    await award({ line_id: L1, response_id: rA1 });
    expect(dealLine(DL1).rate).toBe(120);
    state.db.rows("tenants").find((t) => t.id === T1)!.config = { tender: { default_markup_pct: 8 } };
    await award({ line_id: L2, response_id: rB2 });
    expect(dealLine(DL2).rate).toBe(37.8);
  });

  it("keeps the RFQ's rules: a price that is not the lowest valid one needs a reason, and nothing is written without it", async () => {
    const before = snapshot();
    const no = await award({ line_id: L1, response_id: rB1 });
    expect(no.status).toBe(422);
    expect(no.json.code).toBe("reason_required");
    expect(snapshot()).toBe(before);
    const yes = await award({ line_id: L1, response_id: rB1, reason: "Delivers to site, A is on allocation" });
    expect(yes.status).toBe(200);
    expect(boq(BQ1)).toMatchObject({ unit_cost: 120, price_source_ref: "RFQ-0012, awarded" });
    expect(dealLine(DL1).rate).toBe(138);
    expect(current()[0]).toMatchObject({ not_lowest: true, reason: "Delivers to site, A is on allocation" });
  });

  it("an expired answer chosen knowingly is recorded as accepted, and its age is the answer's, not the award's", async () => {
    state.db.rows("rfq_responses").find((x) => x.id === rA1)!.valid_until = "2026-09-01";
    state.db.rows("rfq_responses").find((x) => x.id === rA1)!.submitted_at = "2026-07-01T08:00:00Z";
    expect((await award({ line_id: L1, response_id: rB1, reason: "A's price has expired" })).status).toBe(200);
    expect(boq(BQ1).stale_accepted).toBe(false);
    const r = await award({ line_id: L1, response_id: rA1, reason: "Confirmed by phone", replace: true });
    expect(r.status).toBe(200);
    expect(boq(BQ1)).toMatchObject({ stale_accepted: true, price_as_of: "2026-07-01", unit_cost: 100 });
  });

  it("a second award on a line needs the buyer's confirmation, and then re-prices the row from the new cost", async () => {
    await award({ line_id: L1, response_id: rA1 });
    const again = await award({ line_id: L1, response_id: rB1, reason: "Changed our mind about delivery" });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("already_awarded");
    expect(dealLine(DL1).rate).toBe(115);
    const replaced = await award({ line_id: L1, response_id: rB1, reason: "Changed our mind about delivery", replace: true });
    expect(replaced.status).toBe(200);
    expect(dealLine(DL1).rate).toBe(138);
    expect(boq(BQ1).unit_cost).toBe(120);
    expect(awards()).toHaveLength(2);
    expect(current()).toHaveLength(1);
  });

  it("awards every line a supplier quoted in one go and prices every row", async () => {
    state.db.rows("rfq_responses").find((x) => x.id === rA2)!.unit_price = 30; // A is now the cheapest on both lines
    const r = await award({ rfq_supplier_id: RS_A, all: true });
    expect(r.status).toBe(200);
    expect(r.json.priced).toHaveLength(2);
    expect(dealLine(DL1).rate).toBe(115);
    expect(dealLine(DL2).rate).toBe(34.5);
    expect(current()).toHaveLength(2);
  });

  it("the rows the deal does not link to the RFQ line, and another deal's line that points at it, are never touched", async () => {
    await award({ line_id: L1, response_id: rA1 });
    expect(dealLine(DL3)).toMatchObject({ rate: 50, amount: 50 });
    expect(boq(BQ3)).toMatchObject({ price_source: "boq_rate", unit_cost: null });
    expect(dealLine(DL_STRAY)).toMatchObject({ rate: 7, amount: 35 });
  });

  it("changes the history with the rate and where it came from, and never the cost or the markup", async () => {
    await award({ line_id: L1, response_id: rA1 });
    const log = state.changes.find((c) => c.objectType === "opportunity_tenders");
    expect(log?.objectId).toBe(OPP);
    expect(log?.changes).toEqual([{ field: "BOQ rate 1.1", from: 0, to: 115 }, { field: "BOQ rate source", from: null, to: "RFQ-0012, awarded" }]);
    expect(JSON.stringify(log)).not.toMatch(/unit_cost|markup/);
  });

  it("refreshes the deal's amount from the new rates", async () => {
    await award({ line_id: L1, response_id: rA1 });
    expect(state.db.rows("opportunities").find((o) => o.id === OPP)!.amount).toBe(13800 + 50);
  });

  it("an RFQ that is not this deal's cannot be awarded here, and no row of any deal changes", async () => {
    const before = snapshot();
    expect((await awardPost(req({ rfq_id: RFQ_TWO, line_id: L_TWO, response_id: rTwo }), ctx())).status).toBe(404);
    expect((await awardPost(req({ rfq_id: RFQ_OTHER, line_id: L_OTHER, response_id: rOther }), ctx())).status).toBe(404);
    expect((await awardPost(req({ rfq_id: RFQ_STD, line_id: L1, response_id: rA1 }), ctx())).status).toBe(404);
    expect((await awardPost(req({ line_id: L1, response_id: rA1 }), ctx())).status).toBe(404); // no rfq_id
    expect(snapshot()).toBe(before);
  });

  it("a line or an answer that is not on this RFQ, or another workspace's, is refused and nothing is written", async () => {
    const before = snapshot();
    expect((await award({ line_id: L_TWO, response_id: rTwo })).status).toBe(404);
    expect((await award({ line_id: L_OTHER, response_id: rOther })).status).toBe(404);
    expect((await award({ line_id: L1, response_id: rA2 })).status).toBe(404);
    expect((await award({ line_id: L1, response_id: rOther })).status).toBe(404);
    expect((await award({ line_id: L1, response_id: "nope" })).status).toBe(404);
    expect((await award({ line_id: "nope", response_id: rA1 })).status).toBe(422);
    expect((await award({ line_id: L1 })).status).toBe(422);
    expect((await award({ rfq_supplier_id: RS_OTHER, all: true })).status).toBe(404);
    expect(snapshot()).toBe(before);
  });

  it("a draft or closed RFQ cannot be awarded", async () => {
    state.db.rows("rfqs").find((x) => x.id === RFQ)!.status = "draft";
    expect((await award({ line_id: L1, response_id: rA1 })).status).toBe(409);
    state.db.rows("rfqs").find((x) => x.id === RFQ)!.status = "closed";
    expect((await award({ line_id: L1, response_id: rA1 })).status).toBe(409);
  });

  it("while migration 0224 is pending the award says so and changes nothing", async () => {
    state.db.missing.add("rfq_line_awards");
    const before = snapshot();
    const r = await award({ line_id: L1, response_id: rA1 });
    expect(r.status).toBe(503);
    expect(String(r.json.error)).toMatch(/0224/);
    expect(snapshot()).toBe(before);
  });

  it("an RFQ line no deal line asked about is awarded, and the response says the row was not priced", async () => {
    dealLine(DL1).rfq_line_id = null;
    const r = await award({ line_id: L1, response_id: rA1 });
    expect(r.status).toBe(200);
    expect(r.json.priced).toEqual([]);
    expect(r.json.skipped).toEqual([{ rfq_line_id: L1, reason: "No deal line asked about this RFQ line" }]);
    expect(current()).toHaveLength(1);
    expect(current()[0].applied_to_deal_at ?? null).toBeNull();
    expect(dealLine(DL1).rate).toBe(0);
  });

  it("an RFQ raised from an estimate is awarded without writing any deal line or BOQ row: the estimate module re-prices through its links", async () => {
    state.db.rows("rfq_suppliers").find((x) => x.id === RS_EST)!.status = "replied";
    state.db.rows("rfq_responses").push(resp(rEst, RS_EST, L_EST, 12));
    const before = JSON.stringify([state.db.rows("opportunity_lines"), state.db.rows("tender_boq_lines")]);
    const r = await awardPost(req({ rfq_id: RFQ_EST, line_id: L_EST, response_id: rEst }), ctx());
    expect(r.status).toBe(200);
    expect(((await r.json()) as Record<string, any>).priced).toEqual([]);
    expect(JSON.stringify([state.db.rows("opportunity_lines"), state.db.rows("tender_boq_lines")])).toBe(before);
    expect(current().map((a) => a.rfq_line_id)).toEqual([L_EST]);
  });
});

describe("pricing awards that already stand", () => {
  it("writes the cost, markup and source of an award made before this screen existed, without awarding again", async () => {
    awards().push({ id: id(200), tenant_id: T1, rfq_id: RFQ, rfq_line_id: L2, rfq_supplier_id: RS_B, supplier_id: SB, response_id: rB2, chosen_by: ME, chosen_at: "2026-10-22T08:00:00Z", reason: null, not_lowest: false, landed_unit: 35, lowest_valid_unit: 35, superseded_at: null, applied_to_deal_at: null, applied_rate: null });
    const r = await award({ apply_only: true });
    expect(r.status).toBe(200);
    expect(r.json.results).toEqual([]);
    expect(r.json.priced).toEqual([{ rfq_line_id: L2, item: "1.2", from: 0, to: 40.25, cost: 35, markup_pct: 15 }]);
    expect(boq(BQ2)).toMatchObject({ unit_cost: 35, price_source_ref: "RFQ-0012, awarded", price_as_of: "2026-10-20" });
    expect(current()).toHaveLength(1);
    expect(current()[0].applied_rate).toBe(40.25);
    // nothing left to write
    expect((await award({ apply_only: true })).status).toBe(422);
  });

  it("the list counts them, so a person can see there is something to price", async () => {
    awards().push({ id: id(201), tenant_id: T1, rfq_id: RFQ, rfq_line_id: L2, rfq_supplier_id: RS_B, supplier_id: SB, response_id: rB2, chosen_by: ME, chosen_at: "2026-10-22T08:00:00Z", reason: null, not_lowest: false, landed_unit: 35, lowest_valid_unit: 35, superseded_at: null, applied_to_deal_at: null, applied_rate: null });
    const rfq = ((await list()).json.items as Record<string, any>[]).find((x) => x.ref === "RFQ-0012")!;
    expect(rfq.awarded_unpriced).toBe(1);
    expect((await compare(RFQ)).json.awards).toHaveLength(1);
  });
});
