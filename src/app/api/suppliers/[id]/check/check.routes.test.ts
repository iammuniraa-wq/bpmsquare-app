import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  features: {} as Record<string, boolean>,
  perms: { unrestricted: true, grants: new Map() } as { unrestricted: boolean; grants: Map<string, unknown> },
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; to: unknown }[] }[],
  research: 0,
}));

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => state.db,
  getAuthUser: async () => ({ id: "u1", email: "me@t1.test" }),
  requireTenantUser: async () => ({ tenantId: "t1", userId: "u1", role: "admin", supabase: state.db }),
}));
vi.mock("@/lib/permissions", async (orig) => ({ ...(await orig<typeof import("@/lib/permissions")>()), resolvePermissions: async () => state.perms }));
vi.mock("@/lib/changeLog", () => ({
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push({ ...p, via: (await import("@/lib/actions/via")).currentVia() } as (typeof state.changes)[number]); },
  diffForLog: () => [],
}));
vi.mock("@/lib/suppliers/check/research", async (orig) => ({
  ...(await orig<typeof import("@/lib/suppliers/check/research")>()),
  runSupplierResearch: async () => {
    state.research++;
    return {
      parts: [
        { part: "standing", ok: true, raw: { facts: [{ kind: "years", text: "Operating since 2009", source_url: "https://wadiprecast.sa/about", about_subject: true }] }, citations: [{ url: "https://wadiprecast.sa/about", title: "About Wadi Precast Pipes Factory" }], searches: 3, tokens: { input: 1000, output: 400 }, queries: [], model: "m" },
        { part: "record", ok: true, raw: { facts: [] }, citations: [], searches: 4, tokens: { input: 800, output: 100 }, queries: [], model: "m" },
      ],
      citations: [{ url: "https://wadiprecast.sa/about", title: "About Wadi Precast Pipes Factory" }], searches: 7, tokens: { input: 1800, output: 500 }, queries: [], model: "m",
    };
  },
}));
vi.mock("@/lib/ai/structured", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/structured")>()),
  askStructuredMetered: async () => ({ summary: "Cited pages say it has operated since 2009." }),
}));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { POST as SAVE } from "./save/route";
import { GET as SUMMARY } from "../../check-summary/route";
import { verifyConsent } from "@/lib/assistant/consentToken";
import { consentQueryFor } from "@/lib/suppliers/check/token";
import { LABELS, RECORDS, SID, history } from "@/lib/suppliers/check/fixtures";

const FOREIGN = "00000000-0000-4000-8000-0000000000f1";
const WEB = { suppliers: true, ai_assistant: true, ai_assistant_web: true };
const ACTIONS = { suppliers: true, ai_assistant: true, ai_assistant_actions: true, next_experience: true };

function seed() {
  const h = history();
  state.db = new MemoryDb({
    suppliers: [
      ...RECORDS.map((r) => ({ ...r, tenant_id: "t1", ref: null, city: "Riyadh" })),
      { id: FOREIGN, tenant_id: "t2", ref: null, city: "Dammam", name: "Foreign Trading", type: "vendor", status: "active", email: null, phone: null, gstin: null, notes: null, created_at: "2025-01-01T00:00:00Z", custom_data: null },
    ],
    custom_fields: LABELS.map((l, i) => ({ id: `cf${i}`, tenant_id: "t1", object_type: "supplier", field_key: l.field_key, field_label: l.label, field_type: "text", field_section: null, options: null, is_required: false, position: i })),
    tenants: [{ id: "t1", features: state.features, config: {} }],
    rfq_suppliers: h.rfqSuppliers.map((r) => ({ ...r, tenant_id: "t1" })),
    rfq_lines: h.lines.map((l) => ({ ...l, tenant_id: "t1", qty: 10 })),
    rfq_responses: h.responses.map((r) => ({ ...r, tenant_id: "t1" })),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown) => new NextRequest(`http://x${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (url: string) => new NextRequest(`http://x${url}`);
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  process.env.ASSISTANT_ACTION_SECRET = "route-test-secret";
  state.features = { suppliers: true };
  state.perms = { unrestricted: true, grants: new Map() };
  state.changes = [];
  state.research = 0;
  seed();
});
const setFeatures = (f: Record<string, boolean>) => { state.features = f; (state.db.rows("tenants")[0] as { features: unknown }).features = f; };

describe("GET /api/suppliers/[id]/check", () => {
  it("answers with no check yet, that this person may run one, and no web question while web research is off", async () => {
    const r = await GET(get(`/api/suppliers/${SID.wadi}/check`), params(SID.wadi));
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ latest: null, history: [], canRun: true, pending: false, web: { available: false, consent: null } });
  });

  it("with web research on it carries a signed consent for exactly this supplier", async () => {
    setFeatures(WEB);
    const j = await json(await GET(get(`/api/suppliers/${SID.wadi}/check`), params(SID.wadi)));
    expect(j.web.available).toBe(true);
    expect(j.web.searches).toBe(7);
    expect(verifyConsent(j.web.consent.token, { tenantId: "t1", userId: "u1", query: consentQueryFor(SID.wadi) })).toEqual({ ok: true, id: j.web.consent.id });
    expect(verifyConsent(j.web.consent.token, { tenantId: "t1", userId: "u1", query: consentQueryFor(SID.tihama) }).ok).toBe(false);
  });

  it("a supplier of another workspace is 404, a workspace without Suppliers is 404, and no access to suppliers is 403", async () => {
    expect((await GET(get(`/api/suppliers/${FOREIGN}/check`), params(FOREIGN))).status).toBe(404);
    expect((await GET(get("/api/suppliers/not-an-id/check"), params("not-an-id"))).status).toBe(404);
    setFeatures({});
    expect((await GET(get(`/api/suppliers/${SID.wadi}/check`), params(SID.wadi))).status).toBe(404);
    setFeatures({ suppliers: true });
    state.perms = { unrestricted: false, grants: new Map() };
    expect((await GET(get(`/api/suppliers/${SID.wadi}/check`), params(SID.wadi))).status).toBe(403);
  });

  it("a person who can only view suppliers sees the check but is not offered the run", async () => {
    state.perms = { unrestricted: false, grants: new Map([["suppliers", { workcenter: "suppliers", canView: true, canCreate: false, canEdit: false, canDelete: false }]]) };
    setFeatures(WEB);
    const j = await json(await GET(get(`/api/suppliers/${SID.wadi}/check`), params(SID.wadi)));
    expect(j.canRun).toBe(false);
    expect(j.web.available).toBe(false);
    expect((await POST(post(`/api/suppliers/${SID.wadi}/check`, {}), params(SID.wadi))).status).toBe(403);
  });
});

describe("POST /api/suppliers/[id]/check", () => {
  it("runs the records-only check, saves it under the SESSION's workspace (a tenant in the body is ignored) and logs it", async () => {
    const r = await POST(post(`/api/suppliers/${SID.wadi}/check`, { tenant_id: "t2", supplier_id: FOREIGN }), params(SID.wadi));
    const j = await json(r);
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ saved: true, result: { verdict: "looks_genuine", supplierId: SID.wadi } });
    expect(state.db.rows("supplier_checks")).toEqual([expect.objectContaining({ tenant_id: "t1", supplier_id: SID.wadi, checked_by: "u1" })]);
    expect(state.changes).toEqual([expect.objectContaining({ objectType: "suppliers", objectId: SID.wadi, action: "update", changes: [expect.objectContaining({ field: "Supplier check" })] })]);
    expect(state.research).toBe(0);
  });

  it("will not run for a supplier of another workspace", async () => {
    expect((await POST(post(`/api/suppliers/${FOREIGN}/check`, {}), params(FOREIGN))).status).toBe(404);
    expect(state.db.rows("supplier_checks")).toHaveLength(0);
  });

  it("web research needs the yes: no token, a token for another supplier, or web switched off, is refused and nothing is searched", async () => {
    setFeatures(WEB);
    const g = await json(await GET(get(`/api/suppliers/${SID.wadi}/check`), params(SID.wadi)));
    expect(await json(await POST(post(`/api/suppliers/${SID.wadi}/check`, { web: true }), params(SID.wadi)))).toMatchObject({ code: "needs_consent" });
    const other = await json(await GET(get(`/api/suppliers/${SID.tihama}/check`), params(SID.tihama)));
    const wrong = await POST(post(`/api/suppliers/${SID.wadi}/check`, { web: true, consent_token: other.web.consent.token }), params(SID.wadi));
    expect(wrong.status).toBe(403);
    expect(state.research).toBe(0);
    setFeatures({ suppliers: true });
    const off = await POST(post(`/api/suppliers/${SID.wadi}/check`, { web: true, consent_token: g.web.consent.token }), params(SID.wadi));
    expect((await json(off)).code).toBe("web_off");
    expect(state.research).toBe(0);
  });

  it("with the yes it researches once, saves the facts with their sources, and a replay of the same yes searches nothing more", async () => {
    setFeatures(WEB);
    const g = await json(await GET(get(`/api/suppliers/${SID.wadi}/check`), params(SID.wadi)));
    const body = { web: true, consent_token: g.web.consent.token };
    const a = await json(await POST(post(`/api/suppliers/${SID.wadi}/check`, body), params(SID.wadi)));
    expect(state.research).toBe(1);
    expect(a.saved).toBe(true);
    expect(a.result.reputation).toMatchObject({ webUsed: true, sentiment: "positive", summary: "Cited pages say it has operated since 2009.", sources: [{ url: "https://wadiprecast.sa/about" }] });
    expect(state.db.rows("supplier_checks")[0]).toMatchObject({ web_used: true, reputation_sentiment: "positive" });
    const again = await json(await POST(post(`/api/suppliers/${SID.wadi}/check`, body), params(SID.wadi)));
    expect(state.research).toBe(1);
    expect(again.result.reputation.webUsed).toBe(false);
    expect(again.notice).toMatch(/already used/);
  });

  it("save:false (the dock) saves nothing and hands back a save token only when the assistant's actions are on", async () => {
    const off = await json(await POST(post(`/api/suppliers/${SID.wadi}/check`, { save: false }), params(SID.wadi)));
    expect(off).toMatchObject({ saved: false, saveToken: null });
    setFeatures(ACTIONS);
    const on = await json(await POST(post(`/api/suppliers/${SID.wadi}/check`, { save: false }), params(SID.wadi)));
    expect(typeof on.saveToken).toBe("string");
    expect(state.db.rows("supplier_checks")).toHaveLength(0);
  });

  it("while migration 0263 is pending the check still runs and says it could not be saved", async () => {
    state.db.missing.add("supplier_checks");
    const j = await json(await POST(post(`/api/suppliers/${SID.wadi}/check`, {}), params(SID.wadi)));
    expect(j).toMatchObject({ saved: false, pending: true, result: { verdict: "looks_genuine" } });
    expect(j.saveError).toMatch(/migration 0263/);
    const g = await json(await GET(get(`/api/suppliers/${SID.wadi}/check`), params(SID.wadi)));
    expect(g).toMatchObject({ pending: true, latest: null });
    expect(g.pendingMessage).toMatch(/migration 0263/);
  });
});

describe("POST /api/suppliers/[id]/check/save (the dock's Save to supplier)", () => {
  const issue = async (id: string = SID.wadi) => json(await POST(post(`/api/suppliers/${id}/check`, { save: false }), params(id)));

  it("saves the result the server computed, once the assistant's actions are on and the token matches", async () => {
    setFeatures(ACTIONS);
    const c = await issue();
    const r = await SAVE(post(`/api/suppliers/${SID.wadi}/check/save`, { result: c.result, token: c.saveToken }), params(SID.wadi));
    expect(r.status).toBe(200);
    expect(state.db.rows("supplier_checks")).toEqual([expect.objectContaining({ tenant_id: "t1", supplier_id: SID.wadi, verdict: "looks_genuine" })]);
    expect(state.changes).toHaveLength(1);
    expect(state.changes[0]).toMatchObject({ via: "assistant" });
  });

  it("refuses a result the client edited, a token for another supplier, and a workspace whose actions are off", async () => {
    setFeatures(ACTIONS);
    const c = await issue();
    const edited = { ...c.result, verdict: "concerning" };
    expect((await SAVE(post(`/api/suppliers/${SID.wadi}/check/save`, { result: edited, token: c.saveToken }), params(SID.wadi))).status).toBe(403);
    const t = await issue(SID.tihama);
    expect((await SAVE(post(`/api/suppliers/${SID.wadi}/check/save`, { result: c.result, token: t.saveToken }), params(SID.wadi))).status).toBe(403);
    expect((await SAVE(post(`/api/suppliers/${SID.tihama}/check/save`, { result: c.result, token: c.saveToken }), params(SID.tihama))).status).toBe(400);
    setFeatures({ suppliers: true });
    expect((await SAVE(post(`/api/suppliers/${SID.wadi}/check/save`, { result: c.result, token: c.saveToken }), params(SID.wadi))).status).toBe(403);
    expect(state.db.rows("supplier_checks")).toHaveLength(0);
  });

  it("needs the person's own right to edit suppliers", async () => {
    setFeatures(ACTIONS);
    const c = await issue();
    state.perms = { unrestricted: false, grants: new Map([["suppliers", { workcenter: "suppliers", canView: true, canCreate: false, canEdit: false, canDelete: false }]]) };
    expect((await SAVE(post(`/api/suppliers/${SID.wadi}/check/save`, { result: c.result, token: c.saveToken }), params(SID.wadi))).status).toBe(403);
  });
});

describe("GET /api/suppliers/check-summary", () => {
  it("returns the newest saved check of this workspace's suppliers only", async () => {
    await POST(post(`/api/suppliers/${SID.wadi}/check`, {}), params(SID.wadi));
    (state.db.rows("supplier_checks") as Record<string, unknown>[]).push({ id: "foreign", tenant_id: "t2", supplier_id: FOREIGN, checked_at: "2026-11-01T00:00:00Z", verdict: "concerning", our_rating: null, our_rating_basis: {} });
    const j = await json(await SUMMARY(get(`/api/suppliers/check-summary?ids=${SID.wadi},${FOREIGN},junk`)));
    expect(j.summaries).toEqual([expect.objectContaining({ supplierId: SID.wadi, verdict: "looks_genuine", rating: 4.75 })]);
  });
});

describe("the check is internal", () => {
  const root = process.cwd();
  it("is not in the v1 API, its query sources, its OpenAPI, the MCP server or the data workbench", () => {
    expect(existsSync(path.join(root, "src/app/api/v1/supplier-checks"))).toBe(false);
    for (const f of ["src/lib/api/listSources.ts", "src/lib/api/openapi.ts", "src/lib/objectFeatures.ts", "mcp-server/mcp.json"]) {
      expect(readFileSync(path.join(root, f), "utf8"), f).not.toMatch(/supplier_check/);
    }
  });
});
