import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { createAdminSupabase } from "@/lib/supabase-server";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { templateById } from "./definition";
import { loadTenantEnv } from "./env";
import { JourneyError, setJourneyStatus, updateJourney } from "./service";
import type { JourneyCtx } from "./access";

const T = "t1";
const VID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_VID = "22222222-2222-4222-8222-222222222222";

const def = (withVersion = true) => {
  const d = templateById("quote_follow_up")!.build();
  const s = d.steps[1];
  if (s.kind === "send_newsletter" && withVersion) s.newsletter_version_id = VID;
  return d;
};

async function ctxFor(over: { status?: string; events?: number; limits?: Record<string, number> } = {}) {
  const now = Date.now();
  const events: Row[] = [];
  const contacts: Row[] = [];
  const accounts: Row[] = [];
  for (let i = 0; i < (over.events ?? 0); i++) {
    events.push({ id: `e${i}`, tenant_id: T, name: "quote.sent", object_type: "standard_quote", object_id: `q${i}`, contact_id: `k${i}`, account_id: `a${i}`, campaign_id: null, source: "app", depth: 0, payload: {}, created_at: new Date(now - (i + 1) * 60_000).toISOString() });
    contacts.push({ id: `k${i}`, tenant_id: T, account_id: `a${i}`, name: `Person ${i}`, email: `p${i}@x.example`, created_at: "2026-01-01" });
    accounts.push({ id: `a${i}`, tenant_id: T, name: `Company ${i}`, owner_user_id: null, marketing_opt_out: false });
  }
  const db = fakeDb({
    tenants: [{ id: T, name: "Al Noor", slug: "a", custom_domain: null, company_info: null, features: { marketing: true, journeys: true, newsletter_studio: true }, config: { wfm: { timezone: "Asia/Riyadh" }, marketing: { journey_limits: over.limits ?? {} } }, is_demo: false }],
    journeys: [{ id: "j1", tenant_id: T, ref: "JNY-0001", name: "Quote follow-up", status: over.status ?? "draft", definition: def(), trigger_name: "quote.sent", version: 1, entry_from: null, went_live_at: null, created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z" }],
    newsletter_versions: [{ id: VID, tenant_id: T }, { id: FOREIGN_VID, tenant_id: "other" }],
    domain_event: events, contacts, accounts, journey_runs: [], journey_run_steps: [], consent_state: [], change_log: [], service_cases: [], invoices: [],
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db.client as never);
  const env = (await loadTenantEnv(db.client, T))!;
  const ctx: JourneyCtx = { supabase: db.client, admin: db.client, tenantId: T, userId: "u1", role: "admin", env, can: { view: true, create: true, edit: true, delete: true } };
  return { db, ctx };
}

describe("saving a journey", () => {
  it("refuses a newsletter version that belongs to another workspace", async () => {
    const { ctx } = await ctxFor();
    const d = def();
    if (d.steps[1].kind === "send_newsletter") d.steps[1].newsletter_version_id = FOREIGN_VID;
    await expect(updateJourney(ctx, "j1", { definition: d })).rejects.toMatchObject({ status: 422 });
  });

  it("refuses a topic the workspace does not have, and a journey id from another workspace is simply not found", async () => {
    const { ctx } = await ctxFor();
    const d = def();
    if (d.steps[1].kind === "send_newsletter") d.steps[1].topic = "made_up";
    await expect(updateJourney(ctx, "j1", { definition: d })).rejects.toMatchObject({ status: 422 });
    await expect(updateJourney({ ...ctx, tenantId: "other" }, "j1", { name: "x" })).rejects.toMatchObject({ status: 404 });
  });

  it("will not change the steps of a journey that is on", async () => {
    const { ctx } = await ctxFor({ status: "live" });
    await expect(updateJourney(ctx, "j1", { definition: def() })).rejects.toMatchObject({ status: 409 });
  });

  it("saves a valid change, bumps the version and writes change history", async () => {
    const { ctx, db } = await ctxFor();
    const d = def();
    d.steps.push({ id: "s4", kind: "end" });
    const j = await updateJourney(ctx, "j1", { name: "Quote chase", definition: d });
    expect(j.name).toBe("Quote chase");
    expect(j.version).toBe(2);
    expect(db.tables.change_log[0]).toMatchObject({ tenant_id: T, object_type: "journeys", object_id: "j1", action: "update" });
  });
});

describe("turning a journey on", () => {
  it("cannot be turned on without a chosen newsletter version", async () => {
    const { ctx, db } = await ctxFor();
    db.tables.journeys[0].definition = def(false);
    await expect(setJourneyStatus(ctx, "j1", "turn_on", false)).rejects.toBeInstanceOf(JourneyError);
    expect(db.tables.journeys[0].status).toBe("draft");
  });

  it("asks before enrolling more people than the limit, and goes ahead once confirmed, enrolling them", async () => {
    const { ctx, db } = await ctxFor({ events: 3, limits: { blast_radius: 2 } });
    const first = await setJourneyStatus(ctx, "j1", "turn_on", false);
    expect("needsConfirm" in first && first.needsConfirm).toBe(true);
    if ("needsConfirm" in first) expect(first.checks.find((c) => c.code === "blast_radius")).toMatchObject({ level: "confirm", count: 3 });
    expect(db.tables.journeys[0].status).toBe("draft");
    expect(db.tables.journey_runs).toHaveLength(0);

    const second = await setJourneyStatus(ctx, "j1", "turn_on", true);
    expect(second).toMatchObject({ status: "live", enrolled: 3 });
    expect(db.tables.journeys[0].status).toBe("live");
    expect(db.tables.journey_runs).toHaveLength(3);
  });

  it("does not ask when the number is within the limit", async () => {
    const { ctx, db } = await ctxFor({ events: 3, limits: { blast_radius: 200 } });
    expect(await setJourneyStatus(ctx, "j1", "turn_on", false)).toMatchObject({ status: "live", enrolled: 3 });
    expect(db.tables.journeys[0].entry_from).toBeTruthy();
  });

  it("pausing is allowed any time and keeps the runs", async () => {
    const { ctx, db } = await ctxFor({ events: 1 });
    await setJourneyStatus(ctx, "j1", "turn_on", false);
    expect(await setJourneyStatus(ctx, "j1", "pause", false)).toMatchObject({ status: "paused" });
    expect(db.tables.journey_runs).toHaveLength(1);
  });

  it("people with no consent are counted before going live, not after", async () => {
    const { ctx, db } = await ctxFor({ events: 2 });
    const { goLiveChecks } = await import("./preview");
    const { loadJourneyRow } = await import("./store");
    const j = (await loadJourneyRow(db.client, T, "j1"))!;
    const r = await goLiveChecks(db.client, ctx.env, j, new Date(), { gate: async (_t, c) => (c === "k0" ? { ok: false, reason: "no_consent" } : { ok: true, reason: "consented" }) });
    expect(r.entry.count).toBe(2);
    expect(r.checks.find((c) => c.code === "missing_consent")).toMatchObject({ count: 1 });
  });
});
