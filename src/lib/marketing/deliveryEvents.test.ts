import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => state.client }));

import { processDelivery } from "./deliveryEvents";
import { normaliseResendEvent } from "./resendEvents";
import { emailBlindIndex } from "./blindIndex";
import { nextHealth } from "./emailHealth";
import { fakeDb, type Row } from "./testFakeDb";
import { POST } from "@/app/api/webhooks/resend/route";

const KEY = "ab".repeat(32);
const SECRET_RAW = Buffer.from("test-secret-bytes-for-svix-sign!");
const SECRET = `whsec_${SECRET_RAW.toString("base64")}`;

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const RID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CAMPAIGN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const hashOf = (e: string) => emailBlindIndex(e, KEY);

function seed(over: { contact?: Partial<Row>; recipient?: Partial<Row> } = {}) {
  return fakeDb({
    marketing_campaign_recipients: [{ id: RID, tenant_id: TENANT_A, campaign_id: CAMPAIGN, account_id: "acc-1", contact_id: CID, email: "Buyer@Example.com", manual_email: null, lang: "en", resend_id: "re_1", delivery_status: null, ...over.recipient }],
    marketing_campaigns: [{ id: CAMPAIGN, tenant_id: TENANT_A, name: "October", topic: "offers", newsletter_version_id: null }],
    contacts: [
      { id: CID, tenant_id: TENANT_A, account_id: "acc-1", email_hash: hashOf("buyer@example.com"), email_status: "unknown", email_status_at: null, ...over.contact },
      // a same-id-looking contact in another tenant must never be touched
      { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", tenant_id: TENANT_B, account_id: "acc-9", email_hash: hashOf("buyer@example.com"), email_status: "unknown", email_status_at: null },
    ],
  });
}

const ev = (type: string, data: Record<string, unknown> = {}, created = "2026-10-20T10:00:00.000Z") => ({
  type, created_at: created,
  data: { email_id: "re_1", to: ["buyer@example.com"], tags: { recipient_id: RID }, created_at: created, ...data },
});
const delivery = (type: string, data?: Record<string, unknown>, created?: string) => normaliseResendEvent(ev(type, data, created))!;

beforeEach(() => { process.env.FIELD_ENCRYPTION_KEY = KEY; });
afterEach(() => { delete process.env.FIELD_ENCRYPTION_KEY; delete process.env.RESEND_WEBHOOK_SECRET; });

describe("normaliseResendEvent", () => {
  it("separates a permanent bounce from a transient one, and keeps provider text out of the reason", () => {
    const hard = delivery("email.bounced", { bounce: { type: "Permanent", subType: "General", message: "550 5.1.1 user unknown at mx.example" } });
    const soft = delivery("email.bounced", { bounce: { type: "Transient", subType: "MailboxFull" } });
    expect(hard.kind).toBe("bounced_hard");
    expect(soft.kind).toBe("bounced_soft");
    expect(hard.reason).not.toContain("550");
    expect(soft.reason).toBe("The mailbox is full.");
  });

  it("reads the tag from the object form and the list form, and ignores events it does not use", () => {
    expect(delivery("email.delivered").recipientTag).toBe(RID);
    const listForm = normaliseResendEvent({ type: "email.delivered", data: { email_id: "x", tags: [{ name: "recipient_id", value: RID }] } });
    expect(listForm?.recipientTag).toBe(RID);
    expect(normaliseResendEvent({ type: "email.opened", data: { email_id: "x" } })).toBeNull();
    expect(normaliseResendEvent({ type: "email.bounced" })).toBeNull();
  });
});

describe("nextHealth -- status transitions", () => {
  const at = "2026-10-20T10:00:00.000Z";
  it("a delivery moves unknown and soft_bounce to valid, and leaves a bounced address alone", () => {
    expect(nextHealth({ status: "unknown", at: null }, { kind: "delivered" })?.status).toBe("valid");
    expect(nextHealth({ status: "soft_bounce", at }, { kind: "delivered" }, "2026-10-21T00:00:00.000Z")?.status).toBe("valid");
    expect(nextHealth({ status: "bounced", at }, { kind: "delivered" }, "2026-10-21T00:00:00.000Z")).toBeNull();
    expect(nextHealth({ status: "valid", at }, { kind: "delivered" })).toBeNull();
  });
  it("a late event cannot undo a newer one", () => {
    expect(nextHealth({ status: "soft_bounce", at }, { kind: "delivered" }, "2026-10-19T00:00:00.000Z")).toBeNull();
  });
  it("severity only rises from webhook signals", () => {
    expect(nextHealth({ status: "soft_bounce", at }, { kind: "bounced" })?.status).toBe("bounced");
    expect(nextHealth({ status: "bounced", at }, { kind: "soft_bounce" })).toBeNull();
    expect(nextHealth({ status: "bounced", at }, { kind: "complained" })?.status).toBe("complained");
    expect(nextHealth({ status: "complained", at }, { kind: "bounced" })).toBeNull();
  });
  it("only a person can bring a bounced address back, and a failed check never overrides a delivery", () => {
    expect(nextHealth({ status: "bounced", at }, { kind: "confirmed", reason: "agreed by phone" })?.status).toBe("valid");
    expect(nextHealth({ status: "valid", at }, { kind: "invalid" })).toBeNull();
    expect(nextHealth({ status: "bounced", at }, { kind: "checked_ok" })).toBeNull();
  });
  it("keeps the reason short", () => {
    const r = nextHealth({ status: "unknown", at: null }, { kind: "bounced", reason: "x".repeat(900) });
    expect(r?.reason?.length).toBeLessThanOrEqual(200);
  });
});

describe("processDelivery", () => {
  it("takes the tenant from the stored row, not from anything in the payload", async () => {
    const { client, tables } = seed();
    const body = delivery("email.delivered", { tenant_id: TENANT_B, tags: { recipient_id: RID, tenant_id: TENANT_B } });
    const out = await processDelivery(client, body, "msg_1");
    expect(out).toMatchObject({ status: "processed", tenantId: TENANT_A });
    expect(tables.domain_event).toHaveLength(1);
    expect(tables.domain_event[0]).toMatchObject({ tenant_id: TENANT_A, name: "email.delivered", contact_id: CID, source: "provider_webhook", campaign_id: CAMPAIGN });
    expect(tables.contacts.find((c) => c.tenant_id === TENANT_B)?.email_status).toBe("unknown");
  });

  it("does nothing for a tag that matches no row", async () => {
    const { client, tables } = seed();
    const out = await processDelivery(client, { ...delivery("email.delivered"), recipientTag: "99999999-9999-4999-8999-999999999999", emailId: null }, "msg_x");
    expect(out).toEqual({ status: "unmatched", reason: "no_row" });
    expect(tables.domain_event ?? []).toHaveLength(0);
  });

  it("refuses an event whose provider id is not the one stored for the row", async () => {
    const { client } = seed();
    expect(await processDelivery(client, delivery("email.delivered", { email_id: "re_other" }), "msg_y")).toEqual({ status: "unmatched", reason: "id_mismatch" });
  });

  it("finds the row by the stored provider id when the tag is missing", async () => {
    const { client } = seed();
    const out = await processDelivery(client, { ...delivery("email.delivered"), recipientTag: null }, "msg_z");
    expect(out.status).toBe("processed");
  });

  it("is idempotent on the provider's event id", async () => {
    const { client, tables } = seed();
    const b = delivery("email.bounced", { bounce: { type: "Permanent" } });
    expect((await processDelivery(client, b, "msg_dup")).status).toBe("processed");
    expect((await processDelivery(client, b, "msg_dup")).status).toBe("duplicate");
    expect(tables.domain_event).toHaveLength(1);
    expect(tables.suppressions).toHaveLength(1);
    expect(tables.email_provider_events).toHaveLength(1);
  });

  it("a hard bounce marks the contact bounced, suppresses the address and records the row", async () => {
    const { client, tables } = seed();
    await processDelivery(client, delivery("email.bounced", { bounce: { type: "Permanent", subType: "General" } }), "msg_h");
    const c = tables.contacts.find((x) => x.id === CID)!;
    expect(c.email_status).toBe("bounced");
    expect(c.email_status_at).toBe("2026-10-20T10:00:00.000Z");
    expect(String(c.email_status_reason).length).toBeLessThanOrEqual(200);
    expect(tables.suppressions[0]).toMatchObject({ tenant_id: TENANT_A, channel: "email", address_hash: hashOf("buyer@example.com"), reason: "bounced_hard" });
    expect(tables.marketing_campaign_recipients[0]).toMatchObject({ delivery_status: "bounced" });
    expect(tables.domain_event[0]).toMatchObject({ name: "email.bounced", payload: { bounce_type: "hard" } });
  });

  it("a soft bounce is not suppressed, and a later delivery returns the contact to valid", async () => {
    const { client, tables } = seed();
    await processDelivery(client, delivery("email.bounced", { bounce: { type: "Transient" } }, "2026-10-20T10:00:00.000Z"), "m1");
    expect(tables.contacts.find((x) => x.id === CID)?.email_status).toBe("soft_bounce");
    expect(tables.suppressions ?? []).toHaveLength(0);
    await processDelivery(client, delivery("email.delivered", {}, "2026-10-21T10:00:00.000Z"), "m2");
    expect(tables.contacts.find((x) => x.id === CID)?.email_status).toBe("valid");
  });

  it("a complaint suppresses the address and withdraws email consent for every topic", async () => {
    const { client, tables } = seed();
    await processDelivery(client, delivery("email.complained"), "m3");
    expect(tables.contacts.find((x) => x.id === CID)?.email_status).toBe("complained");
    expect(tables.suppressions[0]).toMatchObject({ reason: "complained" });
    expect(tables.consent_events).toHaveLength(1);
    expect(tables.consent_events[0]).toMatchObject({ tenant_id: TENANT_A, contact_id: CID, channel: "email", topic: null, status: "withdrawn", source: "provider_webhook" });
    await processDelivery(client, delivery("email.complained"), "m4");
    expect(tables.consent_events).toHaveLength(1);
  });

  it("an event for a redirected message (a demo workspace) never touches the contact or the suppression list", async () => {
    const { client, tables } = seed();
    await processDelivery(client, delivery("email.bounced", { to: ["sap.rashid@gmail.com"], bounce: { type: "Permanent" } }), "m5");
    expect(tables.contacts.find((x) => x.id === CID)?.email_status).toBe("unknown");
    expect(tables.suppressions ?? []).toHaveLength(0);
    expect(tables.domain_event).toHaveLength(1);
  });

  it("ignores health when the contact's address has changed since the send", async () => {
    const { client, tables } = seed({ contact: { email_hash: hashOf("new-address@example.com") } });
    await processDelivery(client, delivery("email.bounced", { bounce: { type: "Permanent" } }), "m6");
    expect(tables.contacts.find((x) => x.id === CID)?.email_status).toBe("unknown");
    // the address that actually bounced is still suppressed
    expect(tables.suppressions[0]).toMatchObject({ address_hash: hashOf("buyer@example.com") });
  });

  it("still records the event while the new columns are pending", async () => {
    const db = fakeDb({
      marketing_campaign_recipients: [{ id: RID, tenant_id: TENANT_A, campaign_id: CAMPAIGN, account_id: "acc-1", contact_id: CID, email: "buyer@example.com", manual_email: null, lang: "en" }],
      marketing_campaigns: [{ id: CAMPAIGN, tenant_id: TENANT_A, name: "October" }],
      contacts: [{ id: CID, tenant_id: TENANT_A, account_id: "acc-1", email_hash: hashOf("buyer@example.com") }],
    }, { missingTables: ["email_provider_events"] });
    const out = await processDelivery(db.client, delivery("email.delivered"), "m7");
    expect(out.status).toBe("processed");
    expect(db.tables.domain_event).toHaveLength(1);
  });
});

describe("POST /api/webhooks/resend", () => {
  const sign = (id: string, ts: string, raw: string, secret = SECRET_RAW) =>
    `v1,${crypto.createHmac("sha256", secret).update(`${id}.${ts}.${raw}`).digest("base64")}`;
  const request = (raw: string, headers: Record<string, string>) =>
    new Request("http://localhost/api/webhooks/resend", { method: "POST", body: raw, headers }) as unknown as Parameters<typeof POST>[0];
  const nowTs = () => String(Math.floor(Date.now() / 1000));

  it("answers 503 and accepts nothing when the signing secret is not configured", async () => {
    const res = await POST(request("{}", { "svix-id": "m", "svix-timestamp": nowTs(), "svix-signature": "v1,AAAA" }));
    expect(res.status).toBe(503);
  });

  it("rejects an unsigned or wrongly signed request before reading it", async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    const db = seed();
    state.client = db.client;
    const raw = JSON.stringify(ev("email.delivered"));
    expect((await POST(request(raw, {}))).status).toBe(401);
    const ts = nowTs();
    expect((await POST(request(raw, { "svix-id": "m", "svix-timestamp": ts, "svix-signature": sign("m", ts, raw, Buffer.from("another-secret")) }))).status).toBe(401);
    // a signature over a different body is no good either
    expect((await POST(request(raw, { "svix-id": "m", "svix-timestamp": ts, "svix-signature": sign("m", ts, raw + " ") }))).status).toBe(401);
    expect(db.tables.domain_event ?? []).toHaveLength(0);
  });

  it("processes a correctly signed delivery and acknowledges an event it does not use", async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    const db = seed();
    state.client = db.client;
    const ts = nowTs();
    const raw = JSON.stringify(ev("email.delivered"));
    const ok = await POST(request(raw, { "svix-id": "m1", "svix-timestamp": ts, "svix-signature": sign("m1", ts, raw) }));
    expect(ok.status).toBe(200);
    expect(db.tables.domain_event).toHaveLength(1);
    const other = JSON.stringify({ type: "email.opened", data: { email_id: "re_1" } });
    const ign = await POST(request(other, { "svix-id": "m2", "svix-timestamp": ts, "svix-signature": sign("m2", ts, other) }));
    expect(ign.status).toBe(200);
    expect(await ign.json()).toMatchObject({ ignored: true });
  });
});
