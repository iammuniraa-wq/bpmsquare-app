import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u) }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {} }));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: unknown) => { select: (c: string) => { single: () => Promise<unknown> } } } }, table: string, _t: string, rec: unknown) =>
    admin.from(table).insert(rec).select("id").single(),
}));

import { runPull, runPushFenceProjects } from "./server";
import { fakeDb, seedConnector, stubFetch, acct, TENANT, type Row } from "./syncHarness";
import {
  nextModifiedWatermark, parseCursor, formatCursor, keysetFilter, selectFields, scopedExternalId, splitExternalId,
  accountLookupKeys, withDataArea, rotateStart, mapPullRow, normalizeModified,
} from "./mapping";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const lastRun = (db: ReturnType<typeof fakeDb>, entity: string) => [...(db.tables.connector_sync_runs ?? [])].filter((r) => r.entity === entity).pop();
const T1 = "2026-10-01T10:00:00Z", T2 = "2026-10-01T11:00:00Z", T3 = "2026-10-01T12:00:00Z";

describe("pull: failed and deferred rows are not lost (H2)", () => {
  it("holds the watermark at the first failed row and reads it again next run", async () => {
    let failBad = true;
    const db = fakeDb(seedConnector(), { failInsert: (t, r) => (t === "accounts" && r.name === "Bad" && failBad ? { message: "constraint" } : null) });
    stubFetch(() => ({ value: [acct("A1", "Ok1", T1), acct("A2", "Bad", T2), acct("A3", "Ok3", T3)] }));
    const r1 = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(r1.counts).toMatchObject({ read: 3, created: 2, failed: 1 });
    expect(lastRun(db, "customers")?.watermark).toBe(T2);

    failBad = false;
    const calls = stubFetch(() => ({ value: [acct("A2", "Bad", T2), acct("A3", "Ok3", T3)] }));
    const r2 = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(calls[0].searchParams.get("$filter")).toBe(`modifiedon ge ${T2}`);
    expect(r2.counts).toMatchObject({ read: 2, created: 1, unchanged: 1, failed: 0 });
    expect(lastRun(db, "customers")?.watermark).toBe(T3);
  });

  it("holds the watermark at a contact whose customer has not been synced yet", async () => {
    const db = fakeDb(seedConnector());
    const contact = (id: string, acc: string, mod: string) => ({ contactid: id, fullname: `Person ${id}`, _parentcustomerid_value: acc, modifiedon: mod });
    stubFetch(() => ({ value: [contact("K1", "A-unknown", T1), contact("K2", "A-unknown", T2)] }));
    const r = await runPull(db.client, TENANT, "contacts", { trigger: "manual", userId: null });
    expect(r.counts).toMatchObject({ skipped: 2, created: 0 });
    expect(lastRun(db, "contacts")?.watermark).toBe(T1);
  });

  it("does not hold on a row that can never be applied (no id)", async () => {
    const db = fakeDb(seedConnector());
    stubFetch(() => ({ value: [{ name: "no id", modifiedon: T1 }, acct("A2", "Ok", T2)] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(lastRun(db, "customers")?.watermark).toBe(T2);
  });

  it("moves on when holding would pin the sync to the same stretch (stopped early, no progress)", () => {
    expect(nextModifiedWatermark({ start: T1, firstSeen: T1, maxSeen: T3, firstHold: T1, stoppedEarly: true })).toEqual({ watermark: T3, held: false, releasedStall: true });
    expect(nextModifiedWatermark({ start: null, firstSeen: T1, maxSeen: T3, firstHold: T1, stoppedEarly: true }).releasedStall).toBe(true);
    // progress was made before the failure: hold there
    expect(nextModifiedWatermark({ start: T1, firstSeen: T1, maxSeen: T3, firstHold: T2, stoppedEarly: true })).toEqual({ watermark: T2, held: true, releasedStall: false });
    // not stopped early: always hold
    expect(nextModifiedWatermark({ start: T1, firstSeen: T1, maxSeen: T3, firstHold: T1, stoppedEarly: false })).toEqual({ watermark: T1, held: true, releasedStall: false });
    expect(nextModifiedWatermark({ start: T1, firstSeen: T1, maxSeen: T3, firstHold: null, stoppedEarly: false }).watermark).toBe(T3);
  });
});

describe("pull: Finance & Operations keyset cursor (C1)", () => {
  const fo = () => seedConnector({ product: "fo", company: "USMF" });
  const cust = (id: string, area = "usmf") => ({ CustomerAccount: id, dataAreaId: area, OrganizationName: `Customer ${id}`, AddressCity: "Riyadh" });

  it("reads in id order, resumes after the last id it reached, and starts over once the table is done", async () => {
    const db = fakeDb(fo());
    const all = ["C1", "C2", "C3"].map((i) => cust(i));
    const calls = stubFetch((url) => {
      const m = (url.searchParams.get("$filter") ?? "").match(/CustomerAccount gt '([^']+)'/);
      return { value: all.filter((r) => !m || r.CustomerAccount > m[1]) };
    });

    const r1 = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, maxRows: 2 });
    expect(calls[0].searchParams.get("$orderby")).toBe("CustomerAccount asc");
    expect(calls[0].searchParams.get("$filter")).toBe("((dataAreaId eq 'usmf'))");
    expect(calls[0].searchParams.get("cross-company")).toBe("true");
    expect(r1.counts).toMatchObject({ read: 2, created: 2 });
    expect(lastRun(db, "customers")?.watermark).toBe("k|usmf|C2");

    const r2 = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, maxRows: 2 });
    expect(calls[1].searchParams.get("$filter")).toBe("((dataAreaId eq 'usmf')) and CustomerAccount gt 'C2'");
    expect(r2.counts).toMatchObject({ read: 1, created: 1 });
    expect(lastRun(db, "customers")?.watermark).toBe("k|usmf|");

    // finished: the next run is a fresh scan from the top and finds nothing new
    const r3 = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(calls[2].searchParams.get("$filter")).toBe("((dataAreaId eq 'usmf'))");
    expect(r3.counts).toMatchObject({ read: 3, unchanged: 3, created: 0 });
    expect(db.tables.accounts).toHaveLength(3);
  });

  it("a full sync ignores the cursor; a cursor from another company is ignored", async () => {
    const db = fakeDb(fo());
    db.tables.connector_sync_runs = [{ id: "r0", tenant_id: TENANT, connector_id: "dynamics365", entity: "customers", direction: "pull", status: "partial", watermark: "k|usmf|C2", started_at: "2026-10-01T00:00:00Z" }];
    const calls = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null, full: true });
    expect(calls[0].searchParams.get("$filter")).toBe("((dataAreaId eq 'usmf'))");
    expect(parseCursor("k|usmf|C2", "USMF")).toEqual({ lastId: "C2" });
    expect(parseCursor("k|usmf|C2", "ussi")).toEqual({ lastId: null });
    expect(parseCursor("k|usmf|", "usmf")).toEqual({ lastId: null });
    expect(parseCursor("2026-10-01T10:00:00Z", "usmf")).toEqual({ lastId: null });
    expect(formatCursor("USMF", "C9")).toBe("k|usmf|C9");
  });

  it("writes ids as strings or bare GUIDs and refuses anything that is not a plain field name", () => {
    expect(keysetFilter("CustomerAccount", "O'Neil")).toBe("CustomerAccount gt 'O''Neil'");
    expect(keysetFilter("id", "11111111-2222-3333-4444-555555555555", "x eq 1")).toBe("(x eq 1) and id gt 11111111-2222-3333-4444-555555555555");
    expect(keysetFilter("bad field", "x")).toBeUndefined();
    expect(keysetFilter("id", null)).toBeUndefined();
  });
});

describe("pull: F&O ids carry the company (H6)", () => {
  const cust = (id: string, area: string, name = `Customer ${id}`) => ({ CustomerAccount: id, dataAreaId: area, OrganizationName: name });

  it("keeps the same account number in two companies apart", async () => {
    const db = fakeDb(seedConnector({ product: "fo" }));
    stubFetch(() => ({ value: [cust("C0100", "usmf", "US Ltd"), cust("C0100", "ussi", "SI Ltd")] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(r.counts.created).toBe(2);
    expect(db.tables.connector_links.map((l) => l.external_id).sort()).toEqual(["usmf|C0100", "ussi|C0100"]);
    expect(db.tables.accounts.map((a) => a.name).sort()).toEqual(["SI Ltd", "US Ltd"]);
  });

  it("still finds a record linked under the old bare id, re-keys that one link, and gives the other company its own record", async () => {
    const db = fakeDb({
      ...seedConnector({ product: "fo" }),
      accounts: [{ id: "acc-1", tenant_id: TENANT, name: "Old name" }],
      connector_links: [{ id: "l1", tenant_id: TENANT, connector_id: "dynamics365", entity: "customers", object_type: "accounts", object_id: "acc-1", external_id: "C0100", external_key: "C0100", direction: "pull", content_hash: "stale" }],
    });
    stubFetch(() => ({ value: [cust("C0100", "usmf", "US Ltd"), cust("C0100", "ussi", "SI Ltd")] }));
    const r = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(r.counts).toMatchObject({ updated: 1, created: 1, failed: 0 });
    expect(db.tables.accounts.find((a) => a.id === "acc-1")?.name).toBe("US Ltd");
    expect(db.tables.connector_links.find((l) => l.id === "l1")?.external_id).toBe("usmf|C0100");
    expect(db.tables.connector_links.map((l) => l.external_id).sort()).toEqual(["usmf|C0100", "ussi|C0100"]);
    const r2 = await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(r2.counts).toMatchObject({ unchanged: 2, created: 0, updated: 0 });
  });

  it("links a contact to its customer whichever id form the customer link has", () => {
    expect(accountLookupKeys("usmf", "C0100")).toEqual(["usmf|c0100", "c0100"]);
    expect(accountLookupKeys(null, "A1")).toEqual(["a1"]);
    expect(splitExternalId("usmf|C0100")).toEqual({ area: "usmf", id: "C0100" });
    expect(splitExternalId("C0100")).toEqual({ area: null, id: "C0100" });
    expect(splitExternalId("11111111-2222-3333-4444-555555555555")).toEqual({ area: null, id: "11111111-2222-3333-4444-555555555555" });
    expect(scopedExternalId("fo", "USMF", "C1")).toBe("usmf|C1");
    expect(scopedExternalId("dataverse", "usmf", "C1")).toBe("C1");
    expect(scopedExternalId("fo", null, "C1")).toBe("C1");
    const m = mapPullRow("customers", { enabled: true, entity_set: "CustomersV3", id_field: "CustomerAccount", field_map: { name: "OrganizationName" } }, cust("C1", "USMF"), "fo");
    expect(m).toMatchObject({ externalId: "usmf|C1", rawId: "C1", area: "usmf" });
  });

  it("sends dataAreaId on a push and the bare account number, and stores the project under a company-scoped id", async () => {
    const db = fakeDb({
      ...seedConnector({ product: "fo", company: "USMF", entities: { fence_projects: { enabled: true, entity_set: "Projects", id_field: "ProjectID", field_map: { ProjectName: "{name}", CustomerAccount: "{account_external_id}" } } } }),
      fence_projects: [{ id: "fp-1", tenant_id: TENANT, ref: "FEN-0001", name: "Site A", status: "won", total_length_m: 120, layout: "open_run", account_id: "acc-1" }],
      connector_links: [{ id: "l1", tenant_id: TENANT, connector_id: "dynamics365", entity: "customers", object_type: "accounts", object_id: "acc-1", external_id: "usmf|C0100", direction: "pull" }],
    });
    let sent: Row | null = null;
    stubFetch((_u, _i, init) => {
      sent = JSON.parse(String(init.body)) as Row;
      return { status: 201, body: { ProjectID: "P-1", dataAreaId: "usmf" } };
    });
    const r = await runPushFenceProjects(db.client, TENANT, { trigger: "manual", userId: null });
    expect(r.counts).toMatchObject({ created: 1, failed: 0 });
    expect(sent).toEqual({ ProjectName: "Site A", CustomerAccount: "C0100", dataAreaId: "usmf" });
    expect(db.tables.connector_links.find((l) => l.entity === "fence_projects")?.external_id).toBe("usmf|P-1");
  });

  it("leaves a push body alone when the admin maps dataAreaId themselves, or the product is not F&O", () => {
    expect(withDataArea("fo", { A: "1" }, { dataAreaId: "x" }, "usmf")).toEqual({ A: "1" });
    expect(withDataArea("dataverse", { A: "1" }, {}, "usmf")).toEqual({ A: "1" });
    expect(withDataArea("fo", { A: "1" }, {}, null)).toEqual({ A: "1" });
    expect(withDataArea("fo", { A: "1" }, {}, "USMF")).toEqual({ A: "1", dataAreaId: "usmf" });
    expect(withDataArea("fo", { A: "1" }, {}, "bad area!")).toEqual({ A: "1" });
  });
});

describe("pull: only the mapped columns are requested (M4)", () => {
  it("sends $select for the id, key, modified and mapped fields", async () => {
    const db = fakeDb(seedConnector());
    const calls = stubFetch(() => ({ value: [] }));
    await runPull(db.client, TENANT, "customers", { trigger: "manual", userId: null });
    expect(calls[0].searchParams.get("$select")?.split(",").sort()).toEqual(["accountid", "accountnumber", "address1_city", "emailaddress1", "modifiedon", "name", "telephone1"]);
  });

  it("adds dataAreaId on F&O and the customer field for contacts; reads everything for a dotted source", () => {
    const cfg = { enabled: true, entity_set: "CustomersV3", id_field: "CustomerAccount", key_field: "CustomerAccount", field_map: { name: "OrganizationName", status: "Ignored" } };
    expect(selectFields("customers", cfg, "fo")?.sort()).toEqual(["CustomerAccount", "OrganizationName", "dataAreaId"]);
    expect(selectFields("contacts", { ...cfg, field_map: { name: "n", account_external_id: "_parentcustomerid_value" } }, "dataverse")?.sort()).toEqual(["CustomerAccount", "_parentcustomerid_value", "n"]);
    expect(selectFields("customers", { ...cfg, field_map: { name: "Address.City" } }, "fo")).toBeUndefined();
  });
});

describe("helpers", () => {
  it("rotates the cron's start tenant", () => {
    expect(rotateStart(["a", "b", "c"], 0)).toEqual(["a", "b", "c"]);
    expect(rotateStart(["a", "b", "c"], 1)).toEqual(["b", "c", "a"]);
    expect(rotateStart(["a", "b", "c"], 4)).toEqual(["b", "c", "a"]);
    expect(rotateStart(["a", "b", "c"], -1)).toEqual(["c", "a", "b"]);
    expect(rotateStart(["a"], 7)).toEqual(["a"]);
    expect(rotateStart([], 3)).toEqual([]);
  });
  it("normalises modified-on values to whole seconds", () => {
    expect(normalizeModified("2026-10-01T10:00:00.1234567Z")).toBe("2026-10-01T10:00:00Z");
    expect(normalizeModified("nope")).toBeNull();
    expect(normalizeModified(null)).toBeNull();
  });
});
