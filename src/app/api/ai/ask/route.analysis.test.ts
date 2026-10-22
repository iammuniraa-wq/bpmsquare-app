import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The route's part in the slider's company analysis: whether the workspace has it, what of the request is trusted, and what
// the loop is handed. The loop and the engine are covered by assistant/analyse.flow.test.ts.

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

import { GET, POST } from "./route";
import { issueOnceConsent } from "@/lib/assistant/consentToken";
import { encodeAnalysisQuery, parseToolInput } from "@/lib/assistant/analysisTool";

const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const subject = parseToolInput({ name: "Tesla Germany", country: "Germany" });
const Q = encodeAnalysisQuery(subject);
const token = (over: Partial<Parameters<typeof issueOnceConsent>[0]> = {}) => issueOnceConsent({ tenantId: "t-1", userId: "u-1", query: Q, id: "consent-1", ...over });
const post = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/ai/ask", { method: "POST", body: JSON.stringify({ question: "analyse Tesla Germany", ...body }) }));
const analysisOf = (i = 0) => state.seen[i].analysis as { direct?: { input: unknown; consentId: string | null }; config: unknown; budget: number } | undefined;

beforeEach(() => { state.features = { ai_assistant: true, ai_assistant_web: true }; state.config = {}; state.seen = []; state.unrestricted = true; });

describe("flag off", () => {
  it("an Analyse or Refresh request, or a Yes on an analysis chip, is a 404 and the loop never runs", async () => {
    state.features = { ai_assistant: true };
    for (const body of [{ analyse: { account_id: ACC } }, { allow_web: "once", consent_query: Q, consent_token: token() }]) {
      expect((await post(body)).status).toBe(404);
    }
    expect(state.seen).toEqual([]);
  });
  it("an ordinary ask is handed no analysis setup at all", async () => {
    state.features = { ai_assistant: true };
    expect((await post({})).status).toBe(200);
    expect(state.seen[0].analysis).toBeUndefined();
  });
  it("the workspace's policy against external calls switches it off whatever the flag says", async () => {
    state.config = { ai_assistant: { block_external_calls: true } };
    expect((await post({ analyse: { name: "Tesla Germany" } })).status).toBe(404);
  });
});

describe("an ordinary ask", () => {
  it("is handed the analysis setup (the workspace's own admin client, config and allowance) but no direct request", async () => {
    await post({});
    expect(analysisOf()?.direct).toBeUndefined();
    expect(analysisOf()?.budget).toBeGreaterThan(0);
  });
});

describe("Analyse and Refresh", () => {
  it("send only the named fields; the workspace and the person come from the session; no consent is implied", async () => {
    await post({ analyse: { account_id: ACC, refresh: true, tenant_id: "t-2", allow_web: true, userId: "someone-else" }, tenant_id: "t-2" });
    expect(analysisOf()?.direct).toEqual({ input: { accountId: ACC, name: null, domain: null, country: null, refresh: true }, consentId: null });
    expect(state.seen[0].tenantId).toBe("t-1");
    expect(state.seen[0].userId).toBe("u-1");
  });
  it("a bad id is dropped rather than trusted", async () => {
    await post({ analyse: { account_id: "../../etc", name: "Tesla Germany" } });
    expect(analysisOf()?.direct?.input).toMatchObject({ accountId: null, name: "Tesla Germany" });
  });
});

describe("a Yes on an analysis chip is verified on the server", () => {
  const yes = (extra: Record<string, unknown> = {}) => ({ allow_web: "once", consent_query: Q, consent_token: token(), ...extra });

  it("a token this server signed for this person, this workspace and this subject reaches the loop with its id, and the web-search path sees nothing", async () => {
    const res = await post(yes());
    expect(res.status).toBe(200);
    expect(analysisOf()?.direct).toEqual({ input: subject, consentId: "consent-1" });
    expect(state.seen[0].web).toMatchObject({ enabled: true, userId: "u-1", allow: null, consentQuery: null, consentId: null });
  });

  it("no token, a forged one, garbage, or one for someone else is no permission: the person is asked again", async () => {
    const good = token();
    const [body, sig] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), uid: "u-1", q: "other" })).toString("base64url") + "." + sig;
    const cases = [undefined, forged, body + ".AAAA", "not-a-token", 42, token({ userId: "u-2" }), token({ tenantId: "t-2" })];
    for (const [i, t] of cases.entries()) {
      await post(yes({ consent_token: t }));
      expect(analysisOf(i)?.direct?.consentId).toBeNull();
    }
  });

  it("a token for another company, or a web-search token, does not verify for this subject", async () => {
    await post(yes({ consent_token: token({ query: encodeAnalysisQuery(parseToolInput({ name: "Siemens" })) }) }));
    await post(yes({ consent_token: token({ query: "Tesla Germany company website" }) }));
    expect(analysisOf(0)?.direct?.consentId).toBeNull();
    expect(analysisOf(1)?.direct?.consentId).toBeNull();
  });

  it("an analysis token cannot start a web search: presented with an ordinary query it is no permission", async () => {
    await post({ allow_web: "once", consent_query: "Tesla Germany company website", consent_token: token() });
    expect(state.seen[0].web).toMatchObject({ allow: null, consentQuery: null });
    expect(analysisOf()?.direct).toBeUndefined();
  });

  it("a subject that is not a whole subject is a 400", async () => {
    const res = await post({ allow_web: "once", consent_query: "analyse_company|garbage", consent_token: token() });
    expect(res.status).toBe(400);
    expect(state.seen).toEqual([]);
  });
});

describe("GET tells the dock whether to offer Analyse company", () => {
  const get = () => GET(new NextRequest("http://localhost/api/ai/ask?route=/accounts"));
  it("true with the flags and the Accounts view", async () => {
    expect((await (await get()).json()).analysis).toBe(true);
  });
  it("false without the web flag, with the workspace policy, or without the Accounts view", async () => {
    state.features = { ai_assistant: true };
    expect((await (await get()).json()).analysis).toBe(false);
    state.features = { ai_assistant: true, ai_assistant_web: true };
    state.config = { ai_assistant: { block_external_calls: true } };
    expect((await (await get()).json()).analysis).toBe(false);
    state.config = {};
    state.unrestricted = false;
    expect((await (await get()).json()).analysis).toBe(false);
  });
});
