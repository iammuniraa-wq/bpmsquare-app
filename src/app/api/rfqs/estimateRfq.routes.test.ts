import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, slice 3c-1: an RFQ raised for the missing costs of an estimate, and what an award does to the estimate and to the BOQ
// lines priced from it. The RFQ itself (suppliers, replies, the comparison, the recorded award) is the one slice 3b built; these tests
// ask only what is new: the origin is checked in the caller's workspace, any number of suppliers is fine, the awarded cost goes into the
// estimate line with its source and date, the BOQ lines priced from the estimate are re-priced and marked for a look, a bid that is
// already in is never changed by itself, and an ordinary RFQ behaves exactly as before.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  user: { id: "u1", email: "me@t1.test" },
  touched: [] as string[],
  changes: [] as { objectType: string; objectId: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
}));

const T1 = "t1";
const T2 = "t2";
const ME = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OPP = id(1), OPP_STD = id(2);
const EST = id(10), EST_STD = id(11), EST_T2 = id(12), EST_QUOTED = id(13);
const LN_PIPE = id(20), LN_VALVE = id(21), LN_OTHER = id(22), LN_T2 = id(23), LN_Q = id(24);
const RFQ = id(30), RFQ_STD = id(31), RFQ_Q = id(32);
const RL1 = id(40), RL2 = id(41), RLS = id(42), RLQ = id(43);
const RS_A = id(50), RS_B = id(51), RS_S = id(52), RS_Q = id(53);
const SUP_A = id(60), SUP_B = id(61);
const RA1 = id(70), RB1 = id(71), RA2 = id(72), RS1 = id(73), RQ1 = id(74);
const BOQ = id(80), DEAL_LINE = id(81), SRC = id(82), LINK = id(83);

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => { state.touched.push(t); return state.db.from(t); }, auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: "member", supabase: { from: (t: string) => state.db.from(t) } }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }),
  canViewWorkcenter: () => true, canEditWorkcenter: () => true, canCreateWorkcenter: () => true,
}));
vi.mock("@/lib/changeLog", () => ({
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
  diffForLog: () => [],
}));
vi.mock("@/lib/events/emitters", () => ({ emitRfqSent: async () => {}, emitRfqReplied: async () => {}, emitRfqAwarded: async () => {} }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-10-26", tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ id: "t1", slug: "kamco", name: "KAMCO", custom_domain: null, config: {}, features: state.features, company_info: null }),
}));

import { NextRequest } from "next/server";
import { POST as award } from "./[id]/award/route";
import { createRfq } from "@/lib/rfq/server";
import { rfqConfig } from "@/lib/rfq/types";

const cfg = rfqConfig(undefined);
const actor = { admin: null as never, tenantId: T1, userId: ME, email: "me@t1.test" };
const make = (input: Parameters<typeof createRfq>[1]) => createRfq({ ...actor, admin: { from: (t: string) => state.db.from(t) } as never }, input, cfg);
const attempt = async (input: Parameters<typeof createRfq>[1]) => { try { return { ok: true as const, ...(await make(input)) }; } catch (e) { return { ok: false as const, status: (e as { status: number }).status, message: (e as { message: string }).message }; } };
const post = async (body: unknown, rid = RFQ) => {
  const res = await award(new NextRequest(new URL("http://internal.invalid/x"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: rid }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> & { estimate?: Record<string, unknown> } };
};
const row = (table: string, rid: string) => state.db.rows(table).find((r) => r.id === rid)!;
const estLine = (lid: string) => row("estimate_lines", lid);
const resp = (rid: string, rs: string, line: string, price: number, over: Record<string, unknown> = {}) => ({
  id: rid, tenant_id: T1, rfq_supplier_id: rs, rfq_line_id: line, status: "quoted", unit_price: price, currency: "SAR", fx_rate: null, lead_time_days: 14, moq: 1,
  offered_description: null, valid_until: "2026-12-31", note: null, source: "buyer", is_awarded: false, submitted_at: "2026-10-20T08:00:00Z", updated_at: "2026-10-20T08:00:00Z", ...over,
});

// The first award loads the estimator (a large module); do it once, before the clock of a test starts.
beforeAll(async () => { await import("@/lib/tender/estimates/writeBack"); }, 60_000);

beforeEach(() => {
  state.features = { rfq: true, gcc_tender: true, pipeline: true, estimator: true };
  state.touched = []; state.changes = [];
  state.user = { id: ME, email: "me@t1.test" };
  const est = (eid: string, over: Record<string, unknown> = {}) => ({
    id: eid, tenant_id: T1, ref: "EST-0007", name: "Pipe run", status: "draft", template_id: null, margin_pct: 0, opportunity_id: OPP, standard_quote_id: null,
    totals: { cost_total: 4000, margin_pct: 0, margin_amount: 0, price: 4000, vat_pct: 0, vat: 0, price_incl_vat: 4000, by_group: [], by_component: {} },
    created_at: "2026-10-20T08:00:00.000Z", updated_at: "2026-10-20T08:00:00.000Z", ...over,
  });
  const ln = (lid: string, eid: string, over: Record<string, unknown>) => ({
    id: lid, tenant_id: T1, estimate_id: eid, sort_order: 1, code: "x", description: "Line", uom: "m", qty: 100, waste_pct: 0, unit_cost: null, cost_total: null, component: "materials",
    product_id: null, source: "rule", wbs_code: "1.1", custom_data: { group: "Supply" }, updated_at: "2026-10-20T08:00:00.000Z", ...over,
  });
  state.db = new MemoryDb({
    tenants: [
      { id: T1, config: {}, features: state.features },
      { id: T2, config: {}, features: { rfq: true, gcc_tender: true } },
    ],
    opportunities: [
      { id: OPP, tenant_id: T1, ref: "OPP-2", title: "Pipeline package 4", account_id: "acc", stage: "estimating", outcome: "open", owner_id: "u1", team: [], amount: 0 },
      { id: OPP_STD, tenant_id: T1, ref: "OPP-1", title: "Standard", account_id: "acc", stage: "qualify", outcome: "open", owner_id: "u1", team: [], amount: 0 },
    ],
    opportunity_tenders: [{ opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0 }],
    estimates: [
      est(EST),
      est(EST_STD, { ref: "EST-0010", opportunity_id: null }),
      est(EST_T2, { tenant_id: T2, ref: "EST-0001", opportunity_id: id(99) }),
      est(EST_QUOTED, { ref: "EST-0011", standard_quote_id: id(98) }),
    ],
    estimate_lines: [
      ln(LN_PIPE, EST, { code: "pipe", description: "HDPE pipe 110mm", qty: 100, waste_pct: 5, unit_cost: 31, cost_total: 3255 }),
      ln(LN_VALVE, EST, { code: "valve", description: "Gate valve DN100", uom: "no", qty: 4, unit_cost: null, cost_total: null, source: "manual", wbs_code: "1.2", custom_data: null }),
      ln(LN_OTHER, EST_STD, { description: "A standard estimate's line" }),
      { ...ln(LN_T2, EST_T2, { description: "Theirs" }), tenant_id: T2 },
      ln(LN_Q, EST_QUOTED, { description: "Quoted line", unit_cost: null, cost_total: null }),
    ],
    rfqs: [
      { id: RFQ, tenant_id: T1, ref: "RFQ-0001", title: "Missing costs", status: "sent", origin_type: "estimate", origin_id: EST, origin_label: "EST-0007", respond_by: "2026-10-28", currency: null, buyer_id: null, requested_by: ME },
      { id: RFQ_STD, tenant_id: T1, ref: "RFQ-0002", title: "An ordinary RFQ", status: "sent", origin_type: "manual", origin_id: null, origin_label: null, respond_by: "2026-10-28", currency: null, buyer_id: null, requested_by: ME },
      { id: RFQ_Q, tenant_id: T1, ref: "RFQ-0003", title: "For a quoted estimate", status: "sent", origin_type: "estimate", origin_id: EST_QUOTED, origin_label: "EST-0011", respond_by: "2026-10-28", currency: null, buyer_id: null, requested_by: ME },
    ],
    rfq_lines: [
      { id: RL1, tenant_id: T1, rfq_id: RFQ, sl_no: 1, product_id: null, description: "HDPE pipe 110mm", uom: "m", qty: 100, status: "open", estimate_line_id: LN_PIPE, path: "purchase.unit_cost" },
      { id: RL2, tenant_id: T1, rfq_id: RFQ, sl_no: 2, product_id: null, description: "Gate valve DN100", uom: "no", qty: 4, status: "open", estimate_line_id: LN_VALVE, path: "purchase.unit_cost" },
      { id: RLS, tenant_id: T1, rfq_id: RFQ_STD, sl_no: 1, product_id: null, description: "Something", uom: "no", qty: 1, status: "open", path: "purchase.unit_cost" },
      { id: RLQ, tenant_id: T1, rfq_id: RFQ_Q, sl_no: 1, product_id: null, description: "Quoted line", uom: "m", qty: 100, status: "open", estimate_line_id: LN_Q, path: "purchase.unit_cost" },
    ],
    suppliers: [{ id: SUP_A, tenant_id: T1, name: "Gulf Pipes", email: "a@x.test" }, { id: SUP_B, tenant_id: T1, name: "Desert Valves", email: "b@x.test" }],
    rfq_suppliers: [
      { id: RS_A, tenant_id: T1, rfq_id: RFQ, supplier_id: SUP_A, status: "replied", reminder_count: 0, email_to: null, token_nonce: "n" },
      { id: RS_B, tenant_id: T1, rfq_id: RFQ, supplier_id: SUP_B, status: "replied", reminder_count: 0, email_to: null, token_nonce: "n" },
      { id: RS_S, tenant_id: T1, rfq_id: RFQ_STD, supplier_id: SUP_A, status: "replied", reminder_count: 0, email_to: null, token_nonce: "n" },
      { id: RS_Q, tenant_id: T1, rfq_id: RFQ_Q, supplier_id: SUP_A, status: "replied", reminder_count: 0, email_to: null, token_nonce: "n" },
    ],
    rfq_responses: [resp(RA1, RS_A, RL1, 28.5), resp(RB1, RS_B, RL1, 30), resp(RA2, RS_B, RL2, 410), resp(RS1, RS_S, RLS, 7), resp(RQ1, RS_Q, RLQ, 25)],
    tender_boq_sources: [{ id: SRC, tenant_id: T1, opportunity_id: OPP, version: 1, is_current: true, file_name: "boq.xlsx", storage_path: "x", size_bytes: 1, sheet_name: "S", header_row: 1, header_labels: [], column_map: {}, rate_col: null, amount_col: null, added_columns: false, total_row: null, line_count: 1, uploaded_by: null, uploaded_at: "2026-10-20T00:00:00Z" }],
    opportunity_lines: [{ id: DEAL_LINE, tenant_id: T1, opportunity_id: OPP, sl_no: "1.3", description: "HDPE pipe 110mm laid", uom: "m", qty: 100, rate: 40, discount_pct: 0, amount: 4000, product_id: null }],
    tender_boq_lines: [{ id: BOQ, tenant_id: T1, opportunity_id: OPP, source_id: SRC, line_id: DEAL_LINE, item_key: "1.3", item_no: "1.3", cost_code: "cc3", row_no: 7, file_description: "HDPE pipe 110mm laid", file_uom: "m", file_qty: 100, file_rate: null, price_source: "estimate", price_source_ref: "EST-0007", price_as_of: "2026-10-20", stale_accepted: false, unit_cost: 40, markup_pct: 0, removed_in_revision: false }],
    tender_boq_estimate_links: [{ id: LINK, tenant_id: T1, opportunity_id: OPP, boq_line_id: BOQ, estimate_id: EST, output: "total", basis: "total", share_pct: 100, applied_cost: 40, applied_at: "2026-10-20T09:00:00.000Z", estimate_updated_at: "2026-10-20T08:00:00.000Z", needs_review: false, review_note: null }],
  });
  state.db.unique("rfq_line_awards", (e, n) => e.rfq_line_id === n.rfq_line_id && !e.superseded_at && !n.superseded_at);
  state.db.unique("product_suppliers", () => false);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("raising an RFQ for an estimate's missing costs", () => {
  it("is an ordinary RFQ whose origin is the estimate, with each line remembering the estimate line it asks about", async () => {
    const r = await attempt({ origin_type: "estimate", origin_id: EST, lines: [{ description: "HDPE pipe 110mm", uom: "m", qty: 100, source_line_id: LN_PIPE }, { description: "Gate valve DN100", uom: "no", qty: 4, source_line_id: LN_VALVE }], supplier_ids: [SUP_A] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rfq = row("rfqs", r.id);
    expect(rfq).toMatchObject({ origin_type: "estimate", origin_id: EST, origin_label: "EST-0007", tenant_id: T1, status: "draft" });
    const lines = state.db.rows("rfq_lines").filter((l) => l.rfq_id === r.id);
    expect(lines.map((l) => l.estimate_line_id)).toEqual([LN_PIPE, LN_VALVE]);
    // The estimate line is not stamped (it has no rfq_line_id column): the RFQ line holds the link.
    expect(estLine(LN_PIPE).rfq_line_id).toBeUndefined();
  });

  it("goes to any number of suppliers: none yet, one, or several", async () => {
    for (const supplier_ids of [[], [SUP_A], [SUP_A, SUP_B]]) {
      const r = await attempt({ origin_type: "estimate", origin_id: EST, lines: [{ description: "HDPE pipe 110mm", source_line_id: LN_PIPE }], supplier_ids });
      expect(r.ok, JSON.stringify(supplier_ids)).toBe(true);
      if (r.ok) expect(state.db.rows("rfq_suppliers").filter((s) => s.rfq_id === r.id)).toHaveLength(supplier_ids.length);
    }
  });

  it("is refused in a workspace without the tender edition, for an estimate that belongs to no tender, and for another workspace's estimate", async () => {
    const lines = (l: string) => [{ description: "x", source_line_id: l }];
    state.features.gcc_tender = false;
    state.db.rows("tenants").find((t) => t.id === T1)!.features = { ...state.features };
    expect(await attempt({ origin_type: "estimate", origin_id: EST, lines: lines(LN_PIPE) })).toMatchObject({ ok: false, status: 404 });
    state.features.gcc_tender = true;
    state.db.rows("tenants").find((t) => t.id === T1)!.features = { ...state.features };
    expect(await attempt({ origin_type: "estimate", origin_id: EST_STD, lines: lines(LN_OTHER) })).toMatchObject({ ok: false, status: 404 });
    expect(await attempt({ origin_type: "estimate", origin_id: EST_T2, lines: lines(LN_T2) })).toMatchObject({ ok: false, status: 404 });
    expect(await attempt({ origin_type: "estimate", origin_id: id(97), lines: lines(LN_PIPE) })).toMatchObject({ ok: false, status: 404 });
    expect(state.db.rows("rfqs")).toHaveLength(3);
  });

  it("needs the estimate named, and every line it claims must be a line of THAT estimate in this workspace", async () => {
    expect(await attempt({ origin_type: "estimate", origin_id: null, lines: [{ description: "x" }] })).toMatchObject({ ok: false, status: 422 });
    for (const bad of [LN_OTHER, LN_T2, id(96), "nope"]) {
      expect(await attempt({ origin_type: "estimate", origin_id: EST, lines: [{ description: "x", source_line_id: bad }] }), bad).toMatchObject({ ok: false, status: 422 });
    }
    expect(await attempt({ origin_type: "estimate", origin_id: EST, lines: [{ description: "x", source_line_id: LN_PIPE }, { description: "y", source_line_id: LN_PIPE }] })).toMatchObject({ ok: false, status: 422 });
    expect(state.db.rows("rfqs")).toHaveLength(3);
  });

  it("while migration 0227 is pending the RFQ is not left half-made", async () => {
    state.db.missingColumns.rfq_lines = new Set(["estimate_line_id"]);
    const r = await attempt({ origin_type: "estimate", origin_id: EST, lines: [{ description: "x", source_line_id: LN_PIPE }] });
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(state.db.rows("rfqs")).toHaveLength(3);
  });

  it("an ordinary RFQ is made exactly as before and never reads an estimate table", async () => {
    state.touched = [];
    const r = await attempt({ origin_type: "manual", lines: [{ description: "Bolts", qty: 10, uom: "no" }], supplier_ids: [SUP_A] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(row("rfqs", r.id)).toMatchObject({ origin_type: "manual", origin_id: null });
    expect(state.db.rows("rfq_lines").find((l) => l.rfq_id === r.id)).not.toHaveProperty("estimate_line_id");
    expect(state.touched.filter((t) => ["estimates", "estimate_lines", "tender_boq_estimate_links"].includes(t))).toEqual([]);
  });
});

describe("the award writes the cost back", () => {
  it("puts the awarded cost in the estimate line with its source and date, re-totals the estimate and keeps a hand edit across a recalculation", async () => {
    const r = await post({ line_id: RL1, response_id: RA1 });
    expect(r.status).toBe(200);
    expect(r.json.estimate).toMatchObject({ written: true, repriced: 1, flagged: 0, locked: false });
    const l = estLine(LN_PIPE);
    // 28.50 a metre for 100 m with 5 percent waste.
    expect(l).toMatchObject({ unit_cost: 28.5, cost_total: 2992.5 });
    const meta = { unit_cost: 28.5, as_of: "2026-10-26", source: "rfq", ref: "RFQ-0001 · Gulf Pipes" };
    expect((l.custom_data as Record<string, unknown>).override).toMatchObject({ unit_cost: 28.5, cost_meta: meta });
    expect((l.custom_data as Record<string, unknown>).group).toBe("Supply");
    expect(row("estimates", EST).updated_at).not.toBe("2026-10-20T08:00:00.000Z");
    expect(state.changes.some((c) => c.objectType === "estimates" && c.objectId === EST && c.changes?.some((x) => x.to === 28.5))).toBe(true);
  });

  it("a hand-added line keeps its cost source on the line itself", async () => {
    await post({ line_id: RL2, response_id: RA2 });
    const l = estLine(LN_VALVE);
    expect(l).toMatchObject({ unit_cost: 410, cost_total: 1640 });
    expect((l.custom_data as Record<string, unknown>).cost_meta).toMatchObject({ unit_cost: 410, as_of: "2026-10-26", ref: "RFQ-0001 · Desert Valves" });
  });

  it("re-prices the BOQ lines priced from the estimate and marks them for review, keeping the line's markup", async () => {
    row("tender_boq_lines", BOQ).markup_pct = 10;
    const r = await post({ line_id: RL1, response_id: RA1 });
    expect(r.json.estimate).toMatchObject({ repriced: 1 });
    // With the valve still open the estimate is 2,992.5 (the pipe) over 100 m.
    expect(row("tender_boq_lines", BOQ)).toMatchObject({ price_source: "estimate", unit_cost: 29.925, markup_pct: 10 });
    expect(row("opportunity_lines", DEAL_LINE)).toMatchObject({ rate: 32.92, amount: 3292 });
    expect(row("tender_boq_estimate_links", LINK)).toMatchObject({ needs_review: true });
    expect(String(row("tender_boq_estimate_links", LINK).review_note)).toContain("RFQ-0001 was awarded to Gulf Pipes");
    expect(row("tender_boq_estimate_links", LINK).applied_at).not.toBe("2026-10-20T09:00:00.000Z");
  });

  it("a bid that is already in is never changed by itself: the estimate line is written, the BOQ rate is not, and the link is only flagged", async () => {
    row("opportunities", OPP).stage = "submitted";
    const r = await post({ line_id: RL1, response_id: RA1 });
    expect(r.json.estimate).toMatchObject({ written: true, repriced: 0, flagged: 1, locked: true });
    expect(estLine(LN_PIPE).unit_cost).toBe(28.5);
    expect(row("opportunity_lines", DEAL_LINE)).toMatchObject({ rate: 40, amount: 4000 });
    expect(row("tender_boq_lines", BOQ)).toMatchObject({ unit_cost: 40 });
    expect(row("tender_boq_estimate_links", LINK)).toMatchObject({ needs_review: true });
    expect(String(row("tender_boq_estimate_links", LINK).review_note)).toContain("bid is already in");
    // The link is also stale (the estimate moved on), which is what the screen shows.
    expect(String(row("estimates", EST).updated_at) > String(row("tender_boq_estimate_links", LINK).estimate_updated_at)).toBe(true);
  });

  it("an estimate that already has a quote keeps its numbers; the award stands and says so", async () => {
    const r = await post({ line_id: RLQ, response_id: RQ1 }, RFQ_Q);
    expect(r.status).toBe(200);
    expect(r.json.estimate).toMatchObject({ written: false });
    expect(String(r.json.estimate!.reason)).toMatch(/quote/);
    expect(estLine(LN_Q).unit_cost).toBeNull();
    expect(row("rfq_lines", RLQ).status).toBe("awarded");
  });

  it("only the estimate the RFQ was raised for can be written: a line id from another estimate is ignored", async () => {
    row("rfq_lines", RL1).estimate_line_id = LN_OTHER;
    const r = await post({ line_id: RL1, response_id: RA1 });
    expect(r.status).toBe(200);
    expect(r.json.estimate).toMatchObject({ written: false });
    expect(estLine(LN_OTHER).unit_cost).toBeNull();
    row("rfq_lines", RL1).estimate_line_id = LN_T2;
    expect((await post({ line_id: RL1, response_id: RB1, replace: true, reason: "Faster delivery from this supplier" })).json.estimate).toMatchObject({ written: false });
    expect(estLine(LN_T2).unit_cost).toBeNull();
  });

  it("an award with no answer ('no award') writes nothing, and an RFQ line not tied to an estimate line says so", async () => {
    expect((await post({ line_id: RL1, response_id: null })).json.estimate).toBeUndefined();
    expect(estLine(LN_PIPE).unit_cost).toBe(31);
    delete row("rfq_lines", RL2).estimate_line_id;
    const r = await post({ line_id: RL2, response_id: RA2 });
    expect(r.json.estimate).toMatchObject({ written: false });
  });

  it("an ordinary RFQ is awarded exactly as before: no estimate in the answer and no estimate table touched", async () => {
    state.touched = [];
    const r = await post({ line_id: RLS, response_id: RS1 }, RFQ_STD);
    expect(r.status).toBe(200);
    expect(r.json.estimate).toBeUndefined();
    expect(state.touched.filter((t) => ["estimates", "estimate_lines", "tender_boq_estimate_links"].includes(t))).toEqual([]);
  });

  it("the lines no longer count as missing once the awarded cost is in", async () => {
    const { missingCosts } = await import("@/lib/tender/estimates/rules");
    const { toEstLine } = await import("@/lib/tender/estimates/server");
    await post({ line_id: RL2, response_id: RA2 });
    const lines = state.db.rows("estimate_lines").filter((l) => l.estimate_id === EST).map(toEstLine);
    expect(missingCosts(lines, "2026-10-26", 180).map((m) => m.line_id)).toEqual([]);
    expect(missingCosts(lines, "2027-06-01", 180).map((m) => m.line_id)).toContain(LN_VALVE);
  });
});
