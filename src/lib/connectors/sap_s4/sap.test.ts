import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u), fetchPublic: async (u: string, init: RequestInit) => fetch(u, init) }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {} }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn, revalidateTag: () => {} }));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: unknown) => { select: (c: string) => { single: () => Promise<unknown> } } } }, table: string, _t: string, rec: unknown) =>
    admin.from(table).insert(rec).select("id").single(),
}));

import { fakeDb, type Row } from "@/lib/connectors/d365/syncHarness";
import { fakeAdmin } from "@/lib/middleware/testHarness";
import { FakeS4 } from "./fakeS4";
import {
  getSapFields, getSapMapping, getSapScope, getSapScopeValues, loadSap, previewSapEntity, publicState, resetSapMapping, runSapPull, sapHealth, sapSyncOverview,
  saveSapConnection, saveSapMapping, saveSapScope, setSapSchedule, testSap, SapSaveError, normalizeHost,
} from "./server";
import { SapClient, SapError, explainSapStatus, sapErrorMessage, unwrapV2 } from "./odata";
import {
  changedSinceFilter, cleanFieldMap, flattenRow, idVariants, idsFilters, mapSapRow, needsExpand, nextPosition, parsePosition, sapDay, selectFields,
} from "./mapping";
import { buildSapScopeFilter, cleanSapScope, sapScopeAttributes } from "./scope";
import { SAP_PRESETS, effectiveEntities, sapServiceBase } from "./catalog";
import { sapAdapter } from "./server";
import { SAP_SCENARIO } from "./types";
import { CONNECTOR_CATALOG, visibleConnectors } from "../registry";

const day = (iso: string) => `/Date(${Date.parse(`${iso}T00:00:00Z`)})/`;
const T1 = "t-1";
const T2 = "t-2";
const HOST = "my426318-api.s4hana.cloud.sap";
const SECRET = "pw-secret-9f3";
const KEY = "key-secret-77b";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function seed(over: { mode?: "basic" | "api_key"; tenant?: string; features?: Record<string, boolean>; entities?: Record<string, unknown>; mw?: boolean } = {}): Record<string, Row[]> {
  const tid = over.tenant ?? T1;
  const mode = over.mode ?? "basic";
  return {
    tenants: [{ id: tid, features: { accounts: true, suppliers: true, products: true, integration_middleware: over.mw !== false, ...(over.features ?? {}) }, config: {} }],
    tenant_connectors: [{
      tenant_id: tid, connector_id: "sap_s4", status: "connected", last_error: null,
      config: { auth_mode: mode, api_host: mode === "basic" ? HOST : "sandbox.api.sap.com", username: mode === "basic" ? "BPM_USER" : "", schedule: "off", entities: over.entities ?? {} },
      credentials: mode === "basic" ? { password: SECRET } : { api_key: KEY },
    }],
  };
}

const server = (mode: "basic" | "api_key" = "basic", o: ConstructorParameters<typeof FakeS4>[0] = {}) =>
  mode === "basic"
    ? new FakeS4({ user: "BPM_USER", password: SECRET, ...o })
    : new FakeS4({ host: "sandbox.api.sap.com", prefix: "/s4hanacloud", apiKey: KEY, ...o });
const serve = (f: FakeS4) => { vi.stubGlobal("fetch", f.fetch); return f; };

const customers = (f: FakeS4) => f.addBps(
  { bp: "0000001000", name: "Alpha GmbH", customer: "1000", changed: "2026-10-01", city: "Berlin", email: "info@alpha.example", phone: "+49 30 123", country: "DE", street: "Hauptstr 1", zip: "10115" },
  { bp: "0000001001", name: "Beta Qatar", customer: "1001", changed: "2026-10-02", city: "Doha", country: "QA" },
  { bp: "0000002000", name: "Only Supplier Ltd", supplier: "2000", changed: "2026-10-02", city: "Leeds" },
);

const runs = (db: { tables: Record<string, Row[]> }, entity: string) => (db.tables.connector_sync_runs ?? []).filter((r) => r.entity === entity);
const lastRun = (db: { tables: Record<string, Row[]> }, entity: string) => [...runs(db, entity)].pop();
const pull = (db: ReturnType<typeof fakeDb>, key: "customers" | "vendors" | "products" = "customers", o: Partial<Parameters<typeof runSapPull>[3]> = {}, tenant = T1) =>
  runSapPull(db.client, tenant, key, { trigger: "manual", userId: "u-1", ...o });

// ── The OData client ────────────────────────────────────────────────────────

describe("the client: plain words, paging, retries, no stray address", () => {
  it("tells 401, 403 and 404 in the words of Communication Management, naming the scenario", () => {
    const bp = SAP_SCENARIO.businessPartner;
    expect(explainSapStatus(401, bp, false)).toMatch(/user name or password/);
    expect(explainSapStatus(401, bp, false)).toMatch(/SAP_COM_0008/);
    expect(explainSapStatus(403, bp, false)).toMatch(/not assigned to the Communication Arrangement/);
    expect(explainSapStatus(404, SAP_SCENARIO.product, false)).toMatch(/SAP_COM_0009 \(Product Integration\)/);
    expect(explainSapStatus(401, bp, true)).toMatch(/API key/);
    expect(explainSapStatus(404, bp, true)).toMatch(/sandbox does not offer/);
  });

  it("reads the V2 envelope and the SAP error message", () => {
    expect(unwrapV2({ d: { results: [{ a: 1 }], __next: "https://x/y?$skiptoken=2" } })).toEqual({ results: [{ a: 1 }], next: "https://x/y?$skiptoken=2" });
    expect(unwrapV2({ d: { a: 1 } })).toEqual({ results: [{ a: 1 }], next: null });
    expect(sapErrorMessage({ error: { message: { value: "  Bad \n request " } } })).toBe("Bad request");
  });

  it("pages by the server's __next and uses only its query on our own address", async () => {
    const f = customers(server("basic", { serverPageSize: 1, nextHost: "evil.example" }));
    const auth = async () => ({ Authorization: `Basic ${Buffer.from(`BPM_USER:${SECRET}`).toString("base64")}` });
    const c = new SapClient(`https://${HOST}/sap/opu/odata/sap/API_BUSINESS_PARTNER`, auth, { fetch: f.fetch as never });
    const rows: unknown[] = [];
    for await (const r of c.list("A_BusinessPartner", { orderby: "BusinessPartner asc", pageSize: 5 })) rows.push(r);
    expect(rows).toHaveLength(3);
    expect(f.calls.length).toBe(3);
    expect(f.calls.every((x) => x.url.host === HOST)).toBe(true);
  });

  it("falls back to $skip when the server sends no __next", async () => {
    const f = customers(server());
    const c = new SapClient(`https://${HOST}/sap/opu/odata/sap/API_BUSINESS_PARTNER`, async () => ({ Authorization: `Basic ${Buffer.from(`BPM_USER:${SECRET}`).toString("base64")}` }), { fetch: f.fetch as never });
    const rows: unknown[] = [];
    for await (const r of c.list("A_BusinessPartner", { pageSize: 2 })) rows.push(r);
    expect(rows).toHaveLength(3);
    expect(f.calls.map((x) => x.url.searchParams.get("$skip"))).toEqual([null, "2"]);
  });

  it("retries a 429 and gives up on a 401 with the plain message", async () => {
    const f = customers(server("basic", { throttleOnce: true }));
    const sleep = vi.fn(async () => {});
    const auth = async () => ({ Authorization: `Basic ${Buffer.from(`BPM_USER:${SECRET}`).toString("base64")}` });
    const ok = new SapClient(`https://${HOST}/sap/opu/odata/sap/API_BUSINESS_PARTNER`, auth, { fetch: f.fetch as never, sleep });
    expect((await ok.get("A_BusinessPartner", { $top: "1" })).results).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(1);
    const bad = new SapClient(`https://${HOST}/sap/opu/odata/sap/API_BUSINESS_PARTNER`, async () => ({ Authorization: "Basic wrong" }), { fetch: f.fetch as never, scenario: SAP_SCENARIO.businessPartner });
    await expect(bad.get("A_BusinessPartner")).rejects.toMatchObject({ status: 401, message: expect.stringContaining("SAP_COM_0008") });
    expect(f.calls.filter((c) => c.headers.get("authorization") === "Basic wrong")).toHaveLength(1);
    expect(SapError).toBeDefined();
  });

  it("refuses an answer past the body cap instead of reading it whole", async () => {
    let pulled = 0;
    const big = () => new Response(new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new TextEncoder().encode("x".repeat(1024))); } }), { status: 200 });
    const c = new SapClient(`https://${HOST}/sap/opu/odata/sap/API_BUSINESS_PARTNER`, async () => ({}), { fetch: (async () => big()) as never, maxBodyBytes: 10 * 1024, maxRetries: 3, sleep: async () => {} });
    await expect(c.get("A_BusinessPartner")).rejects.toMatchObject({ message: expect.stringContaining("more data than one request") });
    expect(pulled).toBeLessThan(30);
  });
});

// ── Pure transforms ─────────────────────────────────────────────────────────

describe("mapping: dates, positions, flattening", () => {
  it("reads a V2 date and writes the V2 literal", () => {
    expect(sapDay("/Date(1759276800000)/")).toBe("2025-10-01");
    expect(sapDay("/Date(1759276800000+0000)/")).toBe("2025-10-01");
    expect(sapDay("2026-10-01T05:00:00Z")).toBe("2026-10-01");
    expect(sapDay(null)).toBeNull();
    expect(changedSinceFilter("LastChangeDate", "2026-10-01")).toBe("LastChangeDate ge datetime'2026-10-01T00:00:00'");
    expect(changedSinceFilter("LastChangeDate", "x' or 1 eq 1")).toBeUndefined();
  });

  it("keeps a finished scan and a stopped scan apart, and never moves past a held row", () => {
    expect(parsePosition("d|2026-10-03")).toMatchObject({ from: "2026-10-03", lastKey: null });
    expect(parsePosition("k|2026-10-01|2026-10-05||0000001500")).toEqual({ from: "2026-10-01", newest: "2026-10-05", hold: null, lastKey: "0000001500" });
    expect(parsePosition("garbage")).toEqual({ from: null, newest: null, hold: null, lastKey: null });
    const p = parsePosition("d|2026-10-01");
    expect(nextPosition(p, { newest: "2026-10-05", hold: null, lastKey: "9" }, true)).toBe("d|2026-10-05");
    expect(nextPosition(p, { newest: "2026-10-05", hold: "2026-10-03", lastKey: "9" }, true)).toBe("d|2026-10-03");
    expect(nextPosition(p, { newest: "2026-10-05", hold: null, lastKey: "0000001500" }, false)).toBe("k|2026-10-01|2026-10-05||0000001500");
    expect(nextPosition(p, { newest: null, hold: null, lastKey: null }, true)).toBe("d|2026-10-01");
  });

  it("flattens the first address with its default e-mail and phone, and the English description", () => {
    const bp = flattenRow("customers", {
      to_BusinessPartnerAddress: { results: [{ CityName: "Berlin", to_EmailAddress: { results: [{ EmailAddress: "b@x.de" }, { EmailAddress: "a@x.de", IsDefaultEmailAddress: true }] }, to_PhoneNumber: { results: [{ PhoneNumber: "030", InternationalPhoneNumber: "+49 30" }] } }] },
    }) as { address: Record<string, string> };
    expect(bp.address).toMatchObject({ CityName: "Berlin", EmailAddress: "a@x.de", PhoneNumber: "+49 30" });
    const pr = flattenRow("products", { to_Description: { results: [{ Language: "DE", ProductDescription: "Zaun" }, { Language: "EN", ProductDescription: "Fence" }] } }) as { description: Record<string, string> };
    expect(pr.description.ProductDescription).toBe("Fence");
  });

  it("maps the shipped presets, drops a bad e-mail, falls back to the number for a nameless record", () => {
    const row = {
      BusinessPartner: "0000001000", BusinessPartnerFullName: "Alpha GmbH", LastChangeDate: "/Date(1759276800000)/",
      to_BusinessPartnerAddress: { results: [{ CityName: "Berlin", Country: "DE", to_EmailAddress: { results: [{ EmailAddress: "not-an-email" }] }, to_PhoneNumber: { results: [] } }] },
    };
    const m = mapSapRow("customers", SAP_PRESETS.customers.field_map, row);
    expect(m).toMatchObject({ externalId: "0000001000", externalKey: "0000001000", values: { name: "Alpha GmbH", city: "Berlin", country: "DE", email: null, phone: null }, changed: "2025-10-01" });
    const nameless = mapSapRow("vendors", SAP_PRESETS.vendors.field_map, { BusinessPartner: "0000009", Supplier: "9" });
    expect(nameless).toMatchObject({ values: { name: "0000009" } });
    expect(mapSapRow("customers", SAP_PRESETS.customers.field_map, { BusinessPartnerFullName: "x" })).toEqual({ error: "no BusinessPartner" });
  });

  it("only writes fields the target owns", () => {
    const m = mapSapRow("customers", { name: "BusinessPartnerFullName", status: "Customer", tenant_id: "Customer" }, { BusinessPartner: "1", BusinessPartnerFullName: "A", Customer: "evil" }) as { values: Record<string, unknown> };
    expect(Object.keys(m.values)).toEqual(["name"]);
  });

  it("asks for the expansion and the columns only when the map needs them", () => {
    expect(needsExpand("customers", SAP_PRESETS.customers.field_map)).toBe(true);
    expect(needsExpand("customers", { name: "BusinessPartnerFullName" })).toBe(false);
    expect(selectFields("customers", { name: "BusinessPartnerFullName" })).toEqual(["BusinessPartner", "LastChangeDate", "BusinessPartnerFullName"]);
    // a map that reads an expanded part asks for whole rows: a $select that loses the nested expansion would lose the data
    expect(selectFields("customers", SAP_PRESETS.customers.field_map)).toBeUndefined();
    expect(selectFields("products", SAP_PRESETS.products.field_map)).toBeUndefined();
    expect(selectFields("products", { name: "Product", sku: "Product" })).toEqual(["Product", "LastChangeDate"]);
  });

  it("builds an id filter that no typed value can break out of", () => {
    expect(idsFilters("customers", ["1000", "O'Brien"])).toEqual(["(BusinessPartner eq '1000' or BusinessPartner eq 'O''Brien')"]);
    expect(idVariants("1000")).toEqual(["1000", "0000001000"]);
    expect(idVariants("P-1")).toEqual(["P-1"]);
  });

  it("validates a field map: known BPMSquare fields, plain SAP names", () => {
    const r = cleanFieldMap("customers", { name: "BusinessPartnerFullName", city: "address.CityName", ref: "x", phone: "a b; drop" });
    expect(r.map).toEqual({ name: "BusinessPartnerFullName", city: "address.CityName" });
    expect(r.problems.map((p) => p.field).sort()).toEqual(["phone", "ref"]);
  });
});

describe("scope", () => {
  it("builds a $filter from values OR'd inside a condition and conditions AND'd", () => {
    const c = cleanSapScope([{ attribute: "BusinessPartnerCategory", kind: "option", values: ["2"] }, { attribute: "Industry", kind: "text", values: ["AUTO", "O'Neil"] }]);
    expect(c.ok).toBe(true);
    if (c.ok) expect(buildSapScopeFilter(c.scope)).toEqual({ ok: true, filter: "(BusinessPartnerCategory eq '2') and (Industry eq 'AUTO' or Industry eq 'O''Neil')" });
    expect(buildSapScopeFilter(undefined)).toEqual({ ok: true, filter: undefined });
  });

  it("refuses an attribute that is not a plain name, a customer attribute, and twice the same", () => {
    expect(cleanSapScope([{ attribute: "x eq 1 or 'a'", kind: "text", values: ["a"] }]).ok).toBe(false);
    expect(cleanSapScope([{ attribute: "Industry", kind: "text", values: ["a"], via: "customer" }]).ok).toBe(false);
    expect(cleanSapScope([{ attribute: "Industry", kind: "text", values: ["a"] }, { attribute: "Industry", kind: "text", values: ["b"] }]).ok).toBe(false);
    expect(cleanSapScope([{ attribute: "Industry", kind: "number", values: ["abc"] }]).ok).toBe(false);
  });

  it("offers the common attributes first, then the filterable properties of the system's own list", () => {
    const a = sapScopeAttributes("customers", [
      { name: "BusinessPartnerCategory", label: "x", type: "String", required: false, creatable: true },
      { name: "SomeCount", label: "Some Count", type: "Int32", required: false, creatable: true },
      { name: "LastChangeDate", label: "Last Change Date", type: "DateTime", required: false, creatable: true },
    ]);
    expect(a.map((x) => x.id)).toEqual(["BusinessPartnerCategory", "SomeCount"]);
    expect(a[0].common).toBe(true);
    expect(sapScopeAttributes("products", null).map((x) => x.id)).toContain("ProductType");
  });
});

// ── The connection ──────────────────────────────────────────────────────────

describe("saving a connection", () => {
  const save = (db: ReturnType<typeof fakeAdmin>, body: unknown) => saveSapConnection(db.client, T1, "u-1", body as never);

  it("stores the password and never returns it", async () => {
    const db = fakeAdmin({ tenant_connectors: [] });
    const state = await save(db, { config: { auth_mode: "basic", api_host: "https://My426318-API.s4hana.cloud.sap/", username: "BPM_USER" }, secrets: { password: SECRET } });
    expect(state.config).toMatchObject({ auth_mode: "basic", api_host: HOST, username: "BPM_USER", environment_url: `https://${HOST}`, sandbox: false });
    expect(state.secrets).toEqual({ password: true, api_key: false });
    expect(state.status).toBe("error");
    expect(JSON.stringify(state)).not.toContain(SECRET);
    const row = db.tables.tenant_connectors[0];
    expect(row.credentials).toEqual({ password: SECRET });
    expect(JSON.stringify(row.config)).not.toContain(SECRET);
  });

  it("a blank secret keeps the stored one; a new one replaces it and resets the status", async () => {
    const db = fakeAdmin(seed());
    const kept = await save(db, { config: { auth_mode: "basic", api_host: HOST, username: "BPM_USER" }, secrets: { password: "  " } });
    expect(db.tables.tenant_connectors[0].credentials).toEqual({ password: SECRET });
    expect(kept.status).toBe("connected");
    const changed = await save(db, { config: { auth_mode: "basic", api_host: HOST, username: "BPM_USER" }, secrets: { password: "new-pw" } });
    expect(db.tables.tenant_connectors[0].credentials).toEqual({ password: "new-pw" });
    expect(changed.status).toBe("error");
  });

  it("asks for what is missing, in order", async () => {
    const db = fakeAdmin({ tenant_connectors: [] });
    await expect(save(db, { config: { auth_mode: "basic", username: "u" }, secrets: { password: "p" } })).rejects.toThrow(/API host/);
    await expect(save(db, { config: { auth_mode: "basic", api_host: HOST }, secrets: { password: "p" } })).rejects.toThrow(/Communication user/);
    await expect(save(db, { config: { auth_mode: "basic", api_host: HOST, username: "u" } })).rejects.toThrow(/password/);
    await expect(save(db, { config: { auth_mode: "api_key" } })).rejects.toThrow(/API key/);
    await expect(save(db, { config: { auth_mode: "oauth", api_host: HOST } })).rejects.toBeInstanceOf(SapSaveError);
    await expect(save(db, null)).rejects.toThrow(/config/);
  });

  it("refuses http, a path, credentials in the address", () => {
    expect(() => normalizeHost("http://x.example")).toThrow(/https/);
    expect(() => normalizeHost("https://x.example/sap/opu")).toThrow(/host only/);
    expect(() => normalizeHost("https://me:pw@x.example")).toThrow(/user name/);
    expect(normalizeHost("https://X.Example:44300/")).toBe("x.example:44300");
  });

  it("the sandbox login fixes the host and keeps the key sealed", async () => {
    const db = fakeAdmin({ tenant_connectors: [] });
    const state = await save(db, { config: { auth_mode: "api_key", api_host: "evil.example" }, secrets: { api_key: KEY } });
    expect(state.config).toMatchObject({ auth_mode: "api_key", api_host: "sandbox.api.sap.com", sandbox: true, environment_url: "https://sandbox.api.sap.com", username: "" });
    expect(state.secrets).toEqual({ password: false, api_key: true });
    expect(JSON.stringify(state)).not.toContain(KEY);
    expect(db.tables.tenant_connectors[0].credentials).toEqual({ api_key: KEY });
  });

  it("keeps the saved scope when a screen saves the connection again, and refuses a bad map", async () => {
    const scope = { conditions: [{ attribute: "Industry", kind: "text", values: ["AUTO"] }] };
    const db = fakeAdmin(seed({ entities: { customers: { enabled: true, field_map: { name: "OrganizationBPName1" }, scope } } }));
    const state = await save(db, { config: { auth_mode: "basic", api_host: HOST, username: "BPM_USER", entities: { customers: { enabled: false, field_map: { name: "OrganizationBPName1" }, scope: null } } } });
    expect(state.config?.entities.customers).toMatchObject({ enabled: false, scope });
    await expect(save(db, { config: { auth_mode: "basic", api_host: HOST, username: "BPM_USER", entities: { customers: { enabled: true, field_map: { name: "a b" } } } } })).rejects.toThrow(/valid SAP field name/);
  });

  it("publicState lists every entity with its effective settings and no secret", async () => {
    const db = fakeAdmin(seed());
    const s = publicState(await loadSap(db.client, T1));
    expect(Object.keys(s.config!.entities)).toEqual(["customers", "vendors", "products", "sales_orders"]);
    expect(s.config!.entities.customers).toMatchObject({ enabled: true, entity_set: "A_BusinessPartner", field_map: SAP_PRESETS.customers.field_map });
    expect(JSON.stringify(s)).not.toContain(SECRET);
    expect(publicState(null)).toMatchObject({ config: null, status: "not_connected" });
  });
});

// ── Test connection ─────────────────────────────────────────────────────────

describe("Test", () => {
  it("one line when both scenarios answer, and the sandbox says it is sample data", async () => {
    const f = serve(customers(server()));
    const db = fakeAdmin(seed());
    const r = await testSap(db.client, T1);
    expect(r).toMatchObject({ ok: true, failures: [], status: 200 });
    expect(r.line).toMatch(/business partners and products/);
    expect(f.calls.map((c) => c.url.pathname.split("/").slice(-2).join("/"))).toEqual(expect.arrayContaining(["API_BUSINESS_PARTNER/A_BusinessPartner", "API_BUSINESS_PARTNER/$metadata", "API_PRODUCT_SRV/A_Product"]));
    expect(db.tables.tenant_connectors[0].status).toBe("connected");

    const sb = serve(server("api_key"));
    const dbs = fakeAdmin(seed({ mode: "api_key" }));
    const rs = await testSap(dbs.client, T1);
    expect(rs.ok).toBe(true);
    expect(rs.line).toMatch(/Sandbox \(sample data\)/);
    expect(sb.calls.every((c) => c.headers.get("apikey") === KEY && !c.headers.get("authorization") && c.url.pathname.startsWith("/s4hanacloud/"))).toBe(true);
  });

  it.each([
    [401, /user name or password/, /SAP_COM_0008/],
    [403, /not assigned to the Communication Arrangement/, /SAP_COM_0008/],
    [404, /Create a Communication Arrangement/, /SAP_COM_0008 \(Business Partner, Customer and Supplier Integration\)/],
  ] as const)("a business partner %s fails the connection in plain words", async (status, words, scenario) => {
    serve(server("basic", { deny: { API_BUSINESS_PARTNER: status } }));
    const db = fakeAdmin(seed());
    const r = await testSap(db.client, T1);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.line).toMatch(words);
    expect(r.line).toMatch(scenario);
    expect(r.failures[0].label).toMatch(/SAP_COM_0008/);
    expect(db.tables.tenant_connectors[0]).toMatchObject({ status: "error" });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("a missing Product scenario is named and the connection stays connected", async () => {
    serve(customers(server("basic", { deny: { API_PRODUCT_SRV: 404 } })));
    const db = fakeAdmin(seed());
    const r = await testSap(db.client, T1);
    expect(r).toMatchObject({ ok: false, status: 200 });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].label).toMatch(/SAP_COM_0009/);
    expect(r.failures[0].fix).toMatch(/SAP_COM_0009 \(Product Integration\)/);
    expect(db.tables.tenant_connectors[0].status).toBe("connected");
  });

  it("a wrong password is a 401 about the user, and a failed $metadata only shortens the line", async () => {
    serve(server("basic", { user: "BPM_USER", password: "other" }));
    expect((await testSap(fakeAdmin(seed()).client, T1)).line).toMatch(/user name or password/);
    serve(server("basic", { metadataFails: true }));
    const r = await testSap(fakeAdmin(seed()).client, T1);
    expect(r.ok).toBe(true);
    expect(r.line).toMatch(/field list/);
  });

  it("not connected yet", async () => {
    expect((await testSap(fakeAdmin({ tenant_connectors: [] }).client, T1)).status).toBe(400);
  });
});

// ── Pull ────────────────────────────────────────────────────────────────────

describe("pull: customers", () => {
  it("creates accounts from business partners with a customer number, linked by the SAP key, with the address data", async () => {
    const f = serve(customers(server()));
    const db = fakeDb(seed());
    const r = await pull(db);
    expect(r.error).toBeNull();
    expect(r.counts).toMatchObject({ read: 2, created: 2, updated: 0, unchanged: 0, failed: 0 });
    const accounts = db.tables.accounts;
    expect(accounts.map((a) => a.name).sort()).toEqual(["Alpha GmbH", "Beta Qatar"]);
    expect(accounts.find((a) => a.name === "Alpha GmbH")).toMatchObject({ tenant_id: T1, city: "Berlin", country: "DE", postal_code: "10115", address_line1: "Hauptstr 1", email: "info@alpha.example", phone: "+49 30 123", type: "direct" });
    expect(db.tables.connector_links.map((l) => [l.connector_id, l.entity, l.external_id, l.external_key, l.direction, l.object_type])).toEqual([
      ["sap_s4", "customers", "0000001000", "0000001000", "pull", "accounts"], ["sap_s4", "customers", "0000001001", "0000001001", "pull", "accounts"],
    ]);
    // the customer filter, the key order, the expansion and the Basic login
    const q = f.calls[0].url.searchParams;
    expect(q.get("$filter")).toBe("(Customer ne '')");
    expect(q.get("$orderby")).toBe("BusinessPartner asc");
    expect(q.get("$expand")).toContain("to_BusinessPartnerAddress/to_EmailAddress");
    expect(q.get("$select")).toBeNull();
    expect(f.calls[0].headers.get("authorization")).toBe(`Basic ${Buffer.from(`BPM_USER:${SECRET}`).toString("base64")}`);
    expect(lastRun(db, "customers")).toMatchObject({ connector_id: "sap_s4", direction: "pull", status: "succeeded", watermark: "d|2026-10-02" });
  });

  it("a second run is idempotent: nothing created twice, unchanged counted, one change updates one record", async () => {
    const f = serve(customers(server()));
    const db = fakeDb(seed());
    await pull(db);
    const again = await pull(db);
    // only what changed since the last day seen is asked for: Beta (2 Oct), not Alpha (1 Oct)
    expect(again.counts).toMatchObject({ read: 1, created: 0, updated: 0, unchanged: 1 });
    expect(db.tables.accounts).toHaveLength(2);
    expect(db.tables.connector_links).toHaveLength(2);
    // the second run asks only for what changed since the last day seen
    expect(f.calls.at(-1)!.url.searchParams.get("$filter")).toBe("(Customer ne '') and LastChangeDate ge datetime'2026-10-02T00:00:00'");

    f.bps[1].BusinessPartnerFullName = "Beta Qatar WLL";
    f.bps[1].LastChangeDate = day("2026-10-04");
    const third = await pull(db);
    expect(third.counts).toMatchObject({ updated: 1, created: 0 });
    expect(db.tables.accounts.find((a) => a.id === db.tables.connector_links[1].object_id)).toMatchObject({ name: "Beta Qatar WLL" });
  });

  it("a blank in SAP never wipes a value in BPMSquare", async () => {
    const f = serve(customers(server()));
    const db = fakeDb(seed());
    await pull(db);
    const addr = (f.bps[0].to_BusinessPartnerAddress as { results: Record<string, unknown>[] }).results[0];
    addr.CityName = "";
    f.bps[0].LastChangeDate = day("2026-10-04");
    await pull(db, "customers", { full: true });
    expect(db.tables.accounts.find((a) => a.name === "Alpha GmbH")!.city).toBe("Berlin");
  });

  it("counts a row that could not be saved as failed, holds the position at it and reads it again next run", async () => {
    const f = serve(customers(server()));
    let bad = true;
    const db = fakeDb(seed(), { failInsert: (t, r) => (t === "accounts" && r.name === "Alpha GmbH" && bad ? { message: "constraint" } : null) });
    const r1 = await pull(db);
    expect(r1.counts).toMatchObject({ read: 2, created: 1, failed: 1 });
    expect(r1.issues[0]).toMatch(/Alpha GmbH: constraint/);
    expect(lastRun(db, "customers")).toMatchObject({ status: "partial", watermark: "d|2026-10-01" });
    bad = false;
    const r2 = await pull(db);
    expect(f.calls.at(-1)!.url.searchParams.get("$filter")).toContain("datetime'2026-10-01T00:00:00'");
    expect(r2.counts).toMatchObject({ created: 1, unchanged: 1, failed: 0 });
  });

  it("follows the server's paging and stops at the row cap, then carries on from the key where it stopped", async () => {
    const f = serve(server("basic", { serverPageSize: 2 }));
    for (let i = 1; i <= 5; i++) f.addBps({ bp: `00000010${String(i).padStart(2, "0")}`, name: `Cust ${i}`, customer: String(1000 + i), changed: `2026-10-0${i}` });
    const db = fakeDb(seed());
    const r1 = await pull(db, "customers", { maxRows: 3 });
    expect(r1.counts.created).toBe(3);
    expect(r1.issues.join(" ")).toMatch(/Stopped at 3 rows/);
    expect(lastRun(db, "customers")!.watermark).toBe("k||2026-10-03||0000001003");
    const r2 = await pull(db, "customers", { maxRows: 3 });
    expect(r2.counts).toMatchObject({ read: 2, created: 2 });
    expect(f.calls.at(-1)!.url.searchParams.get("$filter")).toContain("BusinessPartner gt '0000001003'");
    expect(lastRun(db, "customers")!.watermark).toBe("d|2026-10-05");
    expect(db.tables.accounts).toHaveLength(5);
  });

  it("a Full resync reads everything again, ignoring the position", async () => {
    const f = serve(customers(server()));
    const db = fakeDb(seed());
    await pull(db);
    const r = await pull(db, "customers", { full: true });
    expect(r.counts).toMatchObject({ read: 2, unchanged: 2 });
    expect(f.calls.at(-1)!.url.searchParams.get("$filter")).toBe("(Customer ne '')");
  });

  it("reads only the listed numbers, also when typed without the leading zeros, and moves no position", async () => {
    const f = serve(customers(server()));
    const db = fakeDb(seed());
    const r = await pull(db, "customers", { ids: ["1001"] });
    expect(r.counts).toMatchObject({ read: 1, created: 1, filtered: 1 });
    expect(f.calls[0].url.searchParams.get("$filter")).toBe("(Customer ne '') and (BusinessPartner eq '1001' or BusinessPartner eq '0000001001')");
    expect(lastRun(db, "customers")!.watermark).toBeNull();
    const missing = await pull(db, "customers", { ids: ["777"] });
    expect(missing.issues.join(" ")).toMatch(/1 of 1 record was not found in SAP/);
  });

  it("a scheduled pull needs the Integration middleware module; a manual one is not affected", async () => {
    const f = serve(customers(server()));
    const off = fakeDb(seed({ mw: false }));
    const scheduled = await pull(off, "customers", { trigger: "schedule", userId: null });
    expect(scheduled.error).toMatch(/Integration middleware isn't enabled/);
    expect(f.calls).toHaveLength(0);
    expect(runs(off, "customers")).toHaveLength(0);
    const on = fakeDb(seed());
    expect((await pull(on, "customers", { trigger: "schedule", userId: null })).error).toBeNull();
  });

  it("refuses an id with a quote before opening a run", async () => {
    serve(customers(server()));
    const db = fakeDb(seed());
    const r = await pull(db, "customers", { ids: ["x' or 1 eq 1"] });
    expect(r.error).toMatch(/is not an id or a number/);
    expect(runs(db, "customers")).toHaveLength(0);
  });

  it("reads under the saved scope; a Full resync reports what fell outside it and deletes nothing", async () => {
    const f = serve(customers(server()));
    f.bps[0].BusinessPartnerCategory = "1";
    const db = fakeDb(seed());
    await pull(db);
    const scope = { conditions: [{ attribute: "BusinessPartnerCategory", kind: "option", values: ["2"], labels: ["Organization"] }], needs_full: true };
    db.tables.tenant_connectors[0].config = { ...(db.tables.tenant_connectors[0].config as object), entities: { customers: { enabled: true, field_map: SAP_PRESETS.customers.field_map, scope } } };
    const inc = await pull(db);
    expect(inc.issues.join(" ")).toMatch(/Scope changed: run Full resync/);
    const full = await pull(db, "customers", { full: true });
    expect(f.calls.at(-1)!.url.searchParams.get("$filter")).toBe("(Customer ne '') and ((BusinessPartnerCategory eq '2'))");
    expect(full.counts).toMatchObject({ read: 1, outside_scope: 1 });
    expect(db.tables.accounts).toHaveLength(2);
    expect((db.tables.tenant_connectors[0].config as { entities: { customers: { scope: { needs_full?: boolean } } } }).entities.customers.scope.needs_full).toBeUndefined();
  });

  it("a saved scope that is no longer valid stops the run and says so; it is never ignored", async () => {
    serve(customers(server()));
    const db = fakeDb(seed({ entities: { customers: { enabled: true, field_map: SAP_PRESETS.customers.field_map, scope: { conditions: [{ attribute: "bad attr", kind: "text", values: ["a"] }] } } } }));
    const r = await pull(db);
    expect(r.error).toMatch(/saved scope cannot be used/);
    expect(runs(db, "customers")).toHaveLength(0);
  });

  it("a switched off entity and a module the workspace does not have do not run", async () => {
    serve(customers(server()));
    const off = fakeDb(seed({ entities: { customers: { enabled: false, field_map: SAP_PRESETS.customers.field_map } } }));
    expect((await pull(off)).error).toMatch(/switched off/);
    const noModule = fakeDb(seed({ features: { accounts: false } }));
    expect((await pull(noModule)).error).toMatch(/accounts module isn't enabled/);
    expect(runs(noModule, "customers")).toHaveLength(0);
    expect((await pull(fakeDb({ tenants: [] }))).error).toMatch(/isn't connected/);
  });

  it("one run per entity at a time", async () => {
    serve(customers(server()));
    const db = fakeDb({ ...seed(), connector_sync_runs: [{ id: "r0", tenant_id: T1, connector_id: "sap_s4", entity: "customers", status: "running", started_at: new Date().toISOString() }] });
    expect((await pull(db)).error).toMatch(/already running/);
    expect(db.tables.accounts ?? []).toHaveLength(0);
  });

  it("a refused login fails the run with the plain message, marks the connection and leaves no password anywhere", async () => {
    serve(server("basic", { deny: { API_BUSINESS_PARTNER: 403 } }));
    const db = fakeDb({ ...seed(), integration_messages: [] });
    const r = await pull(db);
    expect(r.error).toMatch(/not assigned to the Communication Arrangement/);
    expect(lastRun(db, "customers")).toMatchObject({ status: "failed" });
    expect(db.tables.tenant_connectors[0]).toMatchObject({ status: "error" });
    expect(JSON.stringify(db.tables.integration_messages)).not.toContain(SECRET);
    expect(JSON.stringify(db.tables.connector_sync_runs)).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});

describe("pull: suppliers and products", () => {
  it("suppliers become suppliers, vendors only", async () => {
    const f = serve(customers(server()));
    const db = fakeDb(seed());
    const r = await pull(db, "vendors");
    expect(r.counts).toMatchObject({ read: 1, created: 1 });
    expect(f.calls[0].url.searchParams.get("$filter")).toBe("(Supplier ne '')");
    expect(db.tables.suppliers[0]).toMatchObject({ name: "Only Supplier Ltd", city: "Leeds", type: "vendor", status: "active" });
    expect(db.tables.connector_links[0]).toMatchObject({ entity: "vendors", external_id: "0000002000", object_type: "suppliers" });
  });

  it("products: the English description is the name, the number is the SKU, deleted products stay out", async () => {
    const f = serve(server());
    f.addProducts({ product: "FG-100", description: "Gate, single swing", unit: "PC", changed: "2026-10-01" }, { product: "OLD-1", description: "Old", changed: "2026-10-01", deleted: true }, { product: "NODESC", changed: "2026-10-02" });
    const db = fakeDb(seed());
    const r = await pull(db, "products");
    expect(r.counts).toMatchObject({ read: 2, created: 2 });
    expect(f.calls[0].url.searchParams.get("$filter")).toBe("(IsMarkedForDeletion eq false)");
    expect(f.calls[0].url.searchParams.get("$expand")).toBe("to_Description");
    expect(db.tables.products.find((p) => p.sku === "FG-100")).toMatchObject({ name: "Gate, single swing", uom: "PC", status: "active" });
    expect(db.tables.products.find((p) => p.sku === undefined || p.name === "NODESC")).toBeDefined();
    expect(db.tables.connector_links.map((l) => l.external_key).sort()).toEqual(["FG-100", "NODESC"]);
  });
});

describe("the sandbox login pulls the same way", () => {
  it("sends the API key, reaches /s4hanacloud, never a Basic header", async () => {
    const f = serve(customers(server("api_key")));
    const db = fakeDb(seed({ mode: "api_key" }));
    const r = await pull(db);
    expect(r.counts.created).toBe(2);
    expect(f.calls.every((c) => c.headers.get("apikey") === KEY && !c.headers.get("authorization"))).toBe(true);
    expect(f.calls[0].url.pathname).toBe("/s4hanacloud/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner");
    expect(sapServiceBase({ auth_mode: "api_key", api_host: "ignored" }, "API_PRODUCT_SRV")).toBe("https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap/API_PRODUCT_SRV");
  });
});

// ── The Monitor, the tenant fence, the surface ──────────────────────────────

describe("Monitor message and isolation", () => {
  it("writes one message per run for the SAP connector, with counts and no secret; none when the module is off", async () => {
    serve(customers(server()));
    const db = fakeDb({ ...seed(), integration_messages: [] });
    await pull(db);
    const m = db.tables.integration_messages;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ tenant_id: T1, connector_id: "sap_s4", entity: "customers", direction: "in", channel: "connector", status: "ok", correlation_id: lastRun(db, "customers")!.id });
    expect((m[0].summary as { counts: { created: number } }).counts.created).toBe(2);
    expect(JSON.stringify(m)).not.toContain(SECRET);

    const off = fakeDb({ ...seed({ mw: false }), integration_messages: [] });
    await pull(off);
    expect(off.tables.integration_messages).toHaveLength(0);
  });

  it("a failed run is a failed message", async () => {
    serve(server("basic", { deny: { API_BUSINESS_PARTNER: 401 } }));
    const db = fakeDb({ ...seed(), integration_messages: [] });
    await pull(db);
    expect(db.tables.integration_messages[0]).toMatchObject({ status: "failed", connector_id: "sap_s4" });
  });

  it("tenant A's run never reads or touches tenant B's links or records", async () => {
    serve(customers(server()));
    const both = { ...seed(), tenants: [...seed().tenants, ...seed({ tenant: T2 }).tenants], tenant_connectors: [...seed().tenant_connectors, ...seed({ tenant: T2 }).tenant_connectors] };
    const db = fakeDb({
      ...both,
      accounts: [{ id: "b-acc", tenant_id: T2, name: "B's Alpha" }],
      connector_links: [{ id: "b-link", tenant_id: T2, connector_id: "sap_s4", entity: "customers", object_type: "accounts", object_id: "b-acc", external_id: "0000001000", external_key: "0000001000", direction: "pull", content_hash: "x" }],
    });
    const r = await pull(db, "customers", {}, T1);
    expect(r.counts).toMatchObject({ created: 2, unchanged: 0 });
    expect(db.tables.accounts.find((a) => a.id === "b-acc")).toEqual({ id: "b-acc", tenant_id: T2, name: "B's Alpha" });
    expect(db.tables.connector_links.find((l) => l.id === "b-link")).toMatchObject({ content_hash: "x" });
    expect(db.tables.accounts.filter((a) => a.tenant_id === T1)).toHaveLength(2);
    expect(db.tables.connector_links.filter((l) => l.tenant_id === T1 && l.connector_id === "sap_s4")).toHaveLength(2);
    // the other workspace sees none of this workspace's connection
    expect(await loadSap(db.client, "t-3")).toBeNull();
    expect((await sapSyncOverview(db.client, "t-3")).connected).toBe(false);
  });

  it("the Dynamics connection is not the SAP connection", async () => {
    const db = fakeAdmin({ tenant_connectors: [{ tenant_id: T1, connector_id: "dynamics365", status: "connected", config: { product: "dataverse", auth_mode: "client_secret" }, credentials: {} }] });
    expect(await loadSap(db.client, T1)).toBeNull();
  });
});

describe("overview, health, schedule, preview, adapter", () => {
  it("the Resync overview has one row per entity, the saved scope in words, and the numbers can be looked up", async () => {
    const db = fakeAdmin({ ...seed(), connector_sync_runs: [{ tenant_id: T1, connector_id: "sap_s4", entity: "customers", status: "succeeded", trigger: "manual", started_at: "2026-10-21T10:00:00Z", finished_at: "2026-10-21T10:01:00Z", counts: { read: 2 } }], connector_links: [{ tenant_id: T1, connector_id: "sap_s4", entity: "customers" }, { tenant_id: T2, connector_id: "sap_s4", entity: "customers" }] });
    const o = await sapSyncOverview(db.client, T1);
    if (!o.connected) throw new Error("expected connected");
    expect(o.entities.map((e) => e.key)).toEqual(["customers", "vendors", "products", "sales_orders"]);
    expect(o.entities[0]).toMatchObject({ direction: "pull", enabled: true, linked: 1, filters: { numbers: true }, scope: { summary: "All customers", narrowed: false, needs_full: false }, last_run: { status: "succeeded" } });
    expect(o.entities[1].scope!.summary).toBe("All suppliers");
  });

  it("health: a missing table is a database problem; a connection in error is a connection problem", async () => {
    const ok = await sapHealth(fakeAdmin(seed()).client, T1);
    expect(ok).toMatchObject({ problems: [], connection: { connected: true, product: { key: "sap_s4" } } });
    const db = fakeAdmin(seed(), { missing: ["integration_messages"] });
    const h = await sapHealth(db.client, T1);
    expect(h.problems[0]).toMatchObject({ kind: "database" });
    const bad = seed();
    bad.tenant_connectors[0].status = "error";
    bad.tenant_connectors[0].last_error = "SAP refused it";
    expect((await sapHealth(fakeAdmin(bad).client, T1)).problems[0]).toMatchObject({ kind: "connection", message: "SAP refused it" });
  });

  it("sets the schedule of one entity and keeps the rest", async () => {
    const db = fakeAdmin(seed());
    expect(await setSapSchedule(db.client, T1, "products", "daily")).toEqual({ ok: true, schedule: "daily" });
    const cfg = db.tables.tenant_connectors[0].config as { entities: Record<string, { schedule?: string }> };
    expect(cfg.entities.products.schedule).toBe("daily");
    const o = await sapSyncOverview(db.client, T1);
    if (o.connected) expect(o.entities.find((e) => e.key === "products")).toMatchObject({ schedule: "daily", schedule_source: "entity" });
    expect((await setSapSchedule(fakeAdmin({ tenant_connectors: [] }).client, T1, "products", "daily")).ok).toBe(false);
  });

  it("the sample rows show the dotted fields the map reads, and nothing else nested", async () => {
    serve(customers(server()));
    const r = await previewSapEntity(fakeAdmin(seed()).client, T1, "customers");
    if ("error" in r) throw new Error(r.error);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ BusinessPartner: "0000001000", "address.CityName": "Berlin", "address.EmailAddress": "info@alpha.example" });
    expect(Object.keys(r.rows[0]).some((k) => k.startsWith("to_") || k === "__metadata")).toBe(false);
  });

  it("the adapter describes the connector and reads a number from a row", () => {
    const a = sapAdapter(fakeAdmin(seed()).client);
    expect(a).toMatchObject({ id: "sap_s4", label: "SAP S/4HANA", authModes: ["basic", "api_key"], capabilities: { pull: ["customers", "vendors", "products", "sales_orders"], pushQuote: false, pushProject: false, pushOrder: true, metadata: true } });
    expect(a.presets.customers.name).toBe("BusinessPartnerFullName");
    expect(a.readableKey("products", { Product: " FG-1 " })).toBe("FG-1");
    expect(a.readableKey("nope", {})).toBeNull();
  });

  it("is listed in the connector registry for the middleware page only", () => {
    const def = CONNECTOR_CATALOG.find((c) => c.id === "sap_s4")!;
    expect(def).toMatchObject({ middleware: true, middlewareOnly: true, fields: [] });
    expect(visibleConnectors(false).some((c) => c.id === "sap_s4")).toBe(false);
    expect(visibleConnectors(true).some((c) => c.id === "sap_s4")).toBe(true);
    expect(visibleConnectors(false).map((c) => c.id)).toContain("dynamics365");
    expect(effectiveEntities({ entities: {} }).products.enabled).toBe(true);
  });
});

// ── Metadata, mapping, scope screens ───────────────────────────────────────

describe("fields, mapping and scope from $metadata", () => {
  it("lists the properties of the entity set and the address / description parts the map can read", async () => {
    serve(server());
    const db = fakeAdmin(seed());
    const bp = await getSapFields(db.client, T1, "customers");
    if (!bp.ok) throw new Error(bp.message);
    expect(bp.source).toBe("metadata");
    expect(bp.main.map((f) => f.name)).toEqual(expect.arrayContaining(["BusinessPartner", "BusinessPartnerFullName", "LastChangeDate"]));
    expect(bp.extra.map((f) => f.name)).toEqual(expect.arrayContaining(["address.CityName", "address.Country", "address.EmailAddress", "address.PhoneNumber"]));
    expect(bp.main.every((f) => !f.required)).toBe(true);
    const pr = await getSapFields(db.client, T1, "products");
    if (!pr.ok) throw new Error(pr.message);
    expect(pr.extra.map((f) => f.name).sort()).toEqual(["description.Language", "description.ProductDescription"]);
  });

  it("falls back to a sample row when $metadata is refused", async () => {
    serve(customers(server("basic", { metadataFails: true })));
    const f = await getSapFields(fakeAdmin(seed()).client, T1, "customers");
    if (!f.ok) throw new Error(f.message);
    expect(f.source).toBe("sample");
    expect(f.main.map((x) => x.name)).toContain("BusinessPartnerFullName");
    expect(f.main.some((x) => x.name.startsWith("to_"))).toBe(false);
  });

  it("not connected, and a refused login, are answers not exceptions", async () => {
    expect(await getSapFields(fakeAdmin({ tenant_connectors: [] }).client, T1, "customers")).toMatchObject({ ok: false, state: "not_connected" });
    serve(server("basic", { deny: { API_BUSINESS_PARTNER: 401 } }));
    expect(await getSapFields(fakeAdmin(seed()).client, T1, "customers")).toMatchObject({ ok: false, state: "error" });
  });

  it("the Mapping view works with zero configuration and edits only the map of the entity", async () => {
    serve(server());
    const db = fakeAdmin(seed());
    const v = await getSapMapping(db.client, T1, "customers");
    if (!("sections" in v)) throw new Error("not connected");
    expect(v.usingStandard).toBe(true);
    expect(v.sections[0].rows.map((r) => [r.id, r.erp?.name])).toEqual([
      ["name", "BusinessPartnerFullName"], ["address_line1", "address.StreetName"], ["city", "address.CityName"], ["postal_code", "address.PostalCode"],
      ["country", "address.Country"], ["phone", "address.PhoneNumber"], ["email", "address.EmailAddress"],
    ]);
    expect(v.erpFields.header.map((f) => f.name)).toContain("OrganizationBPName1");

    const saved = await saveSapMapping(db.client, T1, { document: "customers", section: "header", rows: [{ id: "name", erp: "OrganizationBPName1" }, { id: "phone", erp: null }] });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.view.usingStandard).toBe(false);
    const cfg = db.tables.tenant_connectors[0].config as { entities: Record<string, { field_map: Record<string, string> }> };
    expect(cfg.entities.customers.field_map).toMatchObject({ name: "OrganizationBPName1", city: "address.CityName" });
    expect(cfg.entities.customers.field_map.phone).toBeUndefined();
    expect(cfg.entities.vendors).toBeUndefined();

    const reset = await resetSapMapping(db.client, T1, { document: "customers" });
    if (!reset.ok) throw new Error(reset.error);
    expect(reset.view.usingStandard).toBe(true);
  });

  it("names every row that is not a SAP field, not part of the mapping or sent twice", async () => {
    serve(server());
    const db = fakeAdmin(seed());
    const bad = await saveSapMapping(db.client, T1, { document: "customers", section: "header", rows: [{ id: "name", erp: "NoSuchField" }, { id: "zzz", erp: "Industry" }, { id: "city", erp: "a b" }, { id: "city", erp: "x" }] });
    expect(bad).toMatchObject({ ok: false, status: 422 });
    if (!bad.ok) expect(bad.errors!.map((e) => e.id).sort()).toEqual(["city", "city", "name", "zzz"]);
    expect(await saveSapMapping(db.client, T1, { document: "quote", section: "header", rows: [] })).toMatchObject({ ok: false, status: 422 });
    expect(await saveSapMapping(db.client, T1, { document: "customers", section: "header", rows: ["name", "address_line1", "city", "postal_code", "country", "phone", "email"].map((id) => ({ id, erp: null })) })).toMatchObject({ ok: false, error: "Keep at least one field mapped." });
  });

  it("scope: saved against the system's own attributes, the kind comes from the system, needs a Full resync when it changes", async () => {
    serve(server());
    const db = fakeAdmin(seed());
    const v = await getSapScope(db.client, T1, "customers");
    if ("error" in v) throw new Error(v.error);
    expect(v.source).toBe("system");
    expect(v.attributes[0]).toMatchObject({ id: "BusinessPartnerCategory", common: true });
    expect(v.summary).toBe("All customers");

    const s1 = await saveSapScope(db.client, T1, "customers", { conditions: [{ attribute: "BusinessPartnerCategory", kind: "text", values: ["2"], labels: ["Organization"] }] });
    if ("error" in s1) throw new Error(s1.error);
    expect(s1.conditions[0]).toMatchObject({ kind: "option", attribute_label: "Category", values: ["2"] });
    expect(s1.needs_full).toBe(false);
    const s2 = await saveSapScope(db.client, T1, "customers", { conditions: [{ attribute: "BusinessPartnerCategory", kind: "option", values: ["1"] }] });
    if ("error" in s2) throw new Error(s2.error);
    expect(s2.needs_full).toBe(true);
    expect(await saveSapScope(db.client, T1, "customers", { conditions: [{ attribute: "Nope", kind: "text", values: ["a"] }] })).toMatchObject({ status: 422 });
    const cleared = await saveSapScope(db.client, T1, "vendors", { conditions: [] });
    if ("error" in cleared) throw new Error(cleared.error);
    expect(cleared.conditions).toEqual([]);
  });

  it("scope values: a fixed pick-list, yes/no, or typed", async () => {
    serve(server());
    const db = fakeAdmin(seed());
    expect(await getSapScopeValues(db.client, T1, "customers", "BusinessPartnerCategory")).toMatchObject({ typed: false, values: [{ value: "1", label: "Person" }, { value: "2", label: "Organization" }, { value: "3", label: "Group" }] });
    expect(await getSapScopeValues(db.client, T1, "customers", "Industry")).toMatchObject({ typed: true });
    expect(await getSapScopeValues(db.client, T1, "customers", "Nope")).toMatchObject({ status: 422 });
  });

  it("works with the saved scope while the field list can not be read: the common attributes only", async () => {
    serve(server("basic", { deny: { API_BUSINESS_PARTNER: 403 } }));
    const v = await getSapScope(fakeAdmin(seed()).client, T1, "customers");
    if ("error" in v) throw new Error(v.error);
    expect(v.source).toBe("presets");
    expect(v.attributes.every((a) => a.common)).toBe(true);
  });
});
