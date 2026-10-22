import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.FIELD_ENCRYPTION_KEY = "cd".repeat(32); });
vi.mock("node:dns/promises", () => ({ lookup: async (host: string) => (host === "internal.example.com" ? [{ address: "10.1.2.3", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]) }));

import { unsealSecret } from "@/lib/encryption";
import { fakeAdmin, seedMiddleware, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { saveDocument } from "@/lib/middleware/ops";
import {
  changeEntries, createWebhook, deleteWebhook, listLibrary, mergeHeaders, resolveCoverageWebhook, updateWebhook, usedByMap, verifyCallWebhook,
} from "./library";
import type { StoredHeader, WebhookRow } from "./validate";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const U = "u-1";
const world = (extra: Record<string, Row[]> = {}) => fakeAdmin({
  tenants: [
    { id: T1, name: "Acme", features: { webhooks_library: true, integration_middleware: true }, config: {} },
    { id: T2, name: "Other", features: { webhooks_library: true }, config: {} },
  ],
  webhooks: [], change_log: [], coverages: [], accounts: [], ...extra,
});
const call = { kind: "call", name: "ERP push", url: "https://erp.example.com/in", object_type: "accounts", headers: [{ name: "Authorization", value: "Bearer tok-1" }] };

describe("create", () => {
  it("seals the signing secret and header values, returns the secret once and 'set' forever after", async () => {
    const db = world();
    const r = await createWebhook(db.client, T1, U, call);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(r.value.webhook.secret).toBe("set");
    expect(JSON.stringify(r.value.webhook)).not.toContain(r.value.secret);
    expect(JSON.stringify(r.value.webhook)).not.toContain("tok-1");
    const stored = db.tables.webhooks[0];
    expect(stored.tenant_id).toBe(T1);
    expect(String(stored.secret)).toMatch(/^enc:v1:/);
    expect(unsealSecret(String(stored.secret))).toBe(r.value.secret);
    const h = (stored.headers as StoredHeader[])[0];
    expect(h.value).toMatch(/^enc:v1:/);
    expect(unsealSecret(h.value)).toBe("Bearer tok-1");

    const list = await listLibrary(db.client, T1);
    expect(list.ok && JSON.stringify(list.value)).not.toContain("tok-1");
    expect(list.ok && JSON.stringify(list.value)).not.toContain(r.value.secret);
  });

  it("refuses a private address, a name already used and a token in the host", async () => {
    const db = world();
    const bad = await createWebhook(db.client, T1, U, { ...call, url: "https://internal.example.com/in" });
    expect(bad).toMatchObject({ ok: false, status: 422 });
    expect(await createWebhook(db.client, T1, U, { ...call, url: "https://10.0.0.1/in" })).toMatchObject({ ok: false, status: 422 });
    expect(await createWebhook(db.client, T1, U, { ...call, url: "https://localhost/in" })).toMatchObject({ ok: false, status: 422 });
    expect(await createWebhook(db.client, T1, U, { ...call, url: "http://erp.example.com/in" })).toMatchObject({ ok: false, status: 422 });
    expect(db.tables.webhooks).toHaveLength(0);
    expect((await createWebhook(db.client, T1, U, call)).ok).toBe(true);
    expect(await createWebhook(db.client, T1, U, { ...call, name: "erp PUSH" })).toMatchObject({ ok: false, status: 422 });
    // The same name in another workspace is fine.
    expect((await createWebhook(db.client, T2, U, call)).ok).toBe(true);
  });

  it("takes the tenant from the caller, never from the body", async () => {
    const db = world();
    const r = await createWebhook(db.client, T1, U, { ...call, tenant_id: T2 });
    expect(r).toMatchObject({ ok: false, status: 422 });
    const ok = await createWebhook(db.client, T1, U, call);
    expect(ok.ok && db.tables.webhooks[0].tenant_id).toBe(T1);
  });

  it("an event webhook starts at the tip of the change feed", async () => {
    const db = world({ change_log: [{ id: "c-9", tenant_id: T1, created_at: "2026-10-20T00:00:00Z" }] });
    const r = await createWebhook(db.client, T1, U, { kind: "event", name: "Feed", url: "https://dw.example.com/in" });
    expect(r.ok).toBe(true);
    expect(db.tables.webhooks[0]).toMatchObject({ kind: "event", cursor_id: "c-9", object_types: ["*"] });
  });

  it("button_on makes it the Accounts button", async () => {
    const db = world();
    const r = await createWebhook(db.client, T1, U, { ...call, button_on: "accounts" });
    expect(r.ok).toBe(true);
    const cfg = db.tables.tenants.find((t) => t.id === T1)!.config as { webhooks_library?: { record_buttons?: { accounts?: string } } };
    expect(cfg.webhooks_library?.record_buttons?.accounts).toBe(db.tables.webhooks[0].id);
  });

  it("answers 'pending' while the migration is not applied", async () => {
    const db = fakeAdmin({ tenants: [] }, { missing: ["webhooks"] });
    expect(await createWebhook(db.client, T1, U, call)).toMatchObject({ ok: false, pending: true });
    expect(await listLibrary(db.client, T1)).toMatchObject({ ok: false, pending: true });
  });
});

describe("update", () => {
  const made = async () => {
    const db = world();
    const r = await createWebhook(db.client, T1, U, call);
    if (!r.ok) throw new Error("create failed");
    return { db, id: r.value.webhook.id, secret: r.value.secret };
  };

  it("keeps a header whose value is blank, replaces one with text and drops one that is left out", async () => {
    const { db, id } = await made();
    const keep = await updateWebhook(db.client, T1, id, { headers: [{ name: "Authorization", value: "" }, { name: "X-Extra", value: "new" }] });
    expect(keep.ok).toBe(true);
    const stored = db.tables.webhooks[0].headers as StoredHeader[];
    expect(stored.map((h) => h.name)).toEqual(["Authorization", "X-Extra"]);
    expect(unsealSecret(stored[0].value)).toBe("Bearer tok-1");
    expect(unsealSecret(stored[1].value)).toBe("new");
    const drop = await updateWebhook(db.client, T1, id, { headers: [{ name: "X-Extra", value: "" }] });
    expect(drop.ok && (db.tables.webhooks[0].headers as StoredHeader[]).map((h) => h.name)).toEqual(["X-Extra"]);
    const unknown = await updateWebhook(db.client, T1, id, { headers: [{ name: "X-Never", value: "" }] });
    expect(unknown).toMatchObject({ ok: false, status: 422 });
  });

  it("regenerating returns a new secret once and seals it", async () => {
    const { db, id, secret } = await made();
    const r = await updateWebhook(db.client, T1, id, { regenerate_secret: true });
    expect(r.ok && r.value.secret).toBeTruthy();
    if (!r.ok || !r.value.secret) return;
    expect(r.value.secret).not.toBe(secret);
    expect(unsealSecret(String(db.tables.webhooks[0].secret))).toBe(r.value.secret);
    expect(JSON.stringify(r.value.webhook)).not.toContain(r.value.secret);
  });

  it("another workspace's id is not found, and cannot be changed", async () => {
    const { db, id } = await made();
    expect(await updateWebhook(db.client, T2, id, { name: "Hijacked" })).toMatchObject({ ok: false, status: 404 });
    expect(db.tables.webhooks[0].name).toBe("ERP push");
  });

  it("switching a paused webhook on resets the counter and the reason", async () => {
    const { db, id } = await made();
    Object.assign(db.tables.webhooks[0], { active: false, failure_count: 15, paused_reason: "Paused after 15 failures" });
    const r = await updateWebhook(db.client, T1, id, { active: true });
    expect(r.ok).toBe(true);
    expect(db.tables.webhooks[0]).toMatchObject({ active: true, failure_count: 0, paused_reason: null });
  });

  it("the change-log diff never carries a secret or a header value", async () => {
    const { db, id } = await made();
    const r = await updateWebhook(db.client, T1, id, { name: "Renamed", headers: [{ name: "Authorization", value: "Bearer other" }], regenerate_secret: true });
    if (!r.ok) throw new Error("update failed");
    const entries = changeEntries(r.value.before, r.value.patch);
    const text = JSON.stringify(entries);
    expect(entries.map((e) => e.field)).toEqual(expect.arrayContaining(["name", "signing secret"]));
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("enc:v1:");
    expect(text).not.toContain("whsec_");
  });

  it("the change-log diff shows host and path of an address, never its query", async () => {
    const { db, id } = await made();
    const r = await updateWebhook(db.client, T1, id, { url: "https://erp.example.com/in/v2?region=gcc&page=2" });
    if (!r.ok) throw new Error("update failed");
    const entries = changeEntries(r.value.before, r.value.patch);
    expect(entries).toEqual([{ field: "url", from: "https://erp.example.com/in", to: "https://erp.example.com/in/v2" }]);
    const same = changeEntries({ ...r.value.before, url: "https://erp.example.com/in?x=1" }, { url: "https://erp.example.com/in?x=2" });
    expect(JSON.stringify(same)).not.toContain("x=");
    expect(same[0].to).toMatch(/address changed/);
  });
});

describe("references are tenant-verified", () => {
  const seedTwo = async () => {
    const db = world();
    const a = await createWebhook(db.client, T1, U, call);
    const b = await createWebhook(db.client, T2, U, call);
    const q = await createWebhook(db.client, T1, U, { ...call, name: "Quote hook", object_type: "standard_quotes" });
    const ev = await createWebhook(db.client, T1, U, { kind: "event", name: "Feed", url: "https://dw.example.com/in" });
    if (!a.ok || !b.ok || !q.ok || !ev.ok) throw new Error("seed failed");
    return { db, own: a.value.webhook.id, foreign: b.value.webhook.id, quote: q.value.webhook.id, event: ev.value.webhook.id };
  };

  it("verifyCallWebhook accepts only a Call webhook of this tenant for this object", async () => {
    const { db, own, foreign, quote, event } = await seedTwo();
    expect(await verifyCallWebhook(db.client, T1, own, "accounts")).toMatchObject({ id: own });
    expect(await verifyCallWebhook(db.client, T1, foreign, "accounts")).toBeNull();
    expect(await verifyCallWebhook(db.client, T1, quote, "accounts")).toBeNull();
    expect(await verifyCallWebhook(db.client, T1, event, "accounts")).toBeNull();
    expect(await verifyCallWebhook(db.client, T1, 42, "accounts")).toBeNull();
    expect(await verifyCallWebhook(db.client, T1, null, "accounts")).toBeNull();
  });

  it("a Coverage row can name only an Accounts Call webhook of its own workspace", async () => {
    const { db, own, foreign, quote } = await seedTwo();
    expect(await resolveCoverageWebhook(db.client, T1, own)).toEqual({ ok: true, value: own });
    expect(await resolveCoverageWebhook(db.client, T1, null)).toEqual({ ok: true, value: null });
    expect(await resolveCoverageWebhook(db.client, T1, foreign)).toMatchObject({ ok: false });
    expect(await resolveCoverageWebhook(db.client, T1, quote)).toMatchObject({ ok: false });
  });

  it("without the flag a Coverage row cannot name a webhook at all", async () => {
    const { db, own } = await seedTwo();
    db.tables.tenants.find((t) => t.id === T1)!.features = {};
    expect(await resolveCoverageWebhook(db.client, T1, own)).toMatchObject({ ok: false });
  });

  it("the Quote link refuses a foreign, wrong-object or event webhook and stores a good one", async () => {
    const { db, own, foreign, quote, event } = await seedTwo();
    db.tables.tenants.find((t) => t.id === T1)!.features = { webhooks_library: true, integration_middleware: true, standard_quotes: true };
    for (const bad of [foreign, own, event, "not-a-guid"]) {
      const r = await saveDocument(db.client, T1, { target: "webhook", webhook_id: bad });
      expect(r.ok, String(bad)).toBe(false);
    }
    expect((await saveDocument(db.client, T1, { target: "webhook" })).ok).toBe(false);
    const good = await saveDocument(db.client, T1, { target: "webhook", webhook_id: quote });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.document).toMatchObject({ target: { key: "webhook" }, webhookId: quote, summary: "Awarded → Webhook: Quote hook" });
    const cfg = db.tables.tenants.find((t) => t.id === T1)!.config as { integration_middleware: { documents: { quote: { target: string; webhook_id: string } } } };
    expect(cfg.integration_middleware.documents.quote).toMatchObject({ target: "webhook", webhook_id: quote });
  });

  it("the Quote link does not offer a webhook to a workspace without the library", async () => {
    const db = fakeAdmin(seedMiddleware());
    const r = await saveDocument(db.client, T1, { target: "webhook", webhook_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001" });
    expect(r.ok).toBe(false);
  });

  it("delete is refused while a Link, a Coverage row or a button uses it, and names the user", async () => {
    const { db, own, quote } = await seedTwo();
    const cfgRow = db.tables.tenants.find((t) => t.id === T1)!;
    cfgRow.config = { webhooks_library: { record_buttons: { accounts: own } }, integration_middleware: { documents: { quote: { target: "webhook", webhook_id: quote } } } };
    db.tables.coverages.push({ id: "cv-1", tenant_id: T1, role: "owner", webhook_id: own, teams: { name: "EU team" } });
    const used = await usedByMap(db.client, T1, cfgRow.config as never);
    expect(used.get(own)?.map((u) => u.label)).toEqual(["Button: Accounts", "Coverage: EU team"]);
    expect(used.get(quote)?.map((u) => u.label)).toEqual(["Links: Quote"]);
    const refused = await deleteWebhook(db.client, T1, own);
    expect(refused).toMatchObject({ ok: false, status: 409 });
    expect(db.tables.webhooks.some((w) => w.id === own)).toBe(true);
    cfgRow.config = {};
    db.tables.coverages.length = 0;
    expect((await deleteWebhook(db.client, T1, own)).ok).toBe(true);
    expect(await deleteWebhook(db.client, T1, own)).toMatchObject({ ok: false, status: 404 });
  });

  it("delete cannot reach another workspace's webhook", async () => {
    const { db, foreign } = await seedTwo();
    expect(await deleteWebhook(db.client, T1, foreign)).toMatchObject({ ok: false, status: 404 });
    expect(db.tables.webhooks.some((w) => w.id === foreign)).toBe(true);
  });
});

describe("mergeHeaders", () => {
  it("is case-insensitive when keeping, and refuses a blank value for a new header", () => {
    const stored: StoredHeader[] = [{ name: "Authorization", value: "enc:v1:x" }];
    expect(mergeHeaders([{ name: "authorization", value: null }], stored)).toEqual({ ok: true, value: [{ name: "authorization", value: "enc:v1:x" }] });
    expect(mergeHeaders([{ name: "New", value: null }], stored).ok).toBe(false);
  });
});

describe("list", () => {
  it("returns only this workspace's webhooks, with the shape the screen reads", async () => {
    const db = world();
    await createWebhook(db.client, T1, U, call);
    await createWebhook(db.client, T2, U, { ...call, name: "Theirs" });
    const r = await listLibrary(db.client, T1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.webhooks.map((w) => w.name)).toEqual(["ERP push"]);
    expect(r.value.objects.map((o) => o.key)).toEqual(["accounts", "standard_quotes"]);
    expect(r.value.recordButtons).toEqual({ accounts: null });
    const w: WebhookRow | undefined = undefined;
    void w;
  });
});
