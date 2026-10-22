import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, T1 } from "@/lib/middleware/testHarness";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => { throw new Error("no database in this test"); }, requireTenantUser: vi.fn() }));
const recompute = vi.fn(async () => ({}));
vi.mock("@/lib/signals/recompute", () => ({ recomputeTenant: (...a: unknown[]) => (recompute as (...x: unknown[]) => unknown)(...a) }));

import { analyseCompany, defaultDeps, type AnalyseDeps, type AnalysisAccess } from "./service";
import { assembleInSystem } from "./inSystem";
import type { ResearchRun } from "./research";
import type { LiveInputs } from "./compose";

// After a fresh analysis of an account is saved, that account is scored again so the findings reach Buying signals now.

const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const NOW = new Date("2026-10-21T12:00:00Z");
const FULL = { unrestricted: true, grants: new Map() } as never;
const URL1 = "https://www.arabnews.com/node/9";

const live = (): LiveInputs => ({
  intent: null, terms: ["Precast"], coverage: null, sizeBand: null, customer: null, notInMarket: false,
  inSystem: assembleInSystem({
    account: null, contacts: null, quotes: null, deals: null, cases: null, invoices: null, lastActivity: null, accountNames: [],
    subject: { name: "Najd Precast", domain: "najdprecast.com" }, now: NOW, formatValue: (n) => String(n),
  }),
});
const run = (): ResearchRun => ({
  raw: { claims: [{ text: "Won a housing package", kind: "award", source_url: URL1, published_on: "2026-10-18", about_subject: true }] },
  searches: 2, usage: {}, model: "m", tokens: { input: 1000, output: 100 }, citations: [{ url: URL1, title: "Najd Precast wins package" }],
});

let db: ReturnType<typeof fakeAdmin>;
let rescore: ReturnType<typeof vi.fn>;

const access = (features: Record<string, boolean> = { ai_assistant: true, ai_assistant_web: true }): AnalysisAccess => ({
  supabase: db.client, admin: db.client, tenantId: T1, userId: "u1", perms: FULL, features, config: {}, budget: 1_000_000,
});
const deps = (over: Partial<AnalyseDeps> = {}): AnalyseDeps => ({
  now: () => NOW, research: vi.fn(async () => run()) as never, website: async () => ({ ok: false }), phrase: vi.fn(async () => null) as never,
  allowance: vi.fn(async () => ({ allowed: true, used: 0, budget: 1_000_000, remaining: 1_000_000 })) as never, live: async () => live(), rescore: rescore as never, ...over,
});

beforeEach(() => {
  db = fakeAdmin({
    accounts: [{ id: ACC, tenant_id: T1, name: "Najd Precast Co.", website: "https://www.najdprecast.com", city: "Riyadh", country: "Saudi Arabia", industry: "Precast concrete" }],
    ai_usage_log: [], company_analyses: [],
  });
  rescore = vi.fn(async () => undefined);
  recompute.mockClear();
});

describe("scoring the account again after an analysis", () => {
  it("runs once, for that account, after the findings are saved", async () => {
    const r = await analyseCompany(access(), { accountId: ACC, allowWeb: true }, deps());
    expect(r).toMatchObject({ ok: true, saved: true, cached: false });
    expect(rescore).toHaveBeenCalledTimes(1);
    expect(rescore).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T1 }), ACC);
    expect(db.tables.company_analyses).toHaveLength(1);
  });

  it("does not run for a card read from the cache, for a card built without the web, or for a company that is not an account", async () => {
    await analyseCompany(access(), { accountId: ACC, allowWeb: true }, deps());
    rescore.mockClear();
    await analyseCompany(access(), { accountId: ACC, allowWeb: true }, deps());
    await analyseCompany(access(), { name: "Some Other Co", allowWeb: false }, deps());
    await analyseCompany(access(), { name: "Some Other Co", domain: "someother.com", allowWeb: true }, deps());
    expect(rescore).not.toHaveBeenCalled();
  });

  it("never fails the analysis, which already succeeded", async () => {
    rescore.mockRejectedValueOnce(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await analyseCompany(access(), { accountId: ACC, allowWeb: true }, deps());
    spy.mockRestore();
    expect(r).toMatchObject({ ok: true, saved: true });
  });

  it("by default rescores only that account, and only in a workspace that owns Buying signals", async () => {
    const d = defaultDeps();
    await d.rescore!(access({ ai_assistant: true, ai_assistant_web: true }), ACC);
    expect(recompute).not.toHaveBeenCalled();
    await d.rescore!(access({ ai_assistant: true, ai_assistant_web: true, marketing: true, buying_signals: true }), ACC);
    expect(recompute).toHaveBeenCalledTimes(1);
    expect(recompute).toHaveBeenCalledWith(expect.anything(), T1, { only: [ACC], source: "analysis" });
  });
});
