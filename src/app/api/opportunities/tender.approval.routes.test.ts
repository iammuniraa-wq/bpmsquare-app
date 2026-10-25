import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, slice 1b: manager approval of the bid / no-bid decision, the stage guard it drives, and bond release.
// Against an in-memory database. The questions asked here are the ones the design lists: who may decide (threshold, self-
// approval), the guard in both directions, another workspace's rows, the flag off, and the migration still pending.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  config: {} as Record<string, unknown>,
  touched: [] as string[],
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "u1", email: "me@t1.test" },
  role: "member" as "admin" | "member",
  sent: [] as { from: string; to: string[]; subject: string; text: string }[],
  stageEvents: [] as unknown[],
}));

const T1 = "t1";
const T2 = "t2";
const PROPOSER = "11111111-1111-4111-8111-111111111111";
const BOSS = "22222222-2222-4222-8222-222222222222";
const BOSS2 = "33333333-3333-4333-8333-333333333333";
const COLLEAGUE = "44444444-4444-4444-8444-444444444444";
const OTHER_TENANT_ADMIN = "99999999-9999-4999-8999-999999999999";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const rid = (n: number | string) => `a0000000-0000-4000-8000-${String(n).replace(/\D/g, "").padStart(12, "0")}`;
const AR1 = rid(1);

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => { state.touched.push(t); return state.db.from(t); }, auth: state.db.auth }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: T1, userId: state.user.id, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: state.config, features: state.features }),
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: (_t: string, b: Record<string, unknown>, a: Record<string, unknown>) =>
    Object.entries(a).filter(([k, v]) => JSON.stringify(b[k] ?? null) !== JSON.stringify(v ?? null)).map(([field, to]) => ({ field, from: b[field] ?? null, to })),
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));
vi.mock("@/lib/events/emitters", () => ({
  emitOpportunityStageChanged: async (_t: string, p: unknown) => { state.stageEvents.push(p); },
  emitOpportunityClosed: async () => {}, emitOpportunityUpdated: async () => {}, emitOpportunityCreated: async () => {},
}));
vi.mock("resend", () => ({
  Resend: class { emails = { send: async (p: { from: string; to: string[]; subject: string; text: string }) => { state.sent.push(p); return { error: null }; } }; },
}));

import { NextRequest } from "next/server";
import { PATCH as stdPatch } from "./[id]/route";
import { GET as approvalGet, POST as approvalPost } from "./[id]/tender/approval/route";
import { PATCH as decide } from "./[id]/tender/approval/[requestId]/route";
import { POST as bondPost } from "./[id]/tender/bond/route";
import { GET as settingsGet, PUT as settingsPut } from "@/app/api/settings/tender/route";
import { loadTender } from "@/lib/tender/server";

const req = (method: string, body?: unknown) => new NextRequest(new URL("http://internal.invalid/x"), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const dctx = (id: string, requestId: string) => ({ params: Promise.resolve({ id, requestId }) });
const approvals = () => state.db.rows("approval_requests");
const tenders = () => state.db.rows("opportunity_tenders");
const opps = () => state.db.rows("opportunities");
const as = (id: string, role: "admin" | "member" = "member") => { state.user = { id, email: `${id.slice(0, 2)}@t1.test` }; state.role = role; };

function opp(id: string, over: Record<string, unknown> = {}) {
  return {
    id, tenant_id: T1, ref: `OPP-${id.slice(-1)}`, title: "Pipes for Plant 4", account_id: "acc", contact_id: null, stage: "bid_no_bid", outcome: "open", loss_reason: null,
    loss_note: null, probability: 15, probability_override: null, owner_id: PROPOSER, team: [], expected_close: null, amount: 0, custom_data: null,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closed_at: null, ...over,
  };
}
const tenderRow = (over: Record<string, unknown> = {}) => ({
  opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", issuer_name: "Aramco", portal: "ariba", closing_at: "2026-10-30T09:00:00.000Z",
  bid_bond_amount: 96000, bid_bond_currency: "SAR", bid_bond_expiry: "2027-01-30", addenda_count: 0, decision: null, decision_reason: null, decided_by: null, decided_at: null,
  source_email_id: null, custom_data: null, reminders_sent: [], bond_status: "held", bond_released_at: null, bond_released_by: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over,
});
const approvalRow = (over: Record<string, unknown> = {}) => ({
  id: AR1, tenant_id: T1, object_type: "opportunity_tenders", object_id: OPP, kind: "tender_bid_decision", proposed_value: "go", reason: "Good fit",
  requested_by: PROPOSER, status: "pending", decided_by: null, decided_at: null, decision_comment: null, created_at: "2026-10-20T00:00:00Z", ...over,
});

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [
      { id: T1, slug: "kamco", name: "KAMCO", is_demo: false, config: {}, custom_domain: "kamco.example.com" },
      { id: T2, slug: "other", name: "Other", is_demo: false, config: {}, custom_domain: null },
    ],
    tenant_users: [
      { tenant_id: T1, user_id: PROPOSER, role: "member" }, { tenant_id: T1, user_id: BOSS, role: "admin" },
      { tenant_id: T1, user_id: BOSS2, role: "admin" }, { tenant_id: T1, user_id: COLLEAGUE, role: "member" },
      { tenant_id: T2, user_id: OTHER_TENANT_ADMIN, role: "admin" },
    ],
    opportunities: [opp(OPP_STD, { stage: "qualify" }), opp(OPP), opp(OPP_T2, { tenant_id: T2 })],
    opportunity_tenders: [tenderRow(), tenderRow({ opportunity_id: OPP_T2, tenant_id: T2, tender_no: "T2-1" })],
  });
  state.db.users.set(PROPOSER, { email: "proposer@kamco.test", name: "S. Khan" });
  state.db.users.set(BOSS, { email: "boss@kamco.test", name: "A. Nasser" });
  state.db.users.set(BOSS2, { email: "boss2@kamco.test", name: "B. Said" });
  state.db.users.set(COLLEAGUE, { email: "colleague@kamco.test" });
  state.db.users.set(OTHER_TENANT_ADMIN, { email: "admin@other.test" });
  state.features = { pipeline: true, gcc_tender: true };
  state.config = {};
  state.touched = []; state.changes = []; state.sent = []; state.stageEvents = [];
  as(PROPOSER);
  process.env.RESEND_API_KEY = "test";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const propose = (decision = "go", reason = "Good fit") => approvalPost(req("POST", { decision, reason }), ctx(OPP));

describe("proposing the decision", () => {
  it("a team member proposes go with a reason; who and when come from the session", async () => {
    const res = await propose();
    expect(res.status).toBe(201);
    expect(approvals()).toHaveLength(1);
    expect(approvals()[0]).toMatchObject({ tenant_id: T1, object_type: "opportunity_tenders", object_id: OPP, kind: "tender_bid_decision", proposed_value: "go", reason: "Good fit", requested_by: PROPOSER, status: "pending" });
    expect(state.changes.find((c) => c.objectType === "opportunity_tenders")?.changes?.[0].field).toBe("Bid decision proposed");
    // Nothing is decided yet.
    expect(tenders().find((t) => t.opportunity_id === OPP)).toMatchObject({ decision: null, decided_by: null });
  });

  it("needs a reason, for a go as well as a no-go", async () => {
    expect((await approvalPost(req("POST", { decision: "go" }), ctx(OPP))).status).toBe(400);
    expect((await approvalPost(req("POST", { decision: "no_go", reason: "" }), ctx(OPP))).status).toBe(400);
    expect(approvals()).toHaveLength(0);
  });

  it("tells the approvers by e-mail (logged) and in their Nova inbox, never the proposer", async () => {
    await propose();
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].to.sort()).toEqual(["boss2@kamco.test", "boss@kamco.test"]);
    expect(state.sent[0].subject).toContain("Approval needed: bid (go)");
    expect(state.sent[0].text).toContain("https://kamco.example.com/pipeline/");
    const log = state.db.rows("email_log")[0];
    expect(log).toMatchObject({ tenant_id: T1, kind: "tender", status: "sent", related_object_id: OPP });
    const note = state.db.rows("record_comments")[0];
    expect(note).toMatchObject({ tenant_id: T1, object_type: "opportunities", object_id: OPP, author_id: PROPOSER });
    expect((note.mentions as string[]).sort()).toEqual(["boss2@kamco.test", "boss@kamco.test"]);
  });

  it("a demo workspace's approval mail is redirected, never sent to the approvers", async () => {
    state.db.rows("tenants").find((t) => t.id === T1)!.is_demo = true;
    await propose();
    expect(state.sent).toHaveLength(0);
    expect(state.db.rows("email_log")[0]).toMatchObject({ status: "failed" });
  });

  it("only one proposal can wait at a time", async () => {
    expect((await propose()).status).toBe(201);
    const again = await propose("no_go", "Changed my mind");
    expect(again.status).toBe(409);
    expect(approvals()).toHaveLength(1);
  });

  it("a partial unique index race ends in a clean 409", async () => {
    state.db.unique("approval_requests", (e, n) => e.status === "pending" && n.status === "pending" && e.object_id === n.object_id && e.kind === n.kind);
    approvals().push(approvalRow({ status: "approved", decided_at: "2026-10-21T00:00:00Z", decided_by: BOSS }));
    expect((await propose()).status).toBe(201);
    expect((await propose()).status).toBe(409);
  });

  it("is refused once the tender has moved past Bid/No-bid or is closed", async () => {
    opps().find((o) => o.id === OPP)!.stage = "estimating";
    expect((await propose()).status).toBe(409);
    opps().find((o) => o.id === OPP)!.stage = "bid_no_bid";
    opps().find((o) => o.id === OPP)!.outcome = "won";
    expect((await propose()).status).toBe(409);
    expect(approvals()).toHaveLength(0);
  });

  it("is refused when no one else could approve it, and allowed once self-approval is switched on", async () => {
    state.db.rows("tenant_users").splice(0, state.db.rows("tenant_users").length,
      { tenant_id: T1, user_id: BOSS, role: "admin" }, { tenant_id: T1, user_id: PROPOSER, role: "member" });
    as(BOSS, "admin");
    const refused = await propose();
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/Settings > Tenders/);
    state.config = { tender: { allow_self_approval: true } };
    expect((await propose()).status).toBe(201);
  });
});

describe("who may decide", () => {
  beforeEach(() => { approvals().push(approvalRow()); });

  it("an approver (a workspace admin by default) approves with one decision, and the tender records the decision, who approved and when", async () => {
    as(BOSS, "admin");
    const before = Date.now();
    const res = await decide(req("PATCH", { action: "approve", comment: "Go ahead" }), dctx(OPP, AR1));
    expect(res.status).toBe(200);
    expect(approvals()[0]).toMatchObject({ status: "approved", decided_by: BOSS, decision_comment: "Go ahead" });
    expect(Date.parse(approvals()[0].decided_at as string)).toBeGreaterThanOrEqual(before);
    expect(tenders().find((t) => t.opportunity_id === OPP)).toMatchObject({ decision: "go", decision_reason: "Good fit", decided_by: BOSS });
    // The stage did not move by itself.
    expect(opps().find((o) => o.id === OPP)?.stage).toBe("bid_no_bid");
  });

  it("a second decision on the same proposal is refused: one approval settles it", async () => {
    as(BOSS, "admin");
    expect((await decide(req("PATCH", { action: "approve" }), dctx(OPP, AR1))).status).toBe(200);
    as(BOSS2, "admin");
    const second = await decide(req("PATCH", { action: "reject", comment: "no" }), dctx(OPP, AR1));
    expect(second.status).toBe(409);
    expect(approvals()[0].status).toBe("approved");
  });

  it("the proposer cannot approve their own proposal, even as an admin", async () => {
    approvals()[0].requested_by = BOSS;
    as(BOSS, "admin");
    const res = await decide(req("PATCH", { action: "approve" }), dctx(OPP, AR1));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/own proposal/);
    expect(approvals()[0].status).toBe("pending");
    expect(tenders().find((t) => t.opportunity_id === OPP)?.decision).toBeNull();
  });

  it("unless the workspace allows self-approval", async () => {
    approvals()[0].requested_by = BOSS;
    state.config = { tender: { allow_self_approval: true } };
    as(BOSS, "admin");
    expect((await decide(req("PATCH", { action: "approve" }), dctx(OPP, AR1))).status).toBe(200);
  });

  it("a member who is not an approver is refused", async () => {
    as(COLLEAGUE);
    expect((await decide(req("PATCH", { action: "approve" }), dctx(OPP, AR1))).status).toBe(403);
    expect(approvals()[0].status).toBe("pending");
  });

  it("the approvers chosen in Settings replace the admins; a chosen person who left, or from another workspace, counts for nothing", async () => {
    state.config = { tender: { approvers: [COLLEAGUE, OTHER_TENANT_ADMIN] } };
    as(BOSS, "admin");
    expect((await decide(req("PATCH", { action: "approve" }), dctx(OPP, AR1))).status).toBe(403);
    as(COLLEAGUE);
    expect((await decide(req("PATCH", { action: "approve" }), dctx(OPP, AR1))).status).toBe(200);
  });

  it("when every chosen approver is gone, the admins decide again", async () => {
    state.config = { tender: { approvers: [OTHER_TENANT_ADMIN] } };
    as(BOSS2, "admin");
    expect((await decide(req("PATCH", { action: "approve" }), dctx(OPP, AR1))).status).toBe(200);
  });

  it("a rejection needs a comment, files it, and returns a Received deal to Bid/No-bid", async () => {
    opps().find((o) => o.id === OPP)!.stage = "received";
    as(BOSS, "admin");
    expect((await decide(req("PATCH", { action: "reject" }), dctx(OPP, AR1))).status).toBe(400);
    const res = await decide(req("PATCH", { action: "reject", comment: "Not enough margin" }), dctx(OPP, AR1));
    expect(res.status).toBe(200);
    expect(approvals()[0]).toMatchObject({ status: "rejected", decided_by: BOSS, decision_comment: "Not enough margin" });
    expect(opps().find((o) => o.id === OPP)).toMatchObject({ stage: "bid_no_bid", probability: 15 });
    expect(state.stageEvents).toHaveLength(1);
    expect(tenders().find((t) => t.opportunity_id === OPP)?.decision).toBeNull();
  });

  it("tells the proposer how it went by e-mail and in the inbox, and does not tell the approver about their own act", async () => {
    as(BOSS, "admin");
    await decide(req("PATCH", { action: "approve", comment: "Go ahead" }), dctx(OPP, AR1));
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].to).toEqual(["proposer@kamco.test"]);
    expect(state.sent[0].subject).toContain("Approved: bid (go)");
    expect(state.db.rows("record_comments").at(-1)).toMatchObject({ author_id: BOSS, mentions: ["proposer@kamco.test"] });
  });

  it("the proposer can withdraw it, nobody else can, and a withdrawn proposal stays in the history", async () => {
    as(BOSS, "admin");
    expect((await decide(req("PATCH", { action: "cancel" }), dctx(OPP, AR1))).status).toBe(403);
    as(PROPOSER);
    expect((await decide(req("PATCH", { action: "cancel" }), dctx(OPP, AR1))).status).toBe(200);
    expect(approvals()[0].status).toBe("cancelled");
    expect(state.sent).toHaveLength(0);
    expect((await propose()).status).toBe(201);
    expect(approvals()).toHaveLength(2);
  });

  it("every decision is logged", async () => {
    as(BOSS, "admin");
    await decide(req("PATCH", { action: "approve" }), dctx(OPP, AR1));
    expect(state.changes.some((c) => c.objectType === "opportunity_tenders" && c.changes?.some((x) => x.field === "Bid decision approved"))).toBe(true);
  });
});

describe("the stage guard, on the server", () => {
  const move = (stage: string, id = OPP) => stdPatch(req("PATCH", { stage }), ctx(id));
  const approve = (value: "go" | "no_go", at = "2026-10-21T00:00:00Z") =>
    approvals().push(approvalRow({ id: rid(10 + approvals().length), proposed_value: value, status: "approved", decided_by: BOSS, decided_at: at }));

  it("Bid/No-bid cannot go to Estimating without an approved go", async () => {
    const res = await move("estimating");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/approval/i);
    expect(opps().find((o) => o.id === OPP)?.stage).toBe("bid_no_bid");
  });

  it("a pending, rejected or withdrawn go does not open it either", async () => {
    approvals().push(approvalRow({ id: rid(21) }), approvalRow({ id: rid(22), status: "rejected" }), approvalRow({ id: rid(23), status: "cancelled" }));
    expect((await move("estimating")).status).toBe(409);
  });

  it("an approved go opens Estimating", async () => {
    approve("go");
    expect((await move("estimating")).status).toBe(200);
    expect(opps().find((o) => o.id === OPP)).toMatchObject({ stage: "estimating", probability: 25 });
  });

  it("an approved go does not open No-bid", async () => {
    approve("go");
    expect((await move("no_bid")).status).toBe(409);
  });

  it("No-bid needs an approved no-go, and then closes the deal as dropped", async () => {
    expect((await move("no_bid")).status).toBe(409);
    approve("no_go");
    expect((await move("no_bid")).status).toBe(200);
    expect(opps().find((o) => o.id === OPP)).toMatchObject({ stage: "no_bid", outcome: "dropped" });
  });

  it("the latest approval stands: a later approved no-go closes the door a go had opened", async () => {
    approve("go", "2026-10-21T00:00:00Z");
    approve("no_go", "2026-10-23T00:00:00Z");
    expect((await move("estimating")).status).toBe(409);
  });

  it("moving backwards, or between bid stages, asks for nothing", async () => {
    opps().find((o) => o.id === OPP)!.stage = "estimating";
    expect((await move("submitted")).status).toBe(200);
    expect((await move("bid_no_bid")).status).toBe(200);
    expect((await move("received")).status).toBe(200);
  });

  it("a decision saved before approval existed does not open a stage", async () => {
    tenders().find((t) => t.opportunity_id === OPP)!.decision = "go";
    expect((await move("estimating")).status).toBe(409);
  });

  it("a standard deal is never asked, and never reads the approval table", async () => {
    state.touched = [];
    expect((await move("negotiate", OPP_STD)).status).toBe(200);
    expect(state.touched).not.toContain("approval_requests");
  });

  it("with the flag off nothing is asked and no tender table is read", async () => {
    state.features = { pipeline: true };
    state.touched = [];
    expect((await move("won", OPP_STD)).status).toBe(200);
    expect(state.touched.filter((t) => t === "approval_requests" || t === "opportunity_tenders")).toEqual([]);
  });

  it("while migration 0221 is pending the guard stays at its slice-1 behaviour", async () => {
    state.db.missing.add("approval_requests");
    expect((await move("estimating")).status).toBe(200);
  });
});

describe("another workspace's rows", () => {
  it("a request id from another workspace, or one pointing at another workspace's deal, matches nothing", async () => {
    approvals().push(approvalRow({ id: rid(2), tenant_id: T2, object_id: OPP_T2 }), approvalRow({ id: rid(3), tenant_id: T2, object_id: OPP }));
    as(BOSS, "admin");
    expect((await decide(req("PATCH", { action: "approve" }), dctx(OPP_T2, rid(2)))).status).toBe(404);
    expect((await decide(req("PATCH", { action: "approve" }), dctx(OPP, rid(3)))).status).toBe(404);
    expect(approvals().every((a) => a.status === "pending")).toBe(true);
  });

  it("another workspace's tender cannot be proposed on, read or have its bond released", async () => {
    expect((await approvalPost(req("POST", { decision: "go", reason: "x" }), ctx(OPP_T2))).status).toBe(404);
    expect((await approvalGet(req("GET"), ctx(OPP_T2))).status).toBe(404);
    expect((await bondPost(req("POST", { action: "release" }), ctx(OPP_T2))).status).toBe(404);
    expect(tenders().find((t) => t.opportunity_id === OPP_T2)?.bond_status).toBe("held");
  });

  it("the approval of a request in this workspace on a deal that is not a tender is a 404", async () => {
    expect((await decide(req("PATCH", { action: "approve" }), dctx(OPP_STD, AR1))).status).toBe(404);
  });

  it("every approval query carries the tenant filter (the ids are matched as a pair)", async () => {
    approvals().push(approvalRow({ id: rid(4), tenant_id: T2 }));
    as(BOSS, "admin");
    const view = await (await approvalGet(req("GET"), ctx(OPP))).json();
    expect(view.pending).toBeNull();
    expect(view.history).toEqual([]);
  });
});

describe("the flag off, and the migration pending", () => {
  it("with the flag off every approval route is a 404 and nothing is touched", async () => {
    state.features = { pipeline: true };
    state.touched = [];
    expect((await propose()).status).toBe(404);
    expect((await approvalGet(req("GET"), ctx(OPP))).status).toBe(404);
    expect((await decide(req("PATCH", { action: "approve" }), dctx(OPP, AR1))).status).toBe(404);
    expect((await bondPost(req("POST", { action: "release" }), ctx(OPP))).status).toBe(404);
    as(BOSS, "admin");
    expect((await settingsGet()).status).toBe(404);
    expect(state.touched).toEqual([]);
  });

  it("with approval_requests missing, proposing and reading say a database update is needed", async () => {
    state.db.missing.add("approval_requests");
    const res = await propose();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/0221/);
    expect((await approvalGet(req("GET"), ctx(OPP))).status).toBe(503);
  });

  it("with the bond columns missing the tender still loads (held) and releasing says a database update is needed", async () => {
    state.db.missingColumns.opportunity_tenders = new Set(["bond_status", "bond_released_at", "bond_released_by"]);
    const admin = { from: (t: string) => state.db.from(t) } as unknown as Parameters<typeof loadTender>[0];
    const t = await loadTender(admin, T1, OPP);
    expect(t).toMatchObject({ opportunity_id: OPP, tender_no: "ARB-1", bond_status: "held", bond_released_at: null });
    const res = await bondPost(req("POST", { action: "release" }), ctx(OPP));
    expect(res.status).toBe(503);
  });
});

describe("releasing the bond", () => {
  it("records who and when from the session, and logs it", async () => {
    const before = Date.now();
    const res = await bondPost(req("POST", { action: "release", bond_released_by: "someone-else" }), ctx(OPP));
    expect(res.status).toBe(200);
    const t = tenders().find((x) => x.opportunity_id === OPP)!;
    expect(t).toMatchObject({ bond_status: "released", bond_released_by: PROPOSER });
    expect(Date.parse(t.bond_released_at as string)).toBeGreaterThanOrEqual(before);
    expect(state.changes.at(-1)?.changes).toEqual([{ field: "bond_status", from: "held", to: "released" }]);
  });

  it("twice changes and logs nothing more", async () => {
    await bondPost(req("POST", { action: "release" }), ctx(OPP));
    const at = tenders().find((x) => x.opportunity_id === OPP)!.bond_released_at;
    state.changes = [];
    as(BOSS, "admin");
    expect((await bondPost(req("POST", { action: "release" }), ctx(OPP))).status).toBe(200);
    expect(tenders().find((x) => x.opportunity_id === OPP)).toMatchObject({ bond_released_at: at, bond_released_by: PROPOSER });
    expect(state.changes).toHaveLength(0);
  });

  it("needs a recorded bond and a known action", async () => {
    expect((await bondPost(req("POST", { action: "hold" }), ctx(OPP))).status).toBe(400);
    Object.assign(tenders().find((x) => x.opportunity_id === OPP)!, { bid_bond_amount: null, bid_bond_expiry: null });
    expect((await bondPost(req("POST", { action: "release" }), ctx(OPP))).status).toBe(409);
  });
});

describe("Settings > Tenders", () => {
  it("is admin-only in both directions", async () => {
    as(COLLEAGUE, "member");
    expect((await settingsGet()).status).toBe(403);
    expect((await settingsPut(req("PUT", { approvers: [BOSS] }))).status).toBe(403);
    expect(state.db.rows("tenants").find((t) => t.id === T1)?.config).toEqual({});
  });

  it("stores the approvers and the self-approval switch, merged into the workspace config", async () => {
    as(BOSS, "admin");
    state.db.rows("tenants").find((t) => t.id === T1)!.config = { keep: "me" };
    const res = await settingsPut(req("PUT", { approvers: [BOSS, BOSS, COLLEAGUE], allow_self_approval: true }));
    expect(res.status).toBe(200);
    expect(state.db.rows("tenants").find((t) => t.id === T1)?.config).toEqual({ keep: "me", tender: { approvers: [BOSS, COLLEAGUE], allow_self_approval: true } });
    const got = await (await settingsGet()).json();
    expect(got.approvers).toEqual([BOSS, COLLEAGUE]);
    expect(got.allow_self_approval).toBe(true);
    expect(got.members.find((m: { user_id: string }) => m.user_id === BOSS).is_admin).toBe(true);
    expect(got.members.some((m: { user_id: string }) => m.user_id === OTHER_TENANT_ADMIN)).toBe(false);
  });

  it("refuses an approver who is not a member of this workspace", async () => {
    as(BOSS, "admin");
    const res = await settingsPut(req("PUT", { approvers: [OTHER_TENANT_ADMIN] }));
    expect(res.status).toBe(422);
    expect(state.db.rows("tenants").find((t) => t.id === T1)?.config).toEqual({});
  });
});
