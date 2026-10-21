import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u) }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {} }));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: unknown) => { select: (c: string) => { single: () => Promise<unknown> } } } }, table: string, _t: string, rec: unknown) =>
    admin.from(table).insert(rec).select("id").single(),
}));

import { runPull } from "./server";
import { fakeDb, seedConnector, stubFetch, TENANT, type Row } from "./syncHarness";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const T1 = "2026-10-01T10:00:00Z", T2 = "2026-10-01T11:00:00Z", T3 = "2026-10-02T09:00:00Z";
const G = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const account = (n: number, name: string, modified = T1) => ({ accountid: G(n), accountnumber: `N-${n}`, name, modifiedon: modified });
const runs = (db: ReturnType<typeof fakeDb>, entity: string) => (db.tables.connector_sync_runs ?? []).filter((r: Row) => r.entity === entity);
const filterOf = (u: URL) => u.searchParams.get("$filter");

describe("pull: ids and filters read only what was asked for", () => {
  it("asks Dynamics for exactly those ids and numbers", async () => {
    const db = fakeDb(seedConnector());
    const calls = stubFetch(() => ({ value: [account(1, "One"), account(2, "Two")] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { ids: [G(1), "N-2"] } });
    expect(calls).toHaveLength(1);
    expect(filterOf(calls[0])).toBe(`(accountid eq ${G(1)} or accountnumber eq 'N-2')`);
    expect(r.counts).toMatchObject({ read: 2, created: 2, filtered: 1 });
    expect(r.error).toBeNull();
    expect(db.tables.accounts).toHaveLength(2);
  });

  it("sends the text, date and active filters; quotes in the text stay inside the literal", async () => {
    const db = fakeDb(seedConnector());
    const calls = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { since: "2026-10-01T00:00:00Z", text: "x') or (1 eq 1", activeOnly: true } });
    expect(filterOf(calls[0])).toBe(`(modifiedon ge 2026-10-01T00:00:00Z) and (contains(name,'x'') or (1 eq 1') or contains(accountnumber,'x'') or (1 eq 1')) and (statecode eq 0)`);
  });

  it("keeps the entity's own filter in front of the selection", async () => {
    const db = fakeDb(seedConnector({ entities: { vendors: { enabled: true } } }));
    const calls = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "vendors", { trigger: "manual", userId: null, select: { text: "AG" } });
    expect(filterOf(calls[0])).toBe(`(customertypecode eq 10 or customertypecode eq 11) and (contains(name,'AG') or contains(accountnumber,'AG'))`);
  });

  it("splits a long list into several requests and reads them all", async () => {
    const db = fakeDb(seedConnector());
    const ids = Array.from({ length: 45 }, (_, i) => G(i + 1));
    const calls = stubFetch((url) => {
      const mine = ids.filter((g) => (filterOf(url) ?? "").includes(g));
      return { value: mine.map((g, i) => account(Number(g.slice(0, 8)), `Name ${i}`)) };
    });
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { ids } });
    expect(calls).toHaveLength(3);
    expect(r.counts).toMatchObject({ read: 45, created: 45 });
    expect(r.issues).toEqual([]);
  });

  it("says when some of the records were not found", async () => {
    const db = fakeDb(seedConnector());
    stubFetch(() => ({ value: [account(1, "One")] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { ids: [G(1), G(2), G(3)] } });
    expect(r.counts.read).toBe(1);
    expect(r.issues).toEqual(["2 of 3 records were not found in the ERP."]);
  });
});

describe("pull: a selection never moves the incremental position", () => {
  it("leaves no watermark, and the next ordinary run carries on from the one before", async () => {
    const db = fakeDb(seedConnector());
    stubFetch(() => ({ value: [account(1, "One", T1), account(2, "Two", T2)] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(runs(db, "customers")[0].watermark).toBe(T2);

    // A record changed far later is read by a filtered run only.
    stubFetch(() => ({ value: [account(3, "Three", T3)] }));
    const f = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { text: "Three" } });
    expect(f.counts.filtered).toBe(1);
    const filteredRun = runs(db, "customers")[1];
    expect(filteredRun.watermark).toBeNull();
    expect(filteredRun.counts).toMatchObject({ filtered: 1 });

    const calls = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(filterOf(calls[0])).toBe(`modifiedon ge ${T2}`);
  });

  it("does not start from the watermark either: a filtered run asks for what it was told to", async () => {
    const db = fakeDb(seedConnector());
    stubFetch(() => ({ value: [account(1, "One", T2)] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    const calls = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { activeOnly: true } });
    expect(filterOf(calls[0])).toBe("(statecode eq 0)");
  });

  it("an ordinary run without a selection is exactly as before", async () => {
    const db = fakeDb(seedConnector());
    const calls = stubFetch(() => ({ value: [account(1, "One", T1)] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(filterOf(calls[0])).toBeNull();
    expect(r.counts).not.toHaveProperty("filtered");
    expect(r.unsupported).toBeUndefined();
    expect(runs(db, "customers")[0].watermark).toBe(T1);
  });

  it("Finance & Operations: a filtered run leaves the scan cursor alone", async () => {
    const db = fakeDb(seedConnector({ product: "fo", company: "USMF" }));
    const cust = (id: string) => ({ CustomerAccount: id, dataAreaId: "usmf", OrganizationName: `Customer ${id}`, AddressCity: "Riyadh" });
    stubFetch(() => ({ value: [cust("C1"), cust("C2")] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, maxRows: 1 });
    const cursor = runs(db, "customers")[0].watermark;
    expect(cursor).toMatch(/^k\|usmf\|C1$/);

    const calls = stubFetch(() => ({ value: [cust("C9")] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { ids: ["C9"] } });
    expect(filterOf(calls[0])).toBe(`(dataAreaId eq 'usmf') and (CustomerAccount eq 'C9')`);
    expect(r.counts.filtered).toBe(1);
    expect(runs(db, "customers")[1].watermark).toBeNull();

    const next = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(filterOf(next[0])).toContain("CustomerAccount gt 'C1'");
  });
});

describe("pull: what the ERP product cannot express", () => {
  it("applies the rest and lists what was not applied", async () => {
    const db = fakeDb(seedConnector({ product: "fo", company: "USMF" }));
    const calls = stubFetch(() => ({ value: [] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { text: "AG", since: "2026-10-01T00:00:00Z", activeOnly: true } });
    expect(filterOf(calls[0])).toBe(`(dataAreaId eq 'usmf') and (contains(OrganizationName,'AG') or contains(CustomerAccount,'AG'))`);
    expect(r.error).toBeNull();
    expect(r.unsupported).toHaveLength(2);
  });

  it("refuses when nothing can be applied: no request, no run row, no lock", async () => {
    const db = fakeDb(seedConnector({ product: "fo", company: "USMF" }));
    const calls = stubFetch(() => ({ value: [] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { since: "2026-10-01T00:00:00Z" } });
    expect(calls).toHaveLength(0);
    expect(r.runId).toBeNull();
    expect(r.error).toContain("Changed since");
    expect(r.unsupported).toHaveLength(1);
    expect(runs(db, "customers")).toHaveLength(0);
  });

  it("numbers for an entity that has none are refused, not turned into a full read", async () => {
    const db = fakeDb(seedConnector({ entities: {} }));
    const calls = stubFetch(() => ({ value: [] }));
    const r = await runPull(db.client, TENANT, "contacts", { trigger: "manual", userId: null, select: { ids: ["K-1"] } });
    expect(calls).toHaveLength(0);
    expect(r.error).toContain("K-1");
  });
});

describe("pull: the history says it was a filtered run", () => {
  it("writes a Monitor line naming the selection", async () => {
    const seed = seedConnector();
    (seed.tenants[0].features as Record<string, unknown>).integration_middleware = true;
    const db = fakeDb(seed);
    stubFetch(() => ({ value: [account(1, "One")] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { since: "2026-10-01T00:00:00Z", text: "One" } });
    const line = (db.tables.integration_messages ?? [])[0];
    expect(line.summary).toMatchObject({ kind: "connector_run", selection: `changed since 1 Oct 2026, contains "One"` });
    expect((line.summary as { headline: string }).headline).toMatch(/^Filtered run \(changed since 1 Oct 2026, contains "One"\): 1 read, 1 created/);
  });

  it("an ordinary run writes the line it always did", async () => {
    const seed = seedConnector();
    (seed.tenants[0].features as Record<string, unknown>).integration_middleware = true;
    const db = fakeDb(seed);
    stubFetch(() => ({ value: [account(1, "One")] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    const sum = (db.tables.integration_messages ?? [])[0].summary as Record<string, unknown>;
    expect(sum).not.toHaveProperty("headline");
    expect(sum).not.toHaveProperty("selection");
  });
});
