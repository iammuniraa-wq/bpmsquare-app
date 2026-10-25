import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, slice 1. Two things are proved here against an in-memory database:
//
//  1. THE ONE HARD RULE -- the standard flow does not move. With the flag off, or with the flag on but no tender row on the
//     deal, a standard deal is created and its stages validated exactly as before, and the tender tables are not even read
//     (flag off). The tender stage list reaches only a deal that has a tender row.
//  2. The tender routes: create (deal + tender row together), read, update (explicit allow-list) and the bid decision (reason
//     required for a no-go; who and when from the session), every foreign id checked against the tenant.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  touched: [] as string[],
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  created: [] as unknown[],
  user: { id: "u1", email: "me@t1.test" },
  seq: 0,
}));

const T1 = "t1";
const T2 = "t2";
const U1 = "11111111-1111-4111-8111-111111111111";
const U_OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACC_T2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPP_TENDER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const MAIL_T1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const MAIL_T2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({
    from: (t: string) => { state.touched.push(t); return state.db.from(t); },
    auth: state.db.auth,
  }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: "admin", supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: Record<string, unknown>) => unknown } }, table: string, _tid: string, record: Record<string, unknown>) => {
    const id = `00000000-0000-4000-8000-${String(++state.seq).padStart(12, "0")}`;
    const row = { id, ref: `OPP-${state.seq}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...record };
    state.db.rows(table).push(row);
    void admin;
    return { data: { id, ref: row.ref }, error: null };
  },
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: (_t: string, b: Record<string, unknown>, a: Record<string, unknown>) =>
    Object.entries(a).filter(([k, v]) => JSON.stringify(b[k] ?? null) !== JSON.stringify(v ?? null)).map(([field, to]) => ({ field, from: b[field] ?? null, to })),
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
vi.mock("@/lib/events/emitters", () => ({
  emitOpportunityCreated: async (_t: string, p: unknown) => { state.created.push(p); },
  emitOpportunityStageChanged: async () => {}, emitOpportunityClosed: async () => {}, emitOpportunityUpdated: async () => {},
}));

import { NextRequest } from "next/server";
import { POST as stdPost } from "./route";
import { PATCH as stdPatch } from "./[id]/route";
import { POST as tenderPost } from "./tender/route";
import { GET as tenderGet, PATCH as tenderPatch } from "./[id]/tender/route";
import { POST as approvalPost } from "./[id]/tender/approval/route";

const req = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const tenderTables = () => state.touched.filter((t) => t === "opportunity_tenders" || t === "deal_types");
const opps = () => state.db.rows("opportunities");
const tenders = () => state.db.rows("opportunity_tenders");

function opp(id: string, over: Record<string, unknown> = {}) {
  return {
    id, tenant_id: T1, ref: `OPP-${id.slice(-1)}`, title: "A deal", account_id: ACC, contact_id: null, stage: "qualify", outcome: "open", loss_reason: null,
    loss_note: null, probability: 20, probability_override: null, owner_id: U1, team: [], expected_close: null, amount: 0, custom_data: null,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closed_at: null, ...over,
  };
}
function tenderRow(over: Record<string, unknown> = {}) {
  return {
    opportunity_id: OPP_TENDER, tenant_id: T1, deal_type_id: null, tender_no: "ARB-1", issuer_name: "Aramco", issuer_account_id: null, portal: "ariba",
    closing_at: "2026-10-30T09:00:00.000Z", bid_bond_amount: null, bid_bond_currency: null, bid_bond_expiry: null, addenda_count: 0,
    decision: null, decision_reason: null, decided_by: null, decided_at: null, source_email_id: null, custom_data: null, reminders_sent: [7],
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over,
  };
}

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, config: {} }, { id: T2, config: {} }],
    accounts: [{ id: ACC, tenant_id: T1, name: "Acme" }, { id: ACC_T2, tenant_id: T2, name: "Other" }],
    tenant_users: [{ tenant_id: T1, user_id: U1 }, { tenant_id: T2, user_id: U_OTHER_TENANT }],
    inbound_emails: [{ id: MAIL_T1, tenant_id: T1 }, { id: MAIL_T2, tenant_id: T2 }],
    opportunities: [opp(OPP_STD), opp(OPP_TENDER, { stage: "estimating", probability: 25, ref: "OPP-2", title: "ARB-1 · Aramco" }), opp(OPP_T2, { tenant_id: T2 })],
  });
  state.db.unique("opportunity_tenders", (e, n) => e.tenant_id === n.tenant_id && e.tender_no != null && e.tender_no === n.tender_no);
  state.features = { pipeline: true };
  state.touched = []; state.changes = []; state.created = []; state.seq = 0;
  state.user = { id: U1, email: "me@t1.test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── 1. The standard flow does not move ─────────────────────────────────────────────────────────────────────────────

describe("the standard flow with the flag OFF", () => {
  it("creates a deal exactly as before and never touches a tender table", async () => {
    const res = await stdPost(req("POST", { account_id: ACC, title: "New elevator job" }));
    expect(res.status).toBe(201);
    const made = opps().find((o) => o.title === "New elevator job");
    expect(made).toMatchObject({ stage: "qualify", outcome: "open", probability: 20, account_id: ACC, owner_id: U1, source: "direct" });
    expect(tenderTables()).toEqual([]);
  });

  it("validates a stage change against the workspace's own list and never reads a tender table", async () => {
    const won = await stdPatch(req("PATCH", { stage: "won" }), ctx(OPP_STD));
    expect(won.status).toBe(200);
    expect(opps().find((o) => o.id === OPP_STD)).toMatchObject({ stage: "won", outcome: "won", probability: 100 });
    expect(opps().find((o) => o.id === OPP_STD)?.closed_at).toBeTruthy();

    const tenderStage = await stdPatch(req("PATCH", { stage: "awarded" }), ctx(OPP_STD));
    expect(tenderStage.status).toBe(400);
    expect((await tenderStage.json()).error).toMatch(/Unknown stage/);
    expect(tenderTables()).toEqual([]);
  });

  it("a lost standard stage still files its reason and a reopened one clears it", async () => {
    await stdPatch(req("PATCH", { stage: "lost" }), ctx(OPP_STD));
    expect(opps().find((o) => o.id === OPP_STD)).toMatchObject({ stage: "lost", outcome: "lost", loss_reason: "other", probability: 0 });
    await stdPatch(req("PATCH", { stage: "qualify", outcome: "open" }), ctx(OPP_STD));
    expect(opps().find((o) => o.id === OPP_STD)).toMatchObject({ stage: "qualify", outcome: "open", loss_reason: null, closed_at: null });
  });

  it("the tender create route does not exist for the workspace: 404, nothing written", async () => {
    const res = await tenderPost(req("POST", { account_id: ACC, tender: { tender_no: "X" } }));
    expect(res.status).toBe(404);
    expect(opps()).toHaveLength(3);
    expect(tenders()).toHaveLength(0);
    for (const call of [() => tenderGet(req("GET"), ctx(OPP_TENDER)), () => tenderPatch(req("PATCH", { tender_no: "Z" }), ctx(OPP_TENDER)), () => approvalPost(req("POST", { decision: "go", reason: "x" }), ctx(OPP_TENDER))]) {
      expect((await call()).status).toBe(404);
    }
  });
});

describe("the standard flow with the flag ON but no tender block", () => {
  beforeEach(() => { state.features = { pipeline: true, gcc_tender: true }; });

  it("a standard create is the same deal: initial stage, no tender row, no deal type", async () => {
    const res = await stdPost(req("POST", { account_id: ACC, title: "Plain deal" }));
    expect(res.status).toBe(201);
    expect(opps().find((o) => o.title === "Plain deal")).toMatchObject({ stage: "qualify", outcome: "open", probability: 20 });
    expect(tenders()).toHaveLength(0);
    expect(state.db.rows("deal_types")).toHaveLength(0);
  });

  it("a standard deal's stage change validates against the standard list, as before", async () => {
    expect((await stdPatch(req("PATCH", { stage: "awarded" }), ctx(OPP_STD))).status).toBe(400);
    expect((await stdPatch(req("PATCH", { stage: "negotiate" }), ctx(OPP_STD))).status).toBe(200);
    expect(opps().find((o) => o.id === OPP_STD)).toMatchObject({ stage: "negotiate", outcome: "open", probability: 75 });
    expect((await stdPatch(req("PATCH", { stage: "won" }), ctx(OPP_STD))).status).toBe(200);
    expect(opps().find((o) => o.id === OPP_STD)).toMatchObject({ outcome: "won", probability: 100 });
  });

  it("with the tender table missing (migration pending) every deal falls back to the standard list, nothing crashes", async () => {
    state.db.missing.add("opportunity_tenders");
    expect((await stdPatch(req("PATCH", { stage: "won" }), ctx(OPP_TENDER))).status).toBe(200);
    expect(opps().find((o) => o.id === OPP_TENDER)).toMatchObject({ stage: "won", outcome: "won" });
  });
});

describe("a tender deal's stages (flag ON, tender row present)", () => {
  beforeEach(() => {
    state.features = { pipeline: true, gcc_tender: true };
    state.db.rows("opportunity_tenders").push(tenderRow());
  });

  it("moves through the tender stages with their probability hints", async () => {
    expect((await stdPatch(req("PATCH", { stage: "submitted", outcome: "open" }), ctx(OPP_TENDER))).status).toBe(200);
    expect(opps().find((o) => o.id === OPP_TENDER)).toMatchObject({ stage: "submitted", outcome: "open", probability: 40 });
  });

  it("Awarded, Lost and No-bid set the same outcome fields a standard closed stage sets", async () => {
    await stdPatch(req("PATCH", { stage: "awarded" }), ctx(OPP_TENDER));
    const won = opps().find((o) => o.id === OPP_TENDER)!;
    expect(won).toMatchObject({ stage: "awarded", outcome: "won", probability: 100, loss_reason: null });
    expect(won.closed_at).toBeTruthy();

    await stdPatch(req("PATCH", { stage: "bid_lost", loss_reason: "price" }), ctx(OPP_TENDER));
    expect(opps().find((o) => o.id === OPP_TENDER)).toMatchObject({ stage: "bid_lost", outcome: "lost", loss_reason: "price", probability: 0 });

    // No-bid needs an approved no-go (slice 1b); the approval flow itself is proved in tender.approval.routes.test.ts.
    state.db.rows("approval_requests").push({ id: "ar-1", tenant_id: T1, object_type: "opportunity_tenders", object_id: OPP_TENDER, kind: "tender_bid_decision", proposed_value: "no_go", reason: "r", requested_by: U1, status: "approved", decided_by: "boss", decided_at: "2026-10-02T00:00:00Z", created_at: "2026-10-01T00:00:00Z" });
    await stdPatch(req("PATCH", { stage: "no_bid" }), ctx(OPP_TENDER));
    expect(opps().find((o) => o.id === OPP_TENDER)).toMatchObject({ stage: "no_bid", outcome: "dropped", loss_reason: "price" });

    await stdPatch(req("PATCH", { stage: "received", outcome: "open" }), ctx(OPP_TENDER));
    expect(opps().find((o) => o.id === OPP_TENDER)).toMatchObject({ stage: "received", outcome: "open", loss_reason: null, closed_at: null });
  });

  it("a standard stage is refused for a tender deal", async () => {
    const res = await stdPatch(req("PATCH", { stage: "qualify" }), ctx(OPP_TENDER));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unknown stage/);
  });

  it("another deal of the same workspace stays on the standard list", async () => {
    expect((await stdPatch(req("PATCH", { stage: "awarded" }), ctx(OPP_STD))).status).toBe(400);
  });
});

// ── 2. Creating a tender ──────────────────────────────────────────────────────────────────────────────────────────

describe("POST /api/opportunities/tender", () => {
  beforeEach(() => { state.features = { pipeline: true, gcc_tender: true }; });
  const body = (over: Record<string, unknown> = {}) => ({ account_id: ACC, tender: { tender_no: "ARB-4400123", issuer_name: "Saudi Aramco", portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z" }, ...over });

  it("makes the deal and its tender row in one call, at the first tender stage", async () => {
    const res = await tenderPost(req("POST", body({ source: "referral" })));
    expect(res.status).toBe(201);
    const j = await res.json();
    const deal = opps().find((o) => o.id === j.id)!;
    expect(deal).toMatchObject({ tenant_id: T1, account_id: ACC, stage: "received", outcome: "open", probability: 10, title: "ARB-4400123 · Saudi Aramco", owner_id: U1, source: "referral", expected_close: "2026-10-30" });
    const t = tenders().find((r) => r.opportunity_id === j.id)!;
    expect(t).toMatchObject({ tenant_id: T1, tender_no: "ARB-4400123", issuer_name: "Saudi Aramco", portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z", addenda_count: 0, source_email_id: null, reminders_sent: [] });
    expect(t.deal_type_id).toBeTruthy();
    expect(state.created).toHaveLength(1);
  });

  it("keeps one 'tender' deal type per workspace however many tenders are made", async () => {
    await tenderPost(req("POST", body()));
    await tenderPost(req("POST", body({ tender: { tender_no: "ARB-2" } })));
    const types = state.db.rows("deal_types");
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ tenant_id: T1, code: "tender" });
  });

  it("logs the deal and the tender block", async () => {
    const j = await (await tenderPost(req("POST", body()))).json();
    expect(state.changes.map((c) => `${c.objectType}:${c.action}:${c.objectId}`)).toEqual([`opportunities:create:${j.id}`, `opportunity_tenders:create:${j.id}`]);
    expect(state.changes[1].changes?.map((c) => c.field)).toEqual(expect.arrayContaining(["tender_no", "issuer_name", "portal", "closing_at"]));
  });

  it("takes the tenant from the session, never from the body", async () => {
    const j = await (await tenderPost(req("POST", { ...body(), tenant_id: T2, tender: { tender_no: "N", tenant_id: T2, decision: "go", decided_by: "x" } }))).json();
    expect(opps().find((o) => o.id === j.id)?.tenant_id).toBe(T1);
    const row = tenders().find((r) => r.opportunity_id === j.id)!;
    expect(row.tenant_id).toBe(T1);
    expect(row.decision).toBeUndefined();
    expect(row.decided_by).toBeUndefined();
  });

  it("needs only the account; a source e-mail of this workspace is recorded", async () => {
    expect((await tenderPost(req("POST", { tender: {} }))).status).toBe(400);
    const res = await tenderPost(req("POST", { account_id: ACC, tender_source_email: MAIL_T1, tender: { portal: "email" } }));
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(tenders().find((r) => r.opportunity_id === j.id)).toMatchObject({ source_email_id: MAIL_T1, portal: "email", tender_no: null });
  });

  it("checks every foreign id against the workspace", async () => {
    expect((await tenderPost(req("POST", body({ account_id: ACC_T2 })))).status).toBe(404);
    expect((await tenderPost(req("POST", body({ tender: { issuer_account_id: ACC_T2 } })))).status).toBe(404);
    expect((await tenderPost(req("POST", body({ tender_source_email: MAIL_T2 })))).status).toBe(404);
    expect((await tenderPost(req("POST", body({ owner_id: U_OTHER_TENANT })))).status).toBe(422);
    expect(opps()).toHaveLength(3);
    expect(tenders()).toHaveLength(0);
  });

  it("refuses a duplicate tender number and leaves no half-made deal behind", async () => {
    expect((await tenderPost(req("POST", body()))).status).toBe(201);
    const before = opps().length;
    const dup = await tenderPost(req("POST", body()));
    expect(dup.status).toBe(409);
    expect(opps()).toHaveLength(before);
  });

  it("takes the deal back out when the tender row cannot be written", async () => {
    // A concurrent request wins the unique number between the check and the insert.
    const realFrom = state.db.from.bind(state.db);
    let raced = false;
    state.db.from = ((t: string) => {
      const q = realFrom(t);
      if (t === "opportunity_tenders" && !raced) {
        const insert = q.insert.bind(q);
        q.insert = ((p: Record<string, unknown>) => { raced = true; state.db.rows(t).push({ ...tenderRow({ opportunity_id: "zzz", tender_no: p.tender_no }) }); return insert(p); }) as typeof q.insert;
      }
      return q;
    }) as typeof state.db.from;
    const before = opps().length;
    const res = await tenderPost(req("POST", body()));
    expect(res.status).toBe(409);
    expect(opps()).toHaveLength(before);
  });

  it("answers 503, writing nothing, while migration 0220 is pending", async () => {
    state.db.missing.add("opportunity_tenders");
    const res = await tenderPost(req("POST", body()));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/0220/);
    expect(opps()).toHaveLength(3);
  });

  it("is refused without the Pipeline", async () => {
    state.features = { gcc_tender: true };
    expect((await tenderPost(req("POST", body()))).status).toBe(403);
  });
});

// ── 3. The tender block ────────────────────────────────────────────────────────────────────────────────────────────

describe("GET / PATCH /api/opportunities/[id]/tender", () => {
  beforeEach(() => {
    state.features = { pipeline: true, gcc_tender: true };
    state.db.rows("opportunity_tenders").push(tenderRow());
  });

  it("reads the block of this workspace's tender only", async () => {
    expect((await (await tenderGet(req("GET"), ctx(OPP_TENDER))).json())).toMatchObject({ tender_no: "ARB-1", reminders_sent: [7] });
    expect((await tenderGet(req("GET"), ctx(OPP_STD))).status).toBe(404); // a standard deal has no tender block
    expect((await tenderGet(req("GET"), ctx(OPP_T2))).status).toBe(404); // another workspace's deal
  });

  it("updates through an allow-list and logs the change", async () => {
    const res = await tenderPatch(req("PATCH", { portal: "excel", addenda_count: 2, bid_bond_amount: 96000, bid_bond_currency: "sar", bid_bond_expiry: "2027-01-30" }), ctx(OPP_TENDER));
    expect(res.status).toBe(200);
    expect(tenders()[0]).toMatchObject({ portal: "excel", addenda_count: 2, bid_bond_amount: 96000, bid_bond_currency: "SAR", bid_bond_expiry: "2027-01-30" });
    const log = state.changes.find((c) => c.objectType === "opportunity_tenders")!;
    expect(log).toMatchObject({ action: "update", objectId: OPP_TENDER });
    expect(log.changes?.map((c) => c.field)).toEqual(expect.arrayContaining(["portal", "addenda_count", "bid_bond_amount"]));
  });

  it("cannot set the decision, who decided, the reminders, the source e-mail or the tenant", async () => {
    await tenderPatch(req("PATCH", { decision: "go", decided_by: "someone", decided_at: "2020-01-01T00:00:00Z", reminders_sent: [], source_email_id: MAIL_T1, tenant_id: T2, deal_type_id: "x", opportunity_id: OPP_STD, tender_no: "ARB-9" }), ctx(OPP_TENDER));
    expect(tenders()[0]).toMatchObject({ tender_no: "ARB-9", decision: null, decided_by: null, decided_at: null, reminders_sent: [7], source_email_id: null, tenant_id: T1, deal_type_id: null, opportunity_id: OPP_TENDER });
  });

  it("a new closing date starts the reminders over and moves the deal's expected close when they were in step", async () => {
    opps().find((o) => o.id === OPP_TENDER)!.expected_close = "2026-10-30";
    await tenderPatch(req("PATCH", { closing_at: "2026-11-12T09:00:00Z" }), ctx(OPP_TENDER));
    expect(tenders()[0]).toMatchObject({ closing_at: "2026-11-12T09:00:00.000Z", reminders_sent: [] });
    expect(opps().find((o) => o.id === OPP_TENDER)?.expected_close).toBe("2026-11-12");
  });

  it("the same closing date does not reset the reminders or write history", async () => {
    await tenderPatch(req("PATCH", { closing_at: "2026-10-30T09:00:00Z", portal: "ariba" }), ctx(OPP_TENDER));
    expect(tenders()[0].reminders_sent).toEqual([7]);
    expect(state.changes).toHaveLength(0);
  });

  it("an expected close the person set by hand is left alone", async () => {
    opps().find((o) => o.id === OPP_TENDER)!.expected_close = "2026-12-01";
    await tenderPatch(req("PATCH", { closing_at: "2026-11-12T09:00:00Z" }), ctx(OPP_TENDER));
    expect(opps().find((o) => o.id === OPP_TENDER)?.expected_close).toBe("2026-12-01");
  });

  it("checks the issuer account and the tender number against the workspace", async () => {
    expect((await tenderPatch(req("PATCH", { issuer_account_id: ACC_T2 }), ctx(OPP_TENDER))).status).toBe(404);
    state.db.rows("opportunity_tenders").push(tenderRow({ opportunity_id: OPP_STD, tender_no: "TAKEN" }));
    expect((await tenderPatch(req("PATCH", { tender_no: "TAKEN" }), ctx(OPP_TENDER))).status).toBe(409);
    expect((await tenderPatch(req("PATCH", { portal: "fax" }), ctx(OPP_TENDER))).status).toBe(400);
  });

  it("only cf_ custom fields reach custom_data", async () => {
    await tenderPatch(req("PATCH", { custom_data: { cf_region: "East", evil: 1 } }), ctx(OPP_TENDER));
    expect(tenders()[0].custom_data).toEqual({ cf_region: "East" });
  });

  it("another workspace's deal cannot be changed", async () => {
    state.db.rows("opportunity_tenders").push(tenderRow({ opportunity_id: OPP_T2, tenant_id: T2, tender_no: "T2-1" }));
    expect((await tenderPatch(req("PATCH", { portal: "excel" }), ctx(OPP_T2))).status).toBe(404);
    expect(tenders().find((r) => r.opportunity_id === OPP_T2)?.portal).toBe("ariba");
  });
});
