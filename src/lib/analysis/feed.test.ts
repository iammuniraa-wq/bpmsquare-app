import { describe, expect, it } from "vitest";
import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { computeIntent, liveGroups, reachableMax, thresholds } from "@/lib/signals/rubric";
import { KINDS } from "@/lib/signals/types";
import { collectWebSignals } from "@/lib/signals/collectWeb";
import { analysisFeed } from "./feed";
import type { StoredResearch } from "./compose";
import type { Claim } from "./types";


// The signals feed: what a saved analysis found on the web, as Buying signals for the account it belongs to.

const NOW = new Date("2026-10-22T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACC_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const claim = (over: Partial<Claim> = {}): Claim => ({
  text: "Won a housing package", kind: "award", confidence: "found", stale: false, publishedOn: ago(5),
  source: { id: "s1", url: "https://news.example.com/a", title: "Article", publisher: "news.example.com", fetchedAt: NOW.toISOString() }, ...over,
});
const data = (claims: Claim[], checkThese: Claim[] = []): StoredResearch => ({
  v: 1, claims, checkThese, size: null, people: [], sources: [], sentence: null, snapshot: { claims: [], fit: "unknown", stage: "quiet", verdict: "not_enough" },
});
const row = (account_id: string | null, claims: Claim[], checkThese: Claim[] = []) => ({ account_id, data: data(claims, checkThese) });

describe("the feed", () => {
  it("turns an attached, dated, found claim into a web signal in 'They are moving'", () => {
    const m = analysisFeed([row(ACC, [claim()])], NOW);
    const [s] = m.get(ACC)!;
    expect(s).toMatchObject({ kind: "web_award", source: "web", occurredAt: `${ago(5)}T00:00:00.000Z`, headline: "Won a housing package" });
    expect(KINDS[s.kind].group).toBe("moving");
  });

  it("draws no source: no address on the signal, no publisher in its line", () => {
    const [s] = analysisFeed([row(ACC, [claim()])], NOW).get(ACC)!;
    expect(s.href).toBeUndefined();
    expect(JSON.stringify(s)).not.toMatch(/https?:|news\.example\.com/);
  });

  it("keeps one signal per account, kind and day, whatever the number of articles or saved rows", () => {
    const twoArticles = [claim(), claim({ text: "Another article, same award", source: { id: "s2", url: "https://news.example.com/b", title: "B", fetchedAt: NOW.toISOString() } })];
    expect(analysisFeed([row(ACC, twoArticles)], NOW).get(ACC)).toHaveLength(1);
    expect(analysisFeed([row(ACC, [claim()]), row(ACC, [claim()])], NOW).get(ACC)).toHaveLength(1);
    // A different day, a different kind, a different account: each its own.
    const m = analysisFeed([row(ACC, [claim(), claim({ publishedOn: ago(9) }), claim({ kind: "hiring", text: "Hiring" })]), row(ACC_B, [claim()])], NOW);
    expect(m.get(ACC)).toHaveLength(3);
    expect(m.get(ACC_B)).toHaveLength(1);
  });

  it("is the same on every run (the same input gives the same signals in the same order)", () => {
    const rows = [row(ACC, [claim({ text: "B" }), claim({ kind: "hiring", text: "A" })]), row(ACC_B, [claim()])];
    expect(analysisFeed(rows, NOW)).toEqual(analysisFeed([...rows].reverse(), NOW));
  });

  it("never reads 'Check these', stale, unsure, undated, instruction-like or unattached claims", () => {
    const m = analysisFeed([
      row(ACC, [claim({ publishedOn: ago(250) }), claim({ confidence: "unsure", text: "u" }), claim({ publishedOn: undefined, text: "d" }), claim({ instructionLike: true, text: "i" })], [claim({ text: "parked" })]),
      row(null, [claim()]),
    ], NOW);
    expect(m.size).toBe(0);
  });

  it("judges staleness against today, not the day it was found", () => {
    // Stored as fresh, but 200 days old now.
    const old = claim({ publishedOn: ago(200), stale: false });
    expect(analysisFeed([row(ACC, [old])], NOW).size).toBe(0);
  });

  it("skips a row it cannot read instead of failing the run", () => {
    expect(analysisFeed([{ account_id: ACC, data: { v: 2 } }, { account_id: ACC, data: null }], NOW).size).toBe(0);
  });

  it("carries a tender, hiring and bad news as their own kinds", () => {
    const kinds = analysisFeed([row(ACC, [
      claim({ kind: "tender", tenderRole: "issuer", text: "T1", publishedOn: ago(3) }),
      claim({ kind: "hiring", text: "H", publishedOn: ago(4) }),
      claim({ kind: "risk", text: "R", publishedOn: ago(6) }),
    ])], NOW).get(ACC)!.map((s) => s.kind).sort();
    expect(kinds).toEqual(["web_hiring", "web_risk", "web_tender_issued"]);
  });
});

describe("what the feed does to the score", () => {
  it("is off-line: the live groups and the stage thresholds are exactly what they were", () => {
    expect(liveGroups()).toEqual(["asked", "responded"]);
    expect(reachableMax()).toBe(65);
    expect(thresholds()).toEqual({ deciding: 42, comparing: 26, looking: 10 });
  });

  it("feeds the existing rubric: no third score, the moving group is capped at 20", () => {
    const signals = analysisFeed([row(ACC, [
      claim({ kind: "tender", tenderRole: "issuer", text: "T", publishedOn: ago(2) }),
      claim({ kind: "award", text: "A1", publishedOn: ago(3) }),
      claim({ kind: "award", text: "A2", publishedOn: ago(4) }),
      claim({ kind: "hiring", text: "H1", publishedOn: ago(5) }),
    ])], NOW).get(ACC)!;
    const r = computeIntent(signals, { now: NOW });
    expect(r.score).toBe(20);
    expect(r.factors.some((f) => f.group === "moving" && f.points < 0 && /Limit/.test(f.label))).toBe(true);
    // Web news alone never makes an account Comparing or Deciding: that needs an ask.
    expect(["quiet", "looking"]).toContain(r.stage);
  });

  it("lifts a silent account to Looking only when enough is found, and reaches it with the account's other signals unchanged", () => {
    const one = computeIntent(analysisFeed([row(ACC, [claim({ publishedOn: ago(3) })])], NOW).get(ACC)!, { now: NOW });
    expect(one).toMatchObject({ score: 8, stage: "quiet" });
    const two = computeIntent(analysisFeed([row(ACC, [claim({ publishedOn: ago(3) }), claim({ kind: "hiring", text: "H", publishedOn: ago(4) })])], NOW).get(ACC)!, { now: NOW });
    expect(two).toMatchObject({ score: 13, stage: "looking" });
  });
});

describe("the collector", () => {
  const stored = (tenant: string, account: string | null, computed: string): Row => ({ tenant_id: tenant, account_id: account, computed_at: computed, data: data([claim()]) });
  const tenantRow = (id: string, features: Record<string, boolean>, config: Record<string, unknown> = {}): Row => ({ id, features, config });
  const ON = { ai_assistant: true, ai_assistant_web: true };

  it("reads only this workspace's saved analyses, with the workspace in the filter", async () => {
    const db = fakeAdmin({
      tenants: [tenantRow(T1, ON), tenantRow(T2, ON)],
      company_analyses: [stored(T1, ACC, NOW.toISOString()), stored(T2, ACC_B, NOW.toISOString())],
    });
    const w: string[] = [];
    const m = await collectWebSignals(db.client, T1, NOW, w);
    expect([...m.keys()]).toEqual([ACC]);
    expect(db.log.filter((l) => l.table === "company_analyses").every((l) => l.filters.includes(`tenant_id=${T1}`))).toBe(true);
    expect(w).toEqual([]);
  });

  it("contributes nothing when web research is off or blocked for the workspace", async () => {
    for (const t of [tenantRow(T1, { ai_assistant: true }), tenantRow(T1, ON, { ai_assistant: { block_external_calls: true } })]) {
      const db = fakeAdmin({ tenants: [t], company_analyses: [stored(T1, ACC, NOW.toISOString())] });
      expect((await collectWebSignals(db.client, T1, NOW, [])).size).toBe(0);
      expect(db.log.some((l) => l.table === "company_analyses")).toBe(false);
    }
  });

  it("skips accounts-less rows and rows older than ninety days", async () => {
    const db = fakeAdmin({
      tenants: [tenantRow(T1, ON)],
      company_analyses: [stored(T1, null, NOW.toISOString()), stored(T1, ACC, new Date(NOW.getTime() - 100 * 86_400_000).toISOString())],
    });
    expect((await collectWebSignals(db.client, T1, NOW, [])).size).toBe(0);
  });

  it("treats a table that is not there yet as no signals and no warning", async () => {
    const db = fakeAdmin({ tenants: [tenantRow(T1, ON)] }, { missing: ["company_analyses"] });
    const w: string[] = [];
    expect((await collectWebSignals(db.client, T1, NOW, w)).size).toBe(0);
    expect(w).toEqual([]);
  });
});
