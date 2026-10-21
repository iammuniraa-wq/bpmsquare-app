import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildMessageRow, recordMessage, recordConnectorRun, recordApiCall, pruneMessages, resolveEarlier, findOpenMessage, messagesTableReady, MESSAGE_RETENTION_DAYS } from "./messages";
import { fakeAdmin, T1, T2 } from "./testHarness";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const base = { tenantId: T1, direction: "out" as const, channel: "connector" as const, status: "ok" as const };

describe("payload capture is off unless switched on", () => {
  const payload = { name: "SQ-0001", Authorization: "Bearer abcdefgh12345678", emailaddress1: "a@b.com" };

  it("off: the body is never stored", () => {
    expect(buildMessageRow({ ...base, payload }, false).payload).toBeNull();
  });

  it("on: stored, with tokens and personal data redacted", () => {
    const row = buildMessageRow({ ...base, payload }, true);
    expect(row.payload).toEqual({ name: "SQ-0001", Authorization: "[redacted]", emailaddress1: "[redacted]" });
  });

  it("the error text and summary are scrubbed too", () => {
    const row = buildMessageRow({ ...base, error: "refused for jane@example.com with Bearer abcdefgh12345678", summary: { note: "call +49 170 1234567" } }, false);
    expect(String(row.error)).not.toMatch(/jane@|abcdefgh/);
    expect(JSON.stringify(row.summary)).not.toContain("1234567");
  });

  it("carries the tenant and bounds its fields", () => {
    const row = buildMessageRow({ ...base, refLabel: "x".repeat(500), error: "e".repeat(5000), durationMs: 12.6, httpStatus: 200.9 }, false);
    expect(row.tenant_id).toBe(T1);
    expect(String(row.ref_label)).toHaveLength(200);
    expect(String(row.error).length).toBeLessThanOrEqual(1000);
    expect(row.duration_ms).toBe(13);
    expect(row.http_status).toBe(200);
  });
});

describe("recording never throws", () => {
  it("writes a row and returns its id", async () => {
    const db = fakeAdmin({ integration_messages: [] });
    const r = await recordMessage(db.client, base);
    expect(r.id).toBeTruthy();
    expect(db.tables.integration_messages).toHaveLength(1);
  });

  it("a missing table is the explicit state, not an error", async () => {
    const db = fakeAdmin({}, { missing: ["integration_messages"] });
    expect(await recordMessage(db.client, base)).toEqual({ id: null, needsDatabaseUpdate: true });
    expect(await messagesTableReady(db.client, T1)).toBe(false);
  });

  it("any other failure is swallowed and logged", async () => {
    const db = fakeAdmin({}, { failInsert: () => ({ message: "disk full", code: "53100" }) });
    expect(await recordMessage(db.client, base)).toEqual({ id: null, needsDatabaseUpdate: false });
    const exploding = { from: () => { throw new Error("network down"); } } as never;
    expect(await recordMessage(exploding, base)).toEqual({ id: null, needsDatabaseUpdate: false });
  });
});

describe("connector runs and API calls", () => {
  it("one message per run: counts, the failed rows, the run id as correlation id", async () => {
    const db = fakeAdmin({ integration_messages: [] });
    await recordConnectorRun(db.client, T1, { runId: "run-1", entity: "customers", direction: "pull", trigger: "manual", counts: { read: 6, created: 5, failed: 1 }, issues: ["a", "b", "c", "d", "e", "f", "g"], error: null, startedAtMs: Date.now() - 1500 });
    const m = db.tables.integration_messages[0];
    expect(m).toMatchObject({ direction: "in", channel: "connector", entity: "customers", status: "failed", correlation_id: "run-1", tenant_id: T1 });
    expect((m.summary as { failed_rows: string[] }).failed_rows).toHaveLength(5);
    expect(Number(m.duration_ms)).toBeGreaterThanOrEqual(1500);
  });

  it("a clean push run is ok and goes out", async () => {
    const db = fakeAdmin({ integration_messages: [] });
    await recordConnectorRun(db.client, T1, { runId: null, entity: "fence_projects", direction: "push", trigger: "schedule", counts: { read: 1, created: 1, failed: 0 }, issues: [], error: null, startedAtMs: Date.now() });
    expect(db.tables.integration_messages[0]).toMatchObject({ direction: "out", status: "ok" });
  });

  it("an API call keeps metadata only: method, path, kind of key, outcome", async () => {
    const db = fakeAdmin({ integration_messages: [] });
    await recordApiCall(db.client, T1, { method: "GET", path: "/api/v1/accounts", status: 404, durationMs: null, keyId: "k-1", object: "accounts" });
    const m = db.tables.integration_messages[0];
    expect(m).toMatchObject({ direction: "in", channel: "api", status: "failed", http_status: 404, entity: "accounts", payload: null });
    expect(m.summary).toEqual({ method: "GET", path: "/api/v1/accounts", key: "scoped key" });
  });
});

describe("housekeeping", () => {
  it("prunes after 30 days, only for the named tenant", async () => {
    const now = Date.parse("2026-11-30T00:00:00Z");
    const old = new Date(now - (MESSAGE_RETENTION_DAYS + 1) * 86_400_000).toISOString();
    const fresh = new Date(now - 5 * 86_400_000).toISOString();
    const db = fakeAdmin({ integration_messages: [{ id: "a", tenant_id: T1, created_at: old }, { id: "b", tenant_id: T1, created_at: fresh }, { id: "c", tenant_id: T2, created_at: old }] });
    await pruneMessages(db.client, T1, now);
    expect(db.tables.integration_messages.map((r) => r.id).sort()).toEqual(["b", "c"]);
  });

  it("settles earlier failed items for the same quote and outcome only", async () => {
    const mk = (id: string, outcome: string, status: string, obj = "q-1", tenant = T1) => ({ id, tenant_id: tenant, object_type: "standard_quotes", object_id: obj, status, summary: { outcome } });
    const db = fakeAdmin({ integration_messages: [mk("a", "awarded", "failed"), mk("b", "rejected", "failed"), mk("c", "awarded", "failed", "q-2"), mk("d", "awarded", "failed", "q-1", T2)] });
    await resolveEarlier(db.client, T1, "q-1", "awarded", "new");
    const by = Object.fromEntries(db.tables.integration_messages.map((r) => [r.id, r]));
    expect(by.a).toMatchObject({ status: "skipped" });
    expect((by.a.summary as Record<string, unknown>).resolved).toBe(true);
    expect(by.b.status).toBe("failed");
    expect(by.c.status).toBe("failed");
    expect(by.d.status).toBe("failed");
    expect(await findOpenMessage(db.client, T1, "q-1", "rejected", "failed")).toEqual({ id: "b" });
    expect(await findOpenMessage(db.client, T1, "q-1", "awarded", "failed")).toBeNull();
  });
});
