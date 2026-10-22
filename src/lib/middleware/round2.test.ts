import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u), fetchPublic: async () => new Response("{}") }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {} }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: null }) }));
vi.mock("@/lib/connectors/d365/server", async (orig) => ({ ...(await orig<typeof import("@/lib/connectors/d365/server")>()), testConnection: async () => "Connected to Dataverse." }));

import { dispatchQuoteOutcome } from "./dispatch";
import { FakeDataverse } from "./fakeDataverse";
import { fakeAdmin, seedMiddleware, T1, T2, type Row } from "./testHarness";
import { DEFAULT_INCLUDE } from "./documents";
import { MESSAGE_RETENTION_DAYS, PAYLOAD_RETENTION_HOURS, pruneMessages } from "./messages";
import { capLimit, parseRestartId, restartMessages } from "./restart";
import { checkPermissions, connectionCheck, health } from "./ops";
import { privilegeVerdict, userAccess } from "./health";
import { applyMapping, buildMappingView, invertOutbound, resetMapping } from "./mappingDoc";
import { normalizePayload, pickExchange, buildExchangePayload } from "./exchange";
import { payloadStillKept } from "./monitorRows";
import { listMessages, getMessageDetail } from "./monitor";
import type { D365Config } from "@/lib/connectors/d365/types";

// Round 2 of the integration middleware (spec section 9 with 6-8): Sales Order target, price list and currency
// per send, restart, payloads with a 48-hour life, the one Test answer, the two-column mapping API.

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const msgs = (db: { tables: Record<string, Row[]> }) => db.tables.integration_messages ?? [];
const run = (db: ReturnType<typeof fakeAdmin>, dv: FakeDataverse, over: Parameters<typeof dispatchQuoteOutcome>[3] = { trigger: "auto" }, quoteId = "q-1", tenant = T1) =>
  dispatchQuoteOutcome(db.client, tenant, quoteId, { http: dv, userId: "u-1", ...over });

const ACC_EXT = "00000000-aaaa-4aaa-8aaa-000000000001";
const orderDoc = { documents: { quote: { enabled: true, target: "sales_order", include: { ...DEFAULT_INCLUDE }, confirmed_at: "2026-10-21T10:00:00.000Z" } } };

describe("Sales Order target on Dynamics Sales", () => {
  it("one POST to salesorders with write-in order_details (no uomid), the marker at the end of the description, ordernumber as the key", async () => {
    const db = fakeAdmin(seedMiddleware({ mwConfig: orderDoc }));
    const dv = new FakeDataverse();
    const r = await run(db, dv);
    expect(r).toMatchObject({ state: "sent" });
    expect(dv.quotes).toHaveLength(0);
    expect(dv.orders).toHaveLength(1);
    const o = dv.orders[0];
    expect(o).toMatchObject({ statecode: 0, statuscode: 1, totalamount: 125, name: "SQ-0001 · A. Datum Corporation" });
    expect(String(o.body.description)).toMatch(/\[bpmsquare:q-1\]$/);
    expect(o.lines).toHaveLength(2);
    for (const l of o.lines) { expect(l).toMatchObject({ isproductoverridden: true }); expect("uomid" in l || "uomid@odata.bind" in l).toBe(false); }
    expect(dv.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    // the claim is keyed by the target, the readable number is the order number
    const link = db.tables.connector_links.find((l) => l.entity === "standard_quotes:sales_order")!;
    expect(link).toMatchObject({ object_type: "standard_quotes", object_id: "q-1", external_id: o.salesorderid, external_key: o.ordernumber, direction: "push" });
    expect(r.state === "sent" && r.number).toBe(o.ordernumber);
    expect(msgs(db)).toHaveLength(1);
    expect(msgs(db)[0]).toMatchObject({ status: "ok", entity: "sales_order", object_id: "q-1" });
  });

  it("a second send of the same quote finds the order again and makes no twin", async () => {
    const db = fakeAdmin(seedMiddleware({ mwConfig: orderDoc }));
    const dv = new FakeDataverse();
    await run(db, dv);
    const again = await run(db, dv, { trigger: "retry" });
    expect(again.state).toBe("already_sent");
    expect(dv.orders).toHaveLength(1);
    // even when the link is gone, the marker in the description finds it
    db.tables.connector_links = db.tables.connector_links.filter((l) => l.entity !== "standard_quotes:sales_order");
    expect((await run(db, dv, { trigger: "retry" })).state).toBe("already_sent");
    expect(dv.orders).toHaveLength(1);
  });

  it("a rejected quote is never sent and leaves no message, whatever the target", async () => {
    const seed = seedMiddleware({ mwConfig: orderDoc });
    seed.standard_quotes[0].status = "rejected";
    const db = fakeAdmin(seed);
    const dv = new FakeDataverse();
    const r = await run(db, dv);
    expect(r.state).toBe("disabled");
    expect(dv.calls).toHaveLength(0);
    expect(msgs(db)).toHaveLength(0);
  });
});

describe("price list and currency are decided per send", () => {
  it("the customer's own Dynamics price list wins over the fallback, read live from the linked account", async () => {
    const db = fakeAdmin(seedMiddleware());
    const dv = new FakeDataverse();
    dv.accountPriceLists[ACC_EXT] = "pl-customer";
    await run(db, dv);
    expect(dv.calls.find((c) => c.path === `accounts(${ACC_EXT})`)?.query).toMatchObject({ $select: "_defaultpricelevelid_value" });
    expect(dv.quotes[0].body["pricelevelid@odata.bind"]).toBe("/pricelevels(pl-customer)");
  });

  it("a customer with no list uses the fallback; no list and no fallback fails with the plain fix and sends nothing", async () => {
    const db = fakeAdmin(seedMiddleware());
    const dv = new FakeDataverse();
    dv.accountPriceLists[ACC_EXT] = null;
    await run(db, dv);
    expect(dv.quotes[0].body["pricelevelid@odata.bind"]).toBe("/pricelevels(pl-0001)");

    const db2 = fakeAdmin(seedMiddleware({ cfg: { price_list_id: undefined } }));
    const dv2 = new FakeDataverse();
    dv2.accountPriceLists[ACC_EXT] = null;
    const r = await run(db2, dv2);
    expect(r).toMatchObject({ state: "failed", headline: "This customer has no price list in Dynamics and no fallback is set" });
    expect(dv2.quotes).toHaveLength(0);
    expect(msgs(db2)[0]).toMatchObject({ status: "failed" });
  });

  it("the currency is the quote's ISO code matched in Dynamics, else the base currency, else a plain failure", async () => {
    const seed = seedMiddleware({ cfg: { currency_id: undefined } });
    seed.tenants[0].config = { currency: "USD" };
    const db = fakeAdmin(seed);
    const dv = new FakeDataverse();
    dv.data.transactioncurrencies = [{ transactioncurrencyid: "cur-usd", isocurrencycode: "USD", currencyname: "US Dollar", statecode: 0 }, { transactioncurrencyid: "cur-inr", isocurrencycode: "INR", currencyname: "Rupee", statecode: 0 }];
    await run(db, dv);
    expect(dv.quotes[0].body["transactioncurrencyid@odata.bind"]).toBe("/transactioncurrencies(cur-usd)");

    const seedBase = seedMiddleware({ cfg: { currency_id: undefined } });
    seedBase.tenants[0].config = { currency: "QAR" };
    const db2 = fakeAdmin(seedBase);
    const dv2 = new FakeDataverse();
    dv2.data.transactioncurrencies = [{ transactioncurrencyid: "cur-usd", isocurrencycode: "USD", statecode: 0 }];
    dv2.data.organizations = [{ _basecurrencyid_value: "cur-base" }];
    await run(db2, dv2);
    expect(dv2.quotes[0].body["transactioncurrencyid@odata.bind"]).toBe("/transactioncurrencies(cur-base)");

    const db3 = fakeAdmin(seedBase);
    const dv3 = new FakeDataverse();
    const r = await run(db3, dv3);
    expect(r).toMatchObject({ state: "failed", headline: expect.stringContaining("No Dynamics currency matches") });
    expect(dv3.quotes).toHaveLength(0);
  });

  it("health no longer asks for a price list or a currency", async () => {
    const db = fakeAdmin(seedMiddleware({ cfg: { price_list_id: undefined, currency_id: undefined } }));
    const h = await health(db.client, T1);
    expect(h.problems).toEqual([]);
    expect(JSON.stringify(h)).not.toMatch(/price list|currency/i);
    expect("secretSoon" in h).toBe(false);
  });
});

describe("request and response payloads", () => {
  it("every outbound document send stores the create call, redacted, with url = path only and has_payload on the list", async () => {
    const db = fakeAdmin(seedMiddleware({ mwConfig: orderDoc }));
    const dv = new FakeDataverse();
    await run(db, dv);
    const m = msgs(db)[0];
    const p = normalizePayload(m.payload)!;
    expect(p.request).toMatchObject({ method: "POST", url: "/salesorders" });
    expect((p.request!.body as Record<string, unknown>).name).toBe("SQ-0001 · A. Datum Corporation");
    expect(p.response).toMatchObject({ status: 201 });
    expect((p.response!.body as Record<string, unknown>).ordernumber).toBe(dv.orders[0].ordernumber);
    expect(p.truncated).toBe(false);
    expect((m.summary as Record<string, unknown>).has_payload).toBe(true);
    const page = await listMessages(db.client, T1);
    expect(page.items[0]).toMatchObject({ hasPayload: true, restartable: false, what: "Sales Order", erpNumber: dv.orders[0].ordernumber });
    const detail = await getMessageDetail(db.client, T1, page.items[0].id);
    expect(detail.ok && detail.value.payload?.request?.url).toBe("/salesorders");
  });

  it("a failed call is the one kept, with the ERP's answer; a bad id from another workspace is not found", async () => {
    const db = fakeAdmin(seedMiddleware());
    const dv = new FakeDataverse();
    dv.failOnce.create = { status: 403, message: "Principal user is missing prvCreateQuote privilege" };
    await run(db, dv);
    const p = normalizePayload(msgs(db)[0].payload)!;
    expect(p.request).toMatchObject({ method: "POST", url: "/quotes" });
    expect(p.response?.status).toBe(403);
    expect(JSON.stringify(p.response?.body)).toContain("prvCreateQuote");
    const page = await listMessages(db.client, T1);
    expect(page.items[0]).toMatchObject({ restartable: true, hasPayload: true });
    expect(page.items[0].fix).toBeTruthy();
    expect((await getMessageDetail(db.client, T2, page.items[0].id)).ok).toBe(false);
  });

  it("picks the failed call, else the create, and never keeps a query string or an authorization value", () => {
    const calls = [
      { method: "GET", path: "accounts(1)?$select=x", requestBody: undefined, status: 200, responseBody: {}, durationMs: 1, failed: false },
      { method: "POST", path: "https://org.crm.dynamics.com/api/data/v9.2/quotes?$select=quoteid", requestBody: { name: "x", authorization: "Bearer abc" }, status: 201, responseBody: { quoteid: "1" }, durationMs: 5, failed: false },
      { method: "POST", path: "WinQuote", requestBody: {}, status: 204, responseBody: null, durationMs: 2, failed: false },
    ];
    const stored = buildExchangePayload(pickExchange(calls))!;
    expect(stored.request!.url).toBe("/api/data/v9.2/quotes");
    expect(JSON.stringify(stored.request!.body)).not.toContain("abc");
    const failing = [...calls, { method: "POST", path: "CloseQuote", requestBody: {}, status: 400, responseBody: { error: "x" }, durationMs: 2, failed: true }];
    expect(pickExchange(failing)!.path).toBe("CloseQuote");
  });

  it("the payload is nulled after 48 hours, the line stays until 30 days", async () => {
    const now = Date.parse("2026-11-30T00:00:00Z");
    const h = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
    const db = fakeAdmin({ integration_messages: [
      { id: "a", tenant_id: T1, created_at: h(PAYLOAD_RETENTION_HOURS + 1), payload: { request: { method: "POST" } } },
      { id: "b", tenant_id: T1, created_at: h(2), payload: { request: { method: "POST" } } },
      { id: "c", tenant_id: T2, created_at: h(PAYLOAD_RETENTION_HOURS + 1), payload: { request: { method: "POST" } } },
      { id: "d", tenant_id: T1, created_at: h((MESSAGE_RETENTION_DAYS + 1) * 24), payload: null },
    ] });
    await pruneMessages(db.client, T1, now);
    const by = Object.fromEntries(db.tables.integration_messages.map((r) => [r.id, r]));
    expect(by.a).toMatchObject({ payload: null });
    expect(by.b.payload).not.toBeNull();
    expect(by.c.payload).not.toBeNull();
    expect(by.d).toBeUndefined();
    expect(payloadStillKept(h(47), now)).toBe(true);
    expect(payloadStillKept(h(49), now)).toBe(false);
  });
});

describe("Restart", () => {
  const Q_MSG = "11111111-1111-4111-8111-111111111111";
  const OK_MSG = "22222222-2222-4222-8222-222222222222";
  const OTHER = "33333333-3333-4333-8333-333333333333";
  const seedFailed = (over: Record<string, unknown> = {}) => {
    const s = seedMiddleware(over);
    s.integration_messages = [
      { id: Q_MSG, tenant_id: T1, channel: "connector", direction: "out", object_type: "standard_quotes", object_id: "q-1", status: "failed", entity: "quote", summary: { outcome: "awarded", ref: "SQ-0001", fix: "Retry." }, created_at: "2026-10-21T09:00:00.000Z" },
      { id: OK_MSG, tenant_id: T1, channel: "connector", direction: "out", object_type: "standard_quotes", object_id: "q-1", status: "ok", entity: "quote", summary: { outcome: "awarded" }, created_at: "2026-10-21T08:00:00.000Z" },
      { id: OTHER, tenant_id: T2, channel: "connector", direction: "out", object_type: "standard_quotes", object_id: "q-9", status: "failed", entity: "quote", summary: { outcome: "awarded" }, created_at: "2026-10-21T07:00:00.000Z" },
    ];
    return s;
  };

  it("re-sends a failed document through the claim path, reports per row, and never touches another workspace's row", async () => {
    const db = fakeAdmin(seedFailed());
    const dv = new FakeDataverse();
    const r = await restartMessages(db.client, T1, "u-1", { ids: [`integration:${Q_MSG}`, `integration:${OK_MSG}`, `integration:${OTHER}`, "nonsense"] }, { http: dv });
    expect("results" in r && r.results).toEqual([
      { id: `integration:${Q_MSG}`, outcome: "done", message: expect.stringContaining("Sent") },
      { id: `integration:${OK_MSG}`, outcome: "already_ok", message: expect.any(String) },
      { id: `integration:${OTHER}`, outcome: "not_restartable", message: "Message not found." },
      { id: "nonsense", outcome: "not_restartable", message: expect.any(String) },
    ]);
    expect(dv.quotes).toHaveLength(1);
    expect(db.tables.integration_messages.find((m) => m.id === OTHER)!.status).toBe("failed");
    // the older failed line is settled by the new ok one
    expect(db.tables.integration_messages.find((m) => m.id === Q_MSG)!.status).toBe("skipped");
  });

  it("is idempotent: a second restart finds the quote already in the ERP", async () => {
    const db = fakeAdmin(seedFailed());
    const dv = new FakeDataverse();
    await restartMessages(db.client, T1, "u-1", { ids: [`integration:${Q_MSG}`] }, { http: dv });
    const again = await restartMessages(db.client, T1, "u-1", { ids: [`integration:${Q_MSG}`] }, { http: dv });
    expect("results" in again && again.results[0].outcome).toBe("already_ok");
    expect(dv.quotes).toHaveLength(1);
  });

  it("a filter picks only restartable rows of this workspace, capped; still failing comes back as failed with the reason", async () => {
    const db = fakeAdmin(seedFailed());
    const dv = new FakeDataverse();
    dv.failOnce.create = { status: 403, message: "Principal user is missing prvCreateQuote privilege" };
    const r = await restartMessages(db.client, T1, "u-1", { filter: { status: "failed" }, limit: 500 }, { http: dv });
    expect("results" in r && r.results).toHaveLength(1);
    expect("results" in r && r.results[0]).toMatchObject({ id: `integration:${Q_MSG}`, outcome: "failed", message: expect.stringContaining("may not create quotes") });
    expect(capLimit(500)).toBe(50);
    expect(capLimit("x")).toBe(50);
    expect(capLimit(3)).toBe(3);
    expect(parseRestartId(`integration:${Q_MSG}`)).toEqual({ source: "integration", uuid: Q_MSG });
    expect(parseRestartId("email:" + Q_MSG)).toBeNull();
  });

  it("a failed inbound run row runs that entity again", async () => {
    const RUN = "44444444-4444-4444-8444-444444444444";
    const s = seedMiddleware();
    s.integration_messages = [{ id: RUN, tenant_id: T1, channel: "connector", direction: "in", entity: "customers", status: "failed", summary: { kind: "connector_run", counts: { failed: 2 } }, created_at: "2026-10-21T09:00:00.000Z" }];
    const db = fakeAdmin(s);
    const r = await restartMessages(db.client, T1, "u-1", { ids: [`integration:${RUN}`] });
    expect("results" in r).toBe(true);
    if ("results" in r) {
      expect(r.results[0].id).toBe(`integration:${RUN}`);
      expect(["done", "failed"]).toContain(r.results[0].outcome);
    }
  }, 30_000);
});

describe("Test = connection and permissions in one answer", () => {
  const WHO = "00000000-0000-4000-8000-00000000beef";
  const fakeHttp = (over: { roles?: { name: string }[]; privileges?: Record<string, unknown>[] | "fail"; failReads?: boolean } = {}) => ({
    async get(path: string) {
      if (path === "WhoAmI") return { UserId: WHO };
      if (path === `systemusers(${WHO})/systemuserroles_association`) return { value: over.roles ?? [] };
      if (path === `systemusers(${WHO})/Microsoft.Dynamics.CRM.RetrieveUserPrivileges`) { if (over.privileges === "fail") throw Object.assign(new Error("no"), { status: 403 }); return { value: over.privileges ?? [] }; }
      if (path === "privileges") return { value: [] };
      if (over.failReads) throw Object.assign(new Error("Principal user is missing privilege"), { status: 403 });
      return { value: [] };
    },
  });

  it("an application user is checked through its own systemuser and roles: System Administrator confirms every create", async () => {
    const db = fakeAdmin(seedMiddleware());
    const r = await checkPermissions(db.client, T1, { http: fakeHttp({ roles: [{ name: "System Administrator" }] }) });
    expect("checks" in r && r.checks.filter((c) => /create|close/.test(c.id)).every((c) => c.ok === true)).toBe(true);
  });

  it("a privilege that cannot be determined is 'not checked', never a false no", async () => {
    const db = fakeAdmin(seedMiddleware());
    const r = await checkPermissions(db.client, T1, { http: fakeHttp({ privileges: "fail" }) });
    expect("checks" in r && r.checks.filter((c) => /create|close/.test(c.id)).every((c) => c.ok === null && c.fix === "Not checked: use Send a test quote")).toBe(true);
    const a = await userAccess(fakeHttp({ privileges: [{ PrivilegeName: "prvCreateQuote", PrivilegeId: "p1" }] }), ["prvCreateQuote"]);
    expect(privilegeVerdict(a, ["prvCreateQuote"])).toBe(true);
    expect(privilegeVerdict(a, ["prvCreateSalesOrder"])).toBe(false);
  });

  it("one line and only the failures", async () => {
    const db = fakeAdmin(seedMiddleware());
    const r = await connectionCheck(db.client, T1, { http: fakeHttp({ roles: [{ name: "System Administrator" }], failReads: true }) });
    expect(r.ok).toBe(false);
    expect(r.line).toMatch(/Connected, but \d things? needs? fixing\./);
    expect(r.failures.length).toBeGreaterThan(0);
    for (const f of r.failures) expect(f).toEqual({ label: expect.any(String), fix: expect.any(String) });
    const ok = await connectionCheck(db.client, T1, { http: fakeHttp({ roles: [{ name: "System Administrator" }] }) });
    expect(ok).toMatchObject({ ok: true, failures: [], line: "Connected. Everything checked is fine." });
  });
});

describe("Mapping API: two columns, one row per field", () => {
  const cfg = (): D365Config => seedMiddleware().tenant_connectors[0].config as unknown as D365Config;
  const erp = {
    header: [
      { name: "name", label: "Name", creatable: true, required: true }, { name: "description", label: "Description", creatable: true }, { name: "subject", label: "Subject", creatable: true },
      { name: "customerid", label: "Customer", creatable: true, required: true }, { name: "address1_city", label: "City", creatable: true },
    ],
    lines: [{ name: "productdescription", label: "Product description", creatable: true }, { name: "quantity", label: "Quantity", creatable: true }],
  } as unknown as Parameters<typeof buildMappingView>[0]["erpFields"];

  it("the Quote on a Sales Order target: header and lines, standard rows, a composite shown read-only", () => {
    const v = buildMappingView({ doc: "quote", cfg: cfg(), target: "sales_order", erpFields: erp });
    expect(v.document).toEqual({ key: "quote", label: "Quote", targetLabel: "Dynamics 365 Sales Order" });
    expect(v.sections.map((s) => s.key)).toEqual(["header", "lines"]);
    expect(v.usingStandard).toBe(true);
    expect(v.sections[0].rows.find((r) => r.id === "name")).toMatchObject({ bpm: { label: "Name", name: "name" }, erp: { label: "Name", name: "name" }, standard: true });
    expect(v.sections[0].rows.find((r) => r.id === "ref")).toMatchObject({ erp: null, standard: true });
    expect(v.sections[1].rows.find((r) => r.id === "qty")).toMatchObject({ erp: { name: "quantity" }, standard: true });
    expect(v.sections[1].rows.find((r) => r.id === "sl_no")).toMatchObject({ erp: null });
    // a template built from more than one field shows as one read-only row, with "Standard" only when it is the preset
    const rows = invertOutbound({ name: "{ref} · {customer_name}", description: "{description}" }, { name: "{name}", description: "{description}" }, ["name", "ref", "customer_name", "description"], { ref: "Reference", customer_name: "Customer" }, erp.header);
    expect(rows.find((r) => r.id === "composite:name")).toMatchObject({ bpm: { label: "Reference · Customer", name: "{ref} · {customer_name}" }, erp: { name: "name" }, standard: false, composite: "{ref} · {customer_name}" });
    for (const s of v.sections) for (const r of s.rows) expect(r.bpm).toEqual({ label: expect.any(String), name: expect.any(String) });
    expect(v.erpFields.header.some((f) => f.name === "description")).toBe(true);
    expect(v.missingRequired).toEqual([]);
  });

  it("a save names the row that is wrong; a good save changes only that map, and reset removes it", () => {
    const c = cfg();
    const bad = applyMapping({ doc: "quote", cfg: c, target: "quote", erpFields: erp, section: "header", rows: [{ id: "no-such-row", erp: "description" }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toMatchObject({ id: "no-such-row", message: expect.any(String) });
    const notField = applyMapping({ doc: "quote", cfg: c, target: "quote", erpFields: erp, section: "header", rows: [{ id: "ref", erp: "nope" }] });
    expect(notField.ok).toBe(false);
    if (!notField.ok) expect(notField.errors[0]).toMatchObject({ id: "ref", message: "Reference: nope is not a field in the ERP." });
    const taken = applyMapping({ doc: "quote", cfg: c, target: "quote", erpFields: erp, section: "header", rows: [{ id: "ref", erp: "description" }] });
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.errors[0]).toMatchObject({ id: "ref", message: expect.stringContaining("already filled") });
    const good = applyMapping({ doc: "quote", cfg: c, target: "quote", erpFields: erp, section: "header", rows: [{ id: "ref", erp: "subject" }] });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.change.outbound?.quote?.field_map?.subject).toBe("{ref}");
      const after = buildMappingView({ doc: "quote", cfg: { ...c, ...good.change }, target: "quote", erpFields: erp });
      expect(after.usingStandard).toBe(false);
      expect(after.sections[0].rows.find((r) => r.id === "ref")?.erp?.name).toBe("subject");
      const reset = resetMapping({ ...c, ...good.change }, "quote", "quote");
      expect(buildMappingView({ doc: "quote", cfg: { ...c, outbound: reset.outbound, orders: reset.orders }, target: "quote", erpFields: erp }).usingStandard).toBe(true);
    }
  });

  it("an inbound entity has one section and maps BPMSquare field to ERP source field", () => {
    const v = buildMappingView({ doc: "customers", cfg: cfg(), target: "quote", erpFields: erp });
    expect(v.document.label).toBe("Customers");
    expect(v.sections).toHaveLength(1);
    expect(v.sections[0].rows.map((r) => r.bpm.name)).toEqual(["name", "city", "phone", "email"]);
    const saved = applyMapping({ doc: "customers", cfg: cfg(), target: "quote", erpFields: erp, section: "header", rows: [{ id: "city", erp: "address1_city" }] });
    expect(saved.ok).toBe(true);
    expect(applyMapping({ doc: "customers", cfg: cfg(), target: "quote", erpFields: erp, section: "lines", rows: [] }).ok).toBe(false);
  });
});
