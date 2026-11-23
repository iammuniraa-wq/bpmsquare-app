import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";

// POST /api/ai/report/save: the Save button of a report. What the request may name, what is checked before anything is
// written, and that the content comes from the workspace's own cache.

vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests"; });

const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACC_T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const DEAL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const COMP = "ffffffff-ffff-4fff-8fff-fffffffffff1";

const state = vi.hoisted(() => ({
  features: {} as Record<string, boolean>,
  config: {} as Record<string, unknown>,
  grants: "all" as "all" | string[],
  db: null as unknown as ReturnType<typeof import("@/lib/middleware/testHarness").fakeAdmin>,
  audits: [] as Record<string, unknown>[],
  deal: { ok: true } as { ok: boolean; status?: number; error?: string },
}));

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { features: state.features, config: state.config } }) }) }) }) }, tenantId: "11111111-1111-4111-8111-111111111111", userId: "u-1", role: "member" }),
  createAdminSupabase: () => state.db.client,
  getAuthUser: async () => ({ id: "u-1", email: "me@x.com" }),
}));
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  resolvePermissions: async () => ({ unrestricted: state.grants === "all", grants: new Map() }),
  canViewWorkcenter: (p: { unrestricted: boolean }, w: string) => p.unrestricted || (Array.isArray(state.grants) && state.grants.includes(w)),
}));
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn() }));
vi.mock("@/lib/tender/dealAccess", () => ({
  openTenderDealRequest: async (id: string, write: boolean) => {
    void id; void write;
    return state.deal.ok ? { ok: true, req: { admin: state.db.client, tenantId: "11111111-1111-4111-8111-111111111111" } } : { ok: false, status: state.deal.status ?? 404, error: state.deal.error ?? "Not found" };
  },
}));
vi.mock("@/lib/assistant/reportAudit", () => ({ recordReportAudit: async (a: Record<string, unknown>) => { state.audits.push(a); } }));

import { POST } from "./route";
import { saveReport } from "@/lib/analysis/report/cache";
import { validateBrief } from "@/lib/analysis/report/validate";

const NOW = new Date("2026-10-21T12:00:00Z");
const SITE = "https://najdprecast.com/about";
const post = (body: Record<string, unknown> | string) =>
  POST(new NextRequest("http://localhost/api/ai/report/save", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

async function seed(extra: Record<string, Row[]> = {}) {
  state.db = fakeAdmin({
    accounts: [{ id: ACC, tenant_id: T1 }, { id: ACC_T2, tenant_id: T2 }], opportunities: [{ id: DEAL, tenant_id: T1 }],
    record_comments: [], company_analyses: [], opportunity_competitors: [], ...extra,
  });
  const { report } = validateBrief({ market: { one_liner: { text: "Makes precast concrete elements.", source_url: SITE } } }, {
    subject: { name: "Najd Precast Co.", domain: "najdprecast.com", country: null }, citations: [{ url: SITE, title: "About" }], now: NOW, searches: 4,
  });
  await saveReport(state.db.client as never, { tenantId: T1, companyKey: "najdprecast.com", report, parts: {}, version: 1, searches: 4, inputTokens: 1, outputTokens: 1, requestedBy: "u-1", computedAt: NOW.toISOString(), expiresAt: "2026-10-28T12:00:00.000Z" });
}

beforeEach(async () => {
  state.features = { ai_assistant: true, ai_assistant_web: true, next_experience: true, accounts: true, pipeline: true, gcc_tender: true };
  state.config = {}; state.grants = "all"; state.audits = []; state.deal = { ok: true };
  await seed();
});

describe("who may call it", () => {
  it("not at all when web research is off for the workspace, with the reason", async () => {
    state.features = { ai_assistant: true, next_experience: true, accounts: true };
    const res = await post({ kind: "account", id: ACC, key: "najdprecast.com" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("flag_off");
    expect(state.db.tables.record_comments).toHaveLength(0);
  });

  it("not when the workspace blocks outside calls", async () => {
    state.config = { ai_assistant: { block_external_calls: true } };
    expect((await post({ kind: "account", id: ACC, key: "najdprecast.com" })).status).toBe(403);
  });

  it("not without the Accounts view", async () => {
    state.grants = ["pipeline"];
    expect((await post({ kind: "deal", id: DEAL, key: "najdprecast.com" })).status).toBe(403);
  });
});

describe("what the request may say", () => {
  it("only a kind, a record id and the key: anything else is refused or ignored", async () => {
    for (const body of [{}, { kind: "case", id: ACC, key: "k" }, { kind: "account", id: "not-a-uuid", key: "k" }, { kind: "account", id: ACC }, { kind: "competitor", id: DEAL, key: "k" }, { kind: "competitor", id: DEAL, competitor_id: "x", key: "k" }, "not json"]) {
      expect((await post(body as never)).status, JSON.stringify(body)).toBe(400);
    }
    expect(state.db.tables.record_comments).toHaveLength(0);
  });

  it("the report text is never taken from the request", async () => {
    await post({ kind: "account", id: ACC, key: "najdprecast.com", body: "PLANTED TEXT", report: { name: "PLANTED" }, tenant_id: T2 });
    const body = String(state.db.tables.record_comments[0].body);
    expect(body).toContain("Makes precast concrete elements.");
    expect(body).not.toContain("PLANTED");
    expect(state.db.tables.record_comments[0].tenant_id).toBe(T1);
  });
});

describe("saving to a timeline", () => {
  it("writes the comment as this person in this workspace and audits it", async () => {
    const res = await post({ kind: "account", id: ACC, key: "najdprecast.com" });
    expect(res.status).toBe(200);
    expect(state.db.tables.record_comments[0]).toMatchObject({ tenant_id: T1, object_type: "accounts", object_id: ACC, author_id: "u-1", author_email: "me@x.com" });
    expect(state.audits).toMatchObject([{ kind: "report_save", status: "done", tenantId: T1 }]);
  });

  it("an account of another workspace is a 404 and nothing is written", async () => {
    const res = await post({ kind: "account", id: ACC_T2, key: "najdprecast.com" });
    expect(res.status).toBe(404);
    expect(state.db.tables.record_comments).toHaveLength(0);
    expect(state.audits).toMatchObject([{ status: "failed" }]);
  });

  it("without the workcenter of the record it is a 404, not a 403", async () => {
    state.grants = ["accounts"];
    expect((await post({ kind: "deal", id: DEAL, key: "najdprecast.com" })).status).toBe(404);
    expect(state.db.tables.record_comments).toHaveLength(0);
  });

  it("with the workcenter it works for a deal", async () => {
    state.grants = ["accounts", "pipeline"];
    expect((await post({ kind: "deal", id: DEAL, key: "najdprecast.com" })).status).toBe(200);
    expect(state.db.tables.record_comments[0]).toMatchObject({ object_type: "opportunities", object_id: DEAL });
  });
});

describe("saving to a competitor", () => {
  it("goes through the tender deal gate first: a deal the caller may not edit is refused before anything is read", async () => {
    state.deal = { ok: false, status: 403, error: "You can view this deal but not change it" };
    const res = await post({ kind: "competitor", id: DEAL, competitor_id: COMP, key: "najdprecast.com" });
    expect(res.status).toBe(403);
    expect(state.db.tables.opportunity_competitors).toHaveLength(0);
  });

  it("writes the evidence of this deal's competitor in this workspace", async () => {
    await seed({ opportunity_competitors: [{ id: COMP, tenant_id: T1, opportunity_id: DEAL, name: "Najd Precast Co.", status: "accepted", origin: "manual", evidence: null }] });
    const res = await post({ kind: "competitor", id: DEAL, competitor_id: COMP, key: "najdprecast.com" });
    expect(res.status).toBe(200);
    expect(state.db.tables.opportunity_competitors[0].evidence).toMatchObject({ v: 1, model: "company_report" });
  });

  it("a competitor of another workspace is a 404", async () => {
    await seed({ opportunity_competitors: [{ id: COMP, tenant_id: T2, opportunity_id: DEAL, name: "X", status: "accepted", evidence: null }] });
    expect((await post({ kind: "competitor", id: DEAL, competitor_id: COMP, key: "najdprecast.com" })).status).toBe(404);
    expect(state.db.tables.opportunity_competitors[0].evidence).toBeNull();
  });
});
