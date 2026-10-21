import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = vi.hoisted(() => {
  process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);
  return "ab".repeat(32);
});

import { sealSecret } from "@/lib/encryption";
import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { fireWebhook, idempotencyKey, previewWebhook, type FireDeps } from "./sender";

void KEY;
const SECRET = "whsec_plainsecret";
const HEADER_VALUE = "Bearer tok-9999";
const WH = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const ACC = "acc-1";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const hook = (over: Row = {}): Row => ({
  id: WH, tenant_id: T1, kind: "call", name: "ERP push", url: "https://erp.example.com/in", secret: sealSecret(SECRET), method: "POST", object_type: "accounts",
  object_types: ["*"], headers: [{ name: "Authorization", value: sealSecret(HEADER_VALUE) }], payload_mode: "standard", template: null, allow_personal_data: false,
  timeout_ms: 15000, active: true, paused_reason: null, last_delivery_at: null, last_status: null, last_error: null, failure_count: 0, legacy_key: null,
  created_at: "2026-10-21T00:00:00Z", updated_at: null, ...over,
});

const world = (over: { hook?: Row; demo?: boolean; extra?: Record<string, Row[]> } = {}) => fakeAdmin({
  tenants: [{ id: T1, name: "Acme", custom_domain: "acme.example.com", is_demo: over.demo === true, features: { webhooks_library: true }, config: {} }],
  accounts: [
    { id: ACC, tenant_id: T1, ref: "ACC-0001", name: "A. Datum", city: "Doha", email: "pat@example.com", custom_data: { cf_region: "GCC", other: "x" } },
    { id: "acc-other", tenant_id: T2, ref: "ACC-9", name: "Other tenant" },
  ],
  webhooks: [hook(over.hook)],
  integration_messages: [],
  connector_links: [],
  ...(over.extra ?? {}),
});

const res = (status: number, body = "{}") => new Response(body, { status });
const deps = (f: (u: string, init: RequestInit) => Promise<Response>): FireDeps & { calls: { url: string; init: RequestInit }[]; slept: number[] } => {
  const calls: { url: string; init: RequestInit }[] = [];
  const slept: number[] = [];
  return { calls, slept, fetch: async (u, init) => { calls.push({ url: u, init }); return f(u, init); }, sleep: async (ms) => { slept.push(ms); }, now: () => 1_700_000_000_000 };
};
const input = (over: Partial<Parameters<typeof fireWebhook>[1]> = {}) => ({ tenantId: T1, webhookId: WH, objectType: "accounts", objectId: ACC, trigger: "button" as const, ...over });
const header = (c: { init: RequestInit }, name: string) => (c.init.headers as Record<string, string>)[name];

describe("a successful call", () => {
  it("posts the signed standard body and leaves one ok Monitor row", async () => {
    const db = world();
    const d = deps(async () => res(200, '{"id":"erp-1"}'));
    const r = await fireWebhook(db.client, input(), d);
    expect(r).toMatchObject({ ok: true, status: 200, headline: "Sent (HTTP 200)." });
    expect(d.calls).toHaveLength(1);
    const c = d.calls[0];
    expect(c.url).toBe("https://erp.example.com/in");
    expect(c.init.method).toBe("POST");
    expect(header(c, "Content-Type")).toBe("application/json");
    expect(header(c, "X-BPMSquare-Signature")).toBe(createHmac("sha256", SECRET).update(String(c.init.body)).digest("hex"));
    expect(header(c, "X-BPMSquare-Event")).toBe("account.pushed");
    expect(header(c, "X-BPMSquare-Timestamp")).toBe("1700000000");
    expect(header(c, "X-BPMSquare-Delivery")).toMatch(/^[0-9a-f-]{36}$/);
    expect(header(c, "Authorization")).toBe(HEADER_VALUE);
    const body = JSON.parse(String(c.init.body));
    expect(body).toMatchObject({ event: "account.pushed", workspace: "Acme", record: { id: ACC, ref: "ACC-0001", name: "A. Datum", custom: { cf_region: "GCC" } } });
    expect(body.record.email).toBeUndefined();

    const rows = db.tables.integration_messages;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: T1, channel: "webhook", direction: "out", status: "ok", http_status: 200, object_type: "accounts", object_id: ACC, ref_label: "ACC-0001", webhook_id: WH });
    expect(rows[0].summary).toMatchObject({ kind: "webhook_call", webhook: "ERP push", trigger: "button" });
    expect(db.tables.webhooks[0]).toMatchObject({ last_status: 200, last_error: null, failure_count: 0 });
  });

  it("never stores the signing secret, a header value or any header in the Monitor", async () => {
    const db = world();
    await fireWebhook(db.client, input(), deps(async () => res(200, '{"token":"abc","ok":true}')));
    const stored = JSON.stringify(db.tables.integration_messages);
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain("tok-9999");
    expect(stored).not.toContain("enc:v1:");
    const payload = db.tables.integration_messages[0].payload as { request: Record<string, unknown> };
    expect(payload.request).not.toHaveProperty("headers");
  });

  it("sends personal data only when the webhook allows it", async () => {
    const off = deps(async () => res(200));
    await fireWebhook(world().client, input(), off);
    expect(String(off.calls[0].init.body)).not.toContain("pat@example.com");
    const on = deps(async () => res(200));
    await fireWebhook(world({ hook: { allow_personal_data: true } }).client, input(), on);
    expect(JSON.parse(String(on.calls[0].init.body)).record.email).toBe("pat@example.com");
  });

  it("a template webhook renders its own JSON, with tokens in the address", async () => {
    const d = deps(async () => res(200));
    const db = world({ hook: { url: "https://erp.example.com/a/{{account.ref}}", payload_mode: "template", template: '{"customer":"{{account.name}}","city":"{{account.city}}"}' } });
    await fireWebhook(db.client, input(), d);
    expect(d.calls[0].url).toBe("https://erp.example.com/a/ACC-0001");
    expect(JSON.parse(String(d.calls[0].init.body))).toEqual({ customer: "A. Datum", city: "Doha" });
  });

  it("GET sends no body and signs the empty string", async () => {
    const d = deps(async () => res(200));
    await fireWebhook(world({ hook: { method: "GET" } }).client, input(), d);
    const c = d.calls[0];
    expect(c.init.body).toBeUndefined();
    expect(header(c, "Content-Type")).toBeUndefined();
    expect(header(c, "X-BPMSquare-Signature")).toBe(createHmac("sha256", SECRET).update("").digest("hex"));
  });
});

describe("failures and retries", () => {
  it("a 4xx is not retried and is a failed row with a plain line", async () => {
    const db = world();
    const d = deps(async () => res(401));
    const r = await fireWebhook(db.client, input(), d);
    expect(d.calls).toHaveLength(1);
    expect(r.ok).toBe(false);
    expect(r.headline).toContain("refused");
    expect(db.tables.integration_messages[0]).toMatchObject({ status: "failed", http_status: 401 });
    expect(db.tables.webhooks[0]).toMatchObject({ failure_count: 1, last_status: 401 });
  });

  it("a 5xx is tried once more after 2 seconds, then fails", async () => {
    const d = deps(async () => res(503));
    const db = world();
    const r = await fireWebhook(db.client, input(), d);
    expect(d.calls).toHaveLength(2);
    expect(d.slept).toEqual([2000]);
    expect(r.ok).toBe(false);
    expect(db.tables.integration_messages).toHaveLength(1);
  });

  it("a 5xx then a 2xx counts as one success", async () => {
    let n = 0;
    const d = deps(async () => (++n === 1 ? res(500) : res(200)));
    const db = world();
    const r = await fireWebhook(db.client, input(), d);
    expect(r.ok).toBe(true);
    expect(d.calls).toHaveLength(2);
    expect(db.tables.integration_messages).toHaveLength(1);
    expect(db.tables.integration_messages[0].status).toBe("ok");
  });

  it("a 429 is retried; a network error is retried once and a timeout is named", async () => {
    const d1 = deps(async () => res(429));
    await fireWebhook(world().client, input(), d1);
    expect(d1.calls).toHaveLength(2);

    const d2 = deps(async () => { throw Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }); });
    const r = await fireWebhook(world().client, input(), d2);
    expect(d2.calls).toHaveLength(2);
    expect(r.headline).toBe("The receiver did not answer in time.");
  });

  it("pauses itself at the 15th consecutive failure and then skips", async () => {
    const db = world({ hook: { failure_count: 14 } });
    const d = deps(async () => res(500));
    await fireWebhook(db.client, input(), d);
    expect(db.tables.webhooks[0]).toMatchObject({ failure_count: 15, active: false, paused_reason: "Paused after 15 failures" });

    const again = deps(async () => res(200));
    const r = await fireWebhook(db.client, input(), again);
    expect(again.calls).toHaveLength(0);
    expect(r.ok).toBe(false);
    expect(r.headline).toBe("Paused after 15 failures");
  });

  it("a test never moves the counter or pauses the webhook", async () => {
    const db = world({ hook: { failure_count: 14 } });
    await fireWebhook(db.client, input({ trigger: "test" }), deps(async () => res(500)));
    expect(db.tables.webhooks[0]).toMatchObject({ failure_count: 14, active: true });
  });

  it("a switched-off webhook sends nothing and says so", async () => {
    const d = deps(async () => res(200));
    const r = await fireWebhook(world({ hook: { active: false } }).client, input(), d);
    expect(d.calls).toHaveLength(0);
    expect(r).toMatchObject({ ok: false, skipped: true });
  });

  it("a later success settles the earlier failed rows of the same record", async () => {
    const db = world();
    await fireWebhook(db.client, input(), deps(async () => res(400)));
    expect(db.tables.integration_messages[0].status).toBe("failed");
    await fireWebhook(db.client, input(), deps(async () => res(200)));
    expect(db.tables.integration_messages.map((m) => m.status)).toEqual(["skipped", "ok"]);
  });
});

describe("what it refuses to send", () => {
  it("a migrated http:// address does not fire until it is edited to https", async () => {
    const d = deps(async () => res(200));
    const db = world({ hook: { url: "http://erp.example.com/in" } });
    const r = await fireWebhook(db.client, input(), d);
    expect(d.calls).toHaveLength(0);
    expect(r.headline).toMatch(/https/);
    expect(db.tables.integration_messages[0]).toMatchObject({ status: "failed" });
  });

  it("another workspace's webhook id fires nothing and says not found", async () => {
    const d = deps(async () => res(200));
    const db = world({ hook: { tenant_id: T2 } });
    const r = await fireWebhook(db.client, input(), d);
    expect(d.calls).toHaveLength(0);
    expect(r.headline).toBe("That webhook was not found.");
    expect(db.tables.integration_messages[0]).toMatchObject({ tenant_id: T1 });
    expect(db.tables.integration_messages[0].webhook_id ?? null).toBeNull();
  });

  it("another workspace's record is never loaded, whatever the id", async () => {
    const d = deps(async () => res(200));
    const r = await fireWebhook(world().client, input({ objectId: "acc-other" }), d);
    expect(d.calls).toHaveLength(0);
    expect(r.headline).toBe("That record was not found.");
  });

  it("a webhook for another object type is not used", async () => {
    const d = deps(async () => res(200));
    const r = await fireWebhook(world().client, input({ objectType: "standard_quotes", objectId: "q-1" }), d);
    expect(d.calls).toHaveLength(0);
    expect(r.ok).toBe(false);
  });

  it("an Event webhook is never fired by a record", async () => {
    const d = deps(async () => res(200));
    const r = await fireWebhook(world({ hook: { kind: "event", object_type: null } }).client, input(), d);
    expect(d.calls).toHaveLength(0);
    expect(r.headline).toBe("That is an Event webhook.");
  });

  it("a demo workspace records 'redirected' and sends nothing", async () => {
    const d = deps(async () => res(200));
    const db = world({ demo: true });
    const r = await fireWebhook(db.client, input(), d);
    expect(d.calls).toHaveLength(0);
    expect(r).toMatchObject({ ok: true, redirected: true });
    expect(db.tables.integration_messages[0].status).toBe("redirected");
  });

  it("a private address stored in the row is refused by the real sender without a retry", async () => {
    const fetchSpy = vi.fn(async () => res(200));
    vi.stubGlobal("fetch", fetchSpy);
    const db = world({ hook: { url: "https://10.0.0.1/hook" } });
    const r = await fireWebhook(db.client, input(), { sleep: async () => {} });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.headline).toBe("That address points at a private or internal network.");
  });

  it("an IPv4-mapped IPv6 loopback and the metadata address are refused too", async () => {
    const fetchSpy = vi.fn(async () => res(200));
    vi.stubGlobal("fetch", fetchSpy);
    for (const url of ["https://[::ffff:127.0.0.1]/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://192.168.1.5/x"]) {
      const r = await fireWebhook(world({ hook: { url } }).client, input(), { sleep: async () => {} });
      expect(r.ok, url).toBe(false);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a redirect from a public address to the metadata service is not followed", async () => {
    const fetchSpy = vi.fn(async (u: unknown) => (String(u).includes("93.184.216.34")
      ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } })
      : res(200, "secret")));
    vi.stubGlobal("fetch", fetchSpy);
    const r = await fireWebhook(world({ hook: { url: "https://93.184.216.34/hook" } }).client, input(), { sleep: async () => {} });
    expect(r.ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("idempotency", () => {
  it("is stable across a restart of the same firing and new for a new firing", async () => {
    const db = world();
    const first = deps(async () => res(400));
    const r1 = await fireWebhook(db.client, input({ trigger: "award" }), first);
    const k1 = header(first.calls[0], "X-BPMSquare-Idempotency-Key");
    expect(k1).toMatch(/^[0-9a-f]{64}$/);

    const restart = deps(async () => res(200));
    await fireWebhook(db.client, input({ trigger: "retry", retryOf: r1.messageId }), restart);
    expect(header(restart.calls[0], "X-BPMSquare-Idempotency-Key")).toBe(k1);

    const fresh = deps(async () => res(200));
    await fireWebhook(db.client, input({ trigger: "award" }), fresh);
    expect(header(fresh.calls[0], "X-BPMSquare-Idempotency-Key")).not.toBe(k1);
  });

  it("two attempts for the same failed record share a key even without the row id", async () => {
    const db = world();
    const a = deps(async () => res(400));
    await fireWebhook(db.client, input(), a);
    const b = deps(async () => res(400));
    await fireWebhook(db.client, input(), b);
    expect(header(b.calls[0], "X-BPMSquare-Idempotency-Key")).toBe(header(a.calls[0], "X-BPMSquare-Idempotency-Key"));
  });

  it("depends on the webhook, the record, the event and the origin", () => {
    const k = idempotencyKey("w", "o", "e", "x");
    expect(idempotencyKey("w2", "o", "e", "x")).not.toBe(k);
    expect(idempotencyKey("w", "o2", "e", "x")).not.toBe(k);
    expect(idempotencyKey("w", "o", "e2", "x")).not.toBe(k);
    expect(idempotencyKey("w", "o", "e", "y")).not.toBe(k);
    expect(idempotencyKey("w", "o", "e", "x")).toBe(k);
  });
});

describe("pending schema", () => {
  it("answers needsDatabaseUpdate, records nothing and sends nothing", async () => {
    const db = fakeAdmin({ tenants: [{ id: T1, name: "Acme", features: {}, config: {} }] }, { missing: ["webhooks"] });
    const d = deps(async () => res(200));
    const r = await fireWebhook(db.client, input(), d);
    expect(r).toMatchObject({ ok: false, needsDatabaseUpdate: true });
    expect(d.calls).toHaveLength(0);
    expect(db.tables.integration_messages ?? []).toHaveLength(0);
  });
});

describe("preview", () => {
  it("shows the request without sending or recording, and never a header value", async () => {
    const db = world();
    const p = await previewWebhook(db.client, { tenantId: T1, webhookId: WH, objectType: "accounts", objectId: ACC });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.request.headers).toEqual(expect.arrayContaining(["Authorization", "X-BPMSquare-Signature", "X-BPMSquare-Idempotency-Key"]));
    expect(JSON.stringify(p)).not.toContain("tok-9999");
    expect(db.tables.integration_messages).toHaveLength(0);
  });

  it("refuses another workspace's webhook", async () => {
    const db = world({ hook: { tenant_id: T2 } });
    const p = await previewWebhook(db.client, { tenantId: T1, webhookId: WH, objectType: "accounts", objectId: ACC });
    expect(p.ok).toBe(false);
  });
});
