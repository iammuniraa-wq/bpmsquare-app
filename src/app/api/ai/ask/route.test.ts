import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The route's part in web research: whether the workspace has it, what of the request is trusted, and what the loop is
// handed. The loop itself is covered by assistant/web.flow.test.ts.

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
vi.mock("@/lib/permissions", () => ({ resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }) }));
vi.mock("@/lib/tenant", () => ({ getTenantCurrency: async () => ({ code: "SAR", symbol: "SAR", grouping: "standard" }) }));
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn(), monthlyTokensUsed: async () => 0 }));
vi.mock("@/lib/assistant/pageService", () => ({ describePage: async () => ({ context: null, suggestions: [] }) }));
vi.mock("@/lib/ai/assistant", () => ({
  askAssistant: async (_h: unknown, ctx: Record<string, unknown>) => { state.seen.push(ctx); return { answer: "ok" }; },
  capabilityList: () => [],
  AssistantError: class extends Error {},
}));

import { POST } from "./route";

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/ai/ask", { method: "POST", body: JSON.stringify({ question: "Tesla Germany online?", ...body }) }));

beforeEach(() => { state.features = { ai_assistant: true }; state.config = {}; state.seen = []; });

describe("POST /api/ai/ask and web research", () => {
  it("flag off: a request that carries a web permission is a 404, and the loop never runs", async () => {
    for (const body of [{ allow_web: "once", consent_query: "Tesla Germany company website" }, { allow_web: "chat" }]) {
      const res = await post(body);
      expect(res.status).toBe(404);
    }
    expect(state.seen).toEqual([]);
  });

  it("flag off: an ordinary ask works and the loop is handed no web context at all", async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    expect(state.seen[0].web).toBeUndefined();
  });

  it("the flag without the assistant is the assistant's own 403", async () => {
    state.features = { ai_assistant_web: true };
    expect((await post({})).status).toBe(403);
  });

  it("the workspace's own policy against external calls switches it off whatever the flag says", async () => {
    state.features = { ai_assistant: true, ai_assistant_web: true };
    state.config = { ai_assistant: { block_external_calls: true } };
    expect((await post({ allow_web: "once", consent_query: "x" })).status).toBe(404);
    const plain = await post({});
    expect(plain.status).toBe(200);
    expect(state.seen[0].web).toBeUndefined();
  });

  it("flag on: the loop gets web enabled for this person; the permission and the agreed query come from the body, the person from the session", async () => {
    state.features = { ai_assistant: true, ai_assistant_web: true };
    const res = await post({ allow_web: "once", consent_query: "  Tesla   Germany company website ", userId: "someone-else", tenant_id: "t-2" });
    expect(res.status).toBe(200);
    expect(state.seen[0].web).toEqual({ enabled: true, userId: "u-1", allow: "once", consentQuery: "Tesla Germany company website" });
    expect(state.seen[0].tenantId).toBe("t-1");
  });

  it("an agreed query only travels with a once-permission; an unknown permission is no permission", async () => {
    state.features = { ai_assistant: true, ai_assistant_web: true };
    await post({ allow_web: "chat", consent_query: "Tesla Germany company website" });
    expect(state.seen[0].web).toMatchObject({ allow: "chat", consentQuery: null });
    await post({ allow_web: "always", consent_query: "Tesla Germany company website" });
    expect(state.seen[1].web).toMatchObject({ allow: null, consentQuery: null });
  });
});
