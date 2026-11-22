import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => { throw new Error("no database in this test"); }, getAuthUser: async () => null, requireTenantUser: vi.fn() }));

import { commentAllowed, reportToComment, reportToEvidence, saveReportComment, saveReportCompetitor } from "./save";
import { saveReport } from "./cache";
import { validateReport } from "./validate";
import { loadOfferings } from "./service";
import { reportCacheKey } from "../budget";
import type { PermissionSet } from "@/lib/permissions";

// Saving a report writes nothing new of its own: a readable comment on the record's timeline (module and workcenter
// checked, the record verified in this workspace, written with the service role), or the sourced facts into a competitor's
// evidence. The content is always read back from this workspace's own cache, never taken from the request.

const NOW = new Date("2026-10-21T12:00:00Z");
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ACC_T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const DEAL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const COMP = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const COMP_T2 = "ffffffff-ffff-4fff-8fff-fffffffffff2";
const SITE = "https://najdprecast.com/about";
const NEWS = "https://www.arabnews.com/node/9";
const KEY = "najdprecast.com";

const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const grant = (...wc: string[]): PermissionSet => ({ unrestricted: false, grants: new Map(wc.map((w) => [w, { workcenter: w, canView: true, canCreate: false, canEdit: true, canDelete: false }])) }) as never;
const NOVA = { next_experience: true, accounts: true, leads: true, pipeline: true, gcc_tender: true };

const built = () => validateReport({
  overview: [{ text: "Najd Precast makes precast concrete elements for housing.", source_url: SITE }],
  products: [{ text: "Hollow-core slabs", source_url: SITE }],
  leadership: [{ name: "Khalid Al-Harbi", title: "Chief Executive Officer", source_url: SITE }],
  news: [{ text: "Won a SAR 120 m housing package", published_on: "2026-10-18", source_url: NEWS }],
  projects: [{ text: "Riyadh housing package", kind: "award", published_on: "2026-10-18", source_url: NEWS }],
  strengths: [{ text: "In-house casting yard", source_url: SITE }],
  compete: [{ offering: "Precast concrete", text: "Competes directly on housing elements." }],
}, {
  subject: { name: "Najd Precast Co.", domain: "najdprecast.com", country: "Saudi Arabia" },
  citations: [{ url: SITE, title: "About Najd Precast" }, { url: NEWS, title: "Najd Precast wins package" }],
  offerings: ["Precast concrete"], now: NOW, searches: 6,
}).report;

let db: ReturnType<typeof fakeAdmin>;

async function seed(extra: Record<string, Row[]> = {}, tenant = T1) {
  db = fakeAdmin({
    accounts: [{ id: ACC, tenant_id: T1 }, { id: ACC_T2, tenant_id: T2 }],
    opportunities: [{ id: DEAL, tenant_id: T1 }],
    leads: [], record_comments: [], company_analyses: [], opportunity_competitors: [], ...extra,
  });
  await saveReport(db.client as never, {
    tenantId: tenant, companyKey: KEY, report: built(), version: 1, searches: 6, inputTokens: 1, outputTokens: 1, requestedBy: "u1",
    computedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
  });
}

const ctx = (over: Record<string, unknown> = {}) => ({ admin: db.client, tenantId: T1, userId: "u1", email: "me@x.com", features: NOVA, perms: ALL, ...over }) as never;

beforeEach(async () => { await seed(); });

describe("the cache key", () => {
  it("a report has a key of its own, so the verdict card's row for the same company is never touched", () => {
    expect(reportCacheKey("najdprecast.com")).toBe("report:najdprecast.com");
    expect(reportCacheKey("")).toBe("");
    expect(db.tables.company_analyses[0].company_key).toBe("report:najdprecast.com");
    expect(db.tables.company_analyses[0].account_id).toBeNull();
  });
});

describe("the readable comment", () => {
  const text = reportToComment(built());

  it("names the company, the sections with their statements, the numbered sources and the inference label", () => {
    expect(text).toContain("Company report: Najd Precast Co. (Saudi Arabia)");
    expect(text).toContain("Products and services\n- Hollow-core slabs [1]");
    expect(text).toContain("- Khalid Al-Harbi, Chief Executive Officer [1]");
    expect(text).toContain("Recent news\n- Won a SAR 120 m housing package (2026-10-18) [2]");
    expect(text).toContain("How they compete with us (the assistant's own inference, not from a source)");
    expect(text).toContain("[2] Najd Precast wins package https://www.arabnews.com/node/9");
  });

  it("stays inside the comment limit with its sources whole, and says when it was shortened", () => {
    const big = built();
    big.products = Array.from({ length: 8 }, (_, i) => ({ text: `Product ${i} ${"x".repeat(300)}`, src: 1 }));
    big.strengths = Array.from({ length: 5 }, (_, i) => ({ text: `Strength ${i} ${"y".repeat(300)}`, src: 1 }));
    big.projects = Array.from({ length: 8 }, (_, i) => ({ text: `Project ${i} ${"z".repeat(300)}`, src: 2 }));
    const t = reportToComment(big);
    expect(t.length).toBeLessThanOrEqual(4000);
    expect(t).toContain("(shortened)");
    expect(t).toContain("https://najdprecast.com/about");
    expect(t).toContain("https://www.arabnews.com/node/9");
  });
});

describe("who may post it", () => {
  it("needs the Nova timeline, the module and the workcenter", () => {
    expect(commentAllowed(NOVA, ALL, "account")).toBe(true);
    expect(commentAllowed({ ...NOVA, next_experience: false }, ALL, "account")).toBe(false);
    expect(commentAllowed({ ...NOVA, accounts: false }, ALL, "account")).toBe(false);
    expect(commentAllowed(NOVA, grant("quotations"), "account")).toBe(false);
    expect(commentAllowed(NOVA, grant("accounts"), "account")).toBe(true);
    expect(commentAllowed(NOVA, grant("pipeline"), "deal")).toBe(true);
    expect(commentAllowed(NOVA, grant("accounts"), "deal")).toBe(false);
  });
});

describe("saving to a record's timeline", () => {
  it("writes one comment with the service role, this workspace, this person and the readable body", async () => {
    const r = await saveReportComment(ctx(), "account", ACC, KEY);
    expect(r).toMatchObject({ ok: true });
    expect(db.tables.record_comments).toHaveLength(1);
    expect(db.tables.record_comments[0]).toMatchObject({ tenant_id: T1, object_type: "accounts", object_id: ACC, author_id: "u1", author_email: "me@x.com", mentions: [] });
    expect(String(db.tables.record_comments[0].body)).toContain("Company report: Najd Precast Co.");
  });

  it("posts on a deal as an opportunity", async () => {
    await saveReportComment(ctx(), "deal", DEAL, KEY);
    expect(db.tables.record_comments[0]).toMatchObject({ object_type: "opportunities", object_id: DEAL });
  });

  it("an account of another workspace is 'not found' and nothing is written", async () => {
    const r = await saveReportComment(ctx(), "account", ACC_T2, KEY);
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(db.tables.record_comments).toHaveLength(0);
  });

  it("without the module, the workcenter or the Nova timeline it is 'not found', not 'forbidden', and nothing is written", async () => {
    for (const o of [{ features: { ...NOVA, accounts: false } }, { perms: grant("quotations") }, { features: { ...NOVA, next_experience: false } }]) {
      expect(await saveReportComment(ctx(o), "account", ACC, KEY)).toMatchObject({ ok: false, status: 404, error: "Record not found" });
    }
    expect(db.tables.record_comments).toHaveLength(0);
  });

  it("the report is read from this workspace's own cache: another workspace's report cannot be saved here", async () => {
    await seed({}, T2);
    expect(await saveReportComment(ctx(), "account", ACC, KEY)).toMatchObject({ ok: false, status: 404 });
    expect(await saveReportComment(ctx({ tenantId: T2 }), "account", ACC_T2, KEY)).toMatchObject({ ok: true });
  });

  it("a report that is no longer saved says so", async () => {
    expect(await saveReportComment(ctx(), "account", ACC, "other.example.com")).toMatchObject({ ok: false, status: 404, error: expect.stringContaining("Run it again") });
  });

  it("a failed insert is a message, not a crash", async () => {
    db = fakeAdmin({ accounts: [{ id: ACC, tenant_id: T1 }], company_analyses: db.tables.company_analyses }, { failInsert: (t) => (t === "record_comments" ? { message: "boom" } : null) });
    expect(await saveReportComment(ctx(), "account", ACC, KEY)).toMatchObject({ ok: false, status: 500 });
  });
});

describe("saving to a competitor's evidence", () => {
  const comp = (over: Row = {}): Row => ({ id: COMP, tenant_id: T1, opportunity_id: DEAL, name: "Najd Precast Co.", status: "accepted", origin: "manual", evidence: null, ...over });

  it("puts the sourced facts in that competitor's evidence and nothing else changes on the row", async () => {
    await seed({ opportunity_competitors: [comp()] });
    const r = await saveReportCompetitor({ admin: db.client, tenantId: T1 }, DEAL, COMP, KEY);
    expect(r).toMatchObject({ ok: true });
    const row = db.tables.opportunity_competitors[0];
    const ev = row.evidence as { v: number; facts: { source_url: string; kind: string; published_on: string | null }[]; model: string };
    expect(ev.v).toBe(1);
    expect(ev.model).toBe("company_report");
    expect(ev.facts.length).toBeGreaterThan(3);
    expect(ev.facts.every((f) => f.source_url.startsWith("https://"))).toBe(true);
    expect(ev.facts.map((f) => f.kind)).toEqual(expect.arrayContaining(["profile", "award", "strength"]));
    expect(row).toMatchObject({ name: "Najd Precast Co.", status: "accepted", origin: "manual" });
  });

  it("keeps a price or a win the team's earlier research recorded", () => {
    const prev = { v: 1 as const, facts: [], price: { text: "Priced below us", amount: null, source_url: SITE }, wins: { text: "Beat us in 2024", source_url: NEWS }, researched_at: "", model: "" };
    const ev = reportToEvidence(built(), prev);
    expect(ev.price).toEqual(prev.price);
    expect(ev.wins).toEqual(prev.wins);
  });

  it("another workspace's competitor, another deal's competitor and a rejected one are 'not found'", async () => {
    await seed({ opportunity_competitors: [comp({ id: COMP_T2, tenant_id: T2 }), comp({ id: COMP, opportunity_id: "other-deal" }), comp({ id: "r1", status: "rejected" })] });
    expect(await saveReportCompetitor({ admin: db.client, tenantId: T1 }, DEAL, COMP_T2, KEY)).toMatchObject({ ok: false, status: 404 });
    expect(await saveReportCompetitor({ admin: db.client, tenantId: T1 }, DEAL, COMP, KEY)).toMatchObject({ ok: false, status: 404 });
    expect(await saveReportCompetitor({ admin: db.client, tenantId: T1 }, DEAL, "r1", KEY)).toMatchObject({ ok: false, status: 404 });
    expect(db.tables.opportunity_competitors.every((r) => r.evidence === null)).toBe(true);
  });

  it("the research columns not being there yet (migration 0239 pending) is said plainly", async () => {
    await seed({ opportunity_competitors: [comp()] });
    const base = db.client as unknown as { from: (t: string) => unknown };
    const realFrom = base.from.bind(base);
    const client = { from: (t: string) => {
      const q = realFrom(t) as unknown as { select: (c: string, o?: unknown) => unknown };
      if (t !== "opportunity_competitors") return q;
      const select = q.select.bind(q);
      let wide = true;
      q.select = (cols: string, o?: unknown) => { if (/evidence/.test(cols) && wide) { wide = false; return { eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "42703", message: "column evidence does not exist" } }) }) }) }) }; } return select(cols, o); };
      return q;
    } };
    const r = await saveReportCompetitor({ admin: client as never, tenantId: T1 }, DEAL, COMP, KEY);
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect((r as { error: string }).error).toContain("0239");
  });
});

describe("the offering names the research is allowed to see", () => {
  const access = (t = T1) => ({ admin: db.client, tenantId: t }) as never;

  it("are this workspace's enabled topics and segments, and nothing from another workspace", async () => {
    db = fakeAdmin({
      signal_topics: [{ tenant_id: T1, name: "Precast concrete", enabled: true }, { tenant_id: T1, name: "Retired topic", enabled: false }, { tenant_id: T2, name: "Other tenant topic", enabled: true }],
      segments: [{ tenant_id: T1, name: "Housing developers" }, { tenant_id: T2, name: "Other segment" }],
    });
    expect(await loadOfferings(access())).toEqual(["Precast concrete", "Housing developers"]);
  });

  it("drops a name that looks like a person's contact detail or is too long, and caps the list", async () => {
    db = fakeAdmin({
      signal_topics: [
        { tenant_id: T1, name: "jane@example.com", enabled: true }, { tenant_id: T1, name: "+966 50 123 4567", enabled: true }, { tenant_id: T1, name: "x".repeat(80), enabled: true },
        ...Array.from({ length: 30 }, (_, i) => ({ tenant_id: T1, name: `Topic ${i}`, enabled: true })),
      ],
    });
    const names = await loadOfferings(access());
    expect(names).toHaveLength(20);
    expect(names.join()).not.toMatch(/@|966|xxxx/);
  });

  it("a table that is not there yet is an empty list, not an error", async () => {
    db = fakeAdmin({}, { missing: ["signal_topics", "segments"] });
    expect(await loadOfferings(access())).toEqual([]);
  });
});
