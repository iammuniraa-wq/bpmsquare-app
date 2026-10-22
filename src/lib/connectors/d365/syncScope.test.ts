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

const T1 = "2026-10-01T10:00:00Z", T2 = "2026-10-01T11:00:00Z";
const G = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const account = (n: number, name: string, modified = T1) => ({ accountid: G(n), accountnumber: `N-${n}`, name, modifiedon: modified });
const runs = (db: ReturnType<typeof fakeDb>, entity: string) => (db.tables.connector_sync_runs ?? []).filter((r: Row) => r.entity === entity);
const filterOf = (u: URL) => u.searchParams.get("$filter");
const withMiddleware = (seed: Record<string, Row[]>) => { (seed.tenants[0].features as Record<string, unknown>).integration_middleware = true; return seed; };

describe("pull: the saved scope narrows every ordinary run", () => {
  const CLASS = { attribute: "accountclassificationcode", kind: "option", values: ["1", "2", "3"], labels: ["A", "B", "C"], attribute_label: "Class" };
  const TERR = { attribute: "territoryid", kind: "lookup", values: [G(9)], labels: ["North"], attribute_label: "Territory" };
  const scoped = () => seedConnector({ entities: { customers: { scope: { conditions: [CLASS, TERR] } } } });
  const SCOPE_SQL = `(accountclassificationcode eq 1 or accountclassificationcode eq 2 or accountclassificationcode eq 3) and (_territoryid_value eq ${G(9)})`;

  it("asks the ERP only for the matching records, values OR'd inside a condition and conditions AND'd", async () => {
    const db = fakeDb(scoped());
    const calls = stubFetch(() => ({ value: [account(1, "One")] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(filterOf(calls[0])).toBe(`((${SCOPE_SQL}))`);
    expect(r.error).toBeNull();
    expect(r.counts.read).toBe(1);
  });

  it("applies to the incremental run: the watermark is added to the scope, not instead of it", async () => {
    const db = fakeDb(scoped());
    stubFetch(() => ({ value: [account(1, "One", T2)] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(runs(db, "customers")[0].watermark).toBe(T2);
    const calls = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "customers", { trigger: "schedule", userId: null });
    expect(filterOf(calls[0])).toBe(`((${SCOPE_SQL})) and modifiedon ge ${T2}`);
  });

  it("a full resync reads the whole scope again, still under the scope", async () => {
    const db = fakeDb(scoped());
    stubFetch(() => ({ value: [account(1, "One", T2)] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    const calls = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, full: true });
    expect(filterOf(calls[0])).toBe(`((${SCOPE_SQL}))`);
  });

  it("keeps the entity's own filter and the scope together", async () => {
    const db = fakeDb(seedConnector({ entities: { vendors: { enabled: true, scope: { conditions: [{ attribute: "address1_country", kind: "text", values: ["Qatar"] }] } } } }));
    const calls = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "vendors", { trigger: "manual", userId: null, full: true });
    expect(filterOf(calls[0])).toBe(`((customertypecode eq 10 or customertypecode eq 11) and ((address1_country eq 'Qatar')))`);
  });

  it("a run for named ids is an explicit ask and ignores the scope", async () => {
    const db = fakeDb(scoped());
    const calls = stubFetch(() => ({ value: [account(1, "One")] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { ids: [G(1)] } });
    expect(filterOf(calls[0])).toBe(`(accountid eq ${G(1)})`);
  });

  it("an empty scope changes nothing", async () => {
    const db = fakeDb(seedConnector({ entities: { customers: { scope: { conditions: [] } } } }));
    const calls = stubFetch(() => ({ value: [account(1, "One", T1)] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(filterOf(calls[0])).toBeNull();
  });

  it("Finance & Operations: a text attribute under the company filter; a quote in a value stays inside its literal", async () => {
    const db = fakeDb(seedConnector({ product: "fo", company: "USMF", entities: { customers: { scope: { conditions: [{ attribute: "CustomerGroupId", kind: "text", values: ["10", "20' or 1 eq 1"] }] } } } }));
    const calls = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(filterOf(calls[0])).toContain(`(CustomerGroupId eq '10' or CustomerGroupId eq '20'' or 1 eq 1')`);
    expect(filterOf(calls[0])).toContain(`dataAreaId eq 'usmf'`);
  });

  it("refuses a scope that cannot be built, without opening a run", async () => {
    const db = fakeDb(seedConnector({ entities: { customers: { scope: { conditions: [{ attribute: "name; drop", kind: "text", values: ["x"] }] } } } }));
    const calls = stubFetch(() => ({ value: [] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(calls).toHaveLength(0);
    expect(r.error).toMatch(/saved scope cannot be used/);
    expect(runs(db, "customers")).toHaveLength(0);
  });

  it("stops with a plain fix line when the system no longer has an attribute", async () => {
    const db = fakeDb(withMiddleware(scoped()));
    stubFetch(() => ({ status: 400, body: { error: { message: "Could not find a property named 'accountclassificationcode' on type 'account'." } } }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(r.error).toMatch(/did not accept the saved scope/);
    expect(r.error).toMatch(/Open Scope for customers/);
    expect(runs(db, "customers")[0].status).toBe("failed");
    expect((db.tables.integration_messages ?? [])[0].status).toBe("failed");
  });
});

describe("pull: a changed scope is brought in by a full resync", () => {
  const conds = [{ attribute: "address1_country", kind: "text", values: ["Qatar"] }];
  const scopeOf = (db: ReturnType<typeof fakeDb>) => (db.tables.tenant_connectors[0].config as { entities: { customers: { scope: { needs_full?: boolean } } } }).entities.customers.scope;

  it("an incremental run under a changed scope says so; a finished full resync settles it", async () => {
    const db = fakeDb(seedConnector({ entities: { customers: { scope: { conditions: conds, needs_full: true } } } }));
    stubFetch(() => ({ value: [account(1, "One")] }));
    const inc = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(inc.issues).toContain("Scope changed: run Full resync to bring in the rest.");
    expect(scopeOf(db).needs_full).toBe(true);

    stubFetch(() => ({ value: [account(1, "One")] }));
    const full = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, full: true });
    expect(full.issues).not.toContain("Scope changed: run Full resync to bring in the rest.");
    expect(scopeOf(db).needs_full).toBeUndefined();
    expect(scopeOf(db)).toMatchObject({ conditions: conds });
  });

  it("a run for ids does not settle it", async () => {
    const db = fakeDb(seedConnector({ entities: { customers: { scope: { conditions: conds, needs_full: true } } } }));
    stubFetch(() => ({ value: [account(1, "One")] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, full: true, select: { ids: [G(1)] } });
    expect(scopeOf(db).needs_full).toBe(true);
  });
});

describe("pull: records that fall out of the scope are left alone", () => {
  const link = (n: number) => ({ tenant_id: TENANT, connector_id: "dynamics365", entity: "customers", object_type: "accounts", object_id: `acc-${n}`, external_id: G(n), external_key: `N-${n}`, content_hash: "old" });
  const qatar = { customers: { scope: { conditions: [{ attribute: "address1_country", kind: "text", values: ["Qatar"] }] } } };

  it("a full run under a scope counts them and neither deletes nor unlinks anything; the Monitor says so", async () => {
    const seed = withMiddleware({ ...seedConnector({ entities: qatar }), connector_links: [link(1), link(2), link(3)], accounts: [{ id: "acc-1", tenant_id: TENANT }, { id: "acc-2", tenant_id: TENANT }, { id: "acc-3", tenant_id: TENANT }] });
    const db = fakeDb(seed);
    stubFetch(() => ({ value: [account(1, "One")] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, full: true });
    expect(r.counts).toMatchObject({ read: 1, outside_scope: 2 });
    expect(db.tables.connector_links).toHaveLength(3);
    expect(db.tables.accounts).toHaveLength(3);
    const line = (db.tables.integration_messages ?? [])[0];
    expect(line.summary).toMatchObject({ scope: "Address1 country Qatar" });
    expect((line.summary as { headline: string }).headline).toMatch(/^Scope \(Address1 country Qatar\): 1 read.*2 outside scope left unchanged$/);
  });

  it("an incremental run does not count them: it only reads what changed", async () => {
    const db = fakeDb({ ...seedConnector({ entities: qatar }), connector_links: [link(1), link(2)] });
    stubFetch(() => ({ value: [] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "schedule", userId: null });
    expect(r.counts).not.toHaveProperty("outside_scope");
  });
});

describe("pull: records asked for by id", () => {
  it("numbers for an entity that has none are refused, not turned into a full read", async () => {
    const db = fakeDb(seedConnector());
    const calls = stubFetch(() => ({ value: [] }));
    const r = await runPull(db.client, TENANT, "contacts", { trigger: "manual", userId: null, select: { ids: ["K-1"] } });
    expect(calls).toHaveLength(0);
    expect(r.error).toContain("K-1");
    expect(runs(db, "contacts")).toHaveLength(0);
  });

  it("a run for ids leaves no watermark, and the next ordinary run carries on from the one before", async () => {
    const db = fakeDb(seedConnector());
    stubFetch(() => ({ value: [account(1, "One", T1), account(2, "Two", T2)] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(runs(db, "customers")[0].watermark).toBe(T2);
    stubFetch(() => ({ value: [account(3, "Three", "2026-10-02T09:00:00Z")] }));
    const f = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { ids: [G(3)] } });
    expect(f.counts.filtered).toBe(1);
    expect(runs(db, "customers")[1].watermark).toBeNull();
    const calls = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(filterOf(calls[0])).toBe(`modifiedon ge ${T2}`);
  });
});

describe("pull: the history says what a run read", () => {
  it("names the ids of a run for named records", async () => {
    const db = fakeDb(withMiddleware(seedConnector()));
    stubFetch(() => ({ value: [account(1, "One")] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, select: { ids: [G(1)] } });
    expect((db.tables.integration_messages ?? [])[0].summary).toMatchObject({ kind: "connector_run", selection: "1 record by id or number" });
  });

  it("an ordinary run writes the line it always did", async () => {
    const db = fakeDb(withMiddleware(seedConnector()));
    stubFetch(() => ({ value: [account(1, "One")] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    const sum = (db.tables.integration_messages ?? [])[0].summary as Record<string, unknown>;
    expect(sum).not.toHaveProperty("headline");
    expect(sum).not.toHaveProperty("selection");
    expect(sum).not.toHaveProperty("scope");
  });
});
