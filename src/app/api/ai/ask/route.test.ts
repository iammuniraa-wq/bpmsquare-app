import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";

// The route's part in web research: whether the workspace has it, what of the request is trusted, and what the loop is
// handed. The loop itself is covered by assistant/web.flow.test.ts.

vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests"; });

const state = vi.hoisted(() => ({
  features: {} as Record<string, boolean>,
  config: {} as Record<string, unknown>,
  seen: [] as Record<string, unknown>[],
  role: "admin" as "admin" | "member",
  screenAdmin: [] as boolean[],
}));

vi.mock("@/lib/supabase-server", () => {
  const tenants = { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { features: state.features, config: state.config } }) }) }) };
  return {
    requireTenantUser: async () => ({ supabase: { from: () => tenants }, tenantId: "t-1", userId: "u-1", role: state.role }),
    createAdminSupabase: () => ({}),
  };
});
vi.mock("@/lib/permissions", () => ({ resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }) }));
vi.mock("@/lib/tenant", () => ({ getTenantCurrency: async () => ({ code: "SAR", symbol: "SAR", grouping: "standard" }) }));
vi.mock("@/lib/assistant/screens", () => ({ resolveScreen: async (_r: unknown, a: { isAdmin: boolean }) => { state.screenAdmin.push(a.isAdmin); return null; } }));
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn(), monthlyTokensUsed: async () => 0 }));
vi.mock("@/lib/assistant/pageService", () => ({ describePage: async () => ({ context: null, suggestions: [] }) }));
vi.mock("@/lib/ai/assistant", () => ({
  askAssistant: async (_h: unknown, ctx: Record<string, unknown>) => { state.seen.push(ctx); return { answer: "ok" }; },
  capabilityList: () => [],
  AssistantError: class extends Error {},
}));

import { GET, POST } from "./route";
import { ONCE_TTL_MS, issueOnceConsent } from "@/lib/assistant/consentToken";

const signForTest = (body: string): string => {
  const key = crypto.createHmac("sha256", "bpmsquare.assistant.consent.v1").update("service-role-key-for-tests").digest();
  return crypto.createHmac("sha256", key).update(body).digest("base64url");
};
const post = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/ai/ask", { method: "POST", body: JSON.stringify({ question: "Tesla Germany online?", ...body }) }));

beforeEach(() => { state.features = { ai_assistant: true }; state.config = {}; state.seen = []; state.role = "admin"; state.screenAdmin = []; });

describe("POST /api/ai/ask and web research", () => {
  it("flag off: a request that carries a web permission is a 404, and the loop never runs", async () => {
    for (const body of [{ allow_web: "once", consent_query: "Tesla Germany company website" }]) {
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

  const Q = "Tesla Germany company website";
  const onceFor = (over: Partial<Parameters<typeof issueOnceConsent>[0]> = {}) =>
    issueOnceConsent({ tenantId: "t-1", userId: "u-1", query: Q, id: "consent-1", ...over });

  it("flag on: a permission backed by a token this server signed reaches the loop; the person comes from the session", async () => {
    state.features = { ai_assistant: true, ai_assistant_web: true };
    const res = await post({ allow_web: "once", consent_query: "  Tesla   Germany company website ", consent_token: onceFor(), userId: "someone-else", tenant_id: "t-2" });
    expect(res.status).toBe(200);
    expect(state.seen[0].web).toEqual({ enabled: true, userId: "u-1", allow: "once", consentQuery: Q, consentId: "consent-1" });
    expect(state.seen[0].tenantId).toBe("t-1");
    expect(Object.keys(await res.json())).not.toContain("web_chat_token");
  });

  describe("consent is verified on the server (audit 2026-10-22 L5)", () => {
    beforeEach(() => { state.features = { ai_assistant: true, ai_assistant_web: true }; });
    const noPermission = (i = 0) => expect(state.seen[i].web).toMatchObject({ allow: null, consentQuery: null, consentId: null });

    it("a permission with no token is no permission, whatever it says", async () => {
      await post({ allow_web: "once", consent_query: Q });
      await post({ allow_web: "once" });
      noPermission(0);
      noPermission(1);
    });

    it("a forged, tampered or garbage token is refused", async () => {
      const good = onceFor();
      const [body, sig] = good.split(".");
      const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), q: "other" })).toString("base64url") + "." + sig;
      for (const [i, token] of [tampered, body + ".AAAA", "not-a-token", 42, null].entries()) {
        await post({ allow_web: "once", consent_query: Q, consent_token: token });
        noPermission(i);
      }
    });

    it("a token for another query, another person, another workspace or an expired one is refused", async () => {
      await post({ allow_web: "once", consent_query: "Tesla Germany annual revenue", consent_token: onceFor() });
      await post({ allow_web: "once", consent_query: Q, consent_token: onceFor({ userId: "u-2" }) });
      await post({ allow_web: "once", consent_query: Q, consent_token: onceFor({ tenantId: "t-2" }) });
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const old = onceFor();
        vi.setSystemTime(Date.now() + ONCE_TTL_MS + 1000);
        await post({ allow_web: "once", consent_query: Q, consent_token: old });
      } finally { vi.useRealTimers(); }
      for (let i = 0; i < 4; i++) noPermission(i);
    });

    it("the same wording in other case and spacing is the same query", async () => {
      await post({ allow_web: "once", consent_query: "  tesla GERMANY   company website", consent_token: onceFor() });
      expect(state.seen[0].web).toMatchObject({ allow: "once" });
    });

    it("there is no standing permission: 'chat' is not a permission, with or without a token, and no chat token is ever handed back", async () => {
      const first = await post({ allow_web: "chat", consent_query: Q, consent_token: onceFor() });
      await post({ allow_web: "chat" });
      noPermission(0);
      noPermission(1);
      expect(Object.keys(await first.json())).not.toContain("web_chat_token");
    });

    it("a token of the retired chat kind is refused (it verifies as malformed)", async () => {
      const retired = (() => {
        const good = onceFor();
        const [body] = good.split(".");
        const payload = { ...JSON.parse(Buffer.from(body, "base64url").toString()), k: "chat" };
        const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
        // Signed with the same key as a genuine token would be, so only the kind can be what refuses it.
        return b64 + "." + signForTest(b64);
      })();
      await post({ allow_web: "once", consent_query: Q, consent_token: retired });
      noPermission(0);
    });

    it("a token without a matching query is refused even when it is a genuine once-token", async () => {
      await post({ allow_web: "once", consent_token: onceFor() });
      noPermission(0);
    });
  });
});

describe("guide mode and who is an admin (audit 2026-10-22 L2)", () => {
  // The mocked permission set is unrestricted, as for a member with no Business Role.
  it("a member with no Business Role is not an admin for the screen manifests, on GET and POST", async () => {
    state.role = "member";
    await GET(new NextRequest("http://localhost/api/ai/ask?route=/settings/webhooks-library"));
    await post({ route: "/settings/webhooks-library" });
    expect(state.screenAdmin).toEqual([false]);
    expect(state.seen[0].isWorkspaceAdmin).toBe(false);
  });

  it("a workspace admin is one", async () => {
    await GET(new NextRequest("http://localhost/api/ai/ask?route=/settings/webhooks-library"));
    await post({});
    expect(state.screenAdmin).toEqual([true]);
    expect(state.seen[0].isWorkspaceAdmin).toBe(true);
  });
});
