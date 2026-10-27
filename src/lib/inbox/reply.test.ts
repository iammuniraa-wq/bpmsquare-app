import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "./testing/memoryDb";
import { ALIAS_OPEN, CH_OPEN, DOMAIN, ENV_KEY, T1, U_ADMIN, world } from "./testing/fixtures";

process.env.FIELD_ENCRYPTION_KEY = ENV_KEY;
process.env.INBOUND_EMAIL_DOMAIN = DOMAIN;
process.env.RESEND_SENDING_DOMAIN = "bpmsquare.com";
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { decrypt } from "@/lib/encryption";
import { sendReply, type ReplyDeps } from "./reply";
import { toChannel } from "./server";

let db: MemoryDb;
const as = (d: MemoryDb) => d as unknown as Parameters<typeof sendReply>[0];
const NOW = new Date("2026-10-24T12:00:00Z");

const original = (over: Record<string, unknown> = {}) => ({
  id: "in-1", from_address: "sara@customer.test", from_name: "Sara Khan", subject: "Fence for 300 m", message_id: "first@customer.test",
  references_ids: null as string | null, thread_key: "m:first@customer.test", expires_at: "2027-01-22T00:00:00.000Z", ...over,
});
const channel = (over: Record<string, unknown> = {}) => {
  Object.assign(db.rows("inbox_channels").find((c) => c.id === CH_OPEN)!, over);
  return toChannel(db.rows("inbox_channels").find((c) => c.id === CH_OPEN)!);
};
const args = (over: Partial<Parameters<typeof sendReply>[1]> = {}) => ({
  tenantId: T1, channel: channel(), original: original(), body: "Thanks, we can do that.\n\nRegards", actor: { id: U_ADMIN, email: "admin@gulf.test" }, ...over,
});

function deps() {
  const platform = vi.fn(async (_p: Parameters<NonNullable<ReplyDeps["sendViaPlatform"]>>[0]) => ({ error: null as string | null }));
  const mailbox = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, messageId: "<sent@x>" }));
  const load = vi.fn(async () => ({ connectorId: "gmail" as const, address: "box@gulf.test", user: "box@gulf.test", pass: "x", smtp: { host: "s", port: 587, secure: false }, imap: { host: "i", port: 993, secure: true } }));
  return { platform, mailbox, load, d: { sendViaPlatform: platform, sendViaMailbox: mailbox as never, loadMailbox: load as never, now: NOW } satisfies ReplyDeps };
}

beforeEach(() => { db = world(); });

describe("replying through BPMSquare's sender", () => {
  it("goes only to the person who wrote, threaded, from the tenant's sender, with answers coming back to the channel", async () => {
    const { platform, d } = deps();
    const r = await sendReply(as(db), args(), d);
    expect(r).toMatchObject({ ok: true, via: "platform", redirected: false, to: ["sara@customer.test"] });
    const p = platform.mock.calls[0][0];
    expect(p.to).toEqual(["sara@customer.test"]);
    expect(p.from).toBe("Gulf Fence <gulf@bpmsquare.com>");
    expect(p.replyTo).toBe(`${ALIAS_OPEN}@${DOMAIN}`);
    expect(p.subject).toBe("Re: Fence for 300 m");
    expect(p.headers["In-Reply-To"]).toBe("<first@customer.test>");
    expect(p.headers["References"]).toBe("<first@customer.test>");
    expect(p.headers["Message-ID"]).toMatch(/^<inbox\.[0-9a-f-]{36}@bpmsquare\.com>$/);
    // Our own mail carries the loop-guard header, so it can never come back in as a customer's.
    expect(p.headers["X-BPMSquare-Inbox"]).toBe("1");
    expect(p.text).toContain("Thanks, we can do that.");
  });

  it("extends the References chain and never doubles the Re:", async () => {
    const { platform, d } = deps();
    await sendReply(as(db), args({ original: original({ subject: "RE: Re: Fence", message_id: "<m3@x>", references_ids: "<m1@x> <m2@x>" }) }), d);
    const p = platform.mock.calls[0][0];
    expect(p.subject).toBe("Re: Fence");
    expect(p.headers["In-Reply-To"]).toBe("<m3@x>");
    expect(p.headers["References"]).toBe("<m1@x> <m2@x> <m3@x>");
  });

  it("stores the reply as an outbound row in the same conversation, encrypted, and logs it as an Inbox email", async () => {
    const { d } = deps();
    const r = await sendReply(as(db), args(), d);
    const out = db.rows("inbound_emails").find((e) => e.direction === "out")!;
    expect(out).toMatchObject({
      tenant_id: T1, channel_id: CH_OPEN, thread_key: "m:first@customer.test", send_status: "sent", status: "handled", provider: "platform",
      subject: "Re: Fence for 300 m", expires_at: "2027-01-22T00:00:00.000Z", created_by: U_ADMIN, in_reply_to: "first@customer.test",
    });
    expect(out.to_addresses).toEqual(["sara@customer.test"]);
    expect(String(out.body_text).startsWith("enc:v1:")).toBe(true);
    expect(decrypt(out.body_text as string)).toContain("Thanks, we can do that.");
    expect(r).toMatchObject({ emailId: out.id });
    expect(db.rows("email_log")).toEqual([expect.objectContaining({ tenant_id: T1, kind: "inbox", to_email: "sara@customer.test", subject: "Re: Fence for 300 m", status: "sent", related_object_type: "inbound_emails", related_object_id: "in-1" })]);
  });

  it("a send that fails is stored and logged as failed, and reported", async () => {
    const { platform, d } = deps();
    platform.mockResolvedValueOnce({ error: "domain not verified" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendReply(as(db), args(), d);
    expect(r).toEqual({ ok: false, reason: "Send failed: domain not verified", status: 502 });
    expect(db.rows("inbound_emails").find((e) => e.direction === "out")).toMatchObject({ send_status: "failed", error: "domain not verified" });
    expect(db.rows("email_log")[0]).toMatchObject({ kind: "inbox", status: "failed", error: "domain not verified" });
  });

  it("a reply-from on our own sending domain is used; one on a foreign domain is the reply address instead", async () => {
    const a = deps();
    await sendReply(as(db), args({ channel: channel({ reply_from: "enquiries@bpmsquare.com", reply_name: "Gulf Sales" }) }), a.d);
    expect(a.platform.mock.calls[0][0].from).toBe("Gulf Sales <enquiries@bpmsquare.com>");
    const b = deps();
    process.env.INBOUND_EMAIL_DOMAIN = "";
    await sendReply(as(db), args({ channel: channel({ reply_from: "info@gulf.test", reply_name: null }) }), b.d);
    process.env.INBOUND_EMAIL_DOMAIN = DOMAIN;
    expect(b.platform.mock.calls[0][0].from).toBe("Gulf Fence <gulf@bpmsquare.com>");
    expect(b.platform.mock.calls[0][0].replyTo).toBe("info@gulf.test");
  });

  it("refuses an empty reply and a message with no sender address, sending nothing", async () => {
    const { platform, d } = deps();
    expect(await sendReply(as(db), args({ body: "   \n " }), d)).toMatchObject({ ok: false, status: 400 });
    expect(await sendReply(as(db), args({ original: original({ from_address: null }) }), d)).toMatchObject({ ok: false, status: 422 });
    expect(platform).not.toHaveBeenCalled();
    expect(db.rows("inbound_emails")).toHaveLength(0);
  });
});

describe("a demo workspace can never reach a customer", () => {
  it("is refused with no redirect inbox, and redirects (marked) when one is set", async () => {
    db.rows("tenants").find((t) => t.id === T1)!.is_demo = true;
    const a = deps();
    expect(await sendReply(as(db), args(), a.d)).toMatchObject({ ok: false, status: 400 });
    expect(a.platform).not.toHaveBeenCalled();

    db.rows("tenants").find((t) => t.id === T1)!.config = { email_output: { mode: "redirect", redirect_to: "tester@bpmsquare.com" } };
    const b = deps();
    const r = await sendReply(as(db), args(), b.d);
    expect(r).toMatchObject({ ok: true, redirected: true, to: ["tester@bpmsquare.com"] });
    expect(b.platform.mock.calls[0][0].to).toEqual(["tester@bpmsquare.com"]);
    expect(b.platform.mock.calls[0][0].subject).toMatch(/^\[Redirected · for sara@customer\.test\] Re: Fence/);
    expect(db.rows("inbound_emails").find((e) => e.direction === "out")!.send_status).toBe("redirected");
  });
});

describe("replying through the channel's own mailbox", () => {
  it("sends from the mailbox, threaded, with the loop header, and records it as sent by the mailbox", async () => {
    const { mailbox, load, d } = deps();
    const r = await sendReply(as(db), args({ channel: channel({ connector_id: "gmail", reply_name: "Gulf Sales" }) }), d);
    expect(r).toMatchObject({ ok: true, via: "mailbox", to: ["sara@customer.test"] });
    expect(load).toHaveBeenCalledWith(expect.anything(), T1, "gmail");
    const [mb, mailArg] = mailbox.mock.calls[0] as [{ address: string }, Record<string, unknown>];
    expect(mb.address).toBe("box@gulf.test");
    expect(mailArg).toMatchObject({ fromName: "Gulf Sales", to: ["sara@customer.test"], subject: "Re: Fence for 300 m", inReplyTo: "<first@customer.test>", references: "<first@customer.test>" });
    expect(mailArg.headers).toEqual({ "X-BPMSquare-Inbox": "1" });
    expect(String(mailArg.messageId)).toMatch(/^<inbox\./);
    expect(db.rows("inbound_emails").find((e) => e.direction === "out")).toMatchObject({ provider: "mailbox", from_address: "box@gulf.test" });
  });

  it("a mailbox that is not connected sends nothing and says what to do", async () => {
    const { mailbox, platform, load, d } = deps();
    load.mockResolvedValueOnce(null as never);
    const r = await sendReply(as(db), args({ channel: channel({ connector_id: "mail_server" }) }), d);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as { reason: string }).reason).toMatch(/Mail server connector isn't connected/);
    expect(mailbox).not.toHaveBeenCalled();
    expect(platform).not.toHaveBeenCalled();
    expect(db.rows("inbound_emails")).toHaveLength(0);
  });

  it("a mailbox send that fails is reported and stored as failed", async () => {
    const { mailbox, d } = deps();
    mailbox.mockResolvedValueOnce({ ok: false, error: "535 auth failed" } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendReply(as(db), args({ channel: channel({ connector_id: "gmail" }) }), d);
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(db.rows("inbound_emails").find((e) => e.direction === "out")).toMatchObject({ send_status: "failed" });
  });
});
