import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "./testing/memoryDb";
import { CH_OPEN, CH_OTHER_TENANT, ENV_KEY, T1, T2, world } from "./testing/fixtures";

process.env.FIELD_ENCRYPTION_KEY = ENV_KEY;
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { ownsPath, purgeExpired } from "./purge";
import { addDays, expiryOnConversion, expiryOnReceipt } from "./rules";

let db: MemoryDb;
const as = (d: MemoryDb) => d as unknown as Parameters<typeof purgeExpired>[0];
const NOW = new Date("2026-12-31T12:00:00Z");

function seedEmail(over: Record<string, unknown>) {
  const id = String(over.id);
  db.rows("inbound_emails").push({
    tenant_id: T1, channel_id: CH_OPEN, direction: "in", from_address: "sara@customer.test", from_name: "Sara", subject: "Fence",
    body_text: "enc-body", snippet: "enc-snip", to_addresses: ["x@y.test"], status: "new", purged_at: null,
    received_at: "2026-10-01T00:00:00Z", expires_at: "2026-12-30T00:00:00Z", linked_object_type: null, linked_object_id: null, converted_at: null, ...over,
  });
  return id;
}
async function seedFile(tenantId: string, emailId: string, name: string) {
  const path = `${tenantId}/inbox/${emailId}/${name}.pdf`;
  await db.storage.from("inbox-attachments").upload(path, Buffer.from("%PDF-1.7 x"));
  db.rows("inbound_email_attachments").push({ id: `a-${name}`, tenant_id: tenantId, email_id: emailId, file_name: `${name}.pdf`, storage_path: path });
  return path;
}

beforeEach(() => { db = world(); });

describe("retention arithmetic (owner decisions 2026-10-24)", () => {
  it("never converted: 90 days from receipt; converted: 30 days from the conversion", () => {
    const received = new Date("2026-10-01T00:00:00Z");
    expect(expiryOnReceipt(received).toISOString()).toBe("2026-12-30T00:00:00.000Z");
    const converted = new Date("2026-12-01T00:00:00Z");
    expect(expiryOnConversion(converted).toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(addDays(converted, 30).getTime()).toBe(expiryOnConversion(converted).getTime());
  });
});

describe("the purge", () => {
  it("clears the body, the snippet and the files of an expired message and keeps a stub", async () => {
    seedEmail({ id: "e1" });
    const path = await seedFile(T1, "e1", "plan");
    const r = await purgeExpired(as(db), { now: NOW });
    expect(r).toEqual({ emails: 1, files: 1 });
    const row = db.rows("inbound_emails")[0];
    expect(row).toMatchObject({ body_text: null, snippet: null, to_addresses: [], purged_at: NOW.toISOString() });
    // The stub keeps who wrote, what about and the link.
    expect(row).toMatchObject({ id: "e1", from_address: "sara@customer.test", subject: "Fence", channel_id: CH_OPEN });
    expect(db.rows("inbound_email_attachments")).toHaveLength(0);
    expect(db.objectsIn("inbox-attachments")).not.toContain(path);
  });

  it("leaves a message that has not expired untouched", async () => {
    seedEmail({ id: "e2", expires_at: "2027-01-05T00:00:00Z" });
    await seedFile(T1, "e2", "plan");
    expect(await purgeExpired(as(db), { now: NOW })).toEqual({ emails: 0, files: 0 });
    expect(db.rows("inbound_emails")[0].body_text).toBe("enc-body");
    expect(db.rows("inbound_email_attachments")).toHaveLength(1);
  });

  it("keeps the record link on the stub of a converted message", async () => {
    seedEmail({ id: "e3", status: "handled", linked_object_type: "standard_quotes", linked_object_id: "q-1", converted_at: "2026-11-30T00:00:00Z", expires_at: "2026-12-30T00:00:00Z" });
    await purgeExpired(as(db), { now: NOW });
    expect(db.rows("inbound_emails")[0]).toMatchObject({ body_text: null, linked_object_type: "standard_quotes", linked_object_id: "q-1", status: "handled" });
  });

  it("never touches the copies made onto a record", async () => {
    seedEmail({ id: "e4" });
    await seedFile(T1, "e4", "plan");
    const copyPath = `${T1}/records/cases/case-1/copy.pdf`;
    await db.storage.from("inbox-attachments").upload(copyPath, Buffer.from("%PDF-1.7 x"));
    db.rows("record_files").push({ id: "rf1", tenant_id: T1, object_type: "cases", object_id: "case-1", storage_path: copyPath, source_email_id: "e4" });
    await purgeExpired(as(db), { now: NOW });
    expect(db.objectsIn("inbox-attachments")).toEqual([copyPath]);
    expect(db.rows("record_files")).toHaveLength(1);
  });

  it("is idempotent: a stub is never purged twice", async () => {
    seedEmail({ id: "e5" });
    expect(await purgeExpired(as(db), { now: NOW })).toMatchObject({ emails: 1 });
    expect(await purgeExpired(as(db), { now: NOW })).toEqual({ emails: 0, files: 0 });
  });

  it("works per workspace: each tenant's files are removed under its own folder, and nothing crosses over", async () => {
    seedEmail({ id: "t1", tenant_id: T1 });
    seedEmail({ id: "t2", tenant_id: T2, channel_id: CH_OTHER_TENANT, expires_at: "2027-06-01T00:00:00Z" });
    await seedFile(T1, "t1", "a");
    await seedFile(T2, "t2", "b");
    // A row in T1 whose path points into T2's folder is NOT removed (the folder guard): a T1 message cannot delete T2's file.
    db.rows("inbound_email_attachments").push({ id: "evil", tenant_id: T1, email_id: "t1", file_name: "x.pdf", storage_path: `${T2}/inbox/t2/b.pdf` });
    const r = await purgeExpired(as(db), { now: NOW });
    expect(r.emails).toBe(1);
    expect(db.rows("inbound_emails").find((e) => e.id === "t2")!.body_text).toBe("enc-body");
    expect(db.objectsIn("inbox-attachments")).toEqual([`${T2}/inbox/t2/b.pdf`]);
  });

  it("a pending migration is reported, not thrown", async () => {
    db.missing.add("inbound_emails");
    expect(await purgeExpired(as(db), { now: NOW })).toEqual({ emails: 0, files: 0, pending: true });
  });

  it("only removes a path inside the message's own folder", () => {
    expect(ownsPath(T1, "e1", `${T1}/inbox/e1/a.pdf`)).toBe(true);
    expect(ownsPath(T1, "e1", `${T1}/inbox/e2/a.pdf`)).toBe(false);
    expect(ownsPath(T1, "e1", `${T2}/inbox/e1/a.pdf`)).toBe(false);
    expect(ownsPath(T1, "e1", `${T1}/records/cases/c/a.pdf`)).toBe(false);
  });
});
