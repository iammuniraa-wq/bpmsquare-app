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

