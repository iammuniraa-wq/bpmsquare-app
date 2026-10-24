import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "./testing/memoryDb";
import {
  ALIAS_OPEN, ALIAS_OTHER, CH_OPEN, CH_OTHER_TENANT, DOMAIN, DWG, DXF, ENV_KEY, EXE, PDF, PNG_BIG, PNG_SMALL, SMALL_PDF, T1, T2, ZIP, file, mail, world,
} from "./testing/fixtures";

process.env.FIELD_ENCRYPTION_KEY = ENV_KEY;
process.env.INBOUND_EMAIL_DOMAIN = DOMAIN;

const emitted: Record<string, unknown>[] = [];
vi.mock("@/lib/events/emitters", () => ({
  emitEmailReceived: vi.fn(async (_t: string, p: Record<string, unknown>) => { emitted.push(p); return true; }),
}));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { decrypt } from "@/lib/encryption";
import { ingestInboxMail, routeByAlias, storeAttachments } from "./ingest";
import { ingestPlatformMail } from "./platform";
import { toChannel } from "./server";
import { INBOX_LIMITS } from "./types";

let db: MemoryDb;
const as = (d: MemoryDb) => d as unknown as Parameters<typeof ingestInboxMail>[0];
const channel = (id = CH_OPEN) => toChannel(db.rows("inbox_channels").find((c) => c.id === id)!);

beforeEach(() => { db = world(); emitted.length = 0; });

describe("routing: the alias names the workspace and the channel, never the payload", () => {
  it("a message to a channel's own address lands in that channel and that tenant", async () => {
    const r = await ingestPlatformMail(as(db), { ...mail(), headers: {} } as never);
    expect(r).toMatchObject({ ok: true, tenantId: T1, channelId: CH_OPEN, duplicate: false });
    const row = db.rows("inbound_emails")[0];
    expect(row.tenant_id).toBe(T1);
    expect(row.channel_id).toBe(CH_OPEN);
    expect(row.status).toBe("new");
    expect(row.direction).toBe("in");
  });

  it("another workspace's address lands in THAT workspace, whatever else the message says", async () => {
    const m = mail({ to: [`${ALIAS_OTHER}@${DOMAIN}`], text: "tenant_id: " + T1 });
    const r = await ingestPlatformMail(as(db), m as never);
    expect(r).toMatchObject({ ok: true, tenantId: T2, channelId: CH_OTHER_TENANT });
    expect(db.rows("inbound_emails").every((e) => e.tenant_id === T2)).toBe(true);
  });

  it("an unknown inbox address is dropped, not stored, and says why", async () => {
    const r = await ingestPlatformMail(as(db), mail({ to: [`inbox-zzzzzzzzzzzzzzzz@${DOMAIN}`] }) as never);
    expect(r).toEqual({ ok: false, reason: "unknown inbox address" });
    expect(db.rows("inbound_emails")).toHaveLength(0);
  });

  it("an address that is not an inbox address (an RFQ reply, a person) is not ours", async () => {
    const r = await ingestPlatformMail(as(db), mail({ to: [`rfq-${"a".repeat(32)}-abcdefghij@${DOMAIN}`, "someone@gulf.test"] }) as never);
    expect(r).toEqual({ ok: false, reason: "not an inbox address" });
    expect(db.rows("inbound_emails")).toHaveLength(0);
  });

  it("a platform without an inbound domain routes nothing", async () => {
    expect(await routeByAlias(as(db), mail(), "")).toEqual({ reason: "inbound domain not configured" });
  });

  it("a paused channel and a workspace without the module take nothing in", async () => {
    db.rows("inbox_channels").find((c) => c.id === CH_OPEN)!.active = false;
    expect(await ingestInboxMail(as(db), channel(), mail())).toEqual({ ok: false, reason: "channel paused" });
    db.rows("inbox_channels").find((c) => c.id === CH_OPEN)!.active = true;
    db.rows("tenants").find((t) => t.id === T1)!.features = { inbox: false };
    expect(await ingestInboxMail(as(db), channel(), mail())).toEqual({ ok: false, reason: "inbox not enabled" });
    expect(db.rows("inbound_emails")).toHaveLength(0);
  });

  it("a pending migration is reported, not thrown", async () => {
    db.missing.add("inbound_emails");
    expect(await ingestInboxMail(as(db), channel(), mail())).toEqual({ ok: false, reason: "inbox tables missing" });
  });
});

describe("idempotency", () => {
  it("the same provider message id lands once", async () => {
    const m = mail({ providerMessageId: "same-1" });
    const a = await ingestInboxMail(as(db), channel(), m);
    const b = await ingestInboxMail(as(db), channel(), { ...m, messageId: "<other@x>" });
    expect(a).toMatchObject({ ok: true, duplicate: false });
    expect(b).toMatchObject({ ok: true, duplicate: true });
    expect(db.rows("inbound_emails")).toHaveLength(1);
    expect(emitted).toHaveLength(1);
  });

  it("the same Message-ID arriving by both intakes lands once", async () => {
    const a = await ingestInboxMail(as(db), channel(), mail({ providerMessageId: "resend-9", messageId: "<Same@Customer.Test>" }));
    const b = await ingestInboxMail(as(db), channel(), mail({ provider: "imap:gmail", providerMessageId: "<Same@Customer.Test>", messageId: "<same@customer.test>" }));
    expect(a).toMatchObject({ duplicate: false });
    expect(b).toMatchObject({ ok: true, duplicate: true });
    expect(db.rows("inbound_emails")).toHaveLength(1);
  });

  it("a duplicate does not store its files twice", async () => {
    const m = mail({ providerMessageId: "dup-files", attachments: [file("plan.pdf", PDF)] });
    await ingestInboxMail(as(db), channel(), m);
    await ingestInboxMail(as(db), channel(), m);
    expect(db.rows("inbound_email_attachments")).toHaveLength(1);
  });

  it("the same Message-ID in two DIFFERENT workspaces is two messages", async () => {
    await ingestInboxMail(as(db), channel(CH_OPEN), mail({ providerMessageId: "x1", messageId: "<shared@x>" }));
    const r = await ingestInboxMail(as(db), channel(CH_OTHER_TENANT), mail({ providerMessageId: "x2", messageId: "<shared@x>", to: [`${ALIAS_OTHER}@${DOMAIN}`] }));
    expect(r).toMatchObject({ ok: true, duplicate: false });
    expect(db.rows("inbound_emails")).toHaveLength(2);
  });

  it("a message with no id at all cannot be made idempotent, so it is refused", async () => {
    expect(await ingestInboxMail(as(db), channel(), mail({ providerMessageId: null, messageId: null }))).toEqual({ ok: false, reason: "no message id" });
  });
});

describe("loop and auto-reply protection", () => {
  it.each([
    ["an auto-reply header", { "auto-submitted": "auto-replied" }, "sara@customer.test", "Hello", "auto-reply"],
    ["bulk precedence", { precedence: "bulk" }, "sara@customer.test", "Hello", "auto-reply"],
    ["our own loop header", { "x-bpmsquare-inbox": "1" }, "sara@customer.test", "Re: Fence", "our own message"],
    ["a bounce", {}, "mailer-daemon@mx.test", "Mail delivery failed", "bounce"],
    ["an out-of-office", {}, "sara@customer.test", "Automatic reply: away until Monday", "auto-reply"],
  ])("%s is ignored", async (_n, headers, from, subject, reason) => {
    const r = await ingestInboxMail(as(db), channel(), mail({ headers, from, subject }));
    expect(r).toEqual({ ok: false, reason });
    expect(db.rows("inbound_emails")).toHaveLength(0);
  });

  it("mail from the channel's own address or its reply-from or the connected mailbox is ignored", async () => {
    expect(await ingestInboxMail(as(db), channel(), mail({ from: `Us <${ALIAS_OPEN}@${DOMAIN}>` }))).toMatchObject({ ok: false, reason: "our own address" });
    db.rows("inbox_channels").find((c) => c.id === CH_OPEN)!.reply_from = "info@gulf.test";
    expect(await ingestInboxMail(as(db), channel(), mail({ from: "INFO@gulf.test" }))).toMatchObject({ ok: false, reason: "our own address" });
    expect(await ingestInboxMail(as(db), channel(), mail({ from: "box@gulf.test" }), { mailboxAddress: "box@gulf.test" })).toMatchObject({ ok: false, reason: "our own address" });
  });

  it("a flood stops at the hourly cap and nothing else is stored", async () => {
    const now = new Date("2026-10-24T10:00:00Z");
    for (let i = 0; i < INBOX_LIMITS.maxPerChannelPerHour; i++) {
      db.rows("inbound_emails").push({ id: `f${i}`, tenant_id: T1, channel_id: CH_OPEN, direction: "in", created_at: "2026-10-24T09:30:00Z" });
    }
    expect(await ingestInboxMail(as(db), channel(), mail(), { now })).toEqual({ ok: false, reason: "rate limit" });
    // An hour later the same channel takes mail again.
    expect(await ingestInboxMail(as(db), channel(), mail(), { now: new Date("2026-10-24T11:00:01Z") })).toMatchObject({ ok: true });
  });
});

describe("what is stored", () => {
  it("encrypts the body and the snippet, and keeps no HTML", async () => {
    await ingestInboxMail(as(db), channel(), mail({ text: "", html: "<p>Hello <b>fence</b></p><script>alert(1)</script>" }));
    const row = db.rows("inbound_emails")[0];
    expect(String(row.body_text).startsWith("enc:v1:")).toBe(true);
    expect(String(row.snippet).startsWith("enc:v1:")).toBe(true);
    expect(decrypt(row.body_text as string)).toBe("Hello fence");
    expect(JSON.stringify(row)).not.toMatch(/alert|<script/);
  });

  it("stores script text sent as plain text as plain text (the screen escapes it)", async () => {
    await ingestInboxMail(as(db), channel(), mail({ text: "<img src=x onerror=alert(1)>" }));
    expect(decrypt(db.rows("inbound_emails")[0].body_text as string)).toBe("<img src=x onerror=alert(1)>");
  });

  it("caps an enormous body and subject", async () => {
    await ingestInboxMail(as(db), channel(), mail({ text: "x".repeat(200_000), subject: "s".repeat(2_000) }));
    const row = db.rows("inbound_emails")[0];
    expect((decrypt(row.body_text as string) ?? "").length).toBeLessThan(INBOX_LIMITS.maxBodyChars + 100);
    expect((row.subject as string).length).toBe(INBOX_LIMITS.maxSubjectChars);
  });

  it("parses the sender, sets the 90-day expiry from the date it was sent, and never trusts a future date", async () => {
    const now = new Date("2026-10-24T10:00:00Z");
    await ingestInboxMail(as(db), channel(), mail({ date: "2026-10-22T08:00:00Z" }), { now });
    await ingestInboxMail(as(db), channel(), mail({ date: "2030-01-01T00:00:00Z" }), { now });
    const [a, b] = db.rows("inbound_emails");
    expect(a).toMatchObject({ from_address: "sara@customer.test", from_name: "Sara Khan", received_at: "2026-10-22T08:00:00.000Z", expires_at: "2027-01-20T08:00:00.000Z" });
    expect(b.received_at).toBe(now.toISOString());
  });

  it("records the event with ids and counts only, never an address or a subject", async () => {
    await ingestInboxMail(as(db), channel(), mail({ attachments: [file("plan.pdf", PDF)] }));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ channelId: CH_OPEN, attachments: 1, replyInThread: false });
    expect(JSON.stringify(emitted[0])).not.toMatch(/sara|customer\.test|fence/i);
  });
});

describe("threads", () => {
  it("a reply to a stored message joins its thread and inherits the record it became", async () => {
    await ingestInboxMail(as(db), channel(), mail({ messageId: "<first@customer.test>" }));
    const first = db.rows("inbound_emails")[0];
    Object.assign(first, { linked_object_type: "standard_quotes", linked_object_id: "q-1", linked_object_label: "SQ-0001" });
    await ingestInboxMail(as(db), channel(), mail({ messageId: "<second@customer.test>", inReplyTo: "<first@customer.test>", references: "<first@customer.test>" }));
    const second = db.rows("inbound_emails")[1];
    expect(second.thread_key).toBe(first.thread_key);
    expect(second).toMatchObject({ linked_object_type: "standard_quotes", linked_object_id: "q-1", status: "new" });
    expect(emitted[1]).toMatchObject({ replyInThread: true });
  });

  it("a reply to OUR message (an out row) joins that thread", async () => {
    await ingestInboxMail(as(db), channel(), mail({ messageId: "<first@customer.test>" }));
    const key = db.rows("inbound_emails")[0].thread_key;
    db.rows("inbound_emails").push({ id: "out1", tenant_id: T1, channel_id: CH_OPEN, direction: "out", message_id: "inbox.abc@bpmsquare.com", thread_key: key, received_at: "2026-10-24T00:00:00Z" });
    await ingestInboxMail(as(db), channel(), mail({ messageId: "<third@customer.test>", inReplyTo: "<inbox.abc@bpmsquare.com>" }));
    expect(db.rows("inbound_emails")[2].thread_key).toBe(key);
  });

  it("a reply that names a message from ANOTHER channel or workspace does not join its thread", async () => {
    db.rows("inbound_emails").push({
      id: "x", tenant_id: T2, channel_id: CH_OTHER_TENANT, direction: "in", message_id: "foreign@x", thread_key: "t:foreign-thread",
      linked_object_type: "cases", linked_object_id: "foreign-case", linked_object_label: "CS-1", received_at: "2026-10-24T00:00:00Z",
    });
    await ingestInboxMail(as(db), channel(), mail({ messageId: "<mine@x>", inReplyTo: "<foreign@x>" }));
    const mine = db.rows("inbound_emails").find((e) => e.message_id === "mine@x")!;
    // Not adopted from the other workspace's row: neither its thread nor the record it became.
    expect(mine.thread_key).toBe("m:foreign@x");
    expect(mine.linked_object_id ?? null).toBeNull();
  });
});

describe("attachments: type, size and quality rules", () => {
  it("keeps the allowed types in a private per-workspace path and labels them", async () => {
    const r = await ingestInboxMail(as(db), channel(), mail({
      attachments: [file("site plan.pdf", PDF, "application/pdf"), file("site.dxf", DXF), file("photo.png", PNG_BIG), file("tiny.png", PNG_SMALL), file("site.dwg", DWG), file("empty.pdf", SMALL_PDF)],
    }));
    expect(r).toMatchObject({ ok: true, attachments: 6 });
    const rows = db.rows("inbound_email_attachments");
    expect(rows.map((a) => [a.ext, a.quality])).toEqual([["pdf", "good"], ["dxf", "good"], ["png", "review"], ["png", "poor"], ["dwg", "poor"], ["pdf", "review"]]);
    for (const a of rows) {
      expect(a.tenant_id).toBe(T1);
      expect(String(a.storage_path)).toMatch(new RegExp(`^${T1}/inbox/${(r as { emailId: string }).emailId}/[0-9a-f-]{36}\\.(pdf|dxf|png|dwg)$`));
    }
    expect(db.objectsIn("inbox-attachments")).toHaveLength(6);
  });

  it("refuses an executable, an archive and a page, even named plan.pdf", async () => {
    const r = await ingestInboxMail(as(db), channel(), mail({
      attachments: [file("plan.pdf", EXE, "application/pdf"), file("drawings.docx", ZIP), file("notes.txt", Buffer.from("<html><script>x</script></html>")), file("ok.pdf", PDF)],
    }));
    expect(r).toMatchObject({ ok: true, attachments: 1 });
    expect(db.rows("inbound_email_attachments").map((a) => a.file_name)).toEqual(["ok.pdf"]);
    expect(db.objectsIn("inbox-attachments")).toHaveLength(1);
  });

  it("names the type from the bytes: a PNG called .pdf is stored as a PNG", async () => {
    await ingestInboxMail(as(db), channel(), mail({ attachments: [file("plan.pdf", PNG_BIG, "application/pdf")] }));
    expect(db.rows("inbound_email_attachments")[0]).toMatchObject({ ext: "png", mime_type: "image/png", file_name: "plan.pdf.png" });
  });

  it("drops a file over the size cap, and files beyond the per-message cap", async () => {
    const big = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(INBOX_LIMITS.maxAttachmentBytes + 1, 1)]);
    const many = Array.from({ length: INBOX_LIMITS.maxAttachmentsPerMessage + 4 }, (_, i) => file(`p${i}.pdf`, PDF));
    const r = await ingestInboxMail(as(db), channel(), mail({ attachments: [file("big.pdf", big), ...many] }));
    expect(r).toMatchObject({ ok: true, attachments: INBOX_LIMITS.maxAttachmentsPerMessage - 1 });
  });

  it("a storage failure costs the file, never the message", async () => {
    db.failUploads = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await ingestInboxMail(as(db), channel(), mail({ attachments: [file("plan.pdf", PDF)] }));
    expect(r).toMatchObject({ ok: true, attachments: 0 });
    expect(db.rows("inbound_emails")).toHaveLength(1);
    expect(db.rows("inbound_email_attachments")).toHaveLength(0);
  });

  it("storeAttachments refuses an empty file and a name made of path tricks", async () => {
    const n = await storeAttachments(as(db), T1, "e1", [file("a.pdf", Buffer.alloc(0)), file("../../etc/passwd.pdf", PDF)]);
    expect(n).toBe(1);
    expect(db.rows("inbound_email_attachments")[0].file_name).not.toMatch(/[\\/]/);
  });
});
