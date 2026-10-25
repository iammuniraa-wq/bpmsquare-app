import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, slice 3b: awarding an RFQ line as a RECORDED decision, against an in-memory database. The questions asked
// here are the ones the brief lists: a reason is required whenever the chosen price is not the lowest valid one, another
// workspace's lines / answers / suppliers are refused, a second award on a line is a conflict, the supplier's price lands on the
// product, the migration still pending is told plainly, "use these prices on the deal lines" writes through the deal's own line
// save, and the existing RFQ to purchase order conversion still works from an award made this way.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  user: { id: "u1", email: "me@t1.test" },
  role: "member" as "admin" | "member",
  pipelineEdit: true,
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  beforeInsert: null as null | (() => void),
  put: null as null | { id: string; body: { lines: Record<string, unknown>[] } },
  putStatus: 200,
}));

const T1 = "t1";
const T2 = "t2";
const ME = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RFQ = id(1), RFQ2 = id(2), OPP = id(3), OPP2 = id(4);
const L1 = id(11), L2 = id(12), L9 = id(19);
const RS_A = id(21), RS_B = id(22), RS_C = id(23), RS_X = id(29);
const SA = id(31), SB = id(32), SC = id(33), SX = id(39);
const P1 = id(41);
const rA1 = id(51), rB1 = id(52), rC1 = id(53), rA2 = id(54), rB2 = id(55), rX9 = id(59);
const DL1 = id(61), DL2 = id(62), DL3 = id(63);

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({
    from: (t: string) => {
      const q = state.db.from(t) as unknown as { insert: (p: unknown) => unknown };
      if (t === "rfq_line_awards" && state.beforeInsert) {
        const orig = q.insert.bind(q);
        q.insert = (p: unknown) => { const f = state.beforeInsert!; state.beforeInsert = null; f(); return orig(p); };
      }
      return q;
    },
    auth: state.db.auth,
  }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: state.role, supabase: { from: (t: string) => state.db.from(t) } }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }),
  canViewWorkcenter: () => true,
  canEditWorkcenter: (_p: unknown, wc: string) => (wc === "pipeline" ? state.pipelineEdit : true),
}));
vi.mock("@/lib/changeLog", () => ({
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
  diffForLog: () => [],
}));
vi.mock("@/lib/events/emitters", () => ({ emitRfqSent: async () => {}, emitRfqReplied: async () => {}, emitRfqAwarded: async () => {} }));
vi.mock("@/lib/tenantClock", () => ({ tenantToday: async () => "2026-10-26", tenantTimezone: async () => "Asia/Riyadh" }));
vi.mock("@/lib/tenant", () => ({ getTenant: async () => ({ id: "t1", slug: "kamco", name: "KAMCO", custom_domain: null, config: {}, features: state.features, company_info: null }) }));
vi.mock("@/lib/poRef", () => ({ generateNextPoRef: async () => "PO-0001" }));
vi.mock("@/lib/inventoryForProduct", () => ({ loadProductSkus: async () => new Map(), loadInventoryCandidates: async () => [], inventoryItemForProduct: () => null }));
vi.mock("@/app/api/opportunities/[id]/lines/route", () => ({
  PUT: async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    state.put = { id: (await ctx.params).id, body: await req.json() };
    return Response.json(state.putStatus === 200 ? { ok: true } : { error: "The pipeline is off" }, { status: state.putStatus });
  },
}));

import { NextRequest } from "next/server";
import { POST as award } from "./[id]/award/route";
import { POST as applyToDeal } from "./[id]/apply-to-deal/route";
import { POST as raisePos } from "./[id]/purchase-orders/route";
import { GET as getRfq } from "./[id]/route";
import { RFQ_TIPS } from "@/lib/rfq/tips";

const req = (body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (rid: string) => ({ params: Promise.resolve({ id: rid }) });
const awards = () => state.db.rows("rfq_line_awards");
const current = () => awards().filter((a) => !a.superseded_at);
const line = (lid: string) => state.db.rows("rfq_lines").find((l) => l.id === lid)!;
const post = async (body: unknown, rid = RFQ) => {
  const res = await award(req(body), ctx(rid));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const resp = (rid: string, rs: string, lineId: string, price: number, over: Record<string, unknown> = {}) => ({
  id: rid, tenant_id: T1, rfq_supplier_id: rs, rfq_line_id: lineId, status: "quoted", unit_price: price, currency: "SAR", fx_rate: null,
  lead_time_days: 14, moq: 5, offered_description: null, valid_until: "2026-12-31", note: null, source: "buyer", is_awarded: false,
  submitted_at: "2026-10-20T08:00:00Z", updated_at: "2026-10-20T08:00:00Z", ...over,
});
const sup = (rid: string, supplierId: string, over: Record<string, unknown> = {}) => ({
  id: rid, tenant_id: T1, rfq_id: RFQ, supplier_id: supplierId, status: "replied", reminder_count: 0, last_reminded_at: null, email_to: null, token_nonce: "n", ...over,
});

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [
      { id: T1, slug: "kamco", name: "KAMCO", features: { rfq: true, purchasing: true, pipeline: true }, config: {}, custom_domain: null },
      { id: T2, slug: "other", name: "Other", features: { rfq: true }, config: {}, custom_domain: null },
    ],
    rfqs: [
      { id: RFQ, tenant_id: T1, ref: "RFQ-0001", title: "Pipes", status: "sent", origin_type: "opportunity", origin_id: OPP, origin_label: "OPP-3", respond_by: "2026-10-28", currency: null, buyer_id: null, requested_by: ME },
      { id: RFQ2, tenant_id: T2, ref: "RFQ-0001", title: "Theirs", status: "sent", origin_type: "manual", origin_id: null, respond_by: null, currency: null, buyer_id: null, requested_by: null },
    ],
    rfq_lines: [
      { id: L1, tenant_id: T1, rfq_id: RFQ, sl_no: 1, product_id: P1, description: "Pipe 6in", uom: "Nos", qty: 10, status: "open", cost_model_code: null, path: "purchase.unit_cost", cost_input_id: null },
      { id: L2, tenant_id: T1, rfq_id: RFQ, sl_no: 2, product_id: null, description: "Flange", uom: "Nos", qty: 2, status: "open", cost_model_code: null, path: "purchase.unit_cost", cost_input_id: null },
      { id: L9, tenant_id: T2, rfq_id: RFQ2, sl_no: 1, product_id: null, description: "Their line", uom: "Nos", qty: 1, status: "open", cost_model_code: null, path: "purchase.unit_cost", cost_input_id: null },
    ],
    rfq_suppliers: [sup(RS_A, SA), sup(RS_B, SB), sup(RS_C, SC), { ...sup(RS_X, SX), tenant_id: T2, rfq_id: RFQ2 }],
    rfq_responses: [
      resp(rA1, RS_A, L1, 100), resp(rB1, RS_B, L1, 120), resp(rC1, RS_C, L1, 70, { valid_until: "2026-09-01" }),
      resp(rA2, RS_A, L2, 40), resp(rB2, RS_B, L2, 35),
      { ...resp(rX9, RS_X, L9, 10), tenant_id: T2 },
    ],
    opportunities: [
      { id: OPP, tenant_id: T1, ref: "OPP-3", title: "Plant 4 tender", account_id: "acc" },
      { id: OPP2, tenant_id: T2, ref: "OPP-9", title: "Theirs", account_id: "acc2" },
    ],
    opportunity_lines: [
      { id: DL1, tenant_id: T1, opportunity_id: OPP, sl_no: "1", description: "Pipe 6in", uom: "Nos", qty: 10, rate: 0, discount_pct: 0, rfq_line_id: L1, product_id: P1 },
      { id: DL2, tenant_id: T1, opportunity_id: OPP, sl_no: "2", description: "Flange", uom: "Nos", qty: 2, rate: 99, discount_pct: 0, rfq_line_id: L2 },
      { id: DL3, tenant_id: T1, opportunity_id: OPP, sl_no: "3", description: "Not asked about", uom: "Nos", qty: 1, rate: 5, discount_pct: 0, rfq_line_id: null },
    ],
    products: [{ id: P1, tenant_id: T1, name: "Pipe 6in", ref: "PRD-1" }],
  });
  state.db.unique("rfq_line_awards", (e, n) => e.rfq_line_id === n.rfq_line_id && !e.superseded_at && !n.superseded_at);
  state.db.unique("product_suppliers", () => false);
  state.user = { id: ME, email: "me@t1.test" };
  state.role = "member";
  state.pipelineEdit = true;
  state.changes = [];
  state.beforeInsert = null;
  state.put = null;
  state.putStatus = 200;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the lowest valid price needs no reason", () => {
  it("records who chose it and when, marks the line awarded and the RFQ awarded once every line is", async () => {
    const r = await post({ line_id: L1, response_id: rA1 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, status: "awarded", unit_cost: 100, not_lowest: false });
    expect(current()).toHaveLength(1);
    expect(current()[0]).toMatchObject({
      tenant_id: T1, rfq_id: RFQ, rfq_line_id: L1, rfq_supplier_id: RS_A, supplier_id: SA, response_id: rA1,
      chosen_by: ME, not_lowest: false, reason: null, landed_unit: 100, lowest_valid_unit: 100,
    });
    expect(typeof current()[0].chosen_at).toBe("string");
    expect(line(L1)).toMatchObject({ status: "awarded", awarded_response_id: rA1, awarded_unit_cost: 100 });
    expect(state.db.rows("rfq_responses").find((x) => x.id === rA1)?.is_awarded).toBe(true);
    expect(state.db.rows("rfqs").find((x) => x.id === RFQ)?.status).not.toBe("awarded"); // L2 still open
    await post({ line_id: L2, response_id: rB2 });
    expect(state.db.rows("rfqs").find((x) => x.id === RFQ)?.status).toBe("awarded");
  });

  it("a cheaper EXPIRED answer is not the benchmark: choosing the lowest valid one is fine", async () => {
    expect((await post({ line_id: L1, response_id: rA1 })).status).toBe(200);
  });
});

describe("a reason when the price is not the lowest valid one", () => {
  it("refuses a dearer choice without a reason, writing nothing", async () => {
    const r = await post({ line_id: L1, response_id: rB1 });
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ code: "reason_required", lines: [L1] });
    expect(String(r.json.error)).toMatch(/line 1/i);
    expect(awards()).toHaveLength(0);
    expect(line(L1).status).toBe("open");
    expect((await post({ line_id: L1, response_id: rB1, reason: "ok" })).status).toBe(422); // too short to be a reason
    expect((await post({ line_id: L1, response_id: rB1, reason: "   " })).status).toBe(422);
  });

  it("records the reason with the award and in the change history", async () => {
    const r = await post({ line_id: L1, response_id: rB1, reason: "  Delivers to site, A is on allocation  " });
    expect(r.status).toBe(200);
    expect(r.json.not_lowest).toBe(true);
    expect(current()[0]).toMatchObject({ response_id: rB1, not_lowest: true, reason: "Delivers to site, A is on allocation", landed_unit: 120, lowest_valid_unit: 100 });
    const logged = state.changes.flatMap((c) => c.changes ?? []).find((c) => c.field === "line 1 award reason");
    expect(logged?.to).toBe("Delivers to site, A is on allocation");
  });

  it("an expired answer needs a reason even though it is the cheapest", async () => {
    const r = await post({ line_id: L1, response_id: rC1 });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("reason_required");
    expect((await post({ line_id: L1, response_id: rC1, reason: "Supplier confirmed the price by phone" })).status).toBe(200);
  });

  it("awarding all of a supplier's lines asks once, and keeps the reason only on the lines that need it", async () => {
    const no = await post({ rfq_supplier_id: RS_A, all: true });
    expect(no.status).toBe(422); // L2: A 40 against B 35
    expect(no.json.lines).toEqual([L2]);
    expect(awards()).toHaveLength(0);
    expect(line(L1).status).toBe("open");
    const ok = await post({ rfq_supplier_id: RS_A, all: true, reason: "One supplier for the whole package" });
    expect(ok.status).toBe(200);
    expect(current()).toHaveLength(2);
    const byLine = Object.fromEntries(current().map((a) => [a.rfq_line_id as string, a]));
    expect(byLine[L1]).toMatchObject({ not_lowest: false, reason: null });
    expect(byLine[L2]).toMatchObject({ not_lowest: true, reason: "One supplier for the whole package" });
  });

  it("the exchange rate typed in the dialog decides what 'lowest' means for a foreign quote", async () => {
    state.db.rows("rfq_responses").push(resp(id(70), RS_B, L2, 9, { currency: "USD" })); // 9 USD
    const dear = await post({ line_id: L2, response_id: id(70), fx_rate: 4.5 }); // 40.5 against 35 and 40
    expect(dear.status).toBe(422);
    const cheap = await post({ line_id: L2, response_id: id(70), fx_rate: 3.5 }); // 31.5, lowest
    expect(cheap.status).toBe(200);
    expect(cheap.json.unit_cost).toBe(31.5);
  });
});

describe("another workspace, another RFQ, and ids that do not belong", () => {
  it("an RFQ of another workspace is not found", async () => {
    expect((await post({ line_id: L9, response_id: rX9 }, RFQ2)).status).toBe(404);
    expect(awards()).toHaveLength(0);
  });
  it("a line of another workspace's RFQ is refused on mine", async () => {
    const r = await post({ line_id: L9, response_id: rX9 });
    expect(r.status).toBe(404);
    expect(awards()).toHaveLength(0);
    expect(line(L9).status).toBe("open");
  });
  it("an answer of another workspace, or of another line, is refused", async () => {
    expect((await post({ line_id: L1, response_id: rX9 })).status).toBe(404);
    expect((await post({ line_id: L1, response_id: rA2 })).status).toBe(404); // a real answer, but to line 2
    expect((await post({ line_id: L1, response_id: "not-a-uuid" })).status).toBe(404);
    expect(awards()).toHaveLength(0);
  });
  it("a supplier of another workspace cannot be awarded all lines on mine", async () => {
    expect((await post({ rfq_supplier_id: RS_X, all: true })).status).toBe(404);
    expect(awards()).toHaveLength(0);
  });
  it("a supplier removed from the RFQ cannot be awarded", async () => {
    state.db.rows("rfq_suppliers").find((s) => s.id === RS_B)!.status = "cancelled";
    expect((await post({ line_id: L1, response_id: rB1, reason: "because I said so" })).status).toBe(422);
  });
  it("a line the supplier did not quote cannot be awarded to them", async () => {
    state.db.rows("rfq_responses").find((r) => r.id === rB2)!.status = "no_quote";
    state.db.rows("rfq_responses").find((r) => r.id === rB2)!.unit_price = null;
    expect((await post({ line_id: L2, response_id: rB2 })).status).toBe(422);
  });
  it("a workspace without the rfq module gets a 404, and a draft RFQ cannot be awarded", async () => {
    state.db.rows("tenants")[0].features = { pipeline: true };
    expect((await post({ line_id: L1, response_id: rA1 })).status).toBe(404);
    state.db.rows("tenants")[0].features = { rfq: true };
    state.db.rows("rfqs")[0].status = "draft";
    expect((await post({ line_id: L1, response_id: rA1 })).status).toBe(409);
  });
});

describe("a second award on the same line", () => {
  it("is a conflict unless the buyer confirms the replacement", async () => {
    await post({ line_id: L1, response_id: rA1 });
    const again = await post({ line_id: L1, response_id: rB1, reason: "Changed our mind about delivery" });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("already_awarded");
    expect(current()).toHaveLength(1);
    expect(current()[0].response_id).toBe(rA1);
  });

  it("replacing keeps the earlier decision in the history, with exactly one standing award", async () => {
    await post({ line_id: L1, response_id: rA1 });
    const r = await post({ line_id: L1, response_id: rB1, reason: "Changed our mind about delivery", replace: true });
    expect(r.status).toBe(200);
    expect(awards()).toHaveLength(2);
    expect(current()).toHaveLength(1);
    expect(current()[0].response_id).toBe(rB1);
    const old = awards().find((a) => a.response_id === rA1)!;
    expect(old.superseded_at).toBeTruthy();
    expect(old.superseded_by).toBe(ME);
    expect(state.db.rows("rfq_responses").find((x) => x.id === rA1)?.is_awarded).toBe(false);
    expect(state.db.rows("rfq_responses").find((x) => x.id === rB1)?.is_awarded).toBe(true);
  });

  it("two people awarding at once: the loser is told so and the first award is untouched", async () => {
    state.beforeInsert = () => {
      state.db.rows("rfq_line_awards").push({ id: id(80), tenant_id: T1, rfq_id: RFQ, rfq_line_id: L1, rfq_supplier_id: RS_B, supplier_id: SB, response_id: rB1, chosen_by: "someone-else", chosen_at: "2026-10-26T08:00:00Z", reason: null, not_lowest: false, superseded_at: null });
    };
    const r = await post({ line_id: L1, response_id: rA1 });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("already_awarded");
    expect(current()).toHaveLength(1);
    expect(current()[0].chosen_by).toBe("someone-else");
    expect(line(L1).status).toBe("open");
  });

  it("'no award' supersedes the standing award and marks the line", async () => {
    await post({ line_id: L1, response_id: rA1 });
    const r = await post({ line_id: L1, response_id: null });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("no_award");
    expect(current()).toHaveLength(0);
    expect(line(L1).status).toBe("no_award");
  });

  it("a line already on a purchase order cannot be re-awarded", async () => {
    await post({ line_id: L1, response_id: rA1 });
    state.db.rows("purchase_order_lines").push({ id: id(90), tenant_id: T1, rfq_response_id: rA1 });
    const r = await post({ line_id: L1, response_id: rB1, reason: "Changed our mind", replace: true });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("on_purchase_order");
    expect(current()[0].response_id).toBe(rA1);
  });
});

describe("the supplier's price lands on the product", () => {
  it("upserts product_suppliers for a catalog line (source rfq, as of today, with the validity) and not for a free-text line", async () => {
    await post({ line_id: L1, response_id: rA1 });
    await post({ line_id: L2, response_id: rB2 });
    const ps = state.db.rows("product_suppliers");
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({
      tenant_id: T1, product_id: P1, supplier_id: SA, source: "rfq", as_of: "2026-10-26", valid_from: "2026-10-26", valid_to: "2026-12-31",
      cost: 100, quoted_price: 100, currency: "SAR", rfq_response_id: rA1, lead_time_days: 14, moq: 5,
    });
    expect(ps[0]).not.toHaveProperty("preferred");
  });

  it("a later award for the same product and supplier updates the one row", async () => {
    await post({ line_id: L1, response_id: rA1 });
    state.db.rows("rfq_responses").find((r) => r.id === rA1)!.unit_price = 95;
    await post({ line_id: L1, response_id: rA1, replace: true });
    const ps = state.db.rows("product_suppliers").filter((p) => p.supplier_id === SA);
    expect(ps).toHaveLength(1);
    expect(ps[0].cost).toBe(95);
  });
});

describe("while migration 0224 is pending", () => {
  it("awarding says a database update is needed and changes nothing", async () => {
    state.db.missing.add("rfq_line_awards");
    const r = await post({ line_id: L1, response_id: rA1 });
    expect(r.status).toBe(503);
    expect(String(r.json.error)).toMatch(/0224/);
    expect(line(L1).status).toBe("open");
    expect(state.db.rows("rfq_responses").find((x) => x.id === rA1)?.is_awarded).toBe(false);
  });

  it("the RFQ still opens, with the comparison data and the pending flag", async () => {
    state.db.missing.add("rfq_line_awards");
    const res = await getRfq(new NextRequest(new URL("http://internal.invalid/x")), ctx(RFQ));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.awards_pending).toBe(true);
    expect(j.awards).toEqual([]);
    expect(j.responses).toHaveLength(5);
    expect(j.today).toBe("2026-10-26");
    expect(j.stale_days).toBe(180);
  });
});

describe("the RFQ screen reads the standing awards", () => {
  it("returns them without the superseded ones", async () => {
    await post({ line_id: L1, response_id: rA1 });
    await post({ line_id: L1, response_id: rB1, reason: "Delivery", replace: true });
    const j = await (await getRfq(new NextRequest(new URL("http://internal.invalid/x")), ctx(RFQ))).json();
    expect(j.awards_pending).toBe(false);
    expect(j.awards).toHaveLength(1);
    expect(j.awards[0]).toMatchObject({ rfq_line_id: L1, response_id: rB1, not_lowest: true, reason: "Delivery" });
  });
});

describe("use these prices on the deal lines", () => {
  const apply = async (rid = RFQ) => {
    const res = await applyToDeal(req(), ctx(rid));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it("writes each awarded price as the rate of the deal line that asked, through the deal's own line save, and nothing else", async () => {
    await post({ line_id: L1, response_id: rA1 });
    await post({ line_id: L2, response_id: rB2 });
    const r = await apply();
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(2);
    expect(state.put?.id).toBe(OPP);
    const sent = state.put!.body.lines;
    expect(sent).toHaveLength(3);
    const by = Object.fromEntries(sent.map((l) => [l.sl_no as string, l]));
    expect(by["1"].rate).toBe("100");
    expect(by["2"].rate).toBe("35");
    expect(by["3"].rate).toBe(5); // untouched: it never asked a supplier
    expect(by["1"]).toMatchObject({ local_id: DL1, rfq_line_id: L1, product_id: P1, description: "Pipe 6in" });
    expect(current().every((a) => !!a.applied_to_deal_at && a.applied_by === ME)).toBe(true);
    expect(current().map((a) => a.applied_rate as number).sort((x, y) => x - y)).toEqual([35, 100]);
    const log = state.changes.find((c) => c.objectType === "opportunities");
    expect(log?.objectId).toBe(OPP);
    expect(log?.changes?.map((c) => c.field).join(" | ")).toContain("supplier RFQ RFQ-0001");
  });

  it("asks for an award first, and does nothing when the lines already carry the prices", async () => {
    expect((await apply()).status).toBe(422);
    await post({ line_id: L1, response_id: rA1 });
    state.db.rows("opportunity_lines").find((l) => l.id === DL1)!.rate = 100;
    const r = await apply();
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(0);
    expect(state.put).toBeNull();
  });

  it("is only for an RFQ raised from a deal, needs edit on the Pipeline, and never reaches another workspace's deal", async () => {
    await post({ line_id: L1, response_id: rA1 });
    state.pipelineEdit = false;
    expect((await apply()).status).toBe(403);
    state.pipelineEdit = true;
    state.db.rows("rfqs")[0].origin_type = "manual";
    expect((await apply()).status).toBe(422);
    state.db.rows("rfqs")[0].origin_type = "opportunity";
    state.db.rows("rfqs")[0].origin_id = OPP2;
    expect((await apply()).status).toBe(404);
    expect(state.put).toBeNull();
    expect((await apply(RFQ2)).status).toBe(404);
  });

  it("passes the deal's own refusal through and records nothing as applied", async () => {
    await post({ line_id: L1, response_id: rA1 });
    state.putStatus = 403;
    const r = await apply();
    expect(r.status).toBe(403);
    expect(current()[0].applied_to_deal_at ?? null).toBeNull();
  });
});

describe("the purchase order conversion still works from an award made this way", () => {
  it("raises one draft PO per awarded supplier at the awarded cost", async () => {
    await post({ line_id: L1, response_id: rA1 });
    await post({ line_id: L2, response_id: rB2 });
    const res = await raisePos(req({}), ctx(RFQ));
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.created).toHaveLength(2);
    const lines = state.db.rows("purchase_order_lines");
    expect(lines.map((l) => [l.rfq_response_id, l.rate]).sort()).toEqual([[rA1, 100], [rB2, 35]].sort());
    expect(state.db.rows("purchase_orders").every((p) => p.rfq_id === RFQ && p.tenant_id === T1 && p.status === "draft")).toBe(true);
  });
});

describe("the explanations", () => {
  it("exist for every control the screen explains", () => {
    for (const k of ["compare", "award", "reason", "awardAll", "replace", "deal", "fx", "waiting", "coverage", "stale"] as const) expect(RFQ_TIPS[k]).toBeTruthy();
  });
});
