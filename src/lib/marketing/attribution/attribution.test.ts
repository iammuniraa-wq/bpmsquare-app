import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { attribute, interpretation, totalsOf, type Deal, type Touch } from "./models";
import { touchesFromEvent, ingestTouches, type EventForTouch } from "./touches";
import { recompute, loadDeals } from "./compute";
import { runTenant, tenantsToRun, attributionEnabled } from "./runner";
import { loadReport, parseReportParams } from "./server";
import type { ModuleCtx } from "@/lib/marketing/moduleAccess";

const NOW = new Date("2026-10-21T00:00:00Z");
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const C1 = "c1c1c1c1-0000-4000-8000-000000000001";
const C2 = "c2c2c2c2-0000-4000-8000-000000000002";
const C3 = "c3c3c3c3-0000-4000-8000-000000000003";
const C4 = "c4c4c4c4-0000-4000-8000-000000000004";
const C5 = "c5c5c5c5-0000-4000-8000-000000000005";

const touch = (assetId: string, day: string, accountId = "A1", strength: Touch["strength"] = "engaged", assetType: Touch["assetType"] = "campaign"): Touch => ({ assetType, assetId, accountId, at: d(day), strength });

const deals: Deal[] = [
  { id: "D1", accountId: "A1", createdAt: d("2026-10-01"), closedAt: null, outcome: "open", amount: 1000, invoiced: 0, paid: 0 },
  { id: "D2", accountId: "A1", createdAt: d("2026-10-15"), closedAt: d("2026-10-18"), outcome: "won", amount: 3000, invoiced: 3000, paid: 1200 },
  { id: "D3", accountId: "A2", createdAt: d("2026-10-10"), closedAt: null, outcome: "lost", amount: 500, invoiced: 0, paid: 0 },
  { id: "D4", accountId: "A3", createdAt: d("2026-10-10"), closedAt: null, outcome: "dropped", amount: 9999, invoiced: 0, paid: 0 },
];
const touches: Touch[] = [
  touch(C1, "2026-09-20"), touch(C2, "2026-09-25"), touch(C5, "2026-09-28", "A1", "reached"), touch(C3, "2026-10-10"),
  touch(C1, "2026-10-16"), touch(C4, "2026-10-19"),
  touch(C1, "2026-10-12", "A3"), // a dropped deal's company: nothing is credited for a dropped deal
];
const run = (model: "first" | "last" | "linear", mode: "engaged" | "all" = "engaged") => attribute(deals, touches, { model, mode, assetType: "campaign", now: NOW });

describe("the three models on a small fixture", () => {
  it("first touch: the earliest touch before the deal gets all of it", () => {
    const r = run("first");
    expect(r.get(C1)).toMatchObject({ sourcedDeals: 2, sourcedOpenValue: 1000, sourcedWonDeals: 1, sourcedWonValue: 3000, sourcedPaidValue: 1200 });
    expect(r.get(C2)).toMatchObject({ sourcedDeals: 0, sourcedWonValue: 0 });
    expect(r.get(C3)).toMatchObject({ sourcedDeals: 0 });
  });

  it("last touch: the latest touch before the deal started gets all of it", () => {
    const r = run("last");
    expect(r.get(C2)).toMatchObject({ sourcedDeals: 1, sourcedOpenValue: 1000, sourcedWonValue: 0 });
    expect(r.get(C3)).toMatchObject({ sourcedDeals: 1, sourcedWonValue: 3000, sourcedPaidValue: 1200 });
    expect(r.get(C1)).toMatchObject({ sourcedDeals: 0 });
  });

  it("linear: every touch before the deal gets an equal share, and the shares add up to one deal each", () => {
    const r = run("linear");
    expect(r.get(C1)).toMatchObject({ sourcedDeals: 0.833, sourcedOpenValue: 500, sourcedWonValue: 1000, sourcedPaidValue: 400 });
    expect(r.get(C2)).toMatchObject({ sourcedOpenValue: 500, sourcedWonValue: 1000 });
    expect(r.get(C3)).toMatchObject({ sourcedOpenValue: 0, sourcedWonValue: 1000 });
    const sum = [...r.values()].reduce((s, m) => s + m.sourcedDeals, 0);
    expect(Math.round(sum * 100) / 100).toBe(2);
    // value is conserved: won 3000, open 1000
    expect([...r.values()].reduce((s, m) => s + m.sourcedWonValue, 0)).toBeCloseTo(3000, -1);
    expect([...r.values()].reduce((s, m) => s + m.sourcedOpenValue, 0)).toBeCloseTo(1000, -1);
  });

  it("influenced counts a deal under every asset that touched it, from the window until it closed (or today if open)", () => {
    const r = run("first");
    expect(r.get(C1)).toMatchObject({ influencedDeals: 2, influencedWonDeals: 1, influencedWonValue: 3000 });
    expect(r.get(C2)).toMatchObject({ influencedDeals: 2, influencedWonValue: 3000 });
    // C4 came after the won deal closed, so it touched only the deal that was still open
    expect(r.get(C4)).toMatchObject({ influencedDeals: 1, influencedWonDeals: 0, influencedWonValue: 0 });
    // the same deal appears under several assets: influenced is NOT additive, and the sums above prove it
    expect(r.get(C1)!.influencedDeals + r.get(C2)!.influencedDeals).toBeGreaterThan(2);
  });

  it("a touch after the deal was created influences it but cannot have started it", () => {
    const r = run("first");
    expect(r.get(C4)).toMatchObject({ sourcedDeals: 0 });
    expect(r.get(C4)!.influencedDeals).toBe(1);
  });

  it("a dropped deal is not a deal, and a lost deal with no touch credits nobody", () => {
    const r = run("first");
    expect([...r.values()].reduce((s, m) => s + m.sourcedOpenValue + m.sourcedWonValue, 0)).toBe(4000);
    expect(r.get(C1)!.influencedDeals).toBe(2);
  });

  it("only touches where the person did something count, unless asked otherwise", () => {
    expect(run("first").has(C5)).toBe(false);
    const all = run("last", "all");
    expect(all.get(C5)).toMatchObject({ sourcedDeals: 1, sourcedOpenValue: 1000, sourcedWonValue: 0 });
    expect(all.get(C3)).toMatchObject({ sourcedDeals: 1, sourcedWonValue: 3000 });
    expect(all.get(C2)).toMatchObject({ sourcedDeals: 0 });
  });

  it("people and touches count what the asset reached, regardless of deals", () => {
    const r = run("first");
    expect(r.get(C1)).toMatchObject({ touches: 3, people: 2 });
  });

  it("touches older than the window do not count", () => {
    const old = [touch(C1, "2026-05-01")];
    const r = attribute(deals, old, { model: "first", mode: "engaged", assetType: "campaign", now: NOW });
    expect(r.get(C1)).toMatchObject({ sourcedDeals: 0, influencedDeals: 0 });
  });

  it("is deterministic: the same inputs always give the same answer, whatever order they arrive in", () => {
    const shuffled = [...touches].reverse();
    const a = attribute(deals, touches, { model: "linear", mode: "all", assetType: "campaign", now: NOW });
    const b = attribute([...deals].reverse(), shuffled, { model: "linear", mode: "all", assetType: "campaign", now: NOW });
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it("each kind of asset is its own question", () => {
    const mixed = [...touches, touch("f1f1f1f1-0000-4000-8000-0000000000f1", "2026-09-22", "A1", "engaged", "form")];
    const forms = attribute(deals, mixed, { model: "first", mode: "engaged", assetType: "form", now: NOW });
    expect([...forms.keys()]).toEqual(["f1f1f1f1-0000-4000-8000-0000000000f1"]);
    expect(forms.get("f1f1f1f1-0000-4000-8000-0000000000f1")).toMatchObject({ sourcedOpenValue: 1000, sourcedWonValue: 3000 });
  });

  it("says in words which model was used, and warns when there are few deals", () => {
    const lines = interpretation("linear", "engaged", "campaign", 3);
    expect(lines.join(" ")).toContain("Shared evenly");
    expect(lines.join(" ")).toContain("not why they were won");
    expect(lines.join(" ")).toContain("Only 3 deals");
    expect(interpretation("first", "all", "form", 50).join(" ")).not.toContain("Only ");
    expect(totalsOf([...run("first").values()]).sourcedWonValue).toBe(3000);
  });
});

describe("events become touches", () => {
  const base: EventForTouch = { id: "e1", name: "email.clicked", object_type: "marketing_campaign", object_id: C1, contact_id: "k1", account_id: "A1", campaign_id: C1, newsletter_id: C2, occurred_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", payload: {} };
  it("a click touches both the campaign and its newsletter, engaged", () => {
    expect(touchesFromEvent(base)).toEqual([{ asset_type: "campaign", asset_id: C1, strength: "engaged" }, { asset_type: "newsletter", asset_id: C2, strength: "engaged" }]);
  });
  it("a send only reached them", () => {
    expect(touchesFromEvent({ ...base, name: "email.sent" }).every((t) => t.strength === "reached")).toBe(true);
  });
  it("a form submission takes the form from the payload, a registration the event from the object", () => {
    expect(touchesFromEvent({ ...base, name: "form.submitted", campaign_id: null, newsletter_id: null, payload: { form_id: C3 } })).toEqual([{ asset_type: "form", asset_id: C3, strength: "engaged" }]);
    expect(touchesFromEvent({ ...base, name: "event.registered", object_id: C4, campaign_id: null, newsletter_id: null })).toEqual([{ asset_type: "event", asset_id: C4, strength: "engaged" }]);
  });
  it("a WhatsApp reply is credited to the template it answered, and a dry run reached nobody", () => {
    expect(touchesFromEvent({ ...base, name: "whatsapp.replied", object_id: "k1", campaign_id: null, newsletter_id: null, payload: { template_id: C5 } })).toEqual([{ asset_type: "whatsapp", asset_id: C5, strength: "engaged" }]);
    expect(touchesFromEvent({ ...base, name: "whatsapp.replied", object_id: "k1", campaign_id: null, newsletter_id: null, payload: {} })).toEqual([]);
    expect(touchesFromEvent({ ...base, name: "whatsapp.sent", object_id: C5, campaign_id: null, newsletter_id: null, payload: { dry_run: true } })).toEqual([]);
  });
  it("an event for something that is not an id, or not a touch, makes nothing", () => {
    expect(touchesFromEvent({ ...base, campaign_id: "not-a-uuid", newsletter_id: null })).toEqual([]);
    expect(touchesFromEvent({ ...base, name: "quote.sent" })).toEqual([]);
  });
});

// ── the cron, against a fake database ────────────────────────────────────────

const T = "t1";
const U = "t2";
const ev = (id: string, name: string, over: Row = {}): Row => ({
  id, tenant_id: T, name, object_type: "marketing_campaign", object_id: C1, contact_id: "k1", account_id: "A1", lead_id: null, campaign_id: C1, newsletter_id: null,
  occurred_at: "2026-09-20T00:00:00Z", created_at: "2026-09-20T00:00:00.000Z", payload: {}, depth: 0, ...over,
});

function world(over: { features?: Record<string, boolean>; extra?: Record<string, Row[]> } = {}) {
  return fakeDb({
    tenants: [
      { id: T, features: { marketing: true, marketing_attribution: true, ...over.features } },
      { id: U, features: { marketing: true, marketing_attribution: true } },
      { id: "t3", features: { marketing: true } },
    ],
    domain_event: [
      ev("e1", "email.clicked"),
      ev("e2", "email.clicked", { campaign_id: C2, created_at: "2026-09-25T00:00:00.000Z", occurred_at: "2026-09-25T00:00:00Z" }),
      ev("e3", "form.submitted", { object_type: "form", object_id: C3, campaign_id: null, created_at: "2026-09-26T00:00:00.000Z", occurred_at: "2026-09-26T00:00:00Z", payload: { form_id: C3 } }),
      ev("e4", "email.clicked", { contact_id: "kx", account_id: "AX", tenant_id: U }),
      ev("e5", "quote.sent", { created_at: "2026-09-27T00:00:00.000Z" }),
    ],
    opportunities: [
      { id: "o1", tenant_id: T, account_id: "A1", outcome: "won", amount: 3000, created_at: "2026-10-01T00:00:00Z", closed_at: "2026-10-10T00:00:00Z" },
      { id: "o2", tenant_id: T, account_id: "A1", outcome: "open", amount: 1000, created_at: "2026-10-05T00:00:00Z", closed_at: null },
      { id: "ox", tenant_id: U, account_id: "AX", outcome: "won", amount: 777777, created_at: "2026-10-01T00:00:00Z", closed_at: "2026-10-10T00:00:00Z" },
    ],
    quotes: [{ id: "q1", tenant_id: T, opportunity_id: "o1" }],
    invoices: [{ id: "i1", tenant_id: T, quote_id: "q1", total: 3000, paid_amount: 1200 }],
    contacts: [{ id: "k1", tenant_id: T, account_id: "A1" }],
    marketing_touches: [], attribution_results: [], attribution_state: [{ tenant_id: T, locked_until: "1970-01-01T00:00:00.000Z" }, { tenant_id: U, locked_until: "1970-01-01T00:00:00.000Z" }],
    marketing_campaigns: [{ id: C1, tenant_id: T, name: "Autumn offers" }, { id: C2, tenant_id: T, name: "Service reminder" }],
    ...over.extra,
  });
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe("the cron for one workspace", () => {
  it("turns this workspace's events into touches, once each, and ignores other workspaces and non-touch events", async () => {
    const db = world();
    const r = await runTenant(db.client, T, { now: () => NOW });
    expect(r.status).toBe("ran");
    const mine = db.tables.marketing_touches;
    expect(mine.map((t) => `${t.asset_type}:${t.asset_id}`).sort()).toEqual([`campaign:${C1}`, `campaign:${C2}`, `form:${C3}`].sort());
    expect(mine.every((t) => t.tenant_id === T && t.account_id === "A1")).toBe(true);
    expect(db.tables.attribution_state[0]).toMatchObject({ last_event_id: "e3", touches_total: 3 });
  });

  it("is idempotent: running it again, even with the bookmark lost, writes the same touches and the same results", async () => {
    const db = world();
    await runTenant(db.client, T, { now: () => NOW });
    const touches1 = db.tables.marketing_touches.length;
    const results1 = JSON.stringify(db.tables.attribution_results.map((r) => ({ ...r, id: undefined, computed_at: undefined })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    Object.assign(db.tables.attribution_state[0], { last_created_at: null, last_event_id: null });
    await runTenant(db.client, T, { now: () => new Date(NOW.getTime() + 3_600_000) });
    expect(db.tables.marketing_touches).toHaveLength(touches1);
    const results2 = JSON.stringify(db.tables.attribution_results.map((r) => ({ ...r, id: undefined, computed_at: undefined })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    expect(results2).toBe(results1);
  });

  it("credits revenue from the deals and the paid invoices, per model", async () => {
    const db = world();
    await runTenant(db.client, T, { now: () => NOW });
    const first = db.tables.attribution_results.find((r) => r.model === "first" && r.mode === "engaged" && r.asset_id === C1)!;
    expect(first).toMatchObject({ tenant_id: T, sourced_deals: 2, sourced_open_value: 1000, sourced_won_value: 3000, sourced_paid_value: 1200, window_days: 90 });
    const lin = db.tables.attribution_results.filter((r) => r.model === "linear" && r.mode === "engaged" && r.asset_type === "campaign");
    expect(lin.reduce((s, r) => s + Number(r.sourced_won_value), 0)).toBeCloseTo(3000, -1);
  });

  it("never changes a deal, a quote or an invoice: it only reads them and writes the attribution tables", async () => {
    const db = world();
    const before = JSON.stringify([db.tables.opportunities, db.tables.quotes, db.tables.invoices, db.tables.contacts]);
    await runTenant(db.client, T, { now: () => NOW });
    expect(JSON.stringify([db.tables.opportunities, db.tables.quotes, db.tables.invoices, db.tables.contacts])).toBe(before);
    const writes = db.queries.filter((q) => q.op !== "select").map((q) => q.table);
    expect(new Set(writes)).toEqual(new Set(["attribution_state", "marketing_touches", "attribution_results"]));
  });

  it("another workspace's events and deals never appear, and every query names the tenant", async () => {
    const db = world();
    await runTenant(db.client, T, { now: () => NOW });
    expect(db.tables.marketing_touches.some((t) => t.tenant_id === U)).toBe(false);
    expect(JSON.stringify(db.tables.attribution_results)).not.toContain("777777");
    for (const q of db.queries.filter((x) => x.table !== "tenants")) {
      if (q.op === "upsert" || q.op === "insert") continue;
      expect(q.filters, `${q.op} ${q.table}`).toMatchObject({ tenant_id: T });
    }
  });

  it("a workspace without the flag is not read past the tenants row; the list of workspaces to run holds only those with both flags", async () => {
    const db = world({ features: { marketing_attribution: false } });
    const r = await runTenant(db.client, T, { now: () => NOW });
    expect(r.status).toBe("disabled");
    expect(db.queries.every((q) => q.table === "tenants")).toBe(true);
    expect(await tenantsToRun(db.client)).toEqual([U]);
    expect(attributionEnabled({ marketing: true, marketing_attribution: true })).toBe(true);
    expect(attributionEnabled({ marketing_attribution: true })).toBe(false);
  });

  it("two overlapping calls cannot both work on one workspace", async () => {
    const db = world();
    db.tables.attribution_state[0].locked_until = new Date(NOW.getTime() + 60_000).toISOString();
    expect((await runTenant(db.client, T, { now: () => NOW })).status).toBe("locked");
    expect(db.tables.marketing_touches).toHaveLength(0);
  });

  it("rotates: the workspace that ran longest ago goes first", async () => {
    const db = world();
    db.tables.attribution_state[0].last_run_at = "2026-10-20T00:00:00.000Z";
    db.tables.attribution_state[1].last_run_at = "2026-10-01T00:00:00.000Z";
    expect(await tenantsToRun(db.client)).toEqual([U, T]);
  });

  it("stops starting work after the deadline and leaves the bookmark where it got to", async () => {
    const db = world();
    const r = await runTenant(db.client, T, { now: () => NOW, deadline: Date.now() - 1 });
    expect(r.status).toBe("ran");
    expect(db.tables.marketing_touches).toHaveLength(0);
    expect(db.tables.attribution_results).toHaveLength(0);
  });

  it("a missing table (migration pending) is reported, not a crash", async () => {
    const seed = world();
    const db = fakeDb({ tenants: seed.tables.tenants }, { missingTables: ["attribution_state"] });
    expect((await runTenant(db.client, T, { now: () => NOW })).status).toBe("pending_migration");
    const db2 = world();
    const withoutTouches = fakeDb({ ...db2.tables }, { missingTables: ["marketing_touches"] });
    expect((await runTenant(withoutTouches.client, T, { now: () => NOW })).status).toBe("pending_migration");
  });

  it("results for an asset that no longer has anything to show are removed on the next run", async () => {
    const db = world();
    await runTenant(db.client, T, { now: () => NOW });
    db.tables.attribution_results.push({ id: "stale", tenant_id: T, model: "first", mode: "engaged", asset_type: "campaign", asset_id: "dead", computed_at: "2026-01-01T00:00:00.000Z" });
    await recompute(db.client, T, new Date(NOW.getTime() + 1000));
    expect(db.tables.attribution_results.some((r) => r.asset_id === "dead")).toBe(false);
  });
});

describe("reading the deals", () => {
  it("shares paid money only from invoices on the quotes of a won deal", async () => {
    const db = world();
    const { deals: loaded } = await loadDeals(db.client, T);
    expect(loaded.find((x) => x.id === "o1")).toMatchObject({ outcome: "won", amount: 3000, invoiced: 3000, paid: 1200 });
    expect(loaded.find((x) => x.id === "o2")).toMatchObject({ outcome: "open", paid: 0 });
    expect(loaded.some((x) => x.id === "ox")).toBe(false);
  });
});

describe("the report", () => {
  const ctxFor = (db: ReturnType<typeof world>): ModuleCtx => ({ supabase: db.client, admin: db.client, tenantId: T } as unknown as ModuleCtx);

  it("reads only this workspace's results, with names, sorted by revenue", async () => {
    const db = world();
    await runTenant(db.client, T, { now: () => NOW });
    db.tables.attribution_results.push({ tenant_id: U, model: "first", mode: "engaged", asset_type: "campaign", asset_id: "zzz", sourced_won_value: 99999999, computed_at: "2026-10-21T00:00:00.000Z" });
    const rep = await loadReport(ctxFor(db), { by: "campaign", model: "first", mode: "engaged" });
    expect(rep.missing).toBe(false);
    expect(rep.rows[0]).toMatchObject({ assetId: C1, name: "Autumn offers", sourcedWonValue: 3000 });
    expect(rep.rows.some((r) => r.assetId === "zzz")).toBe(false);
    expect(rep.computedAt).toBeTruthy();
  });

  it("an unknown choice falls back to the defaults, and a missing table is reported", async () => {
    expect(parseReportParams(new URLSearchParams("by=nope&model=x&mode=y"))).toEqual({ by: "campaign", model: "first", mode: "engaged" });
    expect(parseReportParams(new URLSearchParams("by=form&model=linear&mode=all"))).toEqual({ by: "form", model: "linear", mode: "all" });
    const seed = world();
    const db = fakeDb({ tenants: seed.tables.tenants }, { missingTables: ["attribution_results"] });
    expect((await loadReport(ctxFor(seed), { by: "campaign", model: "first", mode: "engaged" })).missing).toBe(false);
    expect((await loadReport({ supabase: db.client, tenantId: T } as unknown as ModuleCtx, { by: "campaign", model: "first", mode: "engaged" })).missing).toBe(true);
  });
});

describe("reading events", () => {
  it("gives a contact-only event its company from the contact (this workspace's only)", async () => {
    const db = world({ extra: { domain_event: [ev("e9", "email.clicked", { account_id: null })] } });
    const r = await ingestTouches(db.client, T, null);
    expect(r.written).toBe(1);
    expect(db.tables.marketing_touches[0]).toMatchObject({ account_id: "A1", tenant_id: T });
  });
  it("an event about nobody we can place makes no touch", async () => {
    const db = world({ extra: { domain_event: [ev("e9", "email.clicked", { account_id: null, contact_id: null })] } });
    expect((await ingestTouches(db.client, T, null)).written).toBe(0);
  });
});
