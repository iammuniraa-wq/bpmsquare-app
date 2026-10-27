import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "./testing/memoryDb";
import {
  CH_OPEN, CH_TEAM, ENV_KEY, PDF, DXF, PNG_BIG, T1, T2, U_ADMIN, U_PLAIN, U_SALES, file, mail, world,
} from "./testing/fixtures";

process.env.FIELD_ENCRYPTION_KEY = ENV_KEY;

const h = vi.hoisted(() => ({
  db: null as unknown as { current: unknown },
  user: { id: "", role: "member" as "admin" | "member", email: "" },
  changes: [] as Record<string, unknown>[],
  converted: [] as Record<string, unknown>[],
  handled: [] as Record<string, unknown>[],
}));
h.db = { current: null };

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => h.db.current,
  getAuthUser: async () => ({ id: h.user.id, email: h.user.email }),
  requireTenantUser: async () => ({ supabase: h.db.current, tenantId: "11111111-1111-4111-8111-111111111111", userId: h.user.id, role: h.user.role }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({ unrestricted: true, grants: new Map() }),
  canViewWorkcenter: () => true, canEditWorkcenter: () => true, canCreateWorkcenter: () => true,
}));
vi.mock("@/lib/changeLog", () => ({
  logChange: async (_s: unknown, p: Record<string, unknown>) => { h.changes.push(p); },
  diffForLog: (_t: string, b: Record<string, unknown>, a: Record<string, unknown>) => Object.keys(a).map((field) => ({ field, from: b[field] ?? null, to: a[field] })),
}));
vi.mock("@/lib/events/emitters", () => ({
  emitEmailReceived: async () => true,
  emitEmailConverted: async (_t: string, p: Record<string, unknown>) => { h.converted.push(p); return true; },
  emitEmailHandled: async (_t: string, p: Record<string, unknown>) => { h.handled.push(p); return true; },
}));

import { decrypt } from "@/lib/encryption";
import { emailBlindIndex } from "@/lib/marketing/blindIndex";
import { ingestInboxMail } from "./ingest";
import { convertEmail, copyAttachmentsToRecord, finishConversion, matchSender, type CreateInput, type Creators } from "./convert";
import { linkEstimateToEmail, loadEstimatePrefill } from "./estimateLink";
import { emailAsBrief } from "./rules";
import { toChannel } from "./server";

let db: MemoryDb;
const as = (d: MemoryDb) => d as unknown as Parameters<typeof convertEmail>[0];
const NOW = new Date("2026-11-01T09:00:00Z");

const creators = (over: Partial<Creators> = {}): Creators => ({
  quote: async () => ({ ok: true, id: "q-1", label: "SQ-0001" }),
  case: async () => ({ ok: true, id: "case-1", label: "CS-2026-0001" }),
  lead: async () => ({ ok: true, id: "lead-1", label: "Fence enquiry" }),
  project: async () => ({ ok: true, id: "proj-1", label: "PRJ-0001" }),
  deal: async () => ({ ok: true, id: "opp-1", label: "OPP-0001" }),
  ...over,
});
const input = (type: CreateInput["type"], over: Partial<CreateInput> = {}): CreateInput => ({ type, accountId: "acc-1", contactId: null, title: "Fence for 300 m", ...over });

async function incoming(channelId = CH_OPEN, over: Parameters<typeof mail>[0] = {}) {
  const ch = toChannel(db.rows("inbox_channels").find((c) => c.id === channelId)!);
  const r = await ingestInboxMail(as(db), ch, mail({ attachments: [file("plan.pdf", PDF), file("site.dxf", DXF)], ...over }), { now: new Date("2026-10-24T09:00:00Z") });
  if (!r.ok) throw new Error(r.reason);
  const row = db.rows("inbound_emails").find((e) => e.id === r.emailId)!;
  return { id: r.emailId, row, ch };
}
const emailArg = (row: Record<string, unknown>) => ({ id: row.id as string, direction: row.direction as "in" | "out", purged_at: (row.purged_at as string | null) ?? null, linked_object_id: (row.linked_object_id as string | null) ?? null, linked_object_label: (row.linked_object_label as string | null) ?? null });

beforeEach(() => {
  db = world();
  h.db.current = db;
  Object.assign(h.user, { id: U_ADMIN, role: "admin", email: "admin@gulf.test" });
  h.changes.length = 0; h.converted.length = 0; h.handled.length = 0;
  for (const [t, id] of [["standard_quotes", "q-1"], ["service_cases", "case-1"], ["leads", "lead-1"], ["wfm_projects", "proj-1"], ["estimates", "est-1"], ["opportunities", "opp-1"]] as const) db.rows(t).push({ id, tenant_id: T1 });
  db.rows("accounts").push({ id: "acc-1", tenant_id: T1, name: "ACME Fences" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Create from this email: a Quote", () => {
  it("copies the files to the quote's attachments, stores sender and summary, links back and marks the email handled", async () => {
    const { id, row, ch } = await incoming();
    const r = await convertEmail(as(db), { tenantId: T1, email: emailArg(row), channel: ch, input: input("quote"), actor: { id: U_ADMIN, email: "admin@gulf.test" }, creators: creators(), now: NOW });
    expect(r).toMatchObject({ ok: true, objectType: "standard_quotes", objectId: "q-1", label: "SQ-0001", copied: 2, total: 2 });

    // 1. files copied to the quote's own Attachments, in the quotes bucket, under the quote
    const atts = db.rows("standard_quote_attachments");
    expect(atts).toHaveLength(2);
    expect(atts.every((a) => a.tenant_id === T1 && a.standard_quote_id === "q-1" && String(a.storage_path).startsWith(`${T1}/q-1/`))).toBe(true);
    expect(db.objectsIn("quote-attachments")).toHaveLength(2);
    // ... and the originals are still in the inbox bucket until retention clears them
    expect(db.objectsIn("inbox-attachments")).toHaveLength(2);

    // 2. sender + summary stored on the record (summary encrypted)
    const src = db.rows("record_sources")[0];
    expect(src).toMatchObject({ tenant_id: T1, object_type: "standard_quotes", object_id: "q-1", source_email_id: id, from_address: "sara@customer.test", from_name: "Sara Khan", subject: "Fence for 300 m", channel_name: "Fence enquiries" });
    expect(String(src.summary).startsWith("enc:v1:")).toBe(true);
    expect(decrypt(src.summary as string)).toBe("Please quote 300 m of fence, 2 m high.");

    // 3. linked, handled, retention restarted at 30 days
    expect(row).toMatchObject({ linked_object_type: "standard_quotes", linked_object_id: "q-1", linked_object_label: "SQ-0001", status: "handled", handled_by: U_ADMIN });
    expect(row.converted_at).toBe(NOW.toISOString());
    expect(row.expires_at).toBe("2026-12-01T09:00:00.000Z");

    // 4. history and events
    expect(h.changes).toHaveLength(1);
    expect(h.changes[0]).toMatchObject({ tenantId: T1, objectType: "inbound_emails", objectId: id, action: "update" });
    // The history names the channel and the message, never the sender or what they wrote.
    expect(JSON.stringify(h.changes[0])).not.toMatch(/sara|customer\.test|300 m|quote 300/i);
    expect(h.converted[0]).toMatchObject({ emailId: id, objectType: "standard_quotes", objectId: "q-1", attachments: 2 });
    expect(h.handled[0]).toMatchObject({ emailId: id, status: "handled", via: "conversion" });
    expect(db.rows("activities")[0]).toMatchObject({ tenant_id: T1, account_id: "acc-1" });
  });

  it("restarts the clock for the whole conversation, our replies included", async () => {
    const { row, ch } = await incoming();
    db.rows("inbound_emails").push({ id: "out-1", tenant_id: T1, channel_id: CH_OPEN, direction: "out", thread_key: row.thread_key, expires_at: row.expires_at, purged_at: null });
    await convertEmail(as(db), { tenantId: T1, email: emailArg(row), channel: ch, input: input("quote"), actor: { id: U_ADMIN, email: null }, creators: creators(), now: NOW });
    expect(db.rows("inbound_emails").find((e) => e.id === "out-1")!.expires_at).toBe("2026-12-01T09:00:00.000Z");
  });
});

describe("Create from this email: the other records", () => {
  it.each([
    ["case", "cases", "case-1"],
    ["lead", "leads", "lead-1"],
    ["project", "wfm_projects", "proj-1"],
    ["deal", "opportunities", "opp-1"],
  ] as const)("a %s gets the files as its own files, in a folder of its own", async (type, objectType, objectId) => {
    const { id, row, ch } = await incoming();
    const r = await convertEmail(as(db), { tenantId: T1, email: emailArg(row), channel: ch, input: input(type), actor: { id: U_ADMIN, email: null }, creators: creators(), now: NOW });
    expect(r).toMatchObject({ ok: true, objectType, objectId, copied: 2 });
    const files = db.rows("record_files");
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.tenant_id === T1 && f.object_type === objectType && f.object_id === objectId && f.source_email_id === id && String(f.storage_path).startsWith(`${T1}/records/${objectType}/${objectId}/`))).toBe(true);
    expect(db.rows("standard_quote_attachments")).toHaveLength(0);
    expect(row).toMatchObject({ linked_object_type: objectType, linked_object_id: objectId, status: "handled" });
  });

  it("a record that survives the email: the copies stay when the original files are gone", async () => {
    const { row, ch } = await incoming();
    await convertEmail(as(db), { tenantId: T1, email: emailArg(row), channel: ch, input: input("case"), actor: { id: U_ADMIN, email: null }, creators: creators(), now: NOW });
    const { purgeExpired } = await import("./purge");
    await purgeExpired(as(db), { now: new Date("2027-03-01T00:00:00Z") });
    expect(db.rows("inbound_emails")[0].body_text).toBeNull();
    expect(db.objectsIn("inbox-attachments").filter((p) => p.includes("/records/"))).toHaveLength(2);
    expect(db.rows("record_files")).toHaveLength(2);
    expect(db.rows("record_sources")).toHaveLength(1);
  });

  it("a file that cannot be copied is counted out, not claimed", async () => {
    const { id, row, ch } = await incoming();
    const first = db.rows("inbound_email_attachments").find((a) => a.email_id === id)!;
    db.storageObjects.delete(`inbox-attachments/${first.storage_path}`);
    const r = await convertEmail(as(db), { tenantId: T1, email: emailArg(row), channel: ch, input: input("case"), actor: { id: U_ADMIN, email: null }, creators: creators(), now: NOW });
    expect(r).toMatchObject({ ok: true, copied: 1, total: 2 });
  });
});

describe("guards", () => {
  it("one email becomes one record", async () => {
    const { row, ch } = await incoming();
    const args = { tenantId: T1, email: emailArg(row), channel: ch, input: input("quote"), actor: { id: U_ADMIN, email: null }, creators: creators(), now: NOW };
    expect(await convertEmail(as(db), args)).toMatchObject({ ok: true });
    const again = await convertEmail(as(db), { ...args, email: emailArg(row) });
    expect(again).toMatchObject({ ok: false, status: 409 });
  });

  it("a cleared email, our own reply and an estimate are not converted here", async () => {
    const { row, ch } = await incoming();
    const base = { tenantId: T1, channel: ch, actor: { id: U_ADMIN, email: null }, creators: creators() };
    expect(await convertEmail(as(db), { ...base, email: { ...emailArg(row), purged_at: "2026-12-01" }, input: input("quote") })).toMatchObject({ ok: false, status: 410 });
    expect(await convertEmail(as(db), { ...base, email: { ...emailArg(row), direction: "out" }, input: input("quote") })).toMatchObject({ ok: false, status: 422 });
    expect(await convertEmail(as(db), { ...base, email: emailArg(row), input: input("estimate") })).toMatchObject({ ok: false, status: 422 });
    expect(db.rows("record_sources")).toHaveLength(0);
  });

  it("a creator that fails leaves the email exactly as it was", async () => {
    const { row, ch } = await incoming();
    const r = await convertEmail(as(db), {
      tenantId: T1, email: emailArg(row), channel: ch, input: input("case"), actor: { id: U_ADMIN, email: null },
      creators: creators({ case: async () => ({ ok: false, error: "complaint is required", status: 400 }) }),
    });
    expect(r).toEqual({ ok: false, error: "complaint is required", status: 400 });
    expect(row).toMatchObject({ status: "new", linked_object_id: null });
    expect(db.rows("record_files")).toHaveLength(0);
  });

  it("a record id that is not this workspace's is never linked", async () => {
    const { row, ch } = await incoming();
    db.rows("standard_quotes").length = 0;
    db.rows("standard_quotes").push({ id: "q-1", tenant_id: T2 });
    const r = await convertEmail(as(db), { tenantId: T1, email: emailArg(row), channel: ch, input: input("quote"), actor: { id: U_ADMIN, email: null }, creators: creators() });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(row.linked_object_id ?? null).toBeNull();
    expect(db.rows("standard_quote_attachments")).toHaveLength(0);
  });

  it("an email id of another workspace is never touched", async () => {
    const { id } = await incoming();
    const r = await finishConversion(as(db), { tenantId: T2, emailId: id, objectType: "cases", objectId: "case-1", objectLabel: "CS-1", actor: { id: null, email: null } });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("copyAttachmentsToRecord copies only the files of this email in this workspace", async () => {
    const { id } = await incoming();
    db.rows("inbound_email_attachments").push({ id: "foreign", tenant_id: T2, email_id: id, file_name: "x.pdf", storage_path: `${T2}/inbox/${id}/x.pdf`, ext: "pdf" });
    const r = await copyAttachmentsToRecord(as(db), { tenantId: T1, emailId: id, objectType: "leads", objectId: "lead-1", actorId: null });
    expect(r).toEqual({ copied: 2, total: 2 });
  });
});

describe("the sender is matched by the contact's e-mail blind index, inside the workspace", () => {
  it("finds the contact and its account", async () => {
    db.rows("contacts").push({ id: "c-1", tenant_id: T1, name: "Sara K", account_id: "acc-1", email_hash: emailBlindIndex("sara@customer.test") });
    const m = await matchSender(as(db), T1, "Sara@Customer.test");
    expect(m).toEqual({ contactId: "c-1", contactName: "Sara K", accountId: "acc-1", accountName: "ACME Fences" });
  });
  it("another workspace's contact with the same address is not a match", async () => {
    db.rows("contacts").push({ id: "c-2", tenant_id: T2, name: "Sara", account_id: "acc-x", email_hash: emailBlindIndex("sara@customer.test") });
    expect(await matchSender(as(db), T1, "sara@customer.test")).toBeNull();
  });
  it("no address or no key is no match, not an error", async () => {
    expect(await matchSender(as(db), T1, null)).toBeNull();
    const k = process.env.FIELD_ENCRYPTION_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY;
    expect(await matchSender(as(db), T1, "sara@customer.test")).toBeNull();
    process.env.FIELD_ENCRYPTION_KEY = k;
  });
});

describe("estimates: linked when they are saved from the workspace", () => {
  it("the email becomes the intake brief, with the sender, for someone on the channel's team", async () => {
    const { id } = await incoming(CH_OPEN, { text: "Two floors, 180 m2 each.", subject: "Villa in Riyadh" });
    Object.assign(h.user, { id: U_PLAIN, role: "member", email: "plain@gulf.test" });
    const p = await loadEstimatePrefill(id);
    expect(p?.brief).toBe(emailAsBrief({ subject: "Villa in Riyadh", from_name: "Sara Khan", from_address: "sara@customer.test", body_text: "Two floors, 180 m2 each." }));
    expect(p?.brief).toMatch(/^Subject: Villa in Riyadh\nFrom: Sara Khan <sara@customer.test>\n\nTwo floors/);
  });

  it("a person who is not on the team of the channel gets nothing, and links nothing", async () => {
    const { id, row } = await incoming(CH_TEAM, { to: ["x@y.test"] });
    Object.assign(h.user, { id: U_PLAIN, role: "member", email: "plain@gulf.test" });
    expect(await loadEstimatePrefill(id)).toBeNull();
    expect(await linkEstimateToEmail({ sourceEmailId: id, estimate: { id: "est-1", label: "EST-0001" } })).toEqual({ linked: false, copied: 0 });
    expect(row.linked_object_id ?? null).toBeNull();
    expect(db.rows("record_sources")).toHaveLength(0);
  });

  it("someone on the team links the estimate: files copied, handled, history written", async () => {
    const { id, row } = await incoming(CH_TEAM, { to: ["x@y.test"] });
    Object.assign(h.user, { id: U_SALES, role: "member", email: "sales@gulf.test" });
    const r = await linkEstimateToEmail({ sourceEmailId: id, estimate: { id: "est-1", label: "EST-0001" }, accountId: "acc-1" });
    expect(r).toEqual({ linked: true, copied: 2 });
    expect(row).toMatchObject({ linked_object_type: "estimates", linked_object_id: "est-1", status: "handled" });
    expect(db.rows("record_files").every((f) => f.object_type === "estimates")).toBe(true);
    expect(h.converted[0]).toMatchObject({ objectType: "estimates" });
  });

  it("ignores an id that is not a message, an email already linked, and a cleared one", async () => {
    Object.assign(h.user, { id: U_ADMIN, role: "admin" });
    expect(await linkEstimateToEmail({ sourceEmailId: "not-an-id", estimate: { id: "est-1", label: "E" } })).toMatchObject({ linked: false });
    expect(await linkEstimateToEmail({ sourceEmailId: 42, estimate: { id: "est-1", label: "E" } })).toMatchObject({ linked: false });
    const { id, row } = await incoming();
    row.linked_object_id = "q-1";
    expect(await linkEstimateToEmail({ sourceEmailId: id, estimate: { id: "est-1", label: "E" } })).toMatchObject({ linked: false });
    row.linked_object_id = null;
    row.purged_at = "2026-12-01";
    expect(await linkEstimateToEmail({ sourceEmailId: id, estimate: { id: "est-1", label: "E" } })).toMatchObject({ linked: false });
  });

  it("an image-only email is still convertible, with its photo labelled for review", async () => {
    const { row, ch } = await incoming(CH_OPEN, { text: "", attachments: [file("photo.png", PNG_BIG)] });
    const r = await convertEmail(as(db), { tenantId: T1, email: emailArg(row), channel: ch, input: input("lead"), actor: { id: U_ADMIN, email: null }, creators: creators(), now: NOW });
    expect(r).toMatchObject({ ok: true, copied: 1 });
    expect(decrypt(db.rows("record_sources")[0].summary as string | null) ?? null).toBeNull();
  });
});
