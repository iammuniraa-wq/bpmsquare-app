import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The route's part in the slider's company report: whether the workspace has it, what of the request is trusted, why web
// research is off when it is, and what the loop is handed. The loop and the engine are covered by assistant/report.flow.test.ts.

vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests"; });

const state = vi.hoisted(() => ({
  features: {} as Record<string, boolean>,
  config: {} as Record<string, unknown>,
  seen: [] as Record<string, unknown>[],
  unrestricted: true,
}));

vi.mock("@/lib/supabase-server", () => {
  const tenants = { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { features: state.features, config: state.config } }) }) }) };
  return {
    requireTenantUser: async () => ({ supabase: { from: () => tenants }, tenantId: "t-1", userId: "u-1", role: "admin" }),
    createAdminSupabase: () => ({}),
  };
});
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  resolvePermissions: async () => ({ unrestricted: state.unrestricted, grants: new Map() }),
}));
vi.mock("@/lib/tenant", () => ({ getTenantCurrency: async () => ({ code: "SAR", symbol: "SAR", grouping: "standard" }) }));
vi.mock("@/lib/assistant/screens", () => ({ resolveScreen: async () => null }));
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn(), monthlyTokensUsed: async () => 0 }));
vi.mock("@/lib/assistant/pageService", () => ({ describePage: async () => ({ context: null, suggestions: [] }) }));
vi.mock("@/lib/ai/assistant", () => ({
  askAssistant: async (_h: unknown, ctx: Record<string, unknown>) => { state.seen.push(ctx); return { answer: "ok" }; },
  capabilityList: () => [],
  AssistantError: class extends Error {},
}));

import { POST } from "./route";
import { issueOnceConsent } from "@/lib/assistant/consentToken";
import { encodeAnalysisQuery, parseToolInput } from "@/lib/assistant/analysisTool";
import { encodeReportQuery, parseReportInput } from "@/lib/assistant/reportTool";

const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const subject = parseReportInput({ name: "Tesla Germany", country: "Germany" });
const Q = encodeReportQuery(subject);
const token = (over: Partial<Parameters<typeof issueOnceConsent>[0]> = {}) => issueOnceConsent({ tenantId: "t-1", userId: "u-1", query: Q, id: "consent-1", ...over });
const post = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/ai/ask", { method: "POST", body: JSON.stringify({ question: "company report on Tesla Germany", ...body }) }));
const reportOf = (i = 0) => state.seen[i].companyReport as { direct?: { input: unknown; consentId: string | null }; config: unknown; budget: number } | undefined;

beforeEach(() => { state.features = { ai_assistant: true, ai_assistant_web: true }; state.config = {}; state.seen = []; state.unrestricted = true; });

describe("flag off", () => {
  it("a Refresh request, or a Yes on a report chip, is a 404 and the loop never runs", async () => {
    state.features = { ai_assistant: true };
    for (const body of [{ report: { account_id: ACC } }, { allow_web: "once", consent_query: Q, consent_token: token() }]) {
      expect((await post(body)).status).toBe(404);
    }
    expect(state.seen).toEqual([]);
  });

  it("an ordinary ask is handed no report setup, and is told why web research is off", async () => {
    state.features = { ai_assistant: true };
    expect((await post({})).status).toBe(200);
    expect(state.seen[0].companyReport).toBeUndefined();
    expect(state.seen[0].webOff).toBe("flag_off");
  });

  it("the three reasons reach the loop: the flag, the assistant it hangs off, and the workspace's own policy", async () => {
    state.features = { ai_assistant: true, ai_assistant_web: false };
    await post({});
    state.config = { ai_assistant: { block_external_calls: true } };
    state.features = { ai_assistant: true, ai_assistant_web: true };
    await post({});
    expect(state.seen.map((s) => s.webOff)).toEqual(["flag_off", "policy"]);
    // needs_assistant cannot reach this route: without the assistant the route answers 403 before anything else.
    state.features = { ai_assistant_web: true };
    expect((await post({})).status).toBe(403);
  });

  it("with web research on there is no reason to give", async () => {
    await post({});
    expect(state.seen[0].webOff).toBeUndefined();
  });

  it("the workspace's policy against external calls switches the report off whatever the flag says", async () => {
    state.config = { ai_assistant: { block_external_calls: true } };
    expect((await post({ report: { name: "Tesla Germany" } })).status).toBe(404);
  });
});

describe("an ordinary ask", () => {
  it("is handed the report setup (the workspace's own admin client, config and allowance) but no direct request", async () => {
    await post({});
    expect(reportOf()?.direct).toBeUndefined();
    expect(reportOf()?.budget).toBeGreaterThan(0);
  });
});

describe("Refresh", () => {
  it("sends only the named fields; the workspace and the person come from the session; no consent is implied", async () => {
    await post({ report: { account_id: ACC, refresh: true, tenant_id: "t-2", allow_web: true, userId: "someone-else" }, tenant_id: "t-2" });
    expect(reportOf()?.direct).toEqual({ input: { accountId: ACC, leadId: null, name: null, domain: null, country: null, refresh: true, retry: false, lens: "prospect" }, consentId: null });
    expect(state.seen[0].tenantId).toBe("t-1");
    expect(state.seen[0].userId).toBe("u-1");
  });

  it("a bad id is dropped rather than trusted", async () => {
    await post({ report: { account_id: "../../etc", lead_id: "1; drop table leads", name: "Tesla Germany" } });
    expect(reportOf()?.direct?.input).toMatchObject({ accountId: null, leadId: null, name: "Tesla Germany" });
  });
});

describe("a Yes on a report chip is verified on the server", () => {
  const yes = (extra: Record<string, unknown> = {}) => ({ allow_web: "once", consent_query: Q, consent_token: token(), ...extra });

  it("a token this server signed for this person, this workspace and this subject reaches the loop with its id, and the web-search path sees nothing", async () => {
    const res = await post(yes());
    expect(res.status).toBe(200);
    expect(reportOf()?.direct).toEqual({ input: subject, consentId: "consent-1" });
    expect(state.seen[0].web).toMatchObject({ enabled: true, userId: "u-1", allow: null, consentQuery: null, consentId: null });
  });

  it("no token, a forged one, garbage, or one for someone else is no permission: the person is asked again", async () => {
    const good = token();
    const [body, sig] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), uid: "u-1", q: "other" })).toString("base64url") + "." + sig;
    const cases = [undefined, forged, body + ".AAAA", "not-a-token", 42, token({ userId: "u-2" }), token({ tenantId: "t-2" })];
    for (const [i, t] of cases.entries()) {
      await post(yes({ consent_token: t }));
      expect(reportOf(i)?.direct?.consentId).toBeNull();
    }
  });

  it("a token for another company, an analysis token or a web-search token does not verify for this subject", async () => {
    await post(yes({ consent_token: token({ query: encodeReportQuery(parseReportInput({ name: "Siemens" })) }) }));
    await post(yes({ consent_token: token({ query: encodeAnalysisQuery(parseToolInput({ name: "Tesla Germany", country: "Germany" })) }) }));
    await post(yes({ consent_token: token({ query: "Tesla Germany company website" }) }));
    for (const i of [0, 1, 2]) expect(reportOf(i)?.direct?.consentId).toBeNull();
  });

  it("a report token cannot start a web search or an analysis: presented with an ordinary query it is no permission", async () => {
    await post({ allow_web: "once", consent_query: "Tesla Germany company website", consent_token: token() });
    expect(state.seen[0].web).toMatchObject({ allow: null, consentQuery: null });
    expect(reportOf()?.direct).toBeUndefined();
  });

  it("a subject that is not a whole subject is a 400", async () => {
    const res = await post({ allow_web: "once", consent_query: "research_report|garbage", consent_token: token() });
    expect(res.status).toBe(400);
    expect(state.seen).toEqual([]);
  });
});
