import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, slice 4: bid versions, logged calls and the outcome facts, against an in-memory database. The questions asked here
// are the ones the design lists: append-only and no cap, a reason from version 2, the stage rules still decide, another workspace's rows,
// the flag off, a non-tender deal, the migration pending, the limits on calls, and what an outcome requires.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  touched: [] as string[],
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "u1", email: "me@t1.test" },
  role: "member" as "admin" | "member",
  edit: true,
  stageEvents: [] as { from: string; to: string }[],
}));

const T1 = "t1";
const T2 = "t2";
const ME = "11111111-1111-4111-8111-111111111111";
const COLLEAGUE = "22222222-2222-4222-8222-222222222222";
const BOSS = "33333333-3333-4333-8333-333333333333";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const uid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NEW_TABLES = ["tender_bid_versions", "deal_activities"];

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => { state.touched.push(t); return state.db.from(t); }, auth: state.db.auth }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }),
  canViewWorkcenter: () => true,
  canEditWorkcenter: () => state.edit,
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: (_t: string, b: Record<string, unknown>, a: Record<string, unknown>) =>
    Object.entries(a).filter(([k, v]) => JSON.stringify(b[k] ?? null) !== JSON.stringify(v ?? null)).map(([field, to]) => ({ field, from: b[field] ?? null, to })),
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
vi.mock("@/lib/events/emitters", () => ({
  emitOpportunityStageChanged: async (_t: string, p: { from: string; to: string }) => { state.stageEvents.push(p); },
  emitOpportunityClosed: async () => {}, emitOpportunityUpdated: async () => {}, emitOpportunityCreated: async () => {},
}));

import { NextRequest } from "next/server";
import { PATCH as stdPatch } from "./[id]/route";
import { GET as bidsGet, POST as bidsPost } from "./[id]/tender/bids/route";
import { GET as compareGet } from "./[id]/tender/bids/compare/route";
import { GET as callsGet, POST as callsPost } from "./[id]/tender/calls/route";
import { PATCH as callPatch, DELETE as callDelete } from "./[id]/tender/calls/[callId]/route";
import { PATCH as outcomePatch } from "./[id]/tender/outcome/route";

const req = (method: string, body?: unknown, url = "http://internal.invalid/x") => new NextRequest(new URL(url), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const cctx = (id: string, callId: string) => ({ params: Promise.resolve({ id, callId }) });
const as = (id: string, role: "admin" | "member" = "member") => { state.user = { id, email: `${id.slice(0, 2)}@t1.test` }; state.role = role; };
const deal = () => state.db.rows("opportunities").find((o) => o.id === OPP)!;
const versions = (opp = OPP) => state.db.rows("tender_bid_versions").filter((v) => v.opportunity_id === opp);
const calls = (opp = OPP) => state.db.rows("deal_activities").filter((v) => v.opportunity_id === opp);
const tenderRow = (opp = OPP) => state.db.rows("opportunity_tenders").find((t) => t.opportunity_id === opp)!;

function oppRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, tenant_id: T1, ref: `OPP-${id.slice(-1)}`, title: "Valves for Plant 4", account_id: "acc", contact_id: null, stage: "estimating", outcome: "open", loss_reason: null,
    loss_note: null, probability: 25, probability_override: null, owner_id: ME, team: [], expected_close: null, amount: 0, currency: "SAR", competitor: null, custom_data: null,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closed_at: null, ...over,
  };
}
const tenderFor = (opportunity_id: string, tenant_id = T1) => ({
  opportunity_id, tenant_id, tender_no: `ARB-${opportunity_id.slice(-1)}`, issuer_name: "Aramco", portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z", bid_bond_amount: null,
  bid_bond_currency: null, bid_bond_expiry: null, addenda_count: 0, decision: "go", decision_reason: null, decided_by: null, decided_at: null, source_email_id: null,
  custom_data: null, reminders_sent: [], bond_status: "held", bond_released_at: null, bond_released_by: null, award_value: null, winning_bidder: null, award_date: null,
  outcome_note: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
});
const lineRow = (id: string, sl_no: string, description: string, qty: number, rate: number, over: Record<string, unknown> = {}) => ({
  id, tenant_id: T1, opportunity_id: OPP, sl_no, description, uom: "Nos", qty, rate, discount_pct: 0, amount: qty * rate, product_id: null, group_id: null, group_type: null,
  break_of: null, is_selected: true, show_on_pdf: true, ...over,
});
const L1 = uid(11), L2 = uid(12), L3 = uid(13);

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, slug: "kamco", name: "KAMCO", is_demo: false, config: {}, custom_domain: "kamco.example.com" }, { id: T2, slug: "other", name: "Other", is_demo: false, config: {}, custom_domain: null }],
    tenant_users: [{ tenant_id: T1, user_id: ME, role: "member", display_name: "S. Khan" }, { tenant_id: T1, user_id: COLLEAGUE, role: "member" }, { tenant_id: T1, user_id: BOSS, role: "admin" }],
    opportunities: [oppRow(OPP_STD, { stage: "qualify" }), oppRow(OPP), oppRow(OPP_T2, { tenant_id: T2 })],
    opportunity_tenders: [tenderFor(OPP), tenderFor(OPP_T2, T2)],
    opportunity_lines: [lineRow(L1, "1", "Gate valve 100mm", 4, 100), lineRow(L2, "2", "Pipe 110mm", 100, 12), lineRow(L3, "3", "Mobilisation", 1, 5000, { uom: "lot" })],
    // The client's file lists the lines in the opposite order to the sl_no.
    tender_boq_lines: [
      { id: uid(21), tenant_id: T1, opportunity_id: OPP, line_id: L3, row_no: 5, price_source: null, unit_cost: null, markup_pct: null },
      { id: uid(22), tenant_id: T1, opportunity_id: OPP, line_id: L2, row_no: 8, price_source: "supplier", unit_cost: 7.5, markup_pct: 60 },
      { id: uid(23), tenant_id: T1, opportunity_id: OPP, line_id: L1, row_no: 9, price_source: "bom", unit_cost: 60, markup_pct: 66.66 },
    ],
  });
  state.db.unique("tender_bid_versions", (e, n) => e.opportunity_id === n.opportunity_id && e.version_no === n.version_no);
  state.db.users.set(ME, { email: "me@kamco.test", name: "S. Khan" });
  state.features = { pipeline: true, gcc_tender: true };
  state.touched = []; state.changes = []; state.stageEvents = [];
  state.edit = true;
  as(ME);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const submit = (body: unknown = {}, id = OPP) => bidsPost(req("POST", body), ctx(id));
const revise = () => stdPatch(req("PATCH", { stage: "estimating", outcome: "open" }), ctx(OPP));

describe("the gate: flag off, a standard deal, another workspace", () => {
  it("with gcc_tender off every new route answers 404 and no table is read", async () => {
    state.features = { pipeline: true };
    const responses = await Promise.all([
      bidsGet(req("GET"), ctx(OPP)), submit(), compareGet(req("GET", undefined, "http://internal.invalid/x?from=1&to=2"), ctx(OPP)),
      callsGet(req("GET"), ctx(OPP)), callsPost(req("POST", { summary: "x" }), ctx(OPP)), callPatch(req("PATCH", { next_step_done: true }), cctx(OPP, uid(1))),
      callDelete(req("DELETE"), cctx(OPP, uid(1))), outcomePatch(req("PATCH", {}), ctx(OPP)),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(404));
    expect(state.touched).toEqual([]);
    expect(deal().stage).toBe("estimating");
  });

  it("a standard deal (no tender row) is a 404 on every route and never reaches the new tables", async () => {
    const responses = await Promise.all([
      bidsGet(req("GET"), ctx(OPP_STD)), submit({}, OPP_STD), compareGet(req("GET", undefined, "http://internal.invalid/x?from=1&to=2"), ctx(OPP_STD)),
      callsGet(req("GET"), ctx(OPP_STD)), callsPost(req("POST", { summary: "x" }), ctx(OPP_STD)), outcomePatch(req("PATCH", {}), ctx(OPP_STD)),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(404));
    for (const t of NEW_TABLES) expect(state.touched, t).not.toContain(t);
    expect(state.db.rows("deal_activities")).toHaveLength(0);
  });

  it("another workspace's tender deal is a 404 as well", async () => {
    expect((await bidsGet(req("GET"), ctx(OPP_T2))).status).toBe(404);
    expect((await submit({}, OPP_T2)).status).toBe(404);
    expect((await callsPost(req("POST", { summary: "x" }), ctx(OPP_T2))).status).toBe(404);
    expect(state.db.rows("tender_bid_versions")).toHaveLength(0);
  });

  it("a view-only person can read but cannot submit, log, change or record", async () => {
    state.edit = false;
    expect((await bidsGet(req("GET"), ctx(OPP))).status).toBe(200);
    expect((await callsGet(req("GET"), ctx(OPP))).status).toBe(200);
    expect((await submit()).status).toBe(403);
    expect((await callsPost(req("POST", { summary: "x" }), ctx(OPP))).status).toBe(403);
    expect((await outcomePatch(req("PATCH", {}), ctx(OPP))).status).toBe(403);
    expect(state.db.rows("tender_bid_versions")).toHaveLength(0);
  });
});

describe("submitting a bid", () => {
  it("saves version 1 in the client's file order, moves the deal to Submitted through the deal's own stage rules, and logs it", async () => {
    const res = await submit({ note: "First offer" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ version_no: 1, total: 400 + 1200 + 5000, line_count: 3, stage_moved: true, stage_error: null });
    const [v] = versions();
    expect(v).toMatchObject({ tenant_id: T1, version_no: 1, submitted_by: ME, currency: "SAR", total: 6600, line_count: 3, note: "First offer", revision_reason: null });
    expect((v.lines as { item_no: string }[]).map((l) => l.item_no)).toEqual(["3", "2", "1"]);
    expect(deal()).toMatchObject({ stage: "submitted", outcome: "open", probability: 40 });
    expect(state.stageEvents).toEqual([expect.objectContaining({ from: "estimating", to: "submitted" })]);
    expect(state.changes.find((c) => c.objectType === "opportunity_tenders")?.changes?.[0]).toMatchObject({ field: "bid submitted", to: expect.stringContaining("version 1") });
  });

  it("never stores a cost or a markup in the snapshot, though the BOQ rows and deal lines hold them", async () => {
    state.db.rows("opportunity_lines")[0].unit_cost = 61.5;
    state.db.rows("opportunity_lines")[0].pricing_flags = [{ code: "floor" }];
    await submit();
    const text = JSON.stringify(versions()[0]);
    for (const leak of ["unit_cost", "markup", "pricing_flags", "66.66", "61.5", "cost"]) expect(text, leak).not.toContain(leak);
    expect((versions()[0].lines as { price_source: string | null }[]).map((l) => l.price_source)).toEqual([null, "Supplier", "BOM / estimate"]);
  });

  it("is append-only and has no cap: version 2 needs a reason, version 41 follows 40, and version 1 is never touched", async () => {
    await submit();
    const first = JSON.stringify(versions()[0]);
    // A second submit straight away is refused: the deal is Submitted.
    const again = await submit({ revision_reason: "Too soon" });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/Revise bid/);

    expect((await revise()).status).toBe(200);
    expect(deal().stage).toBe("estimating");
    const noReason = await submit({});
    expect(noReason.status).toBe(422);
    expect((await noReason.json()).code).toBe("reason_required");
    expect(versions()).toHaveLength(1);
    expect(deal().stage).toBe("estimating");

    state.db.rows("opportunity_lines")[1].rate = 11;
    state.db.rows("opportunity_lines")[1].amount = 1100;
    const v2 = await submit({ revision_reason: "Addendum 2: pipe price update" });
    expect(v2.status).toBe(201);
    expect(versions().map((v) => v.version_no)).toEqual([1, 2]);
    expect(versions()[1]).toMatchObject({ total: 6500, revision_reason: "Addendum 2: pipe price update" });
    expect(JSON.stringify(versions()[0])).toBe(first);

    // No cap: seed up to version 40 and submit the next.
    for (let n = 3; n <= 40; n++) state.db.rows("tender_bid_versions").push({ id: uid(1000 + n), tenant_id: T1, opportunity_id: OPP, version_no: n, total: 1, line_count: 0, lines: [], submitted_by: ME, submitted_at: "2026-10-20T00:00:00Z", revision_reason: "r", note: null, currency: "SAR" });
    deal().stage = "estimating";
    const v41 = await submit({ revision_reason: "Round forty-one" });
    expect(v41.status).toBe(201);
    expect((await v41.json()).version_no).toBe(41);
    expect(versions()).toHaveLength(41);
  });

  it("respects the stage rules: not from Received or Bid/No-bid, not once closed, and not with no lines", async () => {
    for (const stage of ["received", "bid_no_bid", "submitted"]) {
      deal().stage = stage;
      expect((await submit()).status, stage).toBe(409);
    }
    deal().stage = "bid_lost"; deal().outcome = "lost";
    expect((await submit()).status).toBe(409);
    deal().stage = "estimating"; deal().outcome = "open";
    state.db.tables.opportunity_lines = [];
    expect((await submit()).status).toBe(409);
    expect(state.db.rows("tender_bid_versions")).toHaveLength(0);
    expect(deal().stage).toBe("estimating");
  });

  it("can be submitted from Clarifications (the deal goes back to Submitted)", async () => {
    deal().stage = "clarifications";
    expect((await submit()).status).toBe(201);
    expect(deal().stage).toBe("submitted");
  });

  it("two people submitting at once: the second is told, no second version, the stage is unchanged by the loser", async () => {
    // The unique index fires: a row for version 1 appears between the read and the insert.
    const real = state.db.from.bind(state.db);
    let injected = false;
    state.db.from = ((table: string) => {
      const q = real(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (table === "tender_bid_versions" && !injected) {
        const insert = q.insert.bind(q);
        q.insert = (p: unknown) => {
          injected = true;
          state.db.rows("tender_bid_versions").push({ id: uid(77), tenant_id: T1, opportunity_id: OPP, version_no: 1, total: 1, line_count: 0, lines: [], submitted_by: COLLEAGUE, submitted_at: "2026-10-26T00:00:00Z", revision_reason: null, note: null, currency: "SAR" });
          return insert(p);
        };
      }
      return q;
    }) as unknown as typeof state.db.from;
    const res = await submit();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("version_taken");
    expect(deal().stage).toBe("estimating");
    expect(versions()).toHaveLength(1);
  });

  it("answers 503 and changes nothing while migration 0225 is pending", async () => {
    state.db.missing.add("tender_bid_versions");
    const res = await submit();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/0225/);
    expect(deal().stage).toBe("estimating");
    const list = await bidsGet(req("GET"), ctx(OPP));
    expect((await list.json())).toEqual({ versions: [], pending: true });
  });

  it("the workspace is the session's: a tenant_id or a submitted_by in the body is ignored", async () => {
    await submit({ tenant_id: T2, submitted_by: COLLEAGUE, version_no: 9, total: 1 });
    expect(versions()[0]).toMatchObject({ tenant_id: T1, submitted_by: ME, version_no: 1, total: 6600 });
  });

  it("lists the versions newest first without their lines", async () => {
    await submit();
    await revise();
    await submit({ revision_reason: "Negotiated" });
    const j = await (await bidsGet(req("GET"), ctx(OPP))).json();
    expect(j.pending).toBe(false);
    expect(j.versions.map((v: { version_no: number }) => v.version_no)).toEqual([2, 1]);
    expect(JSON.stringify(j)).not.toContain('"lines"');
    expect(j.versions[1].submitted_by_name).toBe("S. Khan");
  });
});

describe("comparing versions", () => {
  async function twoVersions() {
    await submit();
    await revise();
    state.db.rows("opportunity_lines")[0].rate = 90;
    state.db.rows("opportunity_lines")[0].amount = 360;
    state.db.rows("opportunity_lines").push(lineRow(uid(14), "4", "Testing and commissioning", 1, 800, { uom: "lot" }));
    state.db.rows("opportunity_lines").splice(2, 1);
    await submit({ revision_reason: "Scope: testing added, mobilisation by client" });
  }
  const compare = (from: string, to: string, id = OPP) => compareGet(req("GET", undefined, `http://internal.invalid/x?from=${from}&to=${to}`), ctx(id));

  it("reports added, removed and changed lines and the total's change in amount and percent", async () => {
    await twoVersions();
    const res = await compare("1", "2");
    expect(res.status).toBe(200);
    const { diff, currency } = await res.json();
    expect(currency).toBe("SAR");
    expect(diff.added.map((l: { item_no: string }) => l.item_no)).toEqual(["4"]);
    expect(diff.removed.map((l: { item_no: string }) => l.item_no)).toEqual(["3"]);
    expect(diff.changed.map((c: { item_no: string; fields: string[] }) => [c.item_no, c.fields])).toEqual([["1", ["rate"]]]);
    expect(diff.total_from).toBe(6600);
    expect(diff.total_to).toBe(360 + 1200 + 800);
    expect(diff.delta).toBe(2360 - 6600);
    expect(diff.delta_pct).toBe(-64.24);
  });

  it("validates the numbers and refuses two equal versions or a version that is not there", async () => {
    await twoVersions();
    expect((await compare("1", "1")).status).toBe(422);
    expect((await compare("a", "2")).status).toBe(400);
    expect((await compare("0", "2")).status).toBe(400);
    expect((await compare("1", "9")).status).toBe(404);
  });

  it("never reaches another workspace's versions", async () => {
    state.db.rows("tender_bid_versions").push({ id: uid(90), tenant_id: T2, opportunity_id: OPP_T2, version_no: 1, total: 1, line_count: 0, lines: [], currency: "SAR" }, { id: uid(91), tenant_id: T2, opportunity_id: OPP_T2, version_no: 2, total: 2, line_count: 0, lines: [], currency: "SAR" });
    expect((await compare("1", "2", OPP_T2)).status).toBe(404);
    expect((await compare("1", "2")).status).toBe(404);
  });
});

describe("logged calls", () => {
  const log = (body: Record<string, unknown>) => callsPost(req("POST", body), ctx(OPP));

  it("logs a call with the session's user and workspace, and writes it to the change history", async () => {
    const res = await log({ summary: "Consultant confirmed the addendum", with_whom: "R. Haddad", next_step: "Send revised BOQ", next_step_due: "2026-10-28", logged_by: COLLEAGUE, tenant_id: T2, next_step_done_at: "2026-10-01T00:00:00Z" });
    expect(res.status).toBe(201);
    expect(calls()[0]).toMatchObject({ tenant_id: T1, logged_by: ME, kind: "call", summary: "Consultant confirmed the addendum", next_step: "Send revised BOQ", next_step_due: "2026-10-28" });
    expect(calls()[0].next_step_done_at).toBeUndefined();
    expect(state.changes.at(-1)).toMatchObject({ objectType: "opportunity_tenders", objectId: OPP });
    expect(state.changes.at(-1)?.changes?.map((c) => c.field)).toEqual(["call logged", "next step"]);
  });

  it("holds the limits: the summary, a due date without a step, the kind, the date, the cap per deal", async () => {
    expect((await log({})).status).toBe(422);
    expect((await log({ summary: "x".repeat(2001) })).status).toBe(422);
    expect((await log({ summary: "x", kind: "email" })).status).toBe(422);
    expect((await log({ summary: "x", next_step_due: "2026-11-01" })).status).toBe(422);
    expect((await log({ summary: "x", next_step: "y", next_step_due: "tomorrow" })).status).toBe(422);
    expect((await log({ summary: "x", occurred_at: "2027-01-01T00:00:00Z" })).status).toBe(422);
    expect(calls()).toHaveLength(0);
    for (let i = 0; i < 1000; i++) state.db.rows("deal_activities").push({ id: uid(5000 + i), tenant_id: T1, opportunity_id: OPP, kind: "note", summary: "s", occurred_at: "2026-10-01T00:00:00Z" });
    const full = await log({ summary: "one too many" });
    expect(full.status).toBe(409);
    expect(calls()).toHaveLength(1000);
  });

  it("lists newest first and tells each person what they may change", async () => {
    state.db.rows("deal_activities").push(
      { id: uid(1), tenant_id: T1, opportunity_id: OPP, kind: "call", summary: "older", occurred_at: "2026-10-10T00:00:00Z", logged_by: ME, next_step: null, next_step_due: null, next_step_done_at: null },
      { id: uid(2), tenant_id: T1, opportunity_id: OPP, kind: "meeting", summary: "newer", occurred_at: "2026-10-20T00:00:00Z", logged_by: COLLEAGUE, next_step: null, next_step_due: null, next_step_done_at: null },
      { id: uid(3), tenant_id: T2, opportunity_id: OPP_T2, kind: "call", summary: "other workspace", occurred_at: "2026-10-25T00:00:00Z", logged_by: ME },
    );
    const j = await (await callsGet(req("GET"), ctx(OPP))).json();
    expect(j.calls.map((c: { summary: string }) => c.summary)).toEqual(["newer", "older"]);
    expect(j.calls.map((c: { can_change: boolean }) => c.can_change)).toEqual([false, true]);
    as(BOSS, "admin");
    expect((await (await callsGet(req("GET"), ctx(OPP))).json()).calls.map((c: { can_change: boolean }) => c.can_change)).toEqual([true, true]);
  });

  it("anyone who may edit the deal can tick a next step done, but only the author or an admin can edit or remove the entry", async () => {
    await log({ summary: "Call with client", next_step: "Send price", next_step_due: "2026-10-20" });
    const id = calls()[0].id as string;
    as(COLLEAGUE);
    expect((await callPatch(req("PATCH", { next_step_done: true }), cctx(OPP, id))).status).toBe(200);
    expect(calls()[0].next_step_done_at).toBeTruthy();
    expect((await callPatch(req("PATCH", { summary: "Rewritten" }), cctx(OPP, id))).status).toBe(403);
    expect((await callDelete(req("DELETE"), cctx(OPP, id))).status).toBe(403);
    expect(calls()[0].summary).toBe("Call with client");
    as(ME);
    expect((await callPatch(req("PATCH", { summary: "Clearer wording" }), cctx(OPP, id))).status).toBe(200);
    expect((await callPatch(req("PATCH", { next_step_done: false }), cctx(OPP, id))).status).toBe(200);
    expect(calls()[0]).toMatchObject({ summary: "Clearer wording", next_step_done_at: null });
    as(BOSS, "admin");
    expect((await callDelete(req("DELETE"), cctx(OPP, id))).status).toBe(204);
    expect(calls()).toHaveLength(0);
    expect(state.changes.at(-1)?.changes?.[0]).toMatchObject({ field: "call removed" });
  });

  it("a due date cannot be set on an entry that has no next step, and a new next step starts not-done", async () => {
    await log({ summary: "Call", next_step: "Old step", next_step_due: "2026-10-20" });
    const id = calls()[0].id as string;
    await callPatch(req("PATCH", { next_step_done: true }), cctx(OPP, id));
    await callPatch(req("PATCH", { next_step: "New step" }), cctx(OPP, id));
    expect(calls()[0]).toMatchObject({ next_step: "New step", next_step_done_at: null });
    expect((await callPatch(req("PATCH", { next_step: "" }), cctx(OPP, id))).status).toBe(422);
  });

  it("another workspace's call id, or one under another deal, is a 404", async () => {
    state.db.rows("deal_activities").push({ id: uid(8), tenant_id: T2, opportunity_id: OPP_T2, kind: "call", summary: "x", occurred_at: "2026-10-01T00:00:00Z", logged_by: ME });
    state.db.rows("deal_activities").push({ id: uid(9), tenant_id: T1, opportunity_id: OPP_STD, kind: "call", summary: "y", occurred_at: "2026-10-01T00:00:00Z", logged_by: ME });
    for (const id of [uid(8), uid(9), "not-a-uuid"]) {
      expect((await callPatch(req("PATCH", { next_step_done: true }), cctx(OPP, id))).status, id).toBe(404);
      expect((await callDelete(req("DELETE"), cctx(OPP, id))).status, id).toBe(404);
    }
    expect(state.db.rows("deal_activities")).toHaveLength(2);
  });

  it("answers 503 while migration 0225 is pending", async () => {
    state.db.missing.add("deal_activities");
    expect((await log({ summary: "x" })).status).toBe(503);
    expect(await (await callsGet(req("GET"), ctx(OPP))).json()).toEqual({ calls: [], pending: true });
  });
});

describe("the outcome facts", () => {
  const record = (body: Record<string, unknown>) => outcomePatch(req("PATCH", body), ctx(OPP));

  it("are recorded only once the tender is Awarded, Lost or No-bid", async () => {
    const res = await record({ outcome_note: "too early" });
    expect(res.status).toBe(409);
    expect(tenderRow().outcome_note).toBeNull();
  });

  it("Lost requires the reason and who won; the winner is also saved as the deal's competitor", async () => {
    deal().stage = "bid_lost"; deal().outcome = "lost"; deal().loss_reason = "other";
    expect((await record({ award_value: 950000 })).status).toBe(422);
    expect((await record({ winning_bidder: "Rival Co", loss_reason: "silent-ish" })).status).toBe(422);
    expect(tenderRow().winning_bidder).toBeNull();
    const ok = await record({ winning_bidder: "Rival Co", loss_reason: "price", award_value: "950,000", award_date: "2026-11-12", outcome_note: "Debrief next week", tenant_id: T2 });
    expect(ok.status).toBe(200);
    expect(tenderRow()).toMatchObject({ winning_bidder: "Rival Co", award_value: 950000, award_date: "2026-11-12", outcome_note: "Debrief next week" });
    expect(deal()).toMatchObject({ competitor: "Rival Co", loss_reason: "price" });
    expect(tenderRow(OPP_T2).winning_bidder).toBeNull();
    expect(state.changes.map((c) => c.objectType).sort()).toEqual(["opportunities", "opportunity_tenders"]);
  });

  it("Awarded saves the value and date and leaves the deal's loss columns alone", async () => {
    deal().stage = "awarded"; deal().outcome = "won";
    expect((await record({ award_value: 1_250_000, award_date: "2026-11-10", winning_bidder: "ignored", loss_reason: "price" })).status).toBe(200);
    expect(tenderRow()).toMatchObject({ award_value: 1250000, award_date: "2026-11-10", winning_bidder: null });
    expect(deal()).toMatchObject({ competitor: null, loss_reason: null });
  });

  it("No-bid takes only a note; bad values are refused", async () => {
    deal().stage = "no_bid"; deal().outcome = "dropped";
    expect((await record({ outcome_note: "Outside our scope", award_value: 5 })).status).toBe(200);
    expect(tenderRow()).toMatchObject({ outcome_note: "Outside our scope", award_value: null });
    deal().stage = "awarded"; deal().outcome = "won";
    expect((await record({ award_value: -5 })).status).toBe(422);
    expect((await record({ award_date: "soon" })).status).toBe(422);
  });

  it("answers 503 while the outcome columns are missing, and changes nothing", async () => {
    deal().stage = "awarded"; deal().outcome = "won";
    state.db.missingColumns.opportunity_tenders = new Set(["award_value"]);
    const res = await record({ award_value: 10 });
    expect(res.status).toBe(503);
    expect(tenderRow().award_value).toBeNull();
  });
});

describe("the stage move to Lost", () => {
  it("needs the competitor, on the body or already on the deal", async () => {
    const lost = (body: Record<string, unknown>) => stdPatch(req("PATCH", { stage: "bid_lost", loss_reason: "price", ...body }), ctx(OPP));
    expect((await lost({})).status).toBe(422);
    expect(deal().stage).toBe("estimating");
    expect((await lost({ competitor: "Rival Co" })).status).toBe(200);
    expect(deal()).toMatchObject({ stage: "bid_lost", competitor: "Rival Co" });
    deal().stage = "estimating"; deal().outcome = "open";
    expect((await lost({})).status).toBe(200);
  });

  it("leaves a standard deal alone: it can be lost with no competitor", async () => {
    state.db.rows("opportunities").find((o) => o.id === OPP_STD)!.stage = "qualify";
    const res = await stdPatch(req("PATCH", { stage: "lost", loss_reason: "price" }), ctx(OPP_STD));
    expect(res.status).not.toBe(422);
  });
});
