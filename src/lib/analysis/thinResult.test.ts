import { describe, expect, it, vi } from "vitest";
import { fakeAdmin, T1 } from "@/lib/middleware/testHarness";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => { throw new Error("no database in this test"); }, requireTenantUser: vi.fn() }));

import { analyseCompany, type AnalysisAccess, type AnalyseDeps } from "./service";
import { assembleInSystem } from "./inSystem";
import { AnalysisResearchError, NO_ANSWER, NO_SEARCH, runCompanyResearch, type MessagesClient, type ResearchRun } from "./research";
import { ANALYSIS_EMPTY } from "./tips";
import type { LiveInputs } from "./compose";
import { toSubject } from "./subject";

// "Company insights" on a competitor (Amiantit, amiantit.com, Saudi Arabia) came back as a thin card. These tests hold the three things that
// made a thin card hard to read: an unreadable or search-less research run was saved as "little public information found" for seven days,
// items the search did return but could not be confirmed were dropped without a word, and the website typed without a scheme.

const T0 = new Date("2026-10-27T12:00:00Z");
const FULL = { unrestricted: true, grants: new Map() } as never;

const subject = (): ReturnType<typeof toSubject> => toSubject({ name: "Amiantit", website: "amiantit.com", country: "Saudi Arabia" });

describe("the website typed without a scheme still names the company's domain and country", () => {
  it("amiantit.com and https://amiantit.com are the same subject, and the country goes to the search", () => {
    const a = subject();
    const b = toSubject({ name: "Amiantit", website: "https://www.amiantit.com/", country: "Saudi Arabia" });
    expect(a).toMatchObject({ name: "Amiantit", domain: "amiantit.com", country: "Saudi Arabia" });
    expect(b).toMatchObject({ domain: "amiantit.com" });
  });
});

function client(content: unknown[], usage: unknown = {}, stop = "end_turn"): MessagesClient {
  return { messages: { create: vi.fn(async () => ({ content, usage, stop_reason: stop, model: "m" })) } } as unknown as MessagesClient;
}

describe("a research run that gave nothing readable is a failure, not a quiet company", () => {
  it("an answer with no JSON is refused with a plain message", async () => {
    const s = subject();
    if ("error" in s) throw new Error("subject");
    await expect(runCompanyResearch(client([{ type: "text", text: "I could not find anything." }], { server_tool_use: { web_search_requests: 2 } }), s, [])).rejects.toThrow(NO_ANSWER);
  });
  it("a run with no search and no page read is refused with a plain message", async () => {
    const s = subject();
    if ("error" in s) throw new Error("subject");
    await expect(runCompanyResearch(client([{ type: "text", text: '{"claims":[]}' }], {}), s, [])).rejects.toThrow(NO_SEARCH);
  });
  it("an empty claims array after real searches is a normal answer", async () => {
    const s = subject();
    if ("error" in s) throw new Error("subject");
    const out = await runCompanyResearch(client([
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://example.com/a", title: "A" }] },
      { type: "text", text: '{"claims":[]}' },
    ], { server_tool_use: { web_search_requests: 1 } }), s, []);
    expect(out.raw).toEqual({ claims: [] });
    expect(out.searches).toBe(1);
  });
  it("the search that failed to run saves nothing and gives the daily slot back", async () => {
    const db = fakeAdmin({ ai_usage_log: [], company_analyses: [] });
    const a: AnalysisAccess = { supabase: db.client, admin: db.client, tenantId: T1, userId: "u1", perms: FULL, features: { ai_assistant: true, ai_assistant_web: true }, config: {}, budget: 1_000_000 };
    const live: LiveInputs = {
      intent: null, terms: [], coverage: null, sizeBand: null, customer: null, notInMarket: false,
      inSystem: assembleInSystem({ account: null, contacts: null, quotes: null, deals: null, cases: null, invoices: null, lastActivity: null, accountNames: [], subject: { name: "Amiantit", domain: "amiantit.com" }, now: T0, formatValue: (n) => String(n) }),
    };
    const deps: AnalyseDeps = {
      now: () => T0, website: async () => ({ ok: false }), phrase: async () => null, live: async () => live,
      allowance: async () => ({ allowed: true, used: 0, budget: 1_000_000, remaining: 1_000_000 }) as never,
      research: async () => { throw new AnalysisResearchError(NO_ANSWER); },
    };
    const r = await analyseCompany(a, { name: "Amiantit", domain: "amiantit.com", country: "Saudi Arabia", allowWeb: true }, deps);
    expect(r).toMatchObject({ ok: false, status: 502, code: "research_failed", error: NO_ANSWER });
    expect(db.tables.company_analyses).toHaveLength(0);
    expect(db.tables.ai_usage_log).toHaveLength(0);
  });
});

describe("items the search returned but could not be confirmed are counted on the card", () => {
  it("a statement whose source the search never returned is not shown, and the card says how many were left out", async () => {
    const db = fakeAdmin({ ai_usage_log: [], company_analyses: [] });
    const a: AnalysisAccess = { supabase: db.client, admin: db.client, tenantId: T1, userId: "u1", perms: FULL, features: { ai_assistant: true, ai_assistant_web: true }, config: {}, budget: 1_000_000 };
    const live: LiveInputs = {
      intent: null, terms: [], coverage: null, sizeBand: null, customer: null, notInMarket: false,
      inSystem: assembleInSystem({ account: null, contacts: null, quotes: null, deals: null, cases: null, invoices: null, lastActivity: null, accountNames: [], subject: { name: "Amiantit", domain: "amiantit.com" }, now: T0, formatValue: (n) => String(n) }),
    };
    const run: ResearchRun = {
      raw: { claims: [
        { text: "Amiantit won a pipe supply package", kind: "award", source_url: "https://not-returned.example/x", published_on: "2026-10-01" },
        { text: "Amiantit opened a new plant", kind: "expansion", source_url: "https://also-not-returned.example/y", published_on: "2026-09-01" },
      ] },
      searches: 3, usage: {}, model: "m", tokens: { input: 1000, output: 100 }, citations: [{ url: "https://returned.example/z", title: "Other page" }],
    };
    const deps: AnalyseDeps = {
      now: () => T0, website: async () => ({ ok: false }), phrase: async () => null, live: async () => live,
      allowance: async () => ({ allowed: true, used: 0, budget: 1_000_000, remaining: 1_000_000 }) as never,
      research: async () => run,
    };
    const r = await analyseCompany(a, { name: "Amiantit", domain: "amiantit.com", country: "Saudi Arabia", allowWeb: true }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.card.doing).toEqual([]);
    expect(r.card.notes).toContain(ANALYSIS_EMPTY.littleInfo);
    expect(r.card.notes).toContain(ANALYSIS_EMPTY.unverified(2, "Amiantit"));
    // The count is kept with the saved card, so reading it back says the same.
    const saved = db.tables.company_analyses[0] as { data: { unverified?: number } };
    expect(saved.data.unverified).toBe(2);
  });
  it("the wording is plain and singular or plural", () => {
    expect(ANALYSIS_EMPTY.unverified(1, "Amiantit")).toBe("The search returned 1 item that could not be confirmed as Amiantit, so none is shown.");
    expect(ANALYSIS_EMPTY.unverified(3, "Amiantit")).toContain("3 items");
  });
});
