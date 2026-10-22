import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The route's part in "create with web research": what of the request is trusted, and what the loop is handed. The
// loop and the research are covered by assistant/create.flow.test.ts.

vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests"; });

const state = vi.hoisted(() => ({
  features: {} as Record<string, boolean>,
  config: {} as Record<string, unknown>,
  seen: [] as Record<string, unknown>[],
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
  resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }),
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
import { encodeCreateConsent } from "@/lib/assistant/createResearch";

const Q = encodeCreateConsent({ object: "account", name: "Tesla Germany" });
const token = (over: Partial<Parameters<typeof issueOnceConsent>[0]> = {}) => issueOnceConsent({ tenantId: "t-1", userId: "u-1", query: Q, id: "consent-1", ...over });
const post = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/ai/ask", { method: "POST", body: JSON.stringify({ question: "Create an account Tesla Germany", ...body }) }));
const flowOf = (i = 0) => state.seen[i].createFlow as { input: { object: string; name: string; mode: string }; consentId: string | null } | undefined;

beforeEach(() => { state.features = { ai_assistant: true, ai_assistant_web: true, ai_assistant_actions: true }; state.config = {}; state.seen = []; });

describe("the two chips", () => {
  it("send the object, the company and the mode; the workspace and the person come from the session", async () => {
    await post({ create_flow: { object: "account", name: "Tesla Germany", mode: "manual", tenant_id: "t-2", userId: "someone-else" }, tenant_id: "t-2" });
    expect(flowOf()).toEqual({ input: { object: "account", name: "Tesla Germany", mode: "manual" }, consentId: null });
    expect(state.seen[0].tenantId).toBe("t-1");
    expect(state.seen[0].userId).toBe("u-1");
  });

  it("the lookup chip carries no consent: the person is asked", async () => {
    await post({ create_flow: { object: "account", name: "Tesla Germany", mode: "web" } });
    expect(flowOf()?.consentId).toBeNull();
  });

  it("a name with separators, markup or quotes is cleaned, and an unknown shape is a 400", async () => {
    await post({ create_flow: { object: "account", name: 'Tesla|"<b>Germany</b>"', mode: "manual" } });
    expect(flowOf()?.input.name).toBe("Tesla b Germany /b");
    for (const bad of [{ object: "account", name: "x", mode: "other" }, { object: "../accounts", name: "x", mode: "web" }, { object: "account", name: "", mode: "web" }, "text"]) {
      expect((await post({ create_flow: bad })).status).toBe(400);
    }
  });
});

describe("flags off", () => {
  it("the lookup is a 404 without the web flag or under the workspace's policy, and the loop never runs", async () => {
    state.features = { ai_assistant: true, ai_assistant_actions: true };
    expect((await post({ create_flow: { object: "account", name: "Tesla Germany", mode: "web" } })).status).toBe(404);
    expect((await post({ allow_web: "once", consent_query: Q, consent_token: token() })).status).toBe(404);
    state.features = { ai_assistant: true, ai_assistant_web: true, ai_assistant_actions: true };
    state.config = { ai_assistant: { block_external_calls: true } };
    expect((await post({ create_flow: { object: "account", name: "Tesla Germany", mode: "web" } })).status).toBe(404);
    expect(state.seen).toEqual([]);
  });

  it("typing the details yourself needs no web flag: the loop decides whether actions are on", async () => {
    state.features = { ai_assistant: true, ai_assistant_actions: true };
    expect((await post({ create_flow: { object: "account", name: "Tesla Germany", mode: "manual" } })).status).toBe(200);
    expect(flowOf()?.input.mode).toBe("manual");
  });
});

describe("a Yes on the lookup chip is verified on the server", () => {
  const yes = (extra: Record<string, unknown> = {}) => ({ allow_web: "once", consent_query: Q, consent_token: token(), ...extra });

  it("a token signed for this person, workspace and company reaches the loop with its id, and the web-search path sees nothing", async () => {
    expect((await post(yes())).status).toBe(200);
    expect(flowOf()).toEqual({ input: { object: "account", name: "Tesla Germany", mode: "web" }, consentId: "consent-1" });
    expect(state.seen[0].web).toMatchObject({ enabled: true, userId: "u-1", allow: null, consentQuery: null, consentId: null });
  });

  it("no token, garbage, or one for someone else is no permission: the person is asked again", async () => {
    const cases = [undefined, "not-a-token", 42, token({ userId: "u-2" }), token({ tenantId: "t-2" })];
    for (const [i, t] of cases.entries()) {
      await post(yes({ consent_token: t }));
      expect(flowOf(i)?.consentId).toBeNull();
    }
  });

  it("a token for another company, a web-search token or an analysis token does not verify for this one", async () => {
    await post(yes({ consent_token: token({ query: encodeCreateConsent({ object: "account", name: "Siemens" }) }) }));
    await post(yes({ consent_token: token({ query: "Tesla Germany company website" }) }));
    await post(yes({ consent_token: token({ query: encodeAnalysisQuery(parseToolInput({ name: "Tesla Germany" })) }) }));
    for (const i of [0, 1, 2]) expect(flowOf(i)?.consentId).toBeNull();
  });

  it("a create token presented with an ordinary query cannot start a web search", async () => {
    await post({ allow_web: "once", consent_query: "Tesla Germany company website", consent_token: token() });
    expect(state.seen[0].web).toMatchObject({ allow: null, consentQuery: null });
    expect(flowOf()).toBeUndefined();
  });

  it("a company that is not a whole company is a 400", async () => {
    expect((await post({ allow_web: "once", consent_query: "create_research|account", consent_token: token() })).status).toBe(400);
    expect(state.seen).toEqual([]);
  });
});
