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

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;

export function fakeDb(seed: Record<string, Row[]> = {}, opts: { failInsert?: (table: string, row: Row) => DbError; failDelete?: (table: string) => DbError } = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  let n = 0;
  const rows = (t: string) => (tables[t] ??= []);

  class Q implements PromiseLike<{ data: unknown; error: DbError }> {
    private filters: ((r: Row) => boolean)[] = [];
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row = {};
    private wantRows = false;
    private one: "single" | "maybe" | null = null;
    private lim: number | null = null;
    private ord: { col: string; asc: boolean } | null = null;
    private rng: [number, number] | null = null;
    constructor(private table: string) {}
    select() { this.wantRows = true; return this; }
    insert(r: Row) { this.op = "insert"; this.payload = r; return this; }
    update(r: Row) { this.op = "update"; this.payload = r; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
    in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
    lt(c: string, v: unknown) { this.filters.push((r) => r[c] != null && (r[c] as string) < (v as string)); return this; }
    not(c: string, _op: string, _v: unknown) { this.filters.push((r) => r[c] != null); return this; }
    order(col: string, o?: { ascending?: boolean }) { this.ord = { col, asc: o?.ascending !== false }; return this; }
    limit(n: number) { this.lim = n; return this; }
    range(a: number, b: number) { this.rng = [a, b]; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    then<R1, R2>(res?: ((v: { data: unknown; error: DbError }) => R1 | PromiseLike<R1>) | null, rej?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
      return Promise.resolve(this.run()).then(res, rej);
    }
    private run(): { data: unknown; error: DbError } {
      const t = rows(this.table);
      const match = (r: Row) => this.filters.every((f) => f(r));
      if (this.op === "insert") {
        const bad = opts.failInsert?.(this.table, this.payload);
        if (bad) return { data: null, error: bad };
        const row: Row = { id: `id-${++n}`, ...(this.table === "connector_sync_runs" ? { status: "running", started_at: new Date().toISOString() } : {}), ...this.payload };
        const dup = (this.table === "connector_links" && t.some((x) => ["tenant_id", "connector_id", "entity", "external_id"].every((k) => x[k] === row[k])))
          || (this.table === "connector_sync_runs" && row.status === "running" && t.some((x) => x.status === "running" && ["tenant_id", "connector_id", "entity"].every((k) => x[k] === row[k])));
        if (dup) return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        t.push(row);
        return { data: this.one ? row : this.wantRows ? [row] : null, error: null };
      }
      if (this.op === "update") {
        const hit = t.filter(match);
        for (const r of hit) Object.assign(r, this.payload);
        return { data: this.wantRows ? hit : null, error: null };
      }
      if (this.op === "delete") {
        const bad = opts.failDelete?.(this.table);
        if (bad) return { data: null, error: bad };
        tables[this.table] = t.filter((r) => !match(r));
        return { data: null, error: null };
      }
      let out = t.filter(match);
      if (this.ord) { const { col, asc } = this.ord; out = [...out].sort((a, b) => ((a[col] as string) < (b[col] as string) ? -1 : (a[col] as string) > (b[col] as string) ? 1 : 0) * (asc ? 1 : -1)); }
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim !== null) out = out.slice(0, this.lim);
      if (this.one) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }
  }
  return { client: { from: (t: string) => new Q(t) } as never, tables };
}

export const TENANT = "t-1";

export function seedConnector(over: { product?: string; company?: string; entities?: Record<string, unknown> } = {}) {
  const product = over.product ?? "dataverse";
  return {
    tenant_connectors: [{
      tenant_id: TENANT, connector_id: "dynamics365", status: "connected", last_error: null,
      config: { product, auth_mode: "client_secret", environment_url: product === "fo" ? "https://x.operations.dynamics.com" : "https://org.crm.dynamics.com", directory_id: "contoso.com", client_id: "00000000-0000-0000-0000-000000000000", company: over.company, schedule: "off", entities: over.entities ?? {} },
      credentials: { access_token: "tok", expires_at: String(Date.now() + 3_600_000) },
    }],
    tenants: [{ id: TENANT, features: { accounts: true, contacts: true, suppliers: true, products: true, wfm_projects: true, fence_projects: true } }],
  } as Record<string, Row[]>;
}

/** Scripted OData server: each call gets the next handler result. */
export function stubFetch(handler: (url: URL, call: number) => { value: Row[]; next?: string } | { status: number; body?: unknown }) {
  const calls: URL[] = [];
  vi.stubGlobal("fetch", async (u: string) => {
    const url = new URL(u);
    calls.push(url);
    const r = handler(url, calls.length - 1);
    if ("status" in r) return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
    return new Response(JSON.stringify({ value: r.value, ...(r.next ? { "@odata.nextLink": r.next } : {}) }), { status: 200 });
  });
  return calls;
}

const acct = (id: string, name: string, modified = "2026-10-01T10:00:00Z") => ({ accountid: id, accountnumber: `N-${id}`, name, modifiedon: modified });

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
