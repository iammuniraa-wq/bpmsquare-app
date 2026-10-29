import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "./testing/memoryDb";
import { CH_OPEN, DOMAIN, ENV_KEY, PDF, T1, T2, world } from "./testing/fixtures";
import type { FetchedMail } from "@/lib/mail/mailbox";

process.env.FIELD_ENCRYPTION_KEY = ENV_KEY;
process.env.INBOUND_EMAIL_DOMAIN = DOMAIN;
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("@/lib/events/emitters", () => ({ emitEmailReceived: vi.fn(async () => true) }));

import { POLL_FIRST_RUN_DAYS, POLL_MAX_MESSAGES, pollInboxMailboxes, toInboxMail, wantedForInbox } from "./poll";

let db: MemoryDb;
const as = (d: MemoryDb) => d as unknown as Parameters<typeof pollInboxMailboxes>[0];
const CH_BOX = "99999999-9999-4999-8999-999999999999";
const CH_BOX_T2 = "88888888-8888-4888-8888-888888888888";

const box = (address = "box@gulf.test") => ({
  connectorId: "gmail" as const, address, user: address, pass: "x",
  smtp: { host: "smtp.example.com", port: 587, secure: false }, imap: { host: "imap.example.com", port: 993, secure: true },
});
const fetched = (uid: number, over: Partial<FetchedMail> = {}): FetchedMail => ({
  uid, messageId: `<imap-${uid}@customer.test>`, inReplyTo: null, references: null, headers: {}, from: "buyer@customer.test", to: ["box@gulf.test"],
  subject: `Enquiry ${uid}`, date: "2026-10-23T10:00:00Z", text: "Please quote.", html: null,
  attachments: [{ filename: "plan.pdf", contentType: "application/pdf", content: PDF }], ...over,
});

beforeEach(() => {
  db = world();
  db.rows("inbox_channels").push(
    { id: CH_BOX, tenant_id: T1, name: "Company mailbox", address_alias: "inbox-dddddddddddddddd", connector_id: "gmail", role_ids: [], default_action: "none", active: true },
    { id: CH_BOX_T2, tenant_id: T2, name: "Their mailbox", address_alias: "inbox-eeeeeeeeeeeeeeee", connector_id: "mail_server", role_ids: [], default_action: "none", active: true },
  );
  db.rows("tenants").find((t) => t.id === T2)!.features = { inbox: false };
});

describe("intake B: read the client's own mailbox", () => {
  it("reads the new mail from the stored cursor, stores it in the right channel, and moves the cursor", async () => {
    db.rows("inbox_mailbox_state").push({ tenant_id: T1, connector_id: "gmail", uid_validity: "7", last_uid: 40, last_polled_at: "2026-10-24T00:00:00Z" });
    const fetch = vi.fn(async () => ({ uidValidity: BigInt(7), lastUid: 42, messages: [fetched(41), fetched(42)] }));
    const r = await pollInboxMailboxes(as(db), { load: vi.fn(async () => box()) as never, fetch: fetch as never, now: new Date("2026-10-24T10:00:00Z") });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0] as unknown[]).toEqual([expect.objectContaining({ address: "box@gulf.test" }), { uidValidity: BigInt(7), lastUid: 40 }]);
    expect(r.results).toEqual([{ tenantId: T1, channelId: CH_BOX, read: 2, stored: 2 }]);
    const stored = db.rows("inbound_emails");
    expect(stored).toHaveLength(2);
    expect(stored.every((e) => e.tenant_id === T1 && e.channel_id === CH_BOX && e.provider === "imap:gmail")).toBe(true);
    expect(stored[0]).toMatchObject({ received_at: "2026-10-23T10:00:00.000Z", status: "new" });
    expect(db.rows("inbound_email_attachments")).toHaveLength(2);
    expect(db.rows("inbox_mailbox_state")[0]).toMatchObject({ tenant_id: T1, connector_id: "gmail", uid_validity: "7", last_uid: 42, last_error: null });
  });

  it("Read mail now reads only the named channel of the named workspace", async () => {
    db.rows("tenants").find((t) => t.id === T2)!.features = { inbox: true };
    const fetch = vi.fn(async () => ({ uidValidity: BigInt(7), lastUid: 3, messages: [fetched(3)], skipped: [] }));
    const load = vi.fn(async () => box());
    const r = await pollInboxMailboxes(as(db), { load: load as never, fetch: fetch as never, only: { tenantId: T1, channelId: CH_BOX } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(r.results).toEqual([{ tenantId: T1, channelId: CH_BOX, read: 1, stored: 1 }]);
    const other = await pollInboxMailboxes(as(db), { load: load as never, fetch: fetch as never, only: { tenantId: T1, channelId: CH_BOX_T2 } });
    expect(other).toEqual({ channels: 0, results: [] });
  });

  it("the first run has no cursor (the reader looks back three days), and a re-poll of the same mail stores it once", async () => {
    const fetch = vi.fn(async () => ({ uidValidity: BigInt(9), lastUid: 5, messages: [fetched(5)] }));
    const load = vi.fn(async () => box());
    await pollInboxMailboxes(as(db), { load: load as never, fetch: fetch as never });
    expect(fetch.mock.calls[0]).toEqual([expect.anything(), { uidValidity: null, lastUid: 0 }]);
    expect(POLL_FIRST_RUN_DAYS).toBe(3);
    await pollInboxMailboxes(as(db), { load: load as never, fetch: fetch as never });
    expect(db.rows("inbound_emails")).toHaveLength(1);
  });

  it("is bounded per run", () => {
    expect(POLL_MAX_MESSAGES).toBeLessThanOrEqual(25);
  });

  it("a mailbox that is not connected is reported, and a failing one keeps its cursor and records the error", async () => {
    const r1 = await pollInboxMailboxes(as(db), { load: vi.fn(async () => null) as never, fetch: vi.fn() as never });
    expect(r1.results).toEqual([{ tenantId: T1, channelId: CH_BOX, error: "mailbox not connected" }]);

    db.rows("inbox_mailbox_state").push({ tenant_id: T1, connector_id: "gmail", uid_validity: "7", last_uid: 40 });
    const r2 = await pollInboxMailboxes(as(db), { load: vi.fn(async () => box()) as never, fetch: vi.fn(async () => { throw new Error("IMAP login failed"); }) as never });
    expect(r2.results[0]).toMatchObject({ error: "IMAP login failed" });
    expect(db.rows("inbox_mailbox_state")[0]).toMatchObject({ last_uid: 40, uid_validity: "7", last_error: "IMAP login failed" });
  });

  it("does not poll a workspace without the module (the cursor must not pass mail nobody will read)", async () => {
    const load = vi.fn(async () => box());
    const r = await pollInboxMailboxes(as(db), { load: load as never, fetch: vi.fn(async () => ({ uidValidity: BigInt(1), lastUid: 1, messages: [] })) as never });
    expect(r.results.map((x) => x.tenantId)).toEqual([T1]);
    expect(load.mock.calls.every((c) => (c as unknown[])[1] === T1)).toBe(true);
  });

  it("only channels with a mailbox are polled, and a paused channel is not", async () => {
    db.rows("inbox_channels").find((c) => c.id === CH_BOX)!.active = false;
    const r = await pollInboxMailboxes(as(db), { load: vi.fn(async () => box()) as never, fetch: vi.fn() as never });
    expect(r).toEqual({ channels: 0, results: [] });
    expect(db.rows("inbox_channels").some((c) => c.id === CH_OPEN && c.connector_id == null)).toBe(true);
  });

  it("polls the least recently polled first, and stops at the time budget", async () => {
    db.rows("tenants").find((t) => t.id === T2)!.features = { inbox: true };
    db.rows("inbox_mailbox_state").push({ tenant_id: T1, connector_id: "gmail", last_uid: 1, last_polled_at: "2026-10-24T09:00:00Z" });
    const order: string[] = [];
    const load = vi.fn(async (_a: unknown, tenant: string) => { order.push(tenant); return box(); });
    await pollInboxMailboxes(as(db), { load: load as never, fetch: vi.fn(async () => ({ uidValidity: BigInt(1), lastUid: 1, messages: [] })) as never });
    expect(order).toEqual([T2, T1]);
    order.length = 0;
    const r = await pollInboxMailboxes(as(db), { load: load as never, fetch: vi.fn() as never, budgetMs: -1 });
    expect(r.results).toEqual([]);
    expect(order).toEqual([]);
  });

  it("a pending migration is reported", async () => {
    db.missing.add("inbox_channels");
    expect(await pollInboxMailboxes(as(db), {})).toEqual({ channels: 0, results: [], pending: true });
  });
});

describe("what the poller keeps for itself", () => {
  it("leaves mail with an RFQ tag to the RFQ poller", () => {
    expect(wantedForInbox("Quote for 300 m of fence")).toBe(true);
    expect(wantedForInbox("Re: [RFQ-0012 · k3f9q2xa4m] Request for quotation")).toBe(false);
    expect(wantedForInbox("[RFQ-0012] prices")).toBe(false);
  });

  it("carries the headers that identify an auto-reply or our own mail into the ingest shape", () => {
    const m = toInboxMail(fetched(3, { headers: { "auto-submitted": "auto-replied" } }), "gmail", BigInt(7));
    expect(m).toMatchObject({ provider: "imap:gmail", providerMessageId: "<imap-3@customer.test>", headers: { "auto-submitted": "auto-replied" } });
    expect(toInboxMail(fetched(4, { messageId: null }), "mail_server", BigInt(7)).providerMessageId).toBe("7:4");
  });

  it("auto-replies in the mailbox are skipped by the same loop guard as the forwarding address", async () => {
    const fetch = vi.fn(async () => ({ uidValidity: BigInt(1), lastUid: 2, messages: [fetched(1, { headers: { "auto-submitted": "auto-generated" } }), fetched(2)] }));
    const r = await pollInboxMailboxes(as(db), { load: vi.fn(async () => box()) as never, fetch: fetch as never });
    expect(r.results[0]).toMatchObject({ read: 2, stored: 1 });
  });
});
