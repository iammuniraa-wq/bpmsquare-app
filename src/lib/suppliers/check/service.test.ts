import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

const state = vi.hoisted(() => ({ db: null as unknown as MemoryDb }));
vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => state.db,
  getAuthUser: async () => ({ id: "u1", email: "me@t1.test" }),
  requireTenantUser: async () => ({ tenantId: "t1", userId: "u1", role: "admin", supabase: state.db }),
}));

import type { PermissionSet } from "@/lib/permissions";
import { buildCheck, persistCheck, readChecks, readSummaries, rowToResult, checkGate, type CheckAccess, type CheckDeps } from "./service";
import { LABELS, NOW, RECORDS, SID, history } from "./fixtures";
import type { SupplierCheckResult } from "./types";
import type { SupplierResearch } from "./research";

const T1 = "t1";
const T2 = "t2";
const FOREIGN = "00000000-0000-4000-8000-0000000000f1";
const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const NONE: PermissionSet = { unrestricted: false, grants: new Map() };

function seed(): MemoryDb {
  const h = history();
  return new MemoryDb({
    suppliers: [
      ...RECORDS.map((r) => ({ ...r, tenant_id: T1, ref: null, city: "Riyadh" })),
      // Another workspace's supplier that shares Wadi's bank and phone: it must never be compared with this workspace's.
      { id: FOREIGN, tenant_id: T2, ref: null, city: "Dammam", name: "Foreign Trading", type: "vendor", status: "active", email: "x@foreign.test", phone: "+966 11 400 1234", gstin: null, notes: null, created_at: "2025-01-01T00:00:00Z", custom_data: { cf_bank: "SA03 8000 0000 6080 1016 7519" } },
    ],
    custom_fields: LABELS.map((l, i) => ({ id: `cf${i}`, tenant_id: T1, object_type: "supplier", field_key: l.field_key, field_label: l.label, field_type: "text", field_section: null, options: null, is_required: false, position: i })),
    rfq_suppliers: h.rfqSuppliers.map((r) => ({ ...r, tenant_id: T1 })),
    rfq_lines: h.lines.map((l) => ({ ...l, tenant_id: T1, qty: 10 })),
    rfq_responses: h.responses.map((r) => ({ ...r, tenant_id: T1 })),
  });
}

const access = (over: Partial<CheckAccess> = {}): CheckAccess => ({
  admin: state.db as never, tenantId: T1, userId: "u1", perms: ALL, features: { suppliers: true, ai_assistant: true }, config: {}, budget: 1_000_000, ...over,
});

const WEB_PARTS: SupplierResearch = {
  parts: [
    { part: "standing", ok: true, raw: { facts: [{ kind: "years", text: "Operating since 2009", source_url: "https://wadiprecast.sa/about", about_subject: true }] }, citations: [{ url: "https://wadiprecast.sa/about", title: "About Wadi Precast Pipes Factory" }], searches: 3, tokens: { input: 1000, output: 400 }, queries: ["Wadi Precast Pipes Factory about"], model: "m" },
    { part: "record", ok: true, raw: { facts: [] }, citations: [], searches: 4, tokens: { input: 800, output: 100 }, queries: ["Wadi Precast Pipes Factory news"], model: "m" },
  ],
  citations: [{ url: "https://wadiprecast.sa/about", title: "About Wadi Precast Pipes Factory" }],
  searches: 7, tokens: { input: 1800, output: 500 }, queries: [], model: "m",
};

const deps = (over: Partial<CheckDeps> = {}): CheckDeps & { calls: { claim: number; reserved: number; released: number; audited: unknown[]; researched: string[] } } => {
  const calls = { claim: 0, reserved: 0, released: 0, audited: [] as unknown[], researched: [] as string[] };
  const d: CheckDeps = {
    now: () => NOW,
    research: async (s) => { calls.researched.push(s.name); return WEB_PARTS; },
    narrate: async () => null,
    claim: async () => { calls.claim++; return true; },
    reserve: async () => { calls.reserved++; return { ok: true, release: async () => { calls.released++; } }; },
    allowance: async () => ({ allowed: true, used: 0, budget: 1, percent: 0 } as never),
    audit: async (row) => { calls.audited.push(row); },
    ...over,
  };
  return Object.assign(d, { calls });
};

beforeEach(() => { state.db = seed(); });

describe("the check from the workspace's own records", () => {
  it("a supplier that shares bank details with another under a different name is CONCERNING", async () => {
    const r = await buildCheck(access(), SID.najd, { web: null }, deps());
    expect(r.ok && r.result.verdict).toBe("concerning");
    expect(r.ok && r.result.findings.signals[0].id).toBe("dup_bank");
    expect(r.ok && r.result.reputation.webUsed).toBe(false);
  });

  it("a supplier with strong history and a consistent record looks genuine, rated 4.75 from 6 RFQs, with the formula on it", async () => {
    const r = await buildCheck(access(), SID.wadi, { web: null }, deps());
    if (!r.ok) throw new Error("expected a result");
    expect(r.result.verdict).toBe("looks_genuine");
    expect(r.result.rating.value).toBe(4.75);
    expect(r.result.rating.basis.rfqs).toBe(6);
    expect(r.result.rating.basis.formula).toMatch(/Rating = 5 x/);
  });

  it("the thin demo-style supplier comes out unverified with no rating and the sample size shown", async () => {
    const r = await buildCheck(access(), SID.tihama, { web: null }, deps());
    if (!r.ok) throw new Error("expected a result");
    expect(r.result.verdict).toBe("unverified");
    expect(r.result.rating.value).toBeNull();
    expect(r.result.rating.basis.rfqs).toBe(2);
    expect(r.result.sharpen.length).toBeGreaterThan(2);
  });

  it("another workspace's suppliers are never compared: Wadi shares a bank and phone with a supplier of ANOTHER tenant and gets no duplicate signal", async () => {
    const r = await buildCheck(access(), SID.wadi, { web: null }, deps());
    if (!r.ok) throw new Error("expected a result");
    expect(r.result.findings.signals.some((s) => s.id.startsWith("dup_"))).toBe(false);
  });

  it("a supplier of another workspace is not found, whatever the id", async () => {
    const r = await buildCheck(access(), FOREIGN, { web: null }, deps());
    expect(r).toMatchObject({ ok: false, status: 404 });
    const asT2 = await buildCheck(access({ tenantId: T2 }), SID.wadi, { web: null }, deps());
    expect(asT2).toMatchObject({ ok: false, status: 404 });
  });

  it("the gate: a workspace without the Suppliers module answers 404, a person who cannot view suppliers 403, and running needs edit", async () => {
    expect(await buildCheck(access({ features: {} }), SID.wadi, { web: null }, deps())).toMatchObject({ ok: false, status: 404 });
    expect(await buildCheck(access({ perms: NONE }), SID.wadi, { web: null }, deps())).toMatchObject({ ok: false, status: 403 });
    const viewOnly: PermissionSet = { unrestricted: false, grants: new Map([["suppliers", { workcenter: "suppliers", canView: true, canCreate: false, canEdit: false, canDelete: false }]]) };
    expect(checkGate({ features: { suppliers: true }, perms: viewOnly }, "view")).toEqual({ ok: true });
    expect(checkGate({ features: { suppliers: true }, perms: viewOnly }, "run")).toMatchObject({ ok: false, status: 403 });
  });
});

describe("the web part", () => {
  const WEB = { web: { consentId: "c1" } };
  const on = { features: { suppliers: true, ai_assistant: true, ai_assistant_web: true } };

  it("runs only after the yes: it claims the consent once, takes a daily slot and researches the supplier by name", async () => {
    const d = deps();
    const r = await buildCheck(access(on), SID.wadi, WEB, d);
    if (!r.ok) throw new Error("expected a result");
    expect(d.calls.claim).toBe(1);
    expect(d.calls.reserved).toBe(1);
    expect(d.calls.researched).toEqual(["Wadi Precast Pipes Factory"]);
    expect(r.result.reputation.webUsed).toBe(true);
    expect(r.result.reputation.facts.map((f) => f.kind)).toEqual(["years"]);
    expect(r.result.reputation.sources).toHaveLength(1);
    expect(r.result.reputation.summary).toMatch(/Operating since 2009/);
    expect(d.calls.audited).toHaveLength(1);
    expect(state.db.rows("ai_usage_log")).toEqual([expect.objectContaining({ tenant_id: T1, user_id: "u1", surface: "supplier_check", input_tokens: 1800, output_tokens: 500 })]);
  });

  it("without the yes nothing is searched", async () => {
    const d = deps();
    await buildCheck(access(on), SID.wadi, { web: null }, d);
    expect(d.calls.researched).toEqual([]);
    expect(d.calls.claim).toBe(0);
  });

  it("web research switched off for the workspace falls back to the records and says so", async () => {
    const d = deps();
    const r = await buildCheck(access(), SID.wadi, WEB, d);
    if (!r.ok) throw new Error("expected a result");
    expect(d.calls.researched).toEqual([]);
    expect(r.result.reputation.webUsed).toBe(false);
    expect(r.notice).toMatch(/not switched on/);
  });

  it("a consent that was already spent is no permission", async () => {
    const d = deps({ claim: async () => false });
    const r = await buildCheck(access(on), SID.wadi, WEB, d);
    if (!r.ok) throw new Error("expected a result");
    expect(d.calls.researched).toEqual([]);
    expect(r.notice).toMatch(/already used/);
  });

  it("the daily limit and the monthly allowance stop the search, and an unused slot is given back", async () => {
    const full = deps({ reserve: async () => ({ ok: false }) });
    const a = await buildCheck(access(on), SID.wadi, WEB, full);
    expect(a.ok && a.notice).toMatch(/used up/);
    const broke = deps({ allowance: async () => ({ allowed: false, used: 2, budget: 1, percent: 200 } as never) });
    const b = await buildCheck(access(on), SID.wadi, WEB, broke);
    expect(b.ok && b.notice).toMatch(/allowance/);
    expect(broke.calls.released).toBe(1);
    expect(broke.calls.researched).toEqual([]);
  });

  it("a search that finds nothing says so plainly, and 'Nothing found' is a finding, not a pass", async () => {
    const empty: SupplierResearch = { ...WEB_PARTS, parts: WEB_PARTS.parts.map((p) => (p.ok ? { ...p, raw: { facts: [] } } : p)), citations: [] };
    const r = await buildCheck(access(on), SID.tihama, WEB, deps({ research: async () => empty }));
    if (!r.ok) throw new Error("expected a result");
    expect(r.result.reputation.webUsed).toBe(true);
    expect(r.result.reputation.facts).toEqual([]);
    expect(r.result.reputation.note).toMatch(/Nothing was found on the web that could be cited/);
    expect(r.result.reputation.summary).toMatch(/Nothing was found/);
    expect(r.result.verdict).toBe("unverified");
  });

  it("every part failing is said plainly, is not 'nothing found', and gives the slot back when nothing was spent", async () => {
    const failed: SupplierResearch = { parts: [
      { part: "standing", ok: false, error: "The research was still running when time ran out.", searches: 0, tokens: { input: 0, output: 0 }, queries: [] },
      { part: "record", ok: false, error: "The research was still running when time ran out.", searches: 0, tokens: { input: 0, output: 0 }, queries: [] },
    ], citations: [], searches: 0, tokens: { input: 0, output: 0 }, queries: [], model: "m" };
    const d = deps({ research: async () => failed });
    const r = await buildCheck(access(on), SID.tihama, WEB, d);
    if (!r.ok) throw new Error("expected a result");
    expect(r.result.reputation.webUsed).toBe(false);
    expect(r.result.reputation.partial).toBe(true);
    expect(r.result.reputation.summary).toMatch(/market reputation is not known/);
    expect(d.calls.released).toBe(1);
  });

  it("a researcher that throws is a plain notice, never a crash", async () => {
    const d = deps({ research: async () => { throw new Error("The AI service is rate-limited right now."); } });
    const r = await buildCheck(access(on), SID.wadi, WEB, d);
    expect(r.ok && r.notice).toMatch(/rate-limited/);
    expect(d.calls.released).toBe(1);
  });

  it("the model's summary is used only when it stays inside the facts; otherwise the composed one is", async () => {
    const good = await buildCheck(access(on), SID.wadi, WEB, deps({ narrate: async () => "Cited pages say it has operated since 2009." }));
    expect(good.ok && good.result.reputation.summary).toBe("Cited pages say it has operated since 2009.");
    const invented = await buildCheck(access(on), SID.wadi, WEB, deps({ narrate: async () => null }));
    expect(invented.ok && invented.result.reputation.summary).toMatch(/Cited pages report: Operating since 2009/);
  });

  it("a part that failed beside one that worked is kept as partial", async () => {
    const half: SupplierResearch = { ...WEB_PARTS, parts: [WEB_PARTS.parts[0], { part: "record", ok: false, error: "x", searches: 0, tokens: { input: 0, output: 0 }, queries: [] }] };
    const r = await buildCheck(access(on), SID.wadi, WEB, deps({ research: async () => half }));
    expect(r.ok && r.result.reputation.partial).toBe(true);
    expect(r.ok && r.notice).toMatch(/Part of the web research could not run/);
  });
});

describe("saving and reading", () => {
  const sample = async (): Promise<SupplierCheckResult> => {
    const r = await buildCheck(access(), SID.wadi, { web: null }, deps());
    if (!r.ok) throw new Error("expected a result");
    return r.result;
  };

  it("a saved check is stamped with the session's tenant and person and reads back whole", async () => {
    const result = await sample();
    const saved = await persistCheck(access(), result);
    expect(saved.ok).toBe(true);
    const row = state.db.rows("supplier_checks")[0];
    expect(row).toMatchObject({ tenant_id: T1, supplier_id: SID.wadi, checked_by: "u1", verdict: "looks_genuine", our_rating: 4.75, web_used: false });
    const read = await readChecks(access(), SID.wadi, "Wadi");
    expect(read.latest?.verdict).toBe("looks_genuine");
    expect(read.latest?.rating.value).toBe(4.75);
    expect(read.latest?.findings.positives.length).toBeGreaterThan(0);
    expect(read.latest?.verdictSentence).toBe(result.verdictSentence);
    expect(read.history).toHaveLength(1);
  });

  it("will not save a check for a supplier of another workspace", async () => {
    const result = { ...(await sample()), supplierId: FOREIGN };
    expect(await persistCheck(access(), result)).toMatchObject({ ok: false, pending: false });
    expect(state.db.rows("supplier_checks")).toHaveLength(0);
  });

  it("reads never cross workspaces", async () => {
    await persistCheck(access(), await sample());
    expect((await readChecks(access({ tenantId: T2 }), SID.wadi, "Wadi")).latest).toBeNull();
    expect((await readSummaries({ admin: state.db as never, tenantId: T2 }, null)).summaries).toEqual([]);
  });

  it("the summaries hold the newest check of each supplier, small", async () => {
    await persistCheck(access(), { ...(await sample()), checkedAt: "2026-10-01T00:00:00.000Z", verdict: "unverified" });
    await persistCheck(access(), await sample());
    const { summaries } = await readSummaries({ admin: state.db as never, tenantId: T1 }, [SID.wadi, SID.tihama]);
    expect(summaries).toEqual([{ supplierId: SID.wadi, verdict: "looks_genuine", rating: 4.75, rfqs: 6, checkedAt: NOW.toISOString() }]);
  });

  it("while migration 0263 is pending, a read says so and a save says what to do; nothing throws", async () => {
    state.db.missing.add("supplier_checks");
    const read = await readChecks(access(), SID.wadi, "Wadi");
    expect(read).toEqual({ latest: null, history: [], pending: true });
    expect((await readSummaries({ admin: state.db as never, tenantId: T1 }, null)).pending).toBe(true);
    const saved = await persistCheck(access(), await sample());
    expect(saved).toMatchObject({ ok: false, pending: true });
    expect(!saved.ok && saved.error).toMatch(/migration 0263/);
  });

  it("an unknown verdict in a row reads as unverified rather than breaking the card", () => {
    const r = rowToResult({ id: "x", supplier_id: SID.wadi, checked_at: NOW.toISOString(), checked_by: null, verdict: "bogus", genuine_findings: null, our_rating: null, our_rating_basis: null, reputation_summary: null, reputation_sentiment: "??", reputation_facts: null, sources: null, web_used: false, model: null }, "Wadi");
    expect(r.verdict).toBe("unverified");
    expect(r.reputation.sentiment).toBe("unknown");
    expect(r.findings.signals).toEqual([]);
  });
});
