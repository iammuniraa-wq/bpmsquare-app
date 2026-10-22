import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { fakeAdmin, T1, T2 } from "@/lib/middleware/testHarness";
import { tipTextProblems } from "@/lib/infoTip";
import { TenantProvider } from "@/lib/tenant-context";
import type { Account360Card } from "@/lib/account360/types";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => { throw new Error("no database in this test"); }, requireTenantUser: vi.fn() }));

import AnalyseButton from "@/components/analysis/AnalyseButton";
import { analyseQuestion, canAnalyse } from "./dockAsk";
import { agoInWords, buildAnalysisSummaryCard } from "./card360";
import { composeCard, type LiveInputs, type StoredResearch } from "./compose";
import { loadAnalysis360 } from "./account360";
import type { AnalyseDeps, AnalysisAccess } from "./service";
import { assembleInSystem } from "./inSystem";
import { ANALYSIS_TIPS } from "./tips";
import type { Claim } from "./types";

const NOW = new Date("2026-10-22T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACC_T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const claim = (text: string, kind: Claim["kind"], days: number, over: Partial<Claim> = {}): Claim => ({
  text, kind, confidence: "found", stale: false, publishedOn: ago(days),
  source: { id: "s1", url: "https://news.example.com/a", title: "Article", publisher: "news.example.com", fetchedAt: NOW.toISOString() }, ...over,
});

const live = (): LiveInputs => ({
  intent: null, terms: ["Precast"], coverage: null, sizeBand: null, customer: null, notInMarket: false,
  inSystem: assembleInSystem({
    account: null, contacts: null, quotes: null, deals: null, cases: null, invoices: null, lastActivity: null, accountNames: [],
    subject: { name: "Najd Precast", domain: "najdprecast.com" }, now: NOW, formatValue: (n) => String(n),
  }),
});
const stored = (claims: Claim[], sentence: StoredResearch["sentence"] = null): StoredResearch => ({
  v: 1, claims, checkThese: [], size: null, people: [], sources: [], sentence, snapshot: { claims: [], fit: "unknown", stage: "quiet", verdict: "not_enough" },
});
const cardOf = (claims: Claim[], computedDaysAgo = 3) => {
  const at = new Date(NOW.getTime() - computedDaysAgo * 86_400_000).toISOString();
  return composeCard({
    id: "an_1", companyKey: "najdprecast.com", accountId: ACC, subject: { name: "Najd Precast", domain: "najdprecast.com", city: "Riyadh", country: "Saudi Arabia", industry: "Precast concrete" },
    research: stored(claims), live: live(), now: NOW, computedAt: at, expiresAt: new Date(new Date(at).getTime() + 7 * 86_400_000).toISOString(), previous: null,
  });
};

const ACCOUNT = { id: ACC, name: "Najd Precast" };
const MANY = [
  claim("Won a housing package", "award", 5), claim("Hiring site engineers", "hiring", 12), claim("Opened a second site", "expansion", 30),
  claim("Named in a supply tender", "tender", 40, { tenderRole: "named" }), claim("Started a new line", "project", 50),
];

describe("the summary card (the Account 360 card contract: a card is data)", () => {
  it("has the card shape the drawer draws, and nothing it has to special-case", () => {
    const c: Account360Card = buildAnalysisSummaryCard(ACCOUNT, cardOf(MANY), NOW);
    expect(c).toMatchObject({ id: "company_analysis", title: "Company analysis", kind: "internal" });
    expect(c.stats?.map((s) => s.label)).toEqual(["Worth following up", "Last analysed"]);
    expect(c.stats?.[1].value).toBe("3 days ago");
    expect(c.summary).toBeTruthy();
    expect(c.empty).toBeUndefined();
  });

  it("shows the cached verdict as Yes, Not now or Unclear", () => {
    const base = cardOf(MANY);
    for (const [followUp, text] of [["yes", "Yes"], ["not_now", "Not now"], ["unclear", "Unclear"]] as const) {
      const c = buildAnalysisSummaryCard(ACCOUNT, { ...base, verdict: { ...base.verdict, followUp } }, NOW);
      expect(c.stats?.[0].value).toBe(text);
    }
  });

  it("lists the two or three newest highlights, dated in words, never more", () => {
    const c = buildAnalysisSummaryCard(ACCOUNT, cardOf(MANY), NOW);
    expect(c.rows).toHaveLength(3);
    expect(c.rows?.map((r) => r.title)).toEqual(["Won a housing package", "Hiring site engineers", "Opened a second site"]);
    expect(c.rows?.[0].meta).toBe("this week");
    expect(buildAnalysisSummaryCard(ACCOUNT, cardOf([MANY[0]]), NOW).rows).toHaveLength(1);
    expect(buildAnalysisSummaryCard(ACCOUNT, cardOf([]), NOW).rows).toBeUndefined();
  });

  it("draws no source, no link and no address: not in rows, not in the summary, not anywhere", () => {
    const c = buildAnalysisSummaryCard(ACCOUNT, cardOf(MANY), NOW);
    expect(c.rows?.every((r) => r.href === undefined)).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/https?:|news\.example\.com|publisher|source/i);
  });

  it("marks bad news in the bad tone and an old analysis as old", () => {
    const risky = buildAnalysisSummaryCard(ACCOUNT, cardOf([claim("Layoffs reported", "risk", 4)]), NOW);
    expect(risky.rows?.[0].tone).toBe("bad");
    const old = buildAnalysisSummaryCard(ACCOUNT, cardOf(MANY, 9), NOW);
    expect(old.stats?.[1]).toMatchObject({ value: "9 days ago", tone: "warn" });
    expect(old.stats?.[1].hint).toMatch(/Refresh/);
    expect(buildAnalysisSummaryCard(ACCOUNT, cardOf(MANY, 3), NOW).stats?.[1].tone).toBeUndefined();
  });

  it("offers Analyse when nothing is saved and Refresh when something is, each a prepared question for the slider", () => {
    const none = buildAnalysisSummaryCard(ACCOUNT, null, NOW);
    expect(none.empty).toBe("Not analysed yet.");
    expect(none.stats).toBeUndefined();
    expect(none.action).toEqual({ label: "Analyse", ask: "Analyse Najd Precast", accountId: ACC });
    const have = buildAnalysisSummaryCard(ACCOUNT, cardOf(MANY), NOW);
    expect(have.action).toEqual({ label: "Refresh", ask: "Refresh the analysis of Najd Precast", accountId: ACC });
  });

  it("keeps its explanation behind an i, within the limit, and prints no hint line", () => {
    expect(tipTextProblems(ANALYSIS_TIPS.card360)).toEqual([]);
    expect(buildAnalysisSummaryCard(ACCOUNT, cardOf(MANY), NOW).subtitle).toBe(ANALYSIS_TIPS.card360);
  });

  it("says how long ago in words", () => {
    const at = (d: number) => agoInWords(new Date(NOW.getTime() - d * 86_400_000).toISOString(), NOW);
    expect([at(0), at(1), at(3), at(20), at(90), at(400)]).toEqual(["today", "yesterday", "3 days ago", "2 weeks ago", "3 months ago", "over a year ago"]);
  });

  it("is registered in the three places the card contract names, and is hideable like any other card", () => {
    const read = (p: string) => readFileSync(p, "utf8");
    expect(read("src/lib/account360/server.ts")).toMatch(/builtins\.company_analysis\s*=/);
    expect(read("src/lib/account360/server.ts")).toContain('"company_analysis"]');
    expect(read("src/app/(app)/settings/account-360/Account360Client.tsx")).toContain('id: "company_analysis"');
    expect(read("src/app/api/settings/account-360/route.ts")).toMatch(/CARD_IDS = \[[^\]]*"company_analysis"/);
  });
});

describe("opening the drawer costs nothing", () => {
  let db: ReturnType<typeof fakeAdmin>;
  let research: ReturnType<typeof vi.fn>;
  let phrase: ReturnType<typeof vi.fn>;
  let allowance: ReturnType<typeof vi.fn>;

  const FULL = { unrestricted: true, grants: new Map() } as never;
  const NONE = { unrestricted: false, grants: new Map() } as never;
  const access = (over: Partial<AnalysisAccess> = {}): AnalysisAccess => ({
    supabase: db.client, admin: db.client, tenantId: T1, userId: "u1", perms: FULL,
    features: { ai_assistant: true, ai_assistant_web: true }, config: {}, budget: 1_000_000, ...over,
  });
  const deps = (): AnalyseDeps => ({
    now: () => NOW, research: research as never, website: async () => ({ ok: false }), phrase: phrase as never, allowance: allowance as never, live: async () => live(),
  });
  const savedRow = (tenant: string, account: string) => ({
    id: "row1", tenant_id: tenant, company_key: "najdprecast.com", account_id: account, name: "Najd Precast", domain: "najdprecast.com",
    data: stored(MANY.slice(0, 2)), version: 1, computed_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(), expires_at: new Date(NOW.getTime() + 4 * 86_400_000).toISOString(),
  });

  beforeEach(() => {
    db = fakeAdmin({
      accounts: [
        { id: ACC, tenant_id: T1, name: "Najd Precast", website: "https://najdprecast.com", city: "Riyadh", country: "Saudi Arabia", industry: "Precast concrete" },
        { id: ACC_T2, tenant_id: T2, name: "Other Tenant Customer", website: "https://other.example" },
      ],
      company_analyses: [savedRow(T1, ACC)], ai_usage_log: [],
    });
    research = vi.fn(); phrase = vi.fn(); allowance = vi.fn();
  });

  it("reads the saved analysis only: no web research, no AI sentence, no allowance check, no usage row", async () => {
    const r = await loadAnalysis360(access(), ACC, deps());
    expect(r?.card?.name).toBe("Najd Precast");
    expect(r?.card?.doing.length).toBeGreaterThan(0);
    expect(research).not.toHaveBeenCalled();
    expect(phrase).not.toHaveBeenCalled();
    expect(allowance).not.toHaveBeenCalled();
    expect(db.tables.ai_usage_log).toHaveLength(0);
    expect(db.log.some((l) => l.op !== "select")).toBe(false);
  });

  it("answers 'not analysed yet' as a null card, not as an error and not as a search", async () => {
    db = fakeAdmin({ accounts: [{ id: ACC, tenant_id: T1, name: "Najd Precast", website: "https://najdprecast.com" }], company_analyses: [], ai_usage_log: [] });
    const r = await loadAnalysis360(access(), ACC, deps());
    expect(r).toEqual({ card: null });
    expect(research).not.toHaveBeenCalled();
  });

  it("is absent altogether without web research, without the assistant, or without the Accounts view", async () => {
    expect(await loadAnalysis360(access({ features: { ai_assistant: true } }), ACC, deps())).toBeNull();
    expect(await loadAnalysis360(access({ features: { ai_assistant_web: true } }), ACC, deps())).toBeNull();
    expect(await loadAnalysis360(access({ config: { ai_assistant: { block_external_calls: true } } }), ACC, deps())).toBeNull();
    expect(await loadAnalysis360(access({ perms: NONE }), ACC, deps())).toBeNull();
    expect(db.log).toHaveLength(0);
  });

  it("leaves another workspace's account out, and never reads another workspace's saved row", async () => {
    expect(await loadAnalysis360(access(), ACC_T2, deps())).toBeNull();
    const r = await loadAnalysis360(access({ tenantId: T2 }), ACC_T2, deps());
    expect(r).toEqual({ card: null });
    expect(db.log.filter((l) => l.table === "company_analyses").every((l) => l.filters.some((f) => f.startsWith("tenant_id=")))).toBe(true);
  });
});

describe("the Analyse buttons", () => {
  const render = (features: Record<string, boolean>, props: Partial<Parameters<typeof AnalyseButton>[0]> = {}) =>
    renderToString(createElement(TenantProvider, {
      tenant: { features } as never, userRole: "member", children: createElement(AnalyseButton, { name: "Najd Precast", accountId: ACC, ...props }),
    }));

  it("shows only when the assistant and web research are both on for the workspace", () => {
    expect(render({ ai_assistant: true, ai_assistant_web: true })).toContain("Analyse company");
    expect(render({ ai_assistant: true })).toBe("");
    expect(render({ ai_assistant_web: true })).toBe("");
    expect(render({})).toBe("");
  });

  it("a screen can withhold it (no Accounts view), and can label and style it its own way", () => {
    const on = { ai_assistant: true, ai_assistant_web: true };
    expect(render(on, { show: false })).toBe("");
    const out = render(on, { label: "Analyse", className: "btn" });
    expect(out).toContain('class="btn"');
    expect(out).toContain(">Analyse<");
  });

  it("canAnalyse is the same two-switch rule, and the question is the one the slider's tool understands", () => {
    expect(canAnalyse({ ai_assistant: true, ai_assistant_web: true })).toBe(true);
    expect(canAnalyse({ ai_assistant: true, ai_assistant_web: false })).toBe(false);
    expect(canAnalyse(null)).toBe(false);
    expect(analyseQuestion("  Najd   Precast ")).toBe("Analyse Najd Precast");
    expect(analyseQuestion("Najd Precast", true)).toBe("Refresh the analysis of Najd Precast");
  });

  it("sits in the one existing action area of the account page and of the Buying signals row, not as a copy elsewhere", () => {
    const read = (p: string) => readFileSync(p, "utf8");
    expect(read("src/app/(app)/accounts/[id]/page.tsx")).toContain("<AnalyseButton");
    expect(read("src/app/(app)/marketing/signals/SignalsWorkspace.tsx")).toContain("<AnalyseButton");
    expect(read("src/app/(app)/marketing/signals/SignalsWorkspace.tsx").match(/<AnalyseButton/g)).toHaveLength(1);
  });
});

describe("the old 'Get market signals' is retired into the analysis", () => {
  it("has no second research implementation, route or client cache left", async () => {
    const { existsSync, readdirSync } = await import("node:fs");
    for (const gone of [
      "src/components/NovaAccountMarketSignals.tsx", "src/app/api/nova/market-intel/route.ts",
      "src/lib/nova/marketIntel.ts", "src/lib/nova/marketIntelClient.ts",
    ]) expect(existsSync(gone), gone).toBe(false);
    expect(readdirSync("src/lib/nova").some((f) => /marketIntel/.test(f))).toBe(false);
    const { NOVA_NATIVE_META } = await import("@/lib/nova/streamLayout");
    expect(Object.keys(NOVA_NATIVE_META)).not.toContain("nova_market_signals");
  });

  it("a saved Stream layout that still names the old block simply loses it", async () => {
    const { resolveNovaLayout } = await import("@/lib/nova/streamLayout");
    const out = resolveNovaLayout([{ id: "nova_kpis" }, { id: "nova_market_signals", hidden: false }], {} as never);
    expect(out.map((b) => b.id)).not.toContain("nova_market_signals");
    expect(out.map((b) => b.id)).toContain("nova_kpis");
  });
});
