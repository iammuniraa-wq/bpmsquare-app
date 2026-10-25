import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";
import { sendRoomDigests } from "./roomDigest";
import type { TenderMailer } from "./notify";

// The Deal Room digest: one e-mail per member with unread messages from others, at most one per 15 minutes, internal people
// only, through resolveOutbound and logged. Against an in-memory database with a fake mailer.

const T1 = "t1", T2 = "t2", T_DEMO = "t3";
const ME = "11111111-1111-4111-8111-111111111111";
const ANN = "22222222-2222-4222-8222-222222222222";
const BOSS = "33333333-3333-4333-8333-333333333333";
const STRANGER = "99999999-9999-4999-8999-999999999999";
const D1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const R1 = "rrrrrrrr-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-25T10:00:00.000Z");
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

let db: MemoryDb;
let sent: { from: string; to: string[]; subject: string; text: string }[];
let mailer: TenderMailer;
const as = (d: MemoryDb) => d as unknown as Parameters<typeof sendRoomDigests>[0];
const run = (now = NOW, m: TenderMailer | null = mailer) => sendRoomDigests(as(db), { now, mailer: m });
const member = (user: string, over: Record<string, unknown> = {}) => ({ id: `mem-${user.slice(0, 2)}`, tenant_id: T1, room_id: R1, user_id: user, added_at: iso(24 * 60), last_read_at: null, last_digest_at: null, last_seen_at: null, ...over });
const msg = (id: string, author: string, body: string, minutesAgo: number, over: Record<string, unknown> = {}) =>
  ({ id, tenant_id: T1, room_id: R1, author_id: author, kind: "message", body, mentions: [], deleted_at: null, created_at: iso(minutesAgo), updated_at: iso(minutesAgo), ...over });
const mem = (user: string) => db.rows("deal_room_members").find((m) => m.user_id === user)!;

beforeEach(() => {
  sent = [];
  mailer = { send: async (p) => { sent.push(p); return { error: null }; } };
  db = new MemoryDb({
    tenants: [
      { id: T1, slug: "kamco", name: "KAMCO", is_demo: false, config: {}, custom_domain: "kamco.example.com", features: { gcc_tender: true, deal_room: true, pipeline: true } },
      { id: T2, slug: "plain", name: "Plain Co", is_demo: false, config: {}, custom_domain: null, features: { gcc_tender: true, pipeline: true } },
      { id: T_DEMO, slug: "demo", name: "Demo", is_demo: true, config: {}, custom_domain: null, features: { gcc_tender: true, deal_room: true, pipeline: true } },
    ],
    tenant_users: [{ tenant_id: T1, user_id: ME }, { tenant_id: T1, user_id: ANN }, { tenant_id: T1, user_id: BOSS }, { tenant_id: T2, user_id: STRANGER }],
    opportunities: [{ id: D1, tenant_id: T1, ref: "OPP-2", title: "Pipes for Plant 4" }],
    deal_rooms: [{ id: R1, tenant_id: T1, opportunity_id: D1 }],
    deal_room_members: [member(ME), member(ANN), member(BOSS)],
    deal_room_messages: [msg("m1", ANN, "Can you send the BOQ?", 5), msg("m2", BOSS, "Pricing is in the shared folder", 3, { mentions: [ME] })],
  });
  db.users.set(ME, { email: "me@kamco.test", name: "S. Khan" });
  db.users.set(ANN, { email: "ann@kamco.test", name: "Ann" });
  db.users.set(BOSS, { email: "boss@kamco.test", name: "A. Nasser" });
  db.users.set(STRANGER, { email: "stranger@else.test" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Deal Room digest", () => {
  it("sends each member one e-mail with the messages of OTHER people, a link to the room, and who mentioned them", async () => {
    const r = await run();
    expect(r).toMatchObject({ tenants: 2, sent: 3, failed: 0, errors: [] });
    const toMe = sent.find((s) => s.to.includes("me@kamco.test"))!;
    expect(toMe.subject).toBe("Deal Room: 2 new messages on OPP-2 Pipes for Plant 4");
    expect(toMe.text).toContain("Ann: Can you send the BOQ?");
    expect(toMe.text).toContain("A. Nasser: Pricing is in the shared folder");
    expect(toMe.text).toContain("(you were mentioned)");
    expect(toMe.text).toContain(`https://kamco.example.com/pipeline/${D1}/room`);
    // Ann wrote one of them: she is told only about the other.
    const toAnn = sent.find((s) => s.to.includes("ann@kamco.test"))!;
    expect(toAnn.subject).toBe("Deal Room: 1 new message on OPP-2 Pipes for Plant 4");
    expect(toAnn.text).not.toContain("Ann: Can you send");
  });

  it("is logged in the e-mail log, and only workspaces with both flags are looked at", async () => {
    await run();
    expect(db.rows("email_log")).toHaveLength(3);
    expect(db.rows("email_log")[0]).toMatchObject({ tenant_id: T1, kind: "tender", status: "sent", related_object_type: "opportunities" });
    // Plain Co has gcc_tender but not deal_room: skipped without a query on its rooms.
    expect(sent.every((s) => !s.to.some((a) => a.includes("else.test")))).toBe(true);
  });

  it("at most one per 15 minutes per member: a second run right after sends nothing", async () => {
    await run();
    expect(sent).toHaveLength(3);
    db.rows("deal_room_messages").push(msg("m3", ANN, "One more", -0.5));
    const again = await run(new Date(NOW.getTime() + 60_000));
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(3);
    // After the gap the member gets only what is new since the last digest.
    const later = await run(new Date(NOW.getTime() + 16 * 60_000));
    expect(later.sent).toBeGreaterThan(0);
    const toMe = sent.at(-1)!;
    expect(sent.slice(3).every((s) => s.text.includes("One more"))).toBe(true);
    expect(toMe.text).not.toContain("Can you send the BOQ?");
  });

  it("two runs at once cannot send the same member twice (the claim is a compare-and-set)", async () => {
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.sent + b.sent).toBe(3);
    expect(sent).toHaveLength(3);
  });

  it("does not mail about what the member has already read, their own messages, removed messages or pinned decisions", async () => {
    mem(ME).last_read_at = iso(1);
    db.rows("deal_room_messages").push(msg("m4", BOSS, "regretted", 2, { deleted_at: iso(1) }), msg("m5", BOSS, "Agreed to bid", 2, { kind: "decision" }));
    const r = await run();
    expect(sent.some((s) => s.to.includes("me@kamco.test"))).toBe(false);
    expect(r.sent).toBe(2);
    expect(sent.some((s) => s.text.includes("regretted") || s.text.includes("Agreed to bid"))).toBe(false);
  });

  it("history from before the member joined, or older than a week, is not new", async () => {
    mem(ME).added_at = iso(1);
    db.rows("deal_room_messages").push(msg("old", ANN, "ancient", 9 * 24 * 60));
    await run();
    expect(sent.some((s) => s.to.includes("me@kamco.test"))).toBe(false);
    expect(sent.some((s) => s.text.includes("ancient"))).toBe(false);
  });

  it("a person who left the workspace gets nothing, and another workspace's member is never mailed", async () => {
    db.rows("tenant_users").splice(0, db.rows("tenant_users").length, { tenant_id: T1, user_id: ANN }, { tenant_id: T1, user_id: BOSS });
    await run();
    expect(sent.some((s) => s.to.includes("me@kamco.test"))).toBe(false);
  });

  it("a failed send hands the claim back, so the next run tries again", async () => {
    const failing: TenderMailer = { send: async () => ({ error: "smtp down" }) };
    const r = await run(NOW, failing);
    expect(r.failed).toBe(3);
    expect(mem(ME).last_digest_at).toBeNull();
    expect(db.rows("email_log").every((l) => l.status === "failed")).toBe(true);
    const again = await run(new Date(NOW.getTime() + 60_000));
    expect(again.sent).toBe(3);
  });

  it("answers failed, not a crash, when e-mail is not configured", async () => {
    const r = await run(NOW, null);
    expect(r).toMatchObject({ sent: 0, failed: 3 });
    expect(sent).toEqual([]);
  });

  it("a demo workspace is redirected, never mailed to its own people", async () => {
    db.rows("deal_rooms").push({ id: "r-demo", tenant_id: T_DEMO, opportunity_id: "dd" });
    db.rows("opportunities").push({ id: "dd", tenant_id: T_DEMO, ref: "D-1", title: "Demo tender" });
    db.rows("tenant_users").push({ tenant_id: T_DEMO, user_id: ANN });
    db.rows("deal_room_members").push({ ...member(ANN), id: "mem-demo", tenant_id: T_DEMO, room_id: "r-demo" });
    db.rows("deal_room_messages").push({ ...msg("dm1", BOSS, "demo message", 2), tenant_id: T_DEMO, room_id: "r-demo" });
    db.rows("tenants").find((t) => t.id === T1)!.features = { pipeline: true };
    const none = await run();
    expect(none).toMatchObject({ sent: 0, failed: 1 });
    expect(sent).toEqual([]);
    db.rows("tenants").find((t) => t.id === T_DEMO)!.config = { email_output: { mode: "redirect", redirect_to: "inbox@bpmsquare.test" } };
    mem(ANN).last_digest_at = null;
    const ok = await run(new Date(NOW.getTime() + 60 * 60_000));
    expect(ok.sent).toBe(1);
    expect(sent[0].to).toEqual(["inbox@bpmsquare.test"]);
  });

  it("answers pending_migration, not an error, while 0222 is pending", async () => {
    db.missing.add("deal_room_members");
    const r = await run();
    expect(r.pending_migration).toBe(true);
    expect(r.errors).toEqual([]);
    expect(sent).toEqual([]);
  });
});
