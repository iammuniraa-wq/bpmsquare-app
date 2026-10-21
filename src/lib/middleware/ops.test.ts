import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u), fetchPublic: async () => new Response("{}") }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {} }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: null }) }));
const pushAccountToErp = vi.fn();
vi.mock("@/lib/accountPush", () => ({ pushAccountToErp: (...a: unknown[]) => pushAccountToErp(...a) }));

import { sendRecord, describeDispatch, health, getRules, saveRules, rulesView, setEntitySchedule, syncOverview, flagOn, connectionList } from "./ops";
import { parseRules } from "./rules";
import { fakeAdmin, seedMiddleware, T1, T2 } from "./testHarness";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); pushAccountToErp.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("Send a record", () => {
  it("accepts accounts and standard quotes only", async () => {
    const db = fakeAdmin(seedMiddleware());
    expect(await sendRecord(db.client, T1, "u", "invoices", ACC)).toMatchObject({ ok: false, status: 422 });
    expect(await sendRecord(db.client, T1, "u", "accounts", "not-a-uuid")).toMatchObject({ ok: false, status: 422 });
    expect(pushAccountToErp).not.toHaveBeenCalled();
  });

  it("an account goes through the existing account push, scoped to the caller's workspace, and is recorded", async () => {
    pushAccountToErp.mockResolvedValue({ ok: true });
    const db = fakeAdmin(seedMiddleware());
    const r = await sendRecord(db.client, T1, "u", "accounts", ACC);
    expect(r).toMatchObject({ ok: true });
    expect(pushAccountToErp).toHaveBeenCalledWith(db.client, T1, ACC);
    expect(db.tables.integration_messages[0]).toMatchObject({ tenant_id: T1, channel: "webhook", entity: "accounts", object_id: ACC, status: "ok" });
  });

  it("a failed push says what to do and records the failure", async () => {
    pushAccountToErp.mockResolvedValue({ ok: false, status: 502, error: "No push URL configured for this tenant" });
    const db = fakeAdmin(seedMiddleware());
    const r = await sendRecord(db.client, T1, "u", "accounts", ACC);
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(db.tables.integration_messages[0]).toMatchObject({ status: "failed", error: "No push URL configured for this tenant" });
  });

  it("an account that is not in the caller's workspace is a 404 and nothing is recorded", async () => {
    pushAccountToErp.mockResolvedValue({ ok: false, status: 404, error: "Account not found" });
    const db = fakeAdmin(seedMiddleware());
    expect(await sendRecord(db.client, T2, "u", "accounts", ACC)).toMatchObject({ ok: false, status: 404 });
    expect(db.tables.integration_messages).toHaveLength(0);
  });

  it("a standard quote of another workspace is not found", async () => {
    const db = fakeAdmin(seedMiddleware());
    const r = await sendRecord(db.client, T2, "u", "standard_quotes", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("dispatch states become plain answers", () => {
    expect(describeDispatch({ state: "sent", messageId: null, number: "QUO-1", link: "l" })).toMatchObject({ ok: true, number: "QUO-1" });
    expect(describeDispatch({ state: "already_sent", number: "QUO-1", link: null })).toMatchObject({ ok: true });
    expect(describeDispatch({ state: "in_progress" })).toMatchObject({ ok: true, message: expect.stringMatching(/already being sent/) });
    expect(describeDispatch({ state: "failed", messageId: null, headline: "h", fix: "f" })).toEqual({ ok: false, status: 422, headline: "h", fix: "f" });
    expect(describeDispatch({ state: "needs_database_update" })).toMatchObject({ ok: false, needsDatabaseUpdate: true });
    expect(describeDispatch({ state: "not_found" })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("rules view and storage", () => {
  it("returns the contract for the connected product, so the screen can grey options", async () => {
    const dv = await getRules(fakeAdmin(seedMiddleware()).client, T1);
    expect(dv.contract.target).toBe("quote");
    expect(dv.contract.estimate.bom.allowed).toBe(false);
    expect(dv.awarded_target).toBe("Quote");
    expect(dv.rejected_target).toBe("Closes the quote as lost");
    const fo = await getRules(fakeAdmin(seedMiddleware({ product: "fo" })).client, T1);
    expect(fo.contract.estimate.bom.allowed).toBe(true);
    expect(fo.awarded_target).toBe("Project");
    expect(fo.rejected_target).toBe("Sends nothing");
  });

  it("with no ERP connected yet nothing is greyed", () => {
    const v = rulesView(parseRules({}), null);
    expect(v.product).toBeNull();
    expect(Object.values(v.contract.estimate).every((o) => o.allowed)).toBe(true);
  });

  it("saves into tenants.config and leaves the rest of the config alone", async () => {
    const seed = seedMiddleware();
    seed.tenants[0].config = { currency: "EUR" };
    const db = fakeAdmin(seed);
    await saveRules(db.client, T1, parseRules({ rules: { quote_awarded: { mode: "manual" } }, estimate: { internal_costs: true } }));
    const cfg = db.tables.tenants[0].config as Record<string, unknown>;
    expect(cfg.currency).toBe("EUR");
    expect(parseRules(cfg.integration_middleware).rules.quote_awarded.mode).toBe("manual");
    expect(parseRules(cfg.integration_middleware).estimate.internal_costs).toBe(true);
  });

  it("the flag reads from the workspace's own features", async () => {
    expect(await flagOn(fakeAdmin(seedMiddleware()).client, T1)).toBe(true);
    expect(await flagOn(fakeAdmin(seedMiddleware({ features: { integration_middleware: false } })).client, T1)).toBe(false);
    expect(await flagOn(fakeAdmin(seedMiddleware()).client, T2)).toBe(false);
  });
});

describe("health: connection, secret expiry, schema", () => {
  it("names the bundle for every missing table and never crashes", async () => {
    const db = fakeAdmin(seedMiddleware(), { missing: ["integration_messages", "connector_sync_runs"] });
    const h = await health(db.client, T1);
    expect(h.needsDatabaseUpdate).toBe(true);
    expect(h.schema.find((r) => r.table === "integration_messages")).toMatchObject({ exists: false, bundle: "scripts/run-bundle-10-middleware-2026-10-21.sql" });
    expect(h.bundles).toEqual(["scripts/run-bundle-10-middleware-2026-10-21.sql", "scripts/run-bundle-9-connectors-2026-10-21.sql"]);
    expect(h.connection).toMatchObject({ connected: true, price_list_chosen: true, currency_chosen: true, product: { name: "Dynamics 365 Sales" } });
  });

  it("reports the secret's expiry from the connection", async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const h = await health(fakeAdmin(seedMiddleware({ cfg: { secret_expires_on: soon } })).client, T1);
    expect(h.secret.state).toBe("soon");
    expect(h.needsDatabaseUpdate).toBe(false);
  });

  it("without the connector tables it reports not connected rather than failing", async () => {
    const h = await health(fakeAdmin(seedMiddleware(), { missing: ["tenant_connectors"] }).client, T1);
    expect(h.connection.connected).toBe(false);
    expect(h.bundles).toContain("scripts/run-bundle-9-connectors-2026-10-21.sql");
  });

  it("the connection list carries which secrets are stored, never their values", async () => {
    const list = await connectionList(fakeAdmin(seedMiddleware()).client, T1);
    expect(list[0].id).toBe("dynamics365");
    expect(JSON.stringify(list)).not.toMatch(/access_token|expires_at|credentials/);
    expect(list[0].state.secrets).toEqual({ client_secret: false, certificate: false, private_key: false, password: false, refresh_token: false });
  });
});

describe("sync: per-entity schedule", () => {
  const fixCredentialsTable = (db: ReturnType<typeof fakeAdmin>) => db;

  it("stores the schedule on the entity in the connector config and keeps everything else", async () => {
    const db = fixCredentialsTable(fakeAdmin(seedMiddleware()));
    const r = await setEntitySchedule(db.client, T1, "customers", "hourly");
    expect(r).toEqual({ ok: true, schedule: "hourly" });
    const cfg = db.tables.tenant_connectors[0].config as { entities: Record<string, { schedule?: string; entity_set: string }>; price_list_id: string };
    expect(cfg.entities.customers).toMatchObject({ schedule: "hourly", entity_set: "accounts" });
    expect(cfg.price_list_id).toBe("pl-0001");
  });

  it("the overview shows the effective schedule and where it comes from", async () => {
    const db = fakeAdmin(seedMiddleware({ cfg: { schedule: "daily" } }));
    await setEntitySchedule(db.client, T1, "products", "off");
    const o = await syncOverview(db.client, T1);
    if (!o.connected) throw new Error("expected connected");
    const by = Object.fromEntries(o.entities.map((e) => [e.key, e]));
    expect(by.products).toMatchObject({ schedule: "off", schedule_source: "entity" });
    expect(by.customers).toMatchObject({ schedule: "daily", schedule_source: "connector" });
    expect(by.customers).toMatchObject({ direction: "pull", enabled: true, linked: 1 });
    expect(by.fence_projects.direction).toBe("push");
  });

  it("is not connected before a connection exists, and refuses to schedule", async () => {
    const seed = seedMiddleware();
    seed.tenant_connectors = [];
    const db = fakeAdmin(seed);
    expect(await syncOverview(db.client, T1)).toEqual({ connected: false, entities: [] });
    expect(await setEntitySchedule(db.client, T1, "customers", "daily")).toMatchObject({ ok: false, status: 400 });
  });

  it("another workspace's connector is never edited", async () => {
    const db = fakeAdmin(seedMiddleware());
    expect(await setEntitySchedule(db.client, T2, "customers", "hourly")).toMatchObject({ ok: false });
    expect((db.tables.tenant_connectors[0].config as { entities: object }).entities).toEqual({});
  });

  it("shows a running entity", async () => {
    const seed = seedMiddleware();
    seed.connector_sync_runs = [{ id: "r1", tenant_id: T1, connector_id: "dynamics365", entity: "customers", status: "running", trigger: "manual", started_at: "2026-10-21T10:00:00Z", finished_at: null, counts: {}, error: null }];
    const o = await syncOverview(fakeAdmin(seed).client, T1);
    if (!o.connected) throw new Error("expected connected");
    expect(o.entities.find((e) => e.key === "customers")).toMatchObject({ running: true, last_run: { status: "running" } });
  });
});
