import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// POST /api/ai/report/run: the Yes on a brief chip, answered as a stream. What of the request is trusted, that it is the ask
// route's own gates (same session, same signed one-use consent), the lines it writes (one per part change, then the card), that
// it stops waiting at 105 s, and that it never hands the loop anything but the verified subject. The research itself is covered by
// assistant/report.flow.test.ts and analysis/report/research.test.ts.

vi.hoisted(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests"; });

const state = vi.hoisted(() => ({
  features: {} as Record<string, boolean>,
  config: {} as Record<string, unknown>,
  seen: [] as Record<string, unknown>[],
  unrestricted: true,
  /** What the fake loop does with the setup it is handed. */
  behave: null as null | ((ctx: { companyReport?: { onPart?: (p: string, s: string) => void; direct?: unknown } }) => Promise<Record<string, unknown>>),
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
vi.mock("@/lib/ai/structured", () => ({ allowanceFor: vi.fn(), logUsage: vi.fn(), monthlyTokensUsed: async () => 0 }));
vi.mock("@/lib/ai/assistant", () => ({
  askAssistant: async (_h: unknown, ctx: Record<string, unknown>) => {
    state.seen.push(ctx);
    return state.behave ? state.behave(ctx as never) : { answer: "ok" };
  },
  AssistantError: class extends Error {},
}));

import { POST, RUN_STOPPED } from "./route";
import { issueOnceConsent } from "@/lib/assistant/consentToken";
import { encodeReportQuery, parseReportInput } from "@/lib/assistant/reportTool";
import { encodeAnalysisQuery, parseToolInput } from "@/lib/assistant/analysisTool";
import { RUN_BUDGET_MS } from "@/lib/analysis/report/research";

const subject = parseReportInput({ name: "Tesla Germany", country: "Germany" });
const Q = encodeReportQuery(subject);
const token = (over: Partial<Parameters<typeof issueOnceConsent>[0]> = {}) => issueOnceConsent({ tenantId: "t-1", userId: "u-1", query: Q, id: "consent-1", ...over });
const yes = (extra: Record<string, unknown> = {}) => ({ question: "company report on Tesla Germany", allow_web: "once", consent_query: Q, consent_token: token(), ...extra });
const post = (body: Record<string, unknown>) => POST(new NextRequest("http://localhost/api/ai/report/run", { method: "POST", body: JSON.stringify(body) }));

async function lines(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(() => { state.features = { ai_assistant: true, ai_assistant_web: true }; state.config = {}; state.seen = []; state.unrestricted = true; state.behave = null; });
afterEach(() => { vi.useRealTimers(); });

describe("who may call it", () => {
  it("not without the assistant (403), and not with web research off (404), exactly like the ask route", async () => {
    state.features = {};
    expect((await post(yes())).status).toBe(403);
    state.features = { ai_assistant: true };
    expect((await post(yes())).status).toBe(404);
    state.features = { ai_assistant: true, ai_assistant_web: true };
    state.config = { ai_assistant: { block_external_calls: true } };
    expect((await post(yes())).status).toBe(404);
    expect(state.seen).toEqual([]);
  });

  it("only a Yes on a brief chip comes here: no question, no yes, or another kind of chip is refused", async () => {
    expect((await post({ ...yes(), question: "" })).status).toBe(400);
    expect((await post({ question: "company report on Tesla Germany" })).status).toBe(400);
    const analysis = encodeAnalysisQuery(parseToolInput({ name: "Tesla Germany" }));
    expect((await post({ question: "x", allow_web: "once", consent_query: analysis, consent_token: issueOnceConsent({ tenantId: "t-1", userId: "u-1", query: analysis, id: "c" }) })).status).toBe(400);
    expect((await post({ question: "x", allow_web: "once", consent_query: "research_report|not-a-uuid||0p|x||", consent_token: "t" })).status).toBe(400);
    expect(state.seen).toEqual([]);
  });
});

describe("what the loop is handed", () => {
  it("the verified subject and the id inside the signed token, nothing the request claims, and the web-search path sees nothing", async () => {
    await post(yes({ tenant_id: "t-2", userId: "someone-else", report: { account_id: "x" } }));
    const ctx = state.seen[0] as { tenantId: string; userId: string; web: unknown; companyReport: { direct: unknown; budget: number } };
    expect(ctx.tenantId).toBe("t-1");
    expect(ctx.userId).toBe("u-1");
    expect(ctx.companyReport.direct).toEqual({ input: subject, consentId: "consent-1" });
    expect(ctx.web).toMatchObject({ enabled: true, userId: "u-1", allow: null, consentQuery: null, consentId: null });
  });

  it("a token for someone else, another subject, garbage, or none is no permission: the loop is told no yes was given", async () => {
    const good = token();
    const [b, sig] = good.split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, "base64url").toString()), uid: "u-1", q: "other" })).toString("base64url")}.${sig}`;
    for (const t of [token({ userId: "u-2" }), token({ tenantId: "t-2" }), token({ query: encodeReportQuery(parseReportInput({ name: "Other Co" })) }), forged, "garbage", undefined]) {
      state.seen = [];
      await post(yes({ consent_token: t }));
      expect((state.seen[0].companyReport as { direct: { consentId: unknown } }).direct.consentId).toBeNull();
    }
  });
});

describe("the stream", () => {
  it("is newline-delimited JSON with no caching", async () => {
    const res = await post(yes());
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("writes one line per part change, then the card", async () => {
    state.behave = async (ctx) => {
      const on = ctx.companyReport!.onPart!;
      for (const p of ["financials", "signals", "people", "market"]) on(p, "running");
      on("financials", "done"); on("signals", "done"); on("people", "missing"); on("market", "done");
      return { answer: "Here is the brief on Tesla Germany.", companyReport: { report: { v: 2, name: "Tesla Germany" }, key: "tesla" } };
    };
    const out = await lines(await post(yes()));
    expect(out.slice(0, 4).map((l) => [l.type, l.part, l.state])).toEqual([["part", "financials", "running"], ["part", "signals", "running"], ["part", "people", "running"], ["part", "market", "running"]]);
    expect(out.filter((l) => l.state === "missing").map((l) => l.part)).toEqual(["people"]);
    expect(out.at(-1)).toMatchObject({ type: "done", answer: "Here is the brief on Tesla Germany.", companyReport: { key: "tesla" } });
  });

  it("a reply that needs a fresh yes carries its chip, not a card", async () => {
    state.behave = async () => ({ answer: "A brief on Tesla Germany needs web research first.", consent: { id: "c2", kind: "research_report", query: Q, subject: "Tesla Germany", searches: 12, token: "t", mode: "brief" } });
    const out = await lines(await post(yes({ consent_token: "garbage" })));
    expect(out.at(-1)).toMatchObject({ type: "done", consent: { kind: "research_report", id: "c2" } });
    expect(out.at(-1)).not.toHaveProperty("companyReport");
  });

  it("a failure inside is one error line with a plain message, never a stack", async () => {
    state.behave = async () => { throw new Error("secret stack detail"); };
    const out = await lines(await post(yes()));
    expect(out).toEqual([{ type: "error", message: "The brief is unavailable right now." }]);
  });

  it("stops waiting at the run budget and says what happened, then closes", async () => {
    vi.useFakeTimers();
    state.behave = () => new Promise(() => undefined);
    const pending = post(yes()).then(lines);
    await vi.advanceTimersByTimeAsync(RUN_BUDGET_MS + 10);
    expect(await pending).toEqual([{ type: "error", message: RUN_STOPPED }]);
    expect(RUN_BUDGET_MS).toBeLessThan(120_000);
  });
});
