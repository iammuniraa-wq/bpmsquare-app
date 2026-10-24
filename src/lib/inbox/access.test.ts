import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "./testing/memoryDb";
import {
  CH_OPEN, CH_OTHER_TENANT, CH_TEAM, ENV_KEY, T1, T2, U_ADMIN, U_PLAIN, U_SALES, world,
} from "./testing/fixtures";

process.env.FIELD_ENCRYPTION_KEY = ENV_KEY;
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ resolvePermissions: vi.fn(), canViewWorkcenter: () => true, canEditWorkcenter: () => true, canCreateWorkcenter: () => true }));
vi.mock("@/lib/changeLog", () => ({ logChange: vi.fn(), diffForLog: (_t: string, b: Record<string, unknown>, a: Record<string, unknown>) => Object.keys(a).map((field) => ({ field, from: b[field] ?? null, to: a[field] })) }));
vi.mock("@/lib/events/emitters", () => ({ emitEmailHandled: vi.fn() }));

import { encrypt } from "@/lib/encryption";
import { attachmentLink, recordFileLink } from "./files";
import { getInboxAnalytics, inboxBriefingRows } from "./analytics";
import { patchEmail } from "./detail";
import { searchInboxMail } from "./search";
import { hiddenEmailIds, listEmails, loadEmailForViewer, loadThread, userCanSeeEmail, visibleChannelIds, type InboxCtx } from "./server";
import { inboxCandidates } from "@/lib/briefing/rules";

let db: MemoryDb;
const as = (d: MemoryDb) => d as unknown as InboxCtx["admin"];
const ctxFor = (userId: string, isAdmin = false, roleIds: string[] = []) => ({ admin: as(db), tenantId: T1, viewer: { isAdmin, roleIds } }) as Pick<InboxCtx, "admin" | "tenantId" | "viewer">;
const SALES = () => ctxFor(U_SALES, false, ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]);
const PLAIN = () => ctxFor(U_PLAIN);
const ADMIN = () => ctxFor(U_ADMIN, true);

function msg(id: string, channelId: string, tenantId: string, over: Record<string, unknown> = {}) {
  db.rows("inbound_emails").push({
    id, tenant_id: tenantId, channel_id: channelId, direction: "in", from_address: `${id}@customer.test`, from_name: `Sender ${id}`, subject: `Subject ${id}`,
    snippet: encrypt(`snippet ${id}`), body_text: encrypt(`body ${id}`), status: "new", received_at: "2026-10-24T08:00:00Z", expires_at: "2027-01-22T00:00:00Z",
    thread_key: `t-${id}`, to_addresses: [], message_id: `${id}@x`, ...over,
  });
}

beforeEach(() => {
  db = world();
  msg("11111111-0000-4000-8000-000000000001", CH_OPEN, T1);
  msg("11111111-0000-4000-8000-000000000002", CH_TEAM, T1);
  msg("22222222-0000-4000-8000-000000000003", CH_OTHER_TENANT, T2);
});
const E_OPEN = "11111111-0000-4000-8000-000000000001";
const E_TEAM = "11111111-0000-4000-8000-000000000002";
const E_FOREIGN = "22222222-0000-4000-8000-000000000003";

describe("channel visibility by team", () => {
  it("a member without the team's role sees only the open channel", async () => {
    const r = await listEmails(PLAIN(), {});
    expect(r.emails.map((e) => e.id)).toEqual([E_OPEN]);
    expect(r.channels.map((c) => c.id)).toEqual([CH_OPEN]);
    expect(r.total).toBe(1);
  });
  it("a member on the team sees both; an admin sees both", async () => {
    expect((await listEmails(SALES(), {})).emails.map((e) => e.id).sort()).toEqual([E_OPEN, E_TEAM].sort());
    expect((await listEmails(ADMIN(), {})).emails).toHaveLength(2);
  });
  it("asking for a channel you are not on is an empty list, not an error and not a leak", async () => {
    const r = await listEmails(PLAIN(), { channel: CH_TEAM });
    // The filter falls back to the person's own channels: nothing of the team's comes through.
    expect(r.emails.map((e) => e.id)).toEqual([E_OPEN]);
  });
  it("the counts, the search and the status filter obey the same limit", async () => {
    const r = await listEmails(PLAIN(), { status: "new", q: "Subject" });
    expect(r.counts).toEqual({ new: 1, handled: 0, spam: 0 });
    expect(r.emails).toHaveLength(1);
    expect((await listEmails(PLAIN(), { q: "Sender 11111111-0000-4000-8000-000000000002" })).emails).toHaveLength(0);
  });
  it("one message: another team's is a not-found for you, and yours opens", async () => {
    expect(await loadEmailForViewer(PLAIN(), E_TEAM)).toBeNull();
    expect((await loadEmailForViewer(PLAIN(), E_OPEN))?.email.body_text).toBe("body 11111111-0000-4000-8000-000000000001");
    expect((await loadEmailForViewer(SALES(), E_TEAM))?.channel.id).toBe(CH_TEAM);
  });
  it("a message id that is not a uuid is not a lookup at all", async () => {
    expect(await loadEmailForViewer(ADMIN(), "x' or '1'='1")).toBeNull();
  });
  it("the thread of a hidden message is not reachable by its id either", async () => {
    expect(await loadEmailForViewer(PLAIN(), E_TEAM)).toBeNull();
    const t = await loadThread(ADMIN(), { id: E_TEAM, channel_id: CH_TEAM, thread_key: `t-${E_TEAM}` });
    expect(t).toHaveLength(1);
  });
  it("hiddenEmailIds and userCanSeeEmail agree (Nova comments and mentions use them)", async () => {
    expect([...(await hiddenEmailIds(as(db), T1, U_PLAIN, false, [E_OPEN, E_TEAM, E_FOREIGN]))].sort()).toEqual([E_TEAM, E_FOREIGN].sort());
    expect(await userCanSeeEmail(as(db), T1, U_SALES, false, E_TEAM)).toBe(true);
    expect(await userCanSeeEmail(as(db), T1, U_PLAIN, false, E_TEAM)).toBe(false);
    expect(await userCanSeeEmail(as(db), T1, U_ADMIN, true, E_TEAM)).toBe(true);
    expect(await userCanSeeEmail(as(db), T1, U_ADMIN, true, E_FOREIGN)).toBe(false);
  });
  it("the channel ids search and briefing use are the person's own", async () => {
    expect(await visibleChannelIds(as(db), T1, U_PLAIN, false)).toEqual([CH_OPEN]);
    expect((await visibleChannelIds(as(db), T1, U_SALES, false)).sort()).toEqual([CH_OPEN, CH_TEAM].sort());
    expect(await visibleChannelIds(as(db), T2, U_ADMIN, true)).toEqual([CH_OTHER_TENANT]);
  });
});

describe("tenant isolation", () => {
  it("nothing of another workspace is ever listed, counted, opened or searched", async () => {
    expect((await listEmails(ADMIN(), {})).emails.map((e) => e.id)).not.toContain(E_FOREIGN);
    expect(await loadEmailForViewer(ADMIN(), E_FOREIGN)).toBeNull();
    expect(await searchInboxMail(as(db), T1, [CH_OPEN, CH_TEAM, CH_OTHER_TENANT], "Subject", 10)).toHaveLength(2);
    expect((await listEmails({ ...ADMIN(), tenantId: T2 }, {})).emails.map((e) => e.id)).toEqual([E_FOREIGN]);
  });
  it("a foreign channel id handed to the list is ignored", async () => {
    expect((await listEmails(ADMIN(), { channel: CH_OTHER_TENANT })).emails.map((e) => e.id).sort()).toEqual([E_OPEN, E_TEAM].sort());
  });
  it("analytics and briefing rows are counted per workspace", async () => {
    db.rows("inbound_emails").find((e) => e.id === E_OPEN)!.received_at = new Date().toISOString();
    const a = await getInboxAnalytics(as(db), T1);
    expect(a.unhandled).toBe(2);
    expect((await getInboxAnalytics(as(db), T2)).unhandled).toBe(1);
  });
});

describe("files are signed per request, for people who may see the message", () => {
  beforeEach(async () => {
    const path = `${T1}/inbox/${E_TEAM}/a.pdf`;
    await db.storage.from("inbox-attachments").upload(path, Buffer.from("%PDF-1.7 x"));
    db.rows("inbound_email_attachments").push({ id: "11111111-0000-4000-8000-0000000000aa", tenant_id: T1, email_id: E_TEAM, file_name: "a.pdf", storage_path: path, mime_type: "application/pdf" });
    const foreign = `${T2}/inbox/${E_FOREIGN}/f.pdf`;
    await db.storage.from("inbox-attachments").upload(foreign, Buffer.from("%PDF-1.7 x"));
    db.rows("inbound_email_attachments").push({ id: "22222222-0000-4000-8000-0000000000bb", tenant_id: T2, email_id: E_FOREIGN, file_name: "f.pdf", storage_path: foreign, mime_type: "application/pdf" });
  });
  it("the team gets a short-lived download link; a non-member and another workspace get nothing", async () => {
    const link = await attachmentLink(SALES(), "11111111-0000-4000-8000-0000000000aa");
    expect(link?.name).toBe("a.pdf");
    expect(link?.url).toMatch(/^https:\/\/signed\.test\/inbox-attachments\/.+\?t=60&download=a\.pdf$/);
    expect(await attachmentLink(PLAIN(), "11111111-0000-4000-8000-0000000000aa")).toBeNull();
    expect(await attachmentLink(ADMIN(), "22222222-0000-4000-8000-0000000000bb")).toBeNull();
    expect(await attachmentLink(ADMIN(), "not-a-uuid")).toBeNull();
  });
  it("an image opens inline, a drawing downloads", async () => {
    const path = `${T1}/inbox/${E_OPEN}/p.png`;
    await db.storage.from("inbox-attachments").upload(path, Buffer.from("x"));
    db.rows("inbound_email_attachments").push({ id: "11111111-0000-4000-8000-0000000000cc", tenant_id: T1, email_id: E_OPEN, file_name: "p.png", storage_path: path, mime_type: "image/png" });
    expect((await attachmentLink(PLAIN(), "11111111-0000-4000-8000-0000000000cc"))?.url).not.toMatch(/download=/);
  });
  it("a record file link is tenant-scoped too", async () => {
    const path = `${T1}/records/cases/c1/x.pdf`;
    await db.storage.from("inbox-attachments").upload(path, Buffer.from("x"));
    db.rows("record_files").push({ id: "11111111-0000-4000-8000-0000000000dd", tenant_id: T1, object_type: "cases", file_name: "x.pdf", storage_path: path, mime_type: "application/pdf" });
    expect(await recordFileLink(as(db), T1, "11111111-0000-4000-8000-0000000000dd")).toMatchObject({ objectType: "cases", name: "x.pdf" });
    expect(await recordFileLink(as(db), T2, "11111111-0000-4000-8000-0000000000dd")).toBeNull();
  });
});

describe("status and assignment", () => {
  const edit = (userId: string, role: "admin" | "member", roleIds: string[] = []) => ({ ...ctxFor(userId, role === "admin", roleIds), userId, email: null, role }) as unknown as InboxCtx;
  it("marks handled / spam / new, with who and when", async () => {
    const ctx = edit(U_ADMIN, "admin");
    expect((await patchEmail(ctx, E_OPEN, { status: "handled" }))).toMatchObject({ ok: true });
    expect(db.rows("inbound_emails").find((e) => e.id === E_OPEN)).toMatchObject({ status: "handled", handled_by: U_ADMIN });
    await patchEmail(ctx, E_OPEN, { status: "new" });
    expect(db.rows("inbound_emails").find((e) => e.id === E_OPEN)).toMatchObject({ status: "new", handled_at: null, handled_by: null });
    expect(await patchEmail(ctx, E_OPEN, { status: "done" })).toMatchObject({ ok: false, status: 422 });
  });
  it("assigns only a person on the channel's team", async () => {
    const ctx = edit(U_ADMIN, "admin");
    expect(await patchEmail(ctx, E_TEAM, { assigned_to: U_SALES })).toMatchObject({ ok: true });
    expect(db.rows("inbound_emails").find((e) => e.id === E_TEAM)!.assigned_to).toBe(U_SALES);
    expect(await patchEmail(ctx, E_TEAM, { assigned_to: U_PLAIN })).toMatchObject({ ok: false, status: 422 });
    expect(await patchEmail(ctx, E_OPEN, { assigned_to: U_PLAIN })).toMatchObject({ ok: true });
  });
  it("cannot change a message of a channel you are not on, or of another workspace", async () => {
    expect(await patchEmail(edit(U_PLAIN, "member"), E_TEAM, { status: "spam" })).toMatchObject({ ok: false, status: 404 });
    expect(await patchEmail(edit(U_ADMIN, "admin"), E_FOREIGN, { status: "spam" })).toMatchObject({ ok: false, status: 404 });
    expect(db.rows("inbound_emails").find((e) => e.id === E_FOREIGN)!.status).toBe("new");
  });
});

describe("what the morning briefing and search may say", () => {
  it("search finds sender and subject in the person's channels only, and never the body", async () => {
    expect((await searchInboxMail(as(db), T1, [CH_OPEN], "Subject", 10)).map((r) => r.id)).toEqual([E_OPEN]);
    expect(await searchInboxMail(as(db), T1, [CH_OPEN], "body 1111", 10)).toEqual([]);
    expect(await searchInboxMail(as(db), T1, [], "Subject", 10)).toEqual([]);
    expect(await searchInboxMail(as(db), T1, [CH_OPEN], "a", 10)).toEqual([]);
    expect(await searchInboxMail(as(db), T1, [CH_OPEN], "x),(tenant_id.eq.y", 10)).toEqual([]);
  });
  it("the briefing counts new mail per channel the person is on, unassigned or theirs, with the channel's name only", async () => {
    db.rows("inbound_emails").find((e) => e.id === E_TEAM)!.assigned_to = U_ADMIN;
    const rows = await inboxBriefingRows(as(db), { tenantId: T1, userId: U_SALES, isAdmin: false });
    // E_TEAM is assigned to somebody else, so the sales user has nothing waiting there; the open channel has one.
    expect(rows).toEqual([{ channelId: CH_OPEN, channelName: "Fence enquiries", count: 1, oldestAt: "2026-10-24T08:00:00Z" }]);
    const plain = await inboxBriefingRows(as(db), { tenantId: T1, userId: U_PLAIN, isAdmin: false });
    expect(plain.map((r) => r.channelId)).toEqual([CH_OPEN]);
    const c = inboxCandidates(rows, "2026-10-26", "UTC");
    expect(c[0]).toMatchObject({ kind: "inbox_new", label: "1 new email in Fence enquiries", days: 2, count: 1, ownership: "own" });
    expect(JSON.stringify(c)).not.toMatch(/customer\.test|Subject|Sender/);
  });
});
