import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The sync engine against an in-memory stand-in for the service-role client
// and a scripted fetch -- no database, no Dynamics.
vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u) }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {} }));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: unknown) => { select: (c: string) => { single: () => Promise<unknown> } } } }, table: string, _t: string, rec: unknown) =>
    admin.from(table).insert(rec).select("id").single(),
}));

import { runPull, runPushFenceProjects, ALREADY_RUNNING, STALE_RUN_MS } from "./server";
import { fakeDb, seedConnector, stubFetch, acct, TENANT } from "./syncHarness";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("pull: a link that cannot be saved (C2)", () => {
  it("removes the record it just created and counts the row as failed, so no twin appears next run", async () => {
    const db = fakeDb(seedConnector(), { failInsert: (t) => (t === "connector_links" ? { message: "boom", code: "XX000" } : null) });
    stubFetch(() => ({ value: [acct("A1", "Contoso")] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(r.counts).toMatchObject({ read: 1, created: 0, failed: 1 });
    expect(r.issues[0]).toMatch(/could not link .* removed/);
    expect(db.tables.accounts ?? []).toHaveLength(0);
    expect(db.tables.connector_links ?? []).toHaveLength(0);
  });

  it("says so when it cannot even remove the record", async () => {
    const db = fakeDb(seedConnector(), { failInsert: (t) => (t === "connector_links" ? { message: "boom" } : null), failDelete: (t) => (t === "accounts" ? { message: "locked" } : null) });
    stubFetch(() => ({ value: [acct("A1", "Contoso")] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(r.counts.failed).toBe(1);
    expect(r.issues[0]).toMatch(/remove the duplicate by hand/);
  });
});

describe("runs: lock, stale runs and time budget (H5)", () => {
  it("does not start while a live run of the same entity exists", async () => {
    const db = fakeDb({ ...seedConnector(), connector_sync_runs: [{ id: "r0", tenant_id: TENANT, connector_id: "dynamics365", entity: "customers", status: "running", started_at: new Date().toISOString() }] });
    const calls = stubFetch(() => ({ value: [] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "schedule", userId: null });
    expect(r.error).toBe(ALREADY_RUNNING);
    expect(calls).toHaveLength(0);
    // another entity is not blocked by it
    const r2 = await runPull(db.client, TENANT, "products", { trigger: "schedule", userId: null });
    expect(r2.error).toBeNull();
  });

  it("closes a run a killed function left in 'running' and carries on", async () => {
    const old = new Date(Date.now() - STALE_RUN_MS - 60_000).toISOString();
    const db = fakeDb({ ...seedConnector(), connector_sync_runs: [{ id: "r0", tenant_id: TENANT, connector_id: "dynamics365", entity: "customers", status: "running", started_at: old }] });
    stubFetch(() => ({ value: [acct("A1", "Contoso")] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(r.error).toBeNull();
    expect(r.counts.created).toBe(1);
    expect(db.tables.connector_sync_runs.find((x) => x.id === "r0")).toMatchObject({ status: "failed" });
  });

  it("releases the lock when the run ends, even on an error", async () => {
    const db = fakeDb(seedConnector());
    stubFetch(() => ({ status: 400, body: { error: { message: "Bad field" } } }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(r.error).toBe("Bad field");
    expect(db.tables.connector_sync_runs.every((x) => x.status !== "running")).toBe(true);
    stubFetch(() => ({ value: [] }));
    expect((await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null })).error).toBeNull();
  });

  it("stops starting rows at the deadline and says the next run continues", async () => {
    const db = fakeDb(seedConnector());
    stubFetch(() => ({ value: [acct("A1", "One"), acct("A2", "Two")] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, deadline: Date.now() - 1 });
    expect(r.counts.read).toBe(0);
    expect(r.issues.join()).toMatch(/time limit/);
    expect(db.tables.connector_sync_runs.every((x) => x.status !== "running")).toBe(true);
  });

  it("a push does not start while another push is running", async () => {
    const db = fakeDb({ ...seedConnector({ entities: { fence_projects: { enabled: true, entity_set: "msdyn_projects", id_field: "msdyn_projectid", field_map: { msdyn_subject: "{name}" } } } }), connector_sync_runs: [{ id: "r0", tenant_id: TENANT, connector_id: "dynamics365", entity: "fence_projects", status: "running", started_at: new Date().toISOString() }] });
    const calls = stubFetch(() => ({ value: [] }));
    const r = await runPushFenceProjects(db.client, TENANT, { trigger: "manual", userId: null });
    expect(r.error).toBe(ALREADY_RUNNING);
    expect(calls).toHaveLength(0);
  });
});
