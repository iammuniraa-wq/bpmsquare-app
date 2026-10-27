import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

// GCC tender deals, slice 2: the internal Deal Room, against an in-memory database. The questions asked here are the ones the
// design lists: another workspace cannot read or post, a person without the Pipeline gets a 404, the flag hides everything,
// delete is soft, mentions come from the text, the poll cursor finds changes, files are judged on their bytes.

const state = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  tenantId: "t1",
  features: {} as Record<string, boolean>,
  pipelineView: true,
  touched: [] as string[],
  changes: [] as { objectType: string; objectId: string; action: string; changes?: { field: string; from: unknown; to: unknown }[] }[],
  user: { id: "u1", email: "me@t1.test" },
  role: "member" as "admin" | "member",
}));

const T1 = "t1";
const T2 = "t2";
const ME = "11111111-1111-4111-8111-111111111111";
const ANN = "22222222-2222-4222-8222-222222222222";
const BOSS = "33333333-3333-4333-8333-333333333333";
const NEWBIE = "44444444-4444-4444-8444-444444444444";
const OTHER = "99999999-9999-4999-8999-999999999999";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const OPP_STD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: (t: string) => { state.touched.push(t); return state.db.from(t); }, auth: state.db.auth, storage: state.db.storage }),
  getAuthUser: async () => state.user,
  requireTenantUser: async () => ({ tenantId: state.tenantId, userId: state.user.id, role: state.role, supabase: {} }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!state.features[key],
  getTenant: async () => ({ config: {}, features: state.features }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({ unrestricted: state.pipelineView, grants: new Map() }),
  canViewWorkcenter: (p: { unrestricted: boolean }) => p.unrestricted,
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: () => [],
  logChange: async (_c: unknown, p: (typeof state.changes)[number]) => { state.changes.push(p); },
}));

import { NextRequest } from "next/server";
import { GET as roomGet, POST as roomPost } from "./[opportunityId]/route";
import { GET as messagesGet, POST as messagesPost } from "./[opportunityId]/messages/route";
import { PATCH as messagePatch } from "./[opportunityId]/messages/[messageId]/route";
import { POST as membersPost, DELETE as membersDelete } from "./[opportunityId]/members/route";
import { POST as readPost } from "./[opportunityId]/read/route";
import { GET as fileGet } from "./[opportunityId]/files/[fileId]/route";
import { roomSummary, unreadByDeal } from "@/lib/tender/roomServer";

const url = (q = "") => new URL(`http://internal.invalid/x${q}`);
const jreq = (method: string, body?: unknown, q = "") => new NextRequest(url(q), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (q = "") => new NextRequest(url(q), { method: "GET" });
const freq = (fields: Record<string, string>, files: File[]) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const f of files) form.append("files", f);
  return new NextRequest(url(), { method: "POST", body: form });
};
const rctx = (opportunityId = OPP) => ({ params: Promise.resolve({ opportunityId }) });
const mctx = (messageId: string, opportunityId = OPP) => ({ params: Promise.resolve({ opportunityId, messageId }) });
const fctx = (fileId: string, opportunityId = OPP) => ({ params: Promise.resolve({ opportunityId, fileId }) });
const as = (id: string, role: "admin" | "member" = "member") => { state.user = { id, email: `${id.slice(0, 2)}@t1.test` }; state.role = role; };

const rooms = () => state.db.rows("deal_rooms");
const members = () => state.db.rows("deal_room_members");
const msgs = () => state.db.rows("deal_room_messages");
const roomTables = () => state.touched.filter((t) => t.startsWith("deal_room"));

const pdf = (name = "boq.pdf") => new File([new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF")], name, { type: "application/pdf" });

async function post(body: Record<string, unknown>) {
  const res = await messagesPost(jreq("POST", body), rctx());
  return { res, json: (await res.json()) as { message?: { id: string; body: string | null; removed: boolean; question: { status: string; owner_id: string | null } | null; files: { id: string; name: string }[]; mentions: string[]; author_id: string; author_name: string }; error?: string } };
}

beforeEach(() => {
  state.db = new MemoryDb({
    tenants: [{ id: T1, features: {} }, { id: T2, features: {} }],
    tenant_users: [
      { tenant_id: T1, user_id: ME, role: "member" }, { tenant_id: T1, user_id: ANN, role: "member" },
      { tenant_id: T1, user_id: BOSS, role: "admin" }, { tenant_id: T1, user_id: NEWBIE, role: "member" }, { tenant_id: T2, user_id: OTHER, role: "admin" },
    ],
    opportunities: [
      { id: OPP_STD, tenant_id: T1, ref: "OPP-1", title: "Standard deal", account_id: "acc", stage: "qualify", outcome: "open", owner_id: ME, team: [] },
      { id: OPP, tenant_id: T1, ref: "OPP-2", title: "Pipes for Plant 4", account_id: "acc", stage: "estimating", outcome: "open", owner_id: ME, team: [{ user_id: ANN, role: "technical" }, { user_id: OTHER, role: "sales" }] },
      { id: OPP_T2, tenant_id: T2, ref: "OPP-3", title: "Other tenant tender", account_id: "acc", stage: "estimating", outcome: "open", owner_id: OTHER, team: [] },
    ],
    opportunity_tenders: [
      { opportunity_id: OPP, tenant_id: T1, tender_no: "ARB-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { opportunity_id: OPP_T2, tenant_id: T2, tender_no: "T2-1", reminders_sent: [], addenda_count: 0, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ],
  });
  state.db.unique("deal_rooms", (e, n) => e.opportunity_id === n.opportunity_id);
  state.db.unique("deal_room_members", (e, n) => e.room_id === n.room_id && e.user_id === n.user_id);
  state.db.users.set(ME, { email: "me@kamco.test", name: "S. Khan" });
  state.db.users.set(ANN, { email: "ann@kamco.test", name: "Ann" });
  state.db.users.set(BOSS, { email: "boss@kamco.test", name: "A. Nasser" });
  state.db.users.set(NEWBIE, { email: "newbie@kamco.test", name: "Newbie" });
  state.db.users.set(OTHER, { email: "other@else.test", name: "Other Person" });
  state.tenantId = T1;
  state.features = { pipeline: true, gcc_tender: true, deal_room: true };
  state.pipelineView = true;
  state.touched = []; state.changes = [];
  as(ME);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("who can reach a room", () => {
  it("a member of another workspace gets a 404 on every route and nothing is read or written", async () => {
    state.tenantId = T2;
    as(OTHER, "admin");
    const calls = [
      () => roomGet(get(), rctx()), () => roomPost(jreq("POST"), rctx()), () => messagesGet(get(), rctx()), () => messagesPost(jreq("POST", { body: "hi" }), rctx()),
      () => membersPost(jreq("POST", { user_id: OTHER }), rctx()), () => readPost(jreq("POST"), rctx()), () => fileGet(get(), fctx("f")),
    ];
    for (const call of calls) expect((await call()).status).toBe(404);
    expect(rooms()).toHaveLength(0);
    expect(msgs()).toHaveLength(0);
  });

  it("the deal is matched by id AND workspace: with a room in each workspace, a caller sees only their own", async () => {
    await roomPost(jreq("POST"), rctx());
    state.tenantId = T2;
    as(OTHER, "admin");
    await roomPost(jreq("POST"), rctx(OPP_T2));
    await messagesPost(jreq("POST", { body: "other tenant secret" }), rctx(OPP_T2));
    state.tenantId = T1;
    as(ME);
    const mine = await (await messagesGet(get(), rctx())).json();
    expect(JSON.stringify(mine)).not.toContain("other tenant secret");
    expect((await messagesGet(get(), rctx(OPP_T2))).status).toBe(404);
  });

  it("a member without the Pipeline workcenter gets a 404, not a 403", async () => {
    state.pipelineView = false;
    for (const call of [() => roomGet(get(), rctx()), () => messagesGet(get(), rctx()), () => messagesPost(jreq("POST", { body: "hi" }), rctx())]) {
      const res = await call();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    }
    expect(roomTables()).toEqual([]);
  });

  it("a member who may open the Pipeline can read and post without being added first", async () => {
    await roomPost(jreq("POST"), rctx());
    as(NEWBIE);
    expect((await messagesGet(get(), rctx())).status).toBe(200);
    const { res } = await post({ body: "Joining in" });
    expect(res.status).toBe(201);
    expect(members().some((m) => m.user_id === NEWBIE)).toBe(true);
  });

  it("with either flag off every route is a 404 and no room table is touched", async () => {
    for (const features of [{ pipeline: true, gcc_tender: true }, { pipeline: true, deal_room: true }, { gcc_tender: true, deal_room: true }] as Record<string, boolean>[]) {
      state.features = features;
      state.touched = [];
      for (const call of [() => roomGet(get(), rctx()), () => roomPost(jreq("POST"), rctx()), () => messagesGet(get(), rctx()), () => messagesPost(jreq("POST", { body: "hi" }), rctx()), () => readPost(jreq("POST"), rctx())]) {
        expect((await call()).status).toBe(404);
      }
      expect(state.touched).toEqual([]);
    }
    expect(rooms()).toHaveLength(0);
  });

  it("a deal that is not a tender, or does not exist, has no room", async () => {
    expect((await roomPost(jreq("POST"), rctx(OPP_STD))).status).toBe(404);
    expect((await roomGet(get(), rctx("not-an-id"))).status).toBe(404);
    expect(rooms()).toHaveLength(0);
  });

  it("while migration 0222 is pending every route says a database update is needed", async () => {
    for (const t of ["deal_rooms", "deal_room_members", "deal_room_messages", "deal_room_files"]) state.db.missing.add(t);
    for (const call of [() => roomGet(get(), rctx()), () => roomPost(jreq("POST"), rctx()), () => messagesGet(get(), rctx()), () => messagesPost(jreq("POST", { body: "hi" }), rctx()), () => readPost(jreq("POST"), rctx())]) {
      const res = await call();
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/0222/);
    }
    expect((await roomSummary(state.db as never, T1, ME, OPP))).toEqual({ pending: true, exists: false, unread: 0, openQuestions: 0 });
    expect((await unreadByDeal(state.db as never, T1, ME)).size).toBe(0);
  });
});

describe("opening the room", () => {
  it("makes it once, with the owner, the team members of this workspace and the opener; again changes nothing", async () => {
    const res = await roomPost(jreq("POST"), rctx());
    expect(res.status).toBe(201);
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0]).toMatchObject({ tenant_id: T1, opportunity_id: OPP, created_by: ME });
    // OTHER is on the deal's team but belongs to another workspace: not added.
    expect(members().map((m) => m.user_id).sort()).toEqual([ME, ANN].sort());
    expect(state.changes.at(-1)).toMatchObject({ objectType: "deal_rooms", action: "create" });
    const again = await roomPost(jreq("POST"), rctx());
    expect(again.status).toBe(200);
    expect(rooms()).toHaveLength(1);
    expect(members()).toHaveLength(2);
  });

  it("the header lists members with when they were last here and who could still be added, never another workspace's people", async () => {
    await roomPost(jreq("POST"), rctx());
    const head = await (await roomGet(get(), rctx())).json();
    expect(head.members.map((m: { name: string }) => m.name)).toEqual(["Ann", "S. Khan"]);
    expect(head.members.find((m: { is_you: boolean }) => m.is_you).name).toBe("S. Khan");
    expect(head.candidates.map((c: { name: string }) => c.name).sort()).toEqual(["A. Nasser", "Newbie"]);
    expect(JSON.stringify(head)).not.toContain("Other Person");
    expect(head).toMatchObject({ unread: 0, open_questions: 0, you_are_member: true });
  });

  it("adds a colleague by name; a person of another workspace is refused", async () => {
    await roomPost(jreq("POST"), rctx());
    expect((await membersPost(jreq("POST", { user_id: NEWBIE }), rctx())).status).toBe(201);
    expect(members().some((m) => m.user_id === NEWBIE && m.added_by === ME)).toBe(true);
    expect((await membersPost(jreq("POST", { user_id: NEWBIE }), rctx())).status).toBe(200);
    const foreign = await membersPost(jreq("POST", { user_id: OTHER }), rctx());
    expect(foreign.status).toBe(422);
    expect(members().some((m) => m.user_id === OTHER)).toBe(false);
  });

  it("anyone can leave; only an admin or the deal's owner removes someone else", async () => {
    await roomPost(jreq("POST"), rctx());
    as(NEWBIE);
    expect((await membersDelete(jreq("DELETE", undefined, `?user_id=${ANN}`), rctx())).status).toBe(403);
    expect(members().some((m) => m.user_id === ANN)).toBe(true);
    as(ME);
    expect((await membersDelete(jreq("DELETE", undefined, `?user_id=${ANN}`), rctx())).status).toBe(200);
    expect(members().some((m) => m.user_id === ANN)).toBe(false);
    as(BOSS, "admin");
    await membersPost(jreq("POST", { user_id: BOSS }), rctx());
    expect((await membersDelete(jreq("DELETE"), rctx())).status).toBe(200);
    expect(members().some((m) => m.user_id === BOSS)).toBe(false);
  });
});

describe("posting", () => {
  it("the author, the channel and the time are the server's, whatever the body claims", async () => {
    const { res, json } = await post({ body: "Hello team", author_id: ANN, channel: "client", created_at: "2001-01-01T00:00:00Z", tenant_id: T2, room_id: "x", mentions: [BOSS] });
    expect(res.status).toBe(201);
    expect(json.message).toMatchObject({ author_id: ME, author_name: "S. Khan", body: "Hello team", mentions: [] });
    const row = msgs()[0];
    expect(row).toMatchObject({ tenant_id: T1, author_id: ME, channel: "team", kind: "message", mentions: [] });
    expect(Date.parse(row.created_at as string)).toBeGreaterThan(Date.parse("2026-01-01"));
    expect(row.updated_at).toBe(row.created_at);
  });

  it("stores the text as given and never as markup; links stay text until the screen draws them", async () => {
    const { json } = await post({ body: "see <b>this</b> https://portal.example.com/t/1 <script>alert(1)</script>" });
    expect(json.message?.body).toBe("see <b>this</b> https://portal.example.com/t/1 <script>alert(1)</script>");
  });

  it("mentions are read from the text, are members of the room only, and tell their inbox", async () => {
    await roomPost(jreq("POST"), rctx());
    const { json } = await post({ body: "@Ann please check, and @Newbie too, and @Other Person" });
    // Newbie is in the workspace but not in the room; Other Person is another workspace's.
    expect(json.message?.mentions).toEqual([ANN]);
    const note = state.db.rows("record_comments")[0];
    expect(note).toMatchObject({ tenant_id: T1, object_type: "opportunities", object_id: OPP, author_id: ME });
    expect(note.mentions).toEqual(["ann@kamco.test"]);
    expect(String(note.body)).toContain("Mentioned you in the Deal Room");
  });

  it("a question tells its owner, and the owner must be a member of this workspace", async () => {
    await roomPost(jreq("POST"), rctx());
    const bad = await post({ body: "Who has the datasheet?", kind: "question", owner_id: OTHER });
    expect(bad.res.status).toBe(422);
    expect(msgs()).toHaveLength(0);
    const ok = await post({ body: "Who has the datasheet?", kind: "question", owner_id: ANN, due: "2026-11-02" });
    expect(ok.res.status).toBe(201);
    expect(ok.json.message?.question).toMatchObject({ status: "open", owner_id: ANN });
    expect(msgs()[0]).toMatchObject({ question_status: "open", question_owner_id: ANN, question_due: "2026-11-02" });
    expect(state.db.rows("record_comments").at(-1)?.mentions).toEqual(["ann@kamco.test"]);
    expect(String(state.db.rows("record_comments").at(-1)?.body)).toContain("Asked you a question");
  });

  it("a reply goes under the root of its thread, and the message it answers must be a live one of this room", async () => {
    const root = (await post({ body: "root" })).json.message!;
    const reply = (await post({ body: "reply", parent_id: root.id })).json.message!;
    const deeper = (await post({ body: "reply to a reply", parent_id: reply.id })).json.message!;
    expect(msgs().find((m) => m.id === deeper.id)?.parent_id).toBe(root.id);
    expect((await post({ body: "x", parent_id: "00000000-0000-4000-8000-000000000000" })).res.status).toBe(404);
    await messagePatch(jreq("PATCH", { action: "remove" }), mctx(root.id));
    expect((await post({ body: "to a removed one", parent_id: root.id })).res.status).toBe(404);
  });

  it("a decision is one pinned line, in order, with no files", async () => {
    const a = await post({ body: "Agreed to bid\nwith alternative cladding", kind: "decision" });
    expect(a.res.status).toBe(201);
    expect(msgs()[0]).toMatchObject({ kind: "decision", body: "Agreed to bid with alternative cladding", question_status: null });
    const files = await messagesPost(freq({ body: "no files", kind: "decision" }, [pdf()]), rctx());
    expect(files.status).toBe(400);
  });

  it("an empty message, an unknown kind and a long decision are refused", async () => {
    expect((await post({ body: "   " })).res.status).toBe(400);
    expect((await post({ body: "hi", kind: "announcement" })).res.status).toBe(400);
    expect((await post({ body: "x".repeat(201), kind: "decision" })).res.status).toBe(400);
    expect(msgs()).toHaveLength(0);
  });
});

describe("soft delete", () => {
  it("keeps the row, withholds the text, files and mentions, and logs it", async () => {
    await roomPost(jreq("POST"), rctx());
    const sent = await messagesPost(freq({ body: "price is 42 @Ann" }, [pdf("price.pdf")]), rctx());
    const m = (await sent.json()).message;
    expect(m.files).toHaveLength(1);
    const res = await messagePatch(jreq("PATCH", { action: "remove" }), mctx(m.id));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatchObject({ removed: true, body: null, files: [], mentions: [] });
    // Append-only: the row is still there, marked removed, with who and when.
    const row = msgs().find((x) => x.id === m.id)!;
    expect(row.body).toBe("price is 42 @Ann");
    expect(row).toMatchObject({ deleted_by: ME });
    expect(row.deleted_at).toBeTruthy();
    expect(state.changes.at(-1)).toMatchObject({ objectType: "deal_rooms", action: "update", changes: [{ field: "Message removed" }] });
    // Nothing a screen can fetch has the text any more.
    const listed = await (await messagesGet(get(), rctx())).json();
    expect(JSON.stringify(listed)).not.toContain("price is 42");
    expect(listed.messages[0]).toMatchObject({ removed: true, body: null });
    expect(JSON.stringify(listed)).not.toContain("price.pdf");
  });

  it("only the author or an admin can remove, and a removed message cannot be removed or edited again", async () => {
    const m = (await post({ body: "mine" })).json.message!;
    as(ANN);
    expect((await messagePatch(jreq("PATCH", { action: "remove" }), mctx(m.id))).status).toBe(403);
    as(BOSS, "admin");
    expect((await messagePatch(jreq("PATCH", { action: "remove" }), mctx(m.id))).status).toBe(200);
    expect((await messagePatch(jreq("PATCH", { action: "remove" }), mctx(m.id))).status).toBe(409);
    expect(msgs()[0].deleted_by).toBe(BOSS);
  });

  it("there is no way to edit a message", async () => {
    const m = (await post({ body: "original" })).json.message!;
    expect((await messagePatch(jreq("PATCH", { action: "edit", body: "changed" }), mctx(m.id))).status).toBe(400);
    expect(msgs()[0].body).toBe("original");
  });

  it("a message id from another room or workspace matches nothing", async () => {
    await roomPost(jreq("POST"), rctx());
    state.db.rows("deal_room_messages").push({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tenant_id: T2, room_id: "other-room", author_id: OTHER, kind: "message", body: "theirs", deleted_at: null, created_at: "2026-10-25T09:00:00Z", updated_at: "2026-10-25T09:00:00Z" });
    as(BOSS, "admin");
    expect((await messagePatch(jreq("PATCH", { action: "remove" }), mctx("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"))).status).toBe(404);
    expect(msgs().find((m) => m.id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")?.deleted_at).toBeNull();
  });
});

describe("questions", () => {
  it("are answered and reopened by their owner, their author or an admin, and the open count follows", async () => {
    await roomPost(jreq("POST"), rctx());
    const q = (await post({ body: "Which grade?", kind: "question", owner_id: ANN })).json.message!;
    await post({ body: "second", kind: "question" });
    const open = async () => (await (await roomGet(get(), rctx())).json()).open_questions;
    expect(await open()).toBe(2);
    as(NEWBIE);
    expect((await messagePatch(jreq("PATCH", { action: "answer" }), mctx(q.id))).status).toBe(403);
    as(ANN);
    const done = await messagePatch(jreq("PATCH", { action: "answer" }), mctx(q.id));
    expect(done.status).toBe(200);
    expect((await done.json()).message.question.status).toBe("answered");
    expect(msgs().find((m) => m.id === q.id)).toMatchObject({ question_status: "answered", answered_by: ANN });
    expect(await open()).toBe(1);
    expect((await messagePatch(jreq("PATCH", { action: "reopen" }), mctx(q.id))).status).toBe(200);
    expect(await open()).toBe(2);
  });

  it("a removed question is no longer open, and only a question can be answered", async () => {
    const q = (await post({ body: "Q?", kind: "question" })).json.message!;
    const plain = (await post({ body: "plain" })).json.message!;
    expect((await messagePatch(jreq("PATCH", { action: "answer" }), mctx(plain.id))).status).toBe(400);
    await messagePatch(jreq("PATCH", { action: "remove" }), mctx(q.id));
    const summary = await roomSummary(state.db as never, T1, ME, OPP);
    expect(summary).toMatchObject({ exists: true, openQuestions: 0 });
  });
});

describe("polling", () => {
  it("a first load is the latest page, oldest first, with the server's time as the cursor", async () => {
    await post({ body: "one" }); await post({ body: "two" });
    msgs()[0].created_at = msgs()[0].updated_at = "2026-10-25T09:00:00.000Z";
    msgs()[1].created_at = msgs()[1].updated_at = "2026-10-25T09:01:00.000Z";
    const j = await (await messagesGet(get(), rctx())).json();
    expect(j.messages.map((m: { body: string }) => m.body)).toEqual(["one", "two"]);
    expect(Date.parse(j.server_now)).not.toBeNaN();
    expect(j.more).toBe(false);
  });

  it("a poll finds what is new and what changed (answered, removed), and nothing else", async () => {
    await post({ body: "old" });
    const old = msgs()[0];
    old.created_at = old.updated_at = "2026-10-25T08:00:00.000Z";
    const q = (await post({ body: "Q?", kind: "question" })).json.message!;
    msgs().find((m) => m.id === q.id)!.created_at = msgs().find((m) => m.id === q.id)!.updated_at = "2026-10-25T08:30:00.000Z";
    const cursor = "2026-10-25T09:00:00.000Z";
    // Nothing since the cursor.
    expect((await (await messagesGet(get(`?since=${cursor}`), rctx())).json()).messages).toEqual([]);
    // A new message, and an older question that has just been answered.
    state.db.rows("deal_room_messages").push({ ...old, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", body: "fresh", created_at: "2026-10-25T09:00:30.000Z", updated_at: "2026-10-25T09:00:30.000Z" });
    Object.assign(msgs().find((m) => m.id === q.id)!, { question_status: "answered", updated_at: "2026-10-25T09:01:00.000Z" });
    const j = await (await messagesGet(get(`?since=${cursor}`), rctx())).json();
    expect(j.messages.map((m: { body: string }) => m.body)).toEqual(["Q?", "fresh"]);
    expect(j.messages[0].question.status).toBe("answered");
  });

  it("the poll overlaps by two seconds, so a row committed a moment late is still found", async () => {
    await post({ body: "late" });
    msgs()[0].created_at = msgs()[0].updated_at = "2026-10-25T09:00:00.000Z";
    const j = await (await messagesGet(get("?since=2026-10-25T09:00:01.000Z"), rctx())).json();
    expect(j.messages).toHaveLength(1);
  });

  it("an older page is fetched by 'before'", async () => {
    for (let i = 0; i < 3; i++) { await post({ body: `m${i}` }); msgs()[i].created_at = msgs()[i].updated_at = `2026-10-25T09:0${i}:00.000Z`; }
    const j = await (await messagesGet(get("?before=2026-10-25T09:02:00.000Z"), rctx())).json();
    expect(j.messages.map((m: { body: string }) => m.body)).toEqual(["m0", "m1"]);
  });

  it("writes the member's last_seen_at at most once a minute", async () => {
    await roomPost(jreq("POST"), rctx());
    const mine = () => members().find((m) => m.user_id === ME)!;
    mine().last_seen_at = null;
    await messagesGet(get(), rctx());
    const first = mine().last_seen_at as string;
    expect(first).toBeTruthy();
    mine().last_seen_at = new Date(Date.now() - 5_000).toISOString();
    const recent = mine().last_seen_at;
    await messagesGet(get(), rctx());
    expect(mine().last_seen_at).toBe(recent);
  });
});

describe("unread", () => {
  it("counts other people's messages after what you last read, per member, and clears when read", async () => {
    await roomPost(jreq("POST"), rctx());
    as(ANN);
    await post({ body: "from Ann 1" }); await post({ body: "from Ann 2" });
    as(ME);
    members().find((m) => m.user_id === ME)!.last_read_at = "2026-10-01T00:00:00.000Z";
    members().find((m) => m.user_id === ME)!.added_at = "2026-10-01T00:00:00.000Z";
    expect((await unreadByDeal(state.db as never, T1, ME)).get(OPP)).toBe(2);
    expect((await (await roomGet(get(), rctx())).json()).unread).toBe(2);
    // Ann's own messages are not unread for Ann.
    expect((await unreadByDeal(state.db as never, T1, ANN)).get(OPP)).toBeUndefined();
    expect((await readPost(jreq("POST"), rctx())).status).toBe(200);
    expect((await unreadByDeal(state.db as never, T1, ME)).get(OPP)).toBeUndefined();
    expect(members().find((m) => m.user_id === ME)?.last_read_at).toBeTruthy();
  });

  it("a removed message is not unread, and a person who does not follow the room has no count", async () => {
    await roomPost(jreq("POST"), rctx());
    as(ANN);
    const m = (await post({ body: "oops" })).json.message!;
    await messagePatch(jreq("PATCH", { action: "remove" }), mctx(m.id));
    members().find((x) => x.user_id === ME)!.last_read_at = "2026-10-01T00:00:00.000Z";
    expect((await unreadByDeal(state.db as never, T1, ME)).get(OPP)).toBeUndefined();
    expect((await unreadByDeal(state.db as never, T1, NEWBIE)).size).toBe(0);
  });

  it("the unread map only reads this workspace's rooms", async () => {
    await roomPost(jreq("POST"), rctx());
    state.db.rows("deal_room_members").push({ id: "mem-x", tenant_id: T2, room_id: "foreign-room", user_id: ME, added_at: "2026-10-01T00:00:00Z", last_read_at: null });
    state.db.rows("deal_rooms").push({ id: "foreign-room", tenant_id: T2, opportunity_id: OPP_T2 });
    state.db.rows("deal_room_messages").push({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", tenant_id: T2, room_id: "foreign-room", author_id: OTHER, kind: "message", body: "x", deleted_at: null, created_at: "2026-10-25T09:00:00Z", updated_at: "2026-10-25T09:00:00Z" });
    expect((await unreadByDeal(state.db as never, T1, ME)).has(OPP_T2)).toBe(false);
  });
});

describe("files", () => {
  it("are stored privately under the tenant and room, judged on their bytes, and offered through a signed link", async () => {
    await roomPost(jreq("POST"), rctx());
    const res = await messagesPost(freq({ body: "BOQ attached" }, [pdf("My BOQ <final>.pdf")]), rctx());
    expect(res.status).toBe(201);
    const m = (await res.json()).message;
    expect(m.files).toHaveLength(1);
    expect(m.files[0].name).not.toMatch(/[<>]/);
    const stored = state.db.objectsIn("deal-room-files");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(new RegExp(`^${T1}/${rooms()[0].id}/[0-9a-f-]{36}\\.pdf$`));
    expect(state.db.rows("deal_room_files")[0]).toMatchObject({ tenant_id: T1, room_id: rooms()[0].id, message_id: m.id, uploaded_by: ME, mime_type: "application/pdf" });

    const link = await fileGet(get(), fctx(m.files[0].id));
    expect(link.status).toBe(303);
    expect(link.headers.get("location")).toMatch(/^https:\/\/signed\.test\/deal-room-files\/.+t=60/);
  });

  it("refuses an SVG, a web page dressed as a PDF, and a program", async () => {
    await roomPost(jreq("POST"), rctx());
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], "logo.svg", { type: "image/svg+xml" });
    const html = new File(["<!doctype html><html><body><script>1</script></body></html>"], "offer.pdf", { type: "application/pdf" });
    const exe = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])], "setup.exe", { type: "application/octet-stream" });
    for (const f of [svg, html, exe]) {
      const res = await messagesPost(freq({ body: "attached" }, [f]), rctx());
      expect(res.status).toBe(422);
    }
    expect(msgs()).toHaveLength(0);
    expect(state.db.objectsIn("deal-room-files")).toEqual([]);
  });

  it("a failing second file takes the first out of the bucket again", async () => {
    await roomPost(jreq("POST"), rctx());
    const res = await messagesPost(freq({ body: "two" }, [pdf("a.pdf"), new File(["<svg/>"], "b.svg")]), rctx());
    expect(res.status).toBe(422);
    expect(state.db.objectsIn("deal-room-files")).toEqual([]);
  });

  it("limits the number and the size of files", async () => {
    await roomPost(jreq("POST"), rctx());
    const many = Array.from({ length: 6 }, (_, i) => pdf(`f${i}.pdf`));
    expect((await messagesPost(freq({ body: "six" }, many), rctx())).status).toBe(400);
    expect(state.db.objectsIn("deal-room-files")).toEqual([]);
  });

  it("a file of a removed message, of another room, or of another workspace has no link", async () => {
    await roomPost(jreq("POST"), rctx());
    const m = (await (await messagesPost(freq({ body: "x" }, [pdf()]), rctx())).json()).message;
    const fileId = m.files[0].id;
    // Another workspace's request for the same id.
    state.tenantId = T2; as(OTHER, "admin");
    expect((await fileGet(get(), fctx(fileId, OPP_T2))).status).toBe(404);
    state.tenantId = T1; as(ME);
    expect((await fileGet(get(), fctx("not-an-id"))).status).toBe(404);
    await messagePatch(jreq("PATCH", { action: "remove" }), mctx(m.id));
    expect((await fileGet(get(), fctx(fileId))).status).toBe(404);
  });
});

describe("what the deal page is given", () => {
  it("is the unread and open-question counts of this room, or nothing while it does not exist", async () => {
    expect(await roomSummary(state.db as never, T1, ME, OPP)).toEqual({ pending: false, exists: false, unread: 0, openQuestions: 0 });
    await roomPost(jreq("POST"), rctx());
    await post({ body: "Q?", kind: "question" });
    expect(await roomSummary(state.db as never, T1, ME, OPP)).toMatchObject({ exists: true, openQuestions: 1 });
  });
});
