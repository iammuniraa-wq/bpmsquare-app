import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => (v ? `plain(${v})` : v) }));

import { listMessages, getMessageDetail, parseMessageId } from "./monitor";
import { SOURCES, decodeCursor, encodeCursor, compareNewest, matchesQuery } from "./monitorRows";
import { fakeAdmin, T1, T2, type Row } from "./testHarness";

const iso = (min: number) => new Date(Date.UTC(2026, 9, 21, 10, min, 0)).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function seed(): Record<string, Row[]> {
  return {
    integration_messages: [
      { id: id(1), tenant_id: T1, direction: "out", channel: "connector", connector_id: "dynamics365", entity: "quote", object_type: "standard_quotes", object_id: "q-1", ref_label: "SQ-0001", status: "failed", http_status: 403, error: "raw erp text", duration_ms: 800, correlation_id: null, summary: { outcome: "awarded", headline: "The connected app may not create quotes.", fix: "x" }, created_at: iso(50) },
      { id: id(2), tenant_id: T1, direction: "in", channel: "api", connector_id: null, entity: "accounts", object_type: null, object_id: null, ref_label: null, status: "ok", http_status: 200, error: null, duration_ms: null, correlation_id: null, summary: { method: "GET", path: "/api/v1/accounts" }, created_at: iso(40) },
      { id: id(3), tenant_id: T1, direction: "in", channel: "connector", connector_id: "dynamics365", entity: "customers", object_type: null, object_id: null, ref_label: null, status: "ok", http_status: null, error: null, duration_ms: 5000, correlation_id: id(31), summary: { kind: "connector_run", counts: { read: 6, created: 6, updated: 0, failed: 0 } }, created_at: iso(30) },
      { id: id(90), tenant_id: T2, direction: "out", channel: "connector", connector_id: "dynamics365", entity: "quote", object_type: "standard_quotes", object_id: "q-foreign", ref_label: "SQ-FOREIGN", status: "ok", http_status: null, error: null, duration_ms: null, correlation_id: null, summary: { headline: "foreign" }, created_at: iso(55) },
    ],
    email_log: [
      { id: id(11), tenant_id: T1, kind: "quote", to_email: "buyer@customer.example", subject: "Your quote SQ-0001", status: "sent", error: null, related_object_type: "standard_quotes", related_object_id: "q-1", related_object_label: "SQ-0001", created_at: iso(45) },
      { id: id(12), tenant_id: T2, kind: "quote", to_email: "other@x.example", subject: "Foreign", status: "sent", error: null, related_object_type: null, related_object_id: null, related_object_label: null, created_at: iso(46) },
    ],
    rfq_messages: [
      { id: id(21), tenant_id: T1, rfq_id: "rfq-1", direction: "in", channel: "email", from_address: "supplier@vendor.example", to_addresses: null, subject: "Re: RFQ", status: "received", error: null, created_at: iso(35) },
      { id: id(22), tenant_id: T1, rfq_id: "rfq-1", direction: "note", channel: "system", from_address: null, to_addresses: null, subject: "note", status: "logged", error: null, created_at: iso(36) },
    ],
    whatsapp_messages: [
      { id: id(41), tenant_id: T1, direction: "out", contact_id: "c-1", account_id: null, kind: "template", category: "utility", status: "failed", redirected_to: null, error: "x", created_at: iso(20), body: "sealed-body", to_phone: "sealed-phone" },
      { id: id(42), tenant_id: T1, direction: "out", contact_id: "c-2", account_id: null, kind: "template", category: "marketing", status: "sent", redirected_to: "sealed-redirect", error: null, created_at: iso(19) },
    ],
    webhook_deliveries: [
      { id: id(51), tenant_id: T1, webhook_id: "w-1", event_count: 3, status: 200, ok: true, error: null, duration_ms: 120, created_at: iso(25) },
    ],
    webhooks: [{ id: "w-1", tenant_id: T1, name: "ERP receiver", url: "https://hook.example/secret-path" }],
    connector_sync_runs: [
      { id: id(31), tenant_id: T1, connector_id: "dynamics365", entity: "customers", direction: "pull", trigger: "manual", status: "succeeded", started_at: iso(29), finished_at: iso(30), counts: { read: 6, created: 6 }, error: null },
      { id: id(32), tenant_id: T1, connector_id: "dynamics365", entity: "products", direction: "pull", trigger: "schedule", status: "partial", started_at: iso(10), finished_at: iso(11), counts: { read: 9, failed: 2 }, error: null },
    ],
  };
}

describe("one list over six sources", () => {
  it("unions every source, newest first, with one normalised shape", async () => {
    const db = fakeAdmin(seed());
    const page = await listMessages(db.client, T1, {}, null, 50);
    expect(page.items.map((m) => m.id)).toEqual([
      `integration:${id(1)}`, `email:${id(11)}`, `integration:${id(2)}`, `rfq:${id(21)}`, `integration:${id(3)}`,
      `webhook:${id(51)}`, `whatsapp:${id(41)}`, `whatsapp:${id(42)}`, `connector:${id(32)}`,
    ]);
    // newest first, strictly
    const times = page.items.map((m) => Date.parse(m.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const channels = new Set(page.items.map((m) => m.channel));
    expect([...channels].sort()).toEqual(["api", "connector", "email", "webhook", "whatsapp"]);
    const first = page.items[0];
    expect(first).toMatchObject({ direction: "out", channel: "connector", status: "failed", summary: "The connected app may not create quotes.", record: { type: "standard_quotes", id: "q-1", label: "SQ-0001" } });
    expect(page.needsDatabaseUpdate).toBe(false);
  });

  it("is always filtered by tenant: another workspace's rows never appear", async () => {
    const page = await listMessages(fakeAdmin(seed()).client, T1, {}, null, 100);
    expect(JSON.stringify(page.items)).not.toMatch(/foreign|other@x/i);
    const other = await listMessages(fakeAdmin(seed()).client, T2, {}, null, 100);
    expect(other.items).toHaveLength(2);
    expect(other.items.every((m) => /foreign/i.test(m.summary) || m.counterpart === "other@x.example")).toBe(true);
  });

  it("lists never carry a body or a phone number", async () => {
    const page = await listMessages(fakeAdmin(seed()).client, T1, {}, null, 100);
    const json = JSON.stringify(page.items);
    expect(json).not.toMatch(/sealed-body|sealed-phone|sealed-redirect/);
    expect(page.items.find((m) => m.id === `whatsapp:${id(41)}`)!.counterpart).toBeNull();
  });

  it("shows a connector run once: the message replaces its sync-run line", async () => {
    const page = await listMessages(fakeAdmin(seed()).client, T1, {}, null, 100);
    expect(page.items.some((m) => m.id === `integration:${id(3)}`)).toBe(true);
    expect(page.items.some((m) => m.id === `connector:${id(31)}`)).toBe(false);
    expect(page.items.some((m) => m.id === `connector:${id(32)}`)).toBe(true); // a run with no message still shows
  });

  it("maps statuses: partial run = failed, redirected WhatsApp = redirected, RFQ notes are left out", async () => {
    const page = await listMessages(fakeAdmin(seed()).client, T1, {}, null, 100);
    expect(page.items.find((m) => m.id === `connector:${id(32)}`)!.status).toBe("failed");
    expect(page.items.find((m) => m.id === `whatsapp:${id(42)}`)!.status).toBe("redirected");
    expect(page.items.some((m) => m.id === `rfq:${id(22)}`)).toBe(false);
  });

  it("names a webhook by its name, never its address", async () => {
    const page = await listMessages(fakeAdmin(seed()).client, T1, {}, null, 100);
    const w = page.items.find((m) => m.source === "webhook")!;
    expect(w.counterpart).toBe("ERP receiver");
    expect(JSON.stringify(page.items)).not.toContain("secret-path");
  });
});

describe("filters", () => {
  it("direction, channel, status and record", async () => {
    const db = fakeAdmin(seed());
    expect((await listMessages(db.client, T1, { direction: "in" }, null, 100)).items.every((m) => m.direction === "in")).toBe(true);
    expect((await listMessages(db.client, T1, { channel: "email" }, null, 100)).items.map((m) => m.source).sort()).toEqual(["email", "rfq"]);
    expect((await listMessages(db.client, T1, { status: "failed" }, null, 100)).items.map((m) => m.id).sort()).toEqual([`connector:${id(32)}`, `integration:${id(1)}`, `whatsapp:${id(41)}`].sort());
    expect((await listMessages(db.client, T1, { object_id: "q-1" }, null, 100)).items.map((m) => m.source).sort()).toEqual(["email", "integration"]);
  });

  it("time window", async () => {
    const page = await listMessages(fakeAdmin(seed()).client, T1, { from: iso(35), to: iso(46) }, null, 100);
    expect(page.items.every((m) => Date.parse(m.at) >= Date.parse(iso(35)) && Date.parse(m.at) <= Date.parse(iso(46)))).toBe(true);
    expect(page.items.length).toBeGreaterThan(0);
  });

  it("free text over what the list shows", async () => {
    const page = await listMessages(fakeAdmin(seed()).client, T1, { q: "sq-0001" }, null, 100);
    expect(page.items.map((m) => m.source).sort()).toEqual(["email", "integration"]);
  });

  it("a source that cannot answer the filter is not read at all", () => {
    expect(SOURCES.find((s) => s.source === "email")!.plan({ direction: "in" })).toBeNull();
    expect(SOURCES.find((s) => s.source === "webhook")!.plan({ channel: "email" })).toBeNull();
    expect(SOURCES.find((s) => s.source === "integration")!.plan({ status: "dry_run" })).toBeNull();
  });
});

describe("keyset paging", () => {
  it("pages without gaps or repeats, and ends", async () => {
    const db = fakeAdmin(seed());
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page = await listMessages(db.client, T1, {}, cursor, 3);
      seen.push(...page.items.map((m) => m.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    const all = (await listMessages(fakeAdmin(seed()).client, T1, {}, null, 100)).items.map((m) => m.id);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
    expect(cursor).toBeNull();
  });

  it("cursor round-trips and rejects junk", () => {
    const c = { t: iso(5), id: id(7) };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ t: "x", id: "'; drop" })).toString("base64url"))).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });

  it("newest-first comparison and text match", () => {
    const a = { id: "x:1", at: iso(2), summary: "Alpha", counterpart: null, record: null } as never;
    const b = { id: "x:2", at: iso(1), summary: "Beta", counterpart: "ZED", record: null } as never;
    expect(compareNewest(a, b)).toBeLessThan(0);
    expect(matchesQuery(b, "zed")).toBe(true);
    expect(matchesQuery(a, "zed")).toBe(false);
  });
});

describe("a missing source never breaks the list", () => {
  it("integration_messages missing (0201 pending): the older sources still show, with an explicit flag", async () => {
    const s = seed();
    const db = fakeAdmin(s, { missing: ["integration_messages"] });
    const page = await listMessages(db.client, T1, {}, null, 100);
    expect(page.needsDatabaseUpdate).toBe(true);
    expect(page.bundle).toBe("scripts/run-bundle-10-middleware-2026-10-21.sql");
    expect(page.missingSources).toEqual(["integration"]);
    expect(page.items.length).toBeGreaterThan(0);
    // with no message to replace it, the connector run shows again
    expect(page.items.some((m) => m.id === `connector:${id(31)}`)).toBe(true);
  });

  it("any other source missing is tolerated and named", async () => {
    const db = fakeAdmin(seed(), { missing: ["whatsapp_messages", "rfq_messages", "webhook_deliveries"] });
    const page = await listMessages(db.client, T1, {}, null, 100);
    expect(page.needsDatabaseUpdate).toBe(false);
    expect(page.missingSources.sort()).toEqual(["rfq", "webhook", "whatsapp"]);
    expect(page.items.some((m) => m.source === "email")).toBe(true);
  });

  it("everything missing is an empty list, not an error", async () => {
    const page = await listMessages(fakeAdmin({}, { missing: SOURCES.map((s) => s.table) }).client, T1, {}, null, 10);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.needsDatabaseUpdate).toBe(true);
  });
});

describe("one message opened (admin)", () => {
  it("decrypts a WhatsApp body and number only here", async () => {
    const r = await getMessageDetail(fakeAdmin(seed()).client, T1, `whatsapp:${id(41)}`);
    expect(r.ok && r.value.detail).toMatchObject({ body: "plain(sealed-body)", to_phone: "plain(sealed-phone)" });
  });

  it("shows the ERP's raw error for a failed message and never the tenant id", async () => {
    const r = await getMessageDetail(fakeAdmin(seed()).client, T1, `integration:${id(1)}`);
    expect(r.ok && r.value.detail.error).toBe("raw erp text");
    expect(r.ok && "tenant_id" in r.value.detail).toBe(false);
  });

  it("another workspace's message is not found, whatever the id", async () => {
    expect(await getMessageDetail(fakeAdmin(seed()).client, T1, `integration:${id(90)}`)).toEqual({ ok: false, reason: "not_found" });
    expect(await getMessageDetail(fakeAdmin(seed()).client, T1, `email:${id(12)}`)).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects a malformed id and reports a missing table", async () => {
    expect(await getMessageDetail(fakeAdmin(seed()).client, T1, "nonsense")).toEqual({ ok: false, reason: "bad_id" });
    expect(await getMessageDetail(fakeAdmin(seed()).client, T1, "evil:../../x")).toEqual({ ok: false, reason: "bad_id" });
    expect(await getMessageDetail(fakeAdmin(seed(), { missing: ["integration_messages"] }).client, T1, `integration:${id(1)}`)).toEqual({ ok: false, reason: "needs_database_update" });
    expect(parseMessageId(`email:${id(1)}`)).toEqual({ source: "email", uuid: id(1) });
  });
});
