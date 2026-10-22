import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.FIELD_ENCRYPTION_KEY = "ef".repeat(32); });
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {}, logChange: async () => {} }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: null }) }));

import { sealSecret } from "@/lib/encryption";
import { updateWebhook, listLibrary } from "@/lib/webhooks/library";
import { dispatchQuoteOutcome } from "../dispatch";
import { classifyIntegrationRow } from "../monitorRows";
import { restartMessages } from "../restart";
import { fakeAdmin, seedMiddleware, T1, T2, type Row } from "../testHarness";

const WH = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const CONN = `webhook:${WH}`;

let calls: { url: string; method: string; body: string; headers: Record<string, string> }[] = [];
let respond: () => Response = () => new Response("{}", { status: 200 });

beforeEach(() => {
  calls = [];
  respond = () => new Response('{"data":{"number":"ORD-77"}}', { status: 200 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (u: unknown, init?: RequestInit) => {
    calls.push({ url: String(u), method: String(init?.method), body: String(init?.body ?? ""), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return respond();
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const hook = (over: Row = {}): Row => ({
  id: WH, tenant_id: T1, kind: "call", name: "Quote hook", url: "https://erp.example.com/hooks/quote", secret: sealSecret("whsec_x"), method: "POST", object_type: "standard_quotes", object_types: ["*"],
  headers: [{ name: "X-Api-Key", value: sealSecret("k-123") }], payload_mode: "mapping", template: null, allow_personal_data: false, timeout_ms: 15000, active: true, paused_reason: null,
  last_delivery_at: null, last_status: null, last_error: null, failure_count: 0, legacy_key: null, created_at: "2026-10-21T00:00:00Z", updated_at: null,
  mapping_id: "m-1", response_key_path: "$.data.number", ...over,
});

const row = (id: string, target: string, source: string | null, convert: unknown = null) => ({ id, target, source, convert, ifEmpty: null, origin: "user", confidence: null });
const mapping = (tenant = T1): Row => ({
  id: "m-1", tenant_id: tenant, connection_id: CONN, document: "quote", direction: "out", version: 1, status: "active",
  doc: {
    source: { object: "standard_quote", registryHash: "h" },
    target: { kind: "sample", entity: "Sample", linesPath: "items", schema: { fetchedAt: "2026-10-22T00:00:00Z", sourceUrl: null, fields: [], lineFields: [] } },
    header: [row("h1", "orderNo", "ref"), row("h2", "amount", "total"), row("h3", "customer", "account.name")],
    lines: [row("l1", "text", "description"), row("l2", "unitCode", "uom", { kind: "value_list", list: "unit" })],
  },
});
const unitList = (rows: { bpm: string; erp: string; inbound: boolean }[]): Row => ({ tenant_id: T1, connection_id: CONN, kind: "unit", label: "Unit", rows, default_in: null, unknown_in: [] });

const world = (o: { map?: Row | null; list?: Row | null; hookOver?: Row } = {}) => {
  const seed = seedMiddleware({
    features: { webhooks_library: true },
    mwConfig: { documents: { quote: { enabled: true, when: { awarded: true, rejected: false }, mode: "auto", target: "webhook", webhook_id: WH, include: {}, confirmed_at: null } } },
  });
  return fakeAdmin({
    ...seed, webhooks: [hook(o.hookOver)],
    integration_mappings: o.map === null ? [] : [o.map ?? mapping()],
    integration_value_lists: o.list === null ? [] : [o.list ?? unitList([{ bpm: "pcs", erp: "PC", inbound: true }])],
  });
};

describe("a Call webhook whose body comes from a mapping", () => {
  it("sends the engine's body, signed and with the webhook's own headers, and stores the readable id from the response", async () => {
    const db = world();
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" });
    expect(r.state).toBe("sent");
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].body);
    expect(body).toEqual({
      orderNo: "SQ-0001", amount: 143.75, customer: "A. Datum Corporation",
      items: [{ text: "Fence post 2.4 m", unitCode: "PC" }, { text: "Gate, single swing", unitCode: "PC" }],
    });
    expect(calls[0].headers["x-bpmsquare-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0].headers["x-api-key"]).toBe("k-123");
    const link = db.tables.connector_links.find((l) => l.connector_id === CONN) as Row;
    expect(link).toMatchObject({ external_key: "ORD-77" });
    expect(String(link.external_id)).toMatch(/^delivery:/);
    // nothing about the key or the signing secret reaches the stored message
    expect(JSON.stringify(db.tables.integration_messages)).not.toMatch(/k-123|whsec_x/);
  });

  it("an unmapped value fails the call with the fix, nothing is sent, and Restart works after the list is fixed", async () => {
    const db = world({ list: unitList([{ bpm: "Nos", erp: "EA", inbound: true }]) });
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" });
    expect(r).toMatchObject({ state: "failed", headline: "Unit 'pcs' has no ERP code." });
    expect(calls).toHaveLength(0);
    const msg = db.tables.integration_messages.find((m) => m.status === "failed") as Row;
    expect(msg.summary).toMatchObject({ kind: "webhook_call", fix: "Add it in Mapping > Value mapping, then Restart." });
    expect(classifyIntegrationRow(msg as never)).toBe("webhook_call");
    expect(db.tables.connector_links.filter((l) => l.connector_id === CONN)).toHaveLength(0);

    (db.tables.integration_value_lists[0].rows as unknown[]).push({ bpm: "pcs", erp: "PC", inbound: true });
    const out = await restartMessages(db.client, T1, "u-1", { ids: [`integration:${msg.id}`] });
    expect("results" in out && out.results[0]).toMatchObject({ outcome: "done" });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body).items[0].unitCode).toBe("PC");
  });

  it("a mapping that was removed fails plainly instead of sending the standard body", async () => {
    const db = world({ map: null });
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" });
    expect(r).toMatchObject({ state: "failed" });
    expect((r as { headline: string }).headline).toMatch(/mapping was not found/);
    expect(calls).toHaveLength(0);
  });

  it("a mapping saved by another workspace under the same connection id is never used", async () => {
    const db = world({ map: mapping(T2) });
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" });
    expect(r.state).toBe("failed");
    expect(calls).toHaveLength(0);
  });

  it("personal data of the customer is not in the record unless the webhook allows it", async () => {
    const m = mapping();
    (m.doc as { header: unknown[] }).header.push(row("h9", "mail", "account.email"));
    const db = world({ map: m });
    await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" });
    expect(JSON.parse(calls[0].body)).not.toHaveProperty("mail");
  });
});

describe("choosing the mapping on the webhook", () => {
  it("payload mode mapping needs a saved mapping for THIS webhook, and takes the active one", async () => {
    const db = world({ hookOver: { payload_mode: "standard", mapping_id: null } });
    const ok = await updateWebhook(db.client, T1, WH, { payload_mode: "mapping" });
    expect(ok).toMatchObject({ ok: true });
    expect(db.tables.webhooks[0]).toMatchObject({ payload_mode: "mapping", mapping_id: "m-1" });
    const none = world({ map: null, hookOver: { payload_mode: "standard", mapping_id: null } });
    const r = await updateWebhook(none.client, T1, WH, { payload_mode: "mapping" });
    expect(r).toMatchObject({ ok: false, status: 422 });
  });

  it("a mapping_id from the body is resolved against the tenant and the webhook; another's is refused", async () => {
    const db = world({ map: mapping(T2), hookOver: { payload_mode: "standard", mapping_id: null } });
    expect(await updateWebhook(db.client, T1, WH, { mapping_id: "m-1" })).toMatchObject({ ok: false, status: 422 });
    const other = world({ hookOver: { payload_mode: "standard", mapping_id: null } });
    (other.tables.integration_mappings[0] as Row).connection_id = "webhook:aaaaaaaa-aaaa-4aaa-8aaa-0000000000ff";
    expect(await updateWebhook(other.client, T1, WH, { mapping_id: "m-1" })).toMatchObject({ ok: false, status: 422 });
    expect(await updateWebhook(other.client, T1, WH, { mapping_id: "not-a-uuid" })).toMatchObject({ ok: false, status: 422 });
  });

  it("the response path is stored and listed; a webhook list still works without the new columns", async () => {
    const db = world();
    await updateWebhook(db.client, T1, WH, { response_key_path: "$.id" });
    expect(db.tables.webhooks[0].response_key_path).toBe("$.id");
    const list = await listLibrary(db.client, T1);
    expect(list.ok && list.value.webhooks[0]).toMatchObject({ mapping_id: "m-1", response_key_path: "$.id", payload_mode: "mapping" });
    expect(JSON.stringify(list)).not.toMatch(/k-123|whsec_x|enc:v1/);
  });
});
