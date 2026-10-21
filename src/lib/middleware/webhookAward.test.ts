import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.FIELD_ENCRYPTION_KEY = "ef".repeat(32); });
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {}, logChange: async () => {} }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: null }) }));

import { sealSecret } from "@/lib/encryption";
import { sendAccountViaWebhook } from "@/lib/webhooks/recordSend";
import { dispatchQuoteOutcome, previewQuoteOutcome } from "./dispatch";
import { classifyIntegrationRow } from "./monitorRows";
import { sendRecord } from "./ops";
import { restartMessages } from "./restart";
import { fakeAdmin, seedMiddleware, T1, T2, type Row } from "./testHarness";

const WH = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const URL_ = "https://erp.example.com/hooks/quote";

let calls: { url: string; method: string; body: string }[] = [];
let respond: () => Response = () => new Response("{}", { status: 200 });

beforeEach(() => {
  calls = [];
  respond = () => new Response('{"ok":true}', { status: 200 });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (u: unknown, init?: RequestInit) => {
    calls.push({ url: String(u), method: String(init?.method), body: String(init?.body ?? "") });
    return respond();
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const hook = (over: Row = {}): Row => ({
  id: WH, tenant_id: T1, kind: "call", name: "Quote hook", url: URL_, secret: sealSecret("whsec_x"), method: "POST", object_type: "standard_quotes", object_types: ["*"],
  headers: [], payload_mode: "standard", template: null, allow_personal_data: false, timeout_ms: 15000, active: true, paused_reason: null,
  last_delivery_at: null, last_status: null, last_error: null, failure_count: 0, legacy_key: null, created_at: "2026-10-21T00:00:00Z", updated_at: null, ...over,
});

const docConfig = (over: Record<string, unknown> = {}) => ({
  documents: { quote: { enabled: true, when: { awarded: true, rejected: false }, mode: "auto", target: "webhook", webhook_id: WH, include: {}, confirmed_at: null, ...over } },
});

const world = (o: { features?: Record<string, boolean>; hook?: Row; noErp?: boolean; doc?: Record<string, unknown>; extra?: Record<string, Row[]> } = {}) => {
  const seed = seedMiddleware({ features: { webhooks_library: true, ...(o.features ?? {}) }, mwConfig: docConfig(o.doc) });
  if (o.noErp) seed.tenant_connectors = [];
  return fakeAdmin({ ...seed, webhooks: [hook(o.hook)], ...(o.extra ?? {}) });
};
const msgs = (db: { tables: Record<string, Row[]> }) => db.tables.integration_messages;
const webhookLinks = (db: { tables: Record<string, Row[]> }) => db.tables.connector_links.filter((l) => String(l.connector_id).startsWith("webhook:"));

describe("an awarded quote whose Links target is a webhook", () => {
  it("fires once, without any ERP connected, and records a webhook row and a claim", async () => {
    const db = world({ noErp: true });
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" });
    expect(r).toMatchObject({ state: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: URL_, method: "POST" });
    expect(JSON.parse(calls[0].body).record).toMatchObject({ id: "q-1", ref: "SQ-0001", total: 143.75 });
    expect(msgs(db)).toHaveLength(1);
    expect(msgs(db)[0]).toMatchObject({ channel: "webhook", status: "ok", object_type: "standard_quotes", object_id: "q-1", webhook_id: WH });
    expect(msgs(db)[0].summary).toMatchObject({ kind: "webhook_call", trigger: "award", outcome: "awarded" });
    expect(webhookLinks(db)).toHaveLength(1);
    expect(webhookLinks(db)[0]).toMatchObject({ connector_id: `webhook:${WH}`, entity: "standard_quotes", object_id: "q-1", direction: "push", external_key: null });
    expect(String(webhookLinks(db)[0].external_id)).toMatch(/^delivery:/);
  });

  it("Send now, auto and a double press never fire the same quote twice", async () => {
    const db = world();
    expect(await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" })).toMatchObject({ state: "sent" });
    expect(await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "send_now" })).toMatchObject({ state: "already_sent" });
    expect(await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "retry" })).toMatchObject({ state: "already_sent" });
    expect(calls).toHaveLength(1);
    expect(msgs(db)).toHaveLength(1);
  });

  it("two overlapping sends make exactly one call", async () => {
    const db = world();
    const [a, b] = await Promise.all([
      dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" }),
      dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "send_now" }),
    ]);
    expect([a.state, b.state].sort()).toEqual(["in_progress", "sent"]);
    expect(calls).toHaveLength(1);
  });

  it("a failure gives the claim back and Restart sends it again once, with the same idempotency key", async () => {
    const db = world();
    respond = () => new Response("nope", { status: 400 });
    const keys: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: unknown, init?: RequestInit) => {
      calls.push({ url: String(u), method: String(init?.method), body: String(init?.body ?? "") });
      keys.push((init?.headers as Headers).get("x-bpmsquare-idempotency-key") ?? "");
      return respond();
    }));
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" });
    expect(r).toMatchObject({ state: "failed" });
    expect(webhookLinks(db)).toHaveLength(0);
    expect(msgs(db)[0]).toMatchObject({ status: "failed", http_status: 400, webhook_id: WH });
    expect(classifyIntegrationRow(msgs(db)[0])).toBe("webhook_call");

    respond = () => new Response("{}", { status: 200 });
    const id = String(msgs(db)[0].id);
    const out = await restartMessages(db.client, T1, "u-1", { ids: [`integration:${id}`] });
    expect("results" in out && out.results[0]).toMatchObject({ outcome: "done" });
    expect(webhookLinks(db)).toHaveLength(1);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(msgs(db).map((m) => m.status)).toEqual(["skipped", "ok"]);

    const again = await restartMessages(db.client, T1, "u-1", { ids: [`integration:${id}`] });
    expect("results" in again && again.results[0].outcome).toBe("already_ok");
    expect(calls).toHaveLength(2);
  });

  it("a webhook id from another workspace fires nothing and says not found", async () => {
    const db = world({ hook: { tenant_id: T2 } });
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" });
    expect(r).toMatchObject({ state: "failed", headline: "That webhook was not found." });
    expect(calls).toHaveLength(0);
    expect(webhookLinks(db)).toHaveLength(0);
  });

  it("no webhook chosen is a plain failure, not a crash", async () => {
    const db = world({ doc: { webhook_id: null } });
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" });
    expect(r).toMatchObject({ state: "failed", headline: "No webhook is chosen." });
    expect(calls).toHaveLength(0);
  });

  it("a rejected quote never leaves", async () => {
    const seed = seedMiddleware({ features: { webhooks_library: true }, mwConfig: docConfig() });
    seed.standard_quotes[0].status = "rejected";
    const db = fakeAdmin({ ...seed, webhooks: [hook()] });
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "send_now" });
    expect(r.state).toBe("disabled");
    expect(calls).toHaveLength(0);
  });

  it("a workspace without the webhooks library ignores a stored webhook target and never calls it", async () => {
    const seed = seedMiddleware({ mwConfig: docConfig() });
    const db = fakeAdmin({ ...seed, webhooks: [hook()] });
    seed.tenant_connectors = [];
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" });
    expect(calls.filter((c) => c.url === URL_)).toHaveLength(0);
    expect(r.state).not.toBe("sent");
  });

  it("the preview of a webhook target points to the webhook's Test tab", async () => {
    const db = world();
    const r = await previewQuoteOutcome(db.client, T1, "q-1");
    expect(r).toMatchObject({ ok: false, state: "disabled" });
  });

  it("a demo workspace records 'redirected', sends nothing and leaves no claim behind", async () => {
    const seed = seedMiddleware({ features: { webhooks_library: true }, mwConfig: docConfig() });
    (seed.tenants[0] as Row).is_demo = true;
    const db = fakeAdmin({ ...seed, webhooks: [hook()] });
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto" });
    expect(r.state).toBe("skipped");
    expect(calls).toHaveLength(0);
    expect(msgs(db)[0].status).toBe("redirected");
    expect(webhookLinks(db)).toHaveLength(0);
  });
});

describe("Restart on webhook rows", () => {
  it("another workspace's row is not restartable and nothing is sent", async () => {
    const db = world({ extra: { integration_messages: [{ id: "00000000-0000-4000-8000-0000000000aa", tenant_id: T2, channel: "webhook", direction: "out", status: "failed", object_type: "standard_quotes", object_id: "q-1", webhook_id: WH, summary: { kind: "webhook_call", outcome: "awarded" } }] } });
    const r = await restartMessages(db.client, T1, "u-1", { ids: ["integration:00000000-0000-4000-8000-0000000000aa"] });
    expect("results" in r && r.results[0].outcome).toBe("not_restartable");
    expect(calls).toHaveLength(0);
  });

  it("a failed button call is fired again (not through the award claim)", async () => {
    const db = world({
      hook: { object_type: "accounts", url: "https://erp.example.com/acc" },
      extra: {
        integration_messages: [{ id: "00000000-0000-4000-8000-0000000000bb", tenant_id: T1, channel: "webhook", direction: "out", status: "failed", object_type: "accounts", object_id: "acc-1", webhook_id: WH, summary: { kind: "webhook_call", trigger: "button" } }],
      },
    });
    const r = await restartMessages(db.client, T1, "u-1", { ids: ["integration:00000000-0000-4000-8000-0000000000bb"] });
    expect("results" in r && r.results[0].outcome).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://erp.example.com/acc");
    expect(webhookLinks(db)).toHaveLength(0);
  });

  it("an OK row and a test-free paused webhook are not sent", async () => {
    const db = world({
      hook: { active: false, paused_reason: "Paused after 15 failures", object_type: "accounts" },
      extra: { integration_messages: [{ id: "00000000-0000-4000-8000-0000000000cc", tenant_id: T1, channel: "webhook", direction: "out", status: "failed", object_type: "accounts", object_id: "acc-1", webhook_id: WH, summary: { kind: "webhook_call", trigger: "button" } }] },
    });
    const r = await restartMessages(db.client, T1, "u-1", { ids: ["integration:00000000-0000-4000-8000-0000000000cc"] });
    expect("results" in r && r.results[0].outcome).toBe("failed");
    expect("results" in r && r.results[0].message).toContain("Paused after 15 failures");
    expect(calls).toHaveLength(0);
  });
});

describe("classifying Monitor rows", () => {
  it("a failed webhook call is restartable; an OK one and one without a record are not", () => {
    const base = { object_type: "accounts", object_id: "a-1", entity: "accounts", summary: { kind: "webhook_call" } };
    expect(classifyIntegrationRow({ ...base, status: "failed" })).toBe("webhook_call");
    expect(classifyIntegrationRow({ ...base, status: "ok" })).toBeNull();
    expect(classifyIntegrationRow({ ...base, status: "redirected" })).toBeNull();
    expect(classifyIntegrationRow({ ...base, status: "failed", object_id: null })).toBeNull();
  });

  it("a webhook award row is a webhook call, not an ERP document", () => {
    expect(classifyIntegrationRow({ object_type: "standard_quotes", object_id: "q-1", status: "failed", summary: { kind: "webhook_call", outcome: "awarded" } })).toBe("webhook_call");
    expect(classifyIntegrationRow({ object_type: "standard_quotes", object_id: "q-1", status: "failed", summary: { outcome: "awarded" } })).toBe("document");
  });
});

describe("the account button and Send a record", () => {
  const acctWorld = (o: { button?: string | null; hook?: Row; features?: Record<string, boolean> } = {}) => {
    const seed = seedMiddleware({ features: { webhooks_library: true, ...(o.features ?? {}) } });
    (seed.tenants[0] as Row).config = o.button === undefined ? { webhooks_library: { record_buttons: { accounts: WH } } } : { webhooks_library: { record_buttons: { accounts: o.button } } };
    return fakeAdmin({ ...seed, webhooks: [hook({ object_type: "accounts", url: "https://erp.example.com/acc", ...(o.hook ?? {}) })] });
  };

  it("sends the account to the record button's webhook and leaves a Monitor row", async () => {
    const db = acctWorld();
    const r = await sendAccountViaWebhook(db.client, T1, "u-1", "acc-1");
    expect(r).toMatchObject({ kind: "fired", webhookId: WH, result: { ok: true } });
    expect(calls).toHaveLength(1);
    expect(msgs(db)[0]).toMatchObject({ object_type: "accounts", object_id: "acc-1", webhook_id: WH });
    expect(msgs(db)[0].summary).toMatchObject({ trigger: "button" });
  });

  it("with no button set it says so and sends nothing", async () => {
    const r = await sendAccountViaWebhook(acctWorld({ button: null }).client, T1, "u-1", "acc-1");
    expect(r).toEqual({ kind: "none" });
    expect(calls).toHaveLength(0);
  });

  it("a button pointing at another workspace's webhook fires nothing", async () => {
    const db = acctWorld({ hook: { tenant_id: T2 } });
    const r = await sendAccountViaWebhook(db.client, T1, "u-1", "acc-1");
    expect(r).toMatchObject({ kind: "fired", result: { ok: false, headline: "That webhook was not found." } });
    expect(calls).toHaveLength(0);
  });

  it("an account of another workspace is not found", async () => {
    const db = acctWorld();
    db.tables.accounts.push({ id: "acc-x", tenant_id: T2, name: "Other" });
    expect(await sendAccountViaWebhook(db.client, T1, "u-1", "acc-x")).toEqual({ kind: "not_found" });
    expect(calls).toHaveLength(0);
  });

  it("the middleware 'Send a record' uses the same path, and an unflagged workspace keeps the old push", async () => {
    const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const db = acctWorld();
    db.tables.accounts.push({ id: ACC, tenant_id: T1, name: "Zed" });
    const ok = await sendRecord(db.client, T1, "u-1", "accounts", ACC);
    expect(ok).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    const none = await sendRecord(acctWorld({ button: null }).client, T1, "u-1", "accounts", ACC);
    expect(none).toMatchObject({ ok: false, status: 404 });
  });
});
