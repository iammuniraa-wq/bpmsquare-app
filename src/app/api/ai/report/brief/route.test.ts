import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";

// GET /api/ai/report/brief: the saved brief (no web, no model, no limit used) and "Your history with them" (read live through the
// person's own permissions), for the account's Company brief tab and the dock card. What it must never do: search, spend, return another
// workspace's brief, or put the history anywhere but this one response.

vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests"; });

const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACC_T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const state = vi.hoisted(() => ({
  access: null as unknown,
  denied: null as null | { status: number; error: string },
}));

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => { throw new Error("no database in this test"); }, getAuthUser: async () => null, requireTenantUser: vi.fn() }));
vi.mock("@/lib/analysis/access", () => ({
  resolveAnalysisAccess: async () => (state.denied ? NextResponse.json({ error: state.denied.error }, { status: state.denied.status }) : state.access),
}));
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn() }));
vi.mock("@/lib/signals/queries", () => ({ ownerNames: async () => new Map(), loadAccountSignals: async () => null }));

import { GET } from "./route";
import { saveReport } from "@/lib/analysis/report/cache";
import { validateBriefFor } from "@/lib/analysis/report/fixtures";

const NOW = new Date("2026-11-23T12:00:00Z");
const KEY = "halcyon-gulf.example";
const get = (qs: string) => GET(new NextRequest(`http://localhost/api/ai/report/brief?${qs}`));

let db: ReturnType<typeof fakeAdmin>;

async function seed(extra: Record<string, Row[]> = {}, o: { features?: Record<string, boolean>; perms?: unknown; config?: Record<string, unknown> } = {}) {
  db = fakeAdmin({
    accounts: [
      { id: ACC, tenant_id: T1, name: "Halcyon Gulf Infrastructure Co.", website: "https://halcyon-gulf.example", city: "Dammam", country: "Saudi Arabia", industry: "Construction", owner_user_id: null, type: "direct", created_at: "2024-03-01T00:00:00Z" },
      { id: ACC_T2, tenant_id: T2, name: "Other Tenant Customer", website: null },
    ],
    contacts: [{ id: "c1", tenant_id: T1, account_id: ACC, name: "Omar S.", role: "Site engineer", department: null }, { id: "c9", tenant_id: T2, account_id: ACC_T2, name: "Spy", role: "Procurement manager", department: null }],
    opportunities: [{ id: "d1", tenant_id: T1, account_id: ACC, title: "Jubail", amount: 100, stage: "x", outcome: "open", created_at: "2026-11-01T00:00:00Z", ref: "OPP-1" }],
    quotes: [], service_cases: [], invoices: [], company_analyses: [], record_comments: [], ai_usage_log: [], ...extra,
  });
  state.access = {
    supabase: db.client, admin: db.client, tenantId: T1, userId: "u1", perms: o.perms ?? { unrestricted: true, grants: new Map() },
    features: o.features ?? { ai_assistant: true, ai_assistant_web: true, accounts: true, contacts: true, pipeline: true, quotations: true, next_experience: true },
    config: o.config ?? {}, budget: 1_000_000,
  };
  state.denied = null;
}

const save = async (tenant = T1) => saveReport(db.client as never, {
  tenantId: tenant, companyKey: KEY, report: validateBriefFor(), parts: {}, version: 1, searches: 12, inputTokens: 1, outputTokens: 1, requestedBy: "u1",
  computedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
});

beforeEach(async () => { await seed(); vi.useRealTimers(); void NOW; });

describe("who may read it", () => {
  it("without web research on, or with outside calls blocked, it is 403 and nothing is read", async () => {
    await seed({}, { features: { ai_assistant: true, accounts: true } });
    expect((await get(`account_id=${ACC}`)).status).toBe(403);
    await seed({}, { config: { ai_assistant: { block_external_calls: true } } });
    expect((await get(`account_id=${ACC}`)).status).toBe(403);
  });
  it("without the Accounts view it is 403", async () => {
    await seed({}, { perms: { unrestricted: false, grants: new Map() } });
    expect((await get(`account_id=${ACC}`)).status).toBe(403);
  });
  it("a signed-out request is the session's own refusal", async () => {
    state.denied = { status: 401, error: "Unauthorized" };
    expect((await get(`account_id=${ACC}`)).status).toBe(401);
  });
  it("an account of another workspace is not found; a bad id too; no company at all is a 400", async () => {
    expect((await get(`account_id=${ACC_T2}`)).status).toBe(404);
    expect((await get("account_id=not-an-id")).status).toBe(400);
    expect((await get("")).status).toBe(400);
  });
});

describe("the saved brief", () => {
  it("is null when none is saved, and reading it searches nothing and uses no slot", async () => {
    const r = await get(`account_id=${ACC}`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.brief).toBeNull();
    expect(db.tables.ai_usage_log).toHaveLength(0);
    expect(db.tables.company_analyses).toHaveLength(0);
  });

  it("is read from this workspace's own cache by the account's company key", async () => {
    await save();
    const j = await (await get(`account_id=${ACC}`)).json();
    expect(j.brief.report.v).toBe(2);
    expect(j.brief.report.name).toBe("Halcyon Gulf Infrastructure Co.");
    expect(j.brief.cached).toBe(true);
    expect(j.brief.key).toBe(KEY);
    expect(j.brief.targets).toEqual([{ kind: "account", id: ACC, label: "account" }]);
    expect(j.brief.unmatched).toBeNull();
    expect(db.tables.ai_usage_log).toHaveLength(0);
  });

  it("another workspace's saved brief for the same company is never shown", async () => {
    await save(T2);
    expect((await (await get(`account_id=${ACC}`)).json()).brief).toBeNull();
  });

  it("an expired brief reads as none", async () => {
    await saveReport(db.client as never, { tenantId: T1, companyKey: KEY, report: validateBriefFor(), parts: {}, version: 1, searches: 12, inputTokens: 1, outputTokens: 1, requestedBy: "u1", computedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-08T00:00:00Z" });
    expect((await (await get(`account_id=${ACC}`)).json()).brief).toBeNull();
  });
});

describe("Your history", () => {
  it("is read live from this workspace's own rows through the person's permissions, and is never in the brief", async () => {
    await save();
    const j = await (await get(`account_id=${ACC}`)).json();
    expect(j.history).toMatchObject({ inCrm: true, openDeals: 1, openQuotes: 0, contactCount: 1, href: `/accounts/${ACC}` });
    expect(j.history.byFunction.operations ?? j.history.byFunction.projects).toBeDefined();
    expect(JSON.stringify(j.brief)).not.toMatch(/Omar|open deal|contactCount/);
    expect(JSON.stringify(db.tables.company_analyses)).not.toMatch(/Omar|contactCount|openDeals/);
    expect(db.tables.record_comments).toHaveLength(0);
  });

  it("never carries another workspace's contacts", async () => {
    const j = await (await get(`account_id=${ACC}`)).json();
    expect(JSON.stringify(j)).not.toContain("Spy");
  });

  it("an object the person may not view is not mentioned (null, not zero)", async () => {
    await seed({}, { features: { ai_assistant: true, ai_assistant_web: true, accounts: true, contacts: true } });
    const j = await (await get(`account_id=${ACC}`)).json();
    expect(j.history.openDeals).toBeNull();
    expect(j.history.openQuotes).toBeNull();
    expect(j.history.contactCount).toBe(1);
  });

  it("a company typed by name that is not an account is not in the CRM, with similar accounts offered", async () => {
    const j = await (await get("include=history&name=Halcyon%20Gulf%20Infrastructure&country=Saudi%20Arabia")).json();
    // The typed name matches the workspace's account, so it resolves to it.
    expect(j.history.inCrm).toBe(true);
    await seed({ accounts: [{ id: ACC, tenant_id: T1, name: "Halcyon Gulf Trading", website: null }] });
    const k = await (await get("include=history&name=Halcyon%20Gulf%20Infrastructure&country=Saudi%20Arabia")).json();
    expect(k.history.inCrm).toBe(false);
    expect(k.history.similar.map((s: { name: string }) => s.name)).toEqual(["Halcyon Gulf Trading"]);
    expect(k.brief).toBeUndefined();
  });

  it("include picks what is returned", async () => {
    await save();
    const onlyBrief = await (await get(`account_id=${ACC}&include=brief`)).json();
    expect(onlyBrief.history).toBeUndefined();
    expect(onlyBrief.brief).toBeTruthy();
    const onlyHistory = await (await get(`account_id=${ACC}&include=history`)).json();
    expect(onlyHistory.brief).toBeUndefined();
  });

  it("is not cached by the browser", async () => {
    expect((await get(`account_id=${ACC}`)).headers.get("Cache-Control")).toBe("no-store");
  });
});
