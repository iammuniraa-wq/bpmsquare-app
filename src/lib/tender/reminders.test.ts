import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";
import { sendTenderReminders, type ReminderMailer } from "./reminders";

// The closing-date reminder job: owner and team, once per threshold, through resolveOutbound, logged. Against an in-memory
// database, with a fake mailer.

const T1 = "t1", T2 = "t2", T_DEMO = "t3";
const U_OWNER = "11111111-1111-4111-8111-111111111111";
const U_TEAM = "22222222-2222-4222-8222-222222222222";
const U_GONE = "33333333-3333-4333-8333-333333333333"; // left the workspace
const U_OTHER = "44444444-4444-4444-8444-444444444444"; // member of another workspace
const D1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const CLOSING = "2026-10-30T09:00:00.000Z"; // 14:30 on 30 Oct in the default timezone (Asia/Kolkata)

let db: MemoryDb;
let sent: { from: string; to: string[]; subject: string; text: string }[];
let mailer: ReminderMailer;
const as = (d: MemoryDb) => d as unknown as Parameters<typeof sendTenderReminders>[0];
const day = (iso: string) => new Date(iso);

const deal = (id: string, over: Record<string, unknown> = {}) => ({ id, tenant_id: T1, ref: "OPP-1", title: "Pipes for Plant 4", outcome: "open", stage: "estimating", owner_id: U_OWNER, team: [{ user_id: U_TEAM, role: "technical" }, { user_id: U_GONE, role: "sales" }, { user_id: U_OTHER, role: "sales" }], ...over });
const tender = (id: string, over: Record<string, unknown> = {}) => ({ opportunity_id: id, tenant_id: T1, tender_no: "ARB-1", issuer_name: "Aramco", closing_at: CLOSING, decision: null, reminders_sent: [], updated_at: "2026-10-01T00:00:00.000Z", ...over });

beforeEach(() => {
  sent = [];
  mailer = { send: async (p) => { sent.push(p); return { error: null }; } };
  db = new MemoryDb({
    tenants: [
      { id: T1, slug: "kamco", name: "KAMCO", is_demo: false, config: {}, custom_domain: "kamco.example.com", features: { gcc_tender: true, pipeline: true } },
      { id: T2, slug: "plain", name: "Plain Co", is_demo: false, config: {}, custom_domain: null, features: { pipeline: true } },
      { id: T_DEMO, slug: "demo", name: "Demo", is_demo: true, config: {}, custom_domain: null, features: { gcc_tender: true, pipeline: true } },
    ],
    tenant_users: [{ tenant_id: T1, user_id: U_OWNER }, { tenant_id: T1, user_id: U_TEAM }, { tenant_id: T2, user_id: U_OTHER }, { tenant_id: T_DEMO, user_id: U_OWNER }],
    opportunities: [deal(D1)],
    opportunity_tenders: [tender(D1)],
  });
  db.users.set(U_OWNER, { email: "owner@kamco.test" });
  db.users.set(U_TEAM, { email: "team@kamco.test" });
  db.users.set(U_GONE, { email: "gone@kamco.test" });
  db.users.set(U_OTHER, { email: "other@elsewhere.test" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const run = (iso: string, over: { mailer?: ReminderMailer | null } = {}) => sendTenderReminders(as(db), { now: day(iso), mailer: over.mailer === undefined ? mailer : over.mailer });
const marked = () => db.rows("opportunity_tenders").find((r) => r.opportunity_id === D1)!.reminders_sent;

describe("closing-date reminders", () => {
  it("sends nothing earlier than 7 days out", async () => {
    const r = await run("2026-10-22T05:00:00Z"); // 8 days
    expect(r).toMatchObject({ sent: 0, considered: 0 });
    expect(sent).toEqual([]);
  });

  it("reminds the owner and the team, and only members of this workspace, once at 7 days", async () => {
    const r = await run("2026-10-23T05:00:00Z");
    expect(r).toMatchObject({ tenants: 2, considered: 1, sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to.sort()).toEqual(["owner@kamco.test", "team@kamco.test"]);
    expect(sent[0].subject).toBe("Tender closes in 7 days: ARB-1 · Aramco");
    expect(sent[0].text).toContain("https://kamco.example.com/pipeline/");
    expect(sent[0].from).toContain("kamco@");
    expect(marked()).toEqual([7]);
  });

  it("does not repeat: the same day again, or a second run, sends nothing more", async () => {
    await run("2026-10-23T05:00:00Z");
    await run("2026-10-23T11:00:00Z");
    await run("2026-10-24T05:00:00Z"); // 6 days
    expect(sent).toHaveLength(1);
  });

  it("then 3 days, 1 day and the day itself, each once", async () => {
    for (const iso of ["2026-10-23T05:00:00Z", "2026-10-27T05:00:00Z", "2026-10-29T05:00:00Z", "2026-10-30T02:00:00Z", "2026-10-30T06:00:00Z", "2026-10-31T05:00:00Z"]) await run(iso);
    expect(sent.map((s) => s.subject.replace(/: .*/, ""))).toEqual(["Tender closes in 7 days", "Tender closes in 3 days", "Tender closes tomorrow", "Tender closes today"]);
    expect(marked()).toEqual([7, 3, 1, 0]);
  });

  it("two runs at the same moment send one email between them", async () => {
    const [a, b] = await Promise.all([run("2026-10-27T05:00:00Z"), run("2026-10-27T05:00:00Z")]);
    expect(sent).toHaveLength(1);
    expect(a.sent + b.sent).toBe(1);
    expect(a.skipped + b.skipped).toBeGreaterThanOrEqual(1);
  });

  it("records each send in the email log, kind tender, tied to the deal", async () => {
    await run("2026-10-27T05:00:00Z");
    expect(db.rows("email_log")).toHaveLength(1);
    expect(db.rows("email_log")[0]).toMatchObject({ tenant_id: T1, kind: "tender", status: "sent", related_object_type: "opportunities", related_object_id: D1 });
  });

  it("a failed send gives the threshold back, so the next run tries again", async () => {
    const r = await run("2026-10-27T05:00:00Z", { mailer: { send: async () => ({ error: "mailbox full" }) } });
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(marked()).toEqual([]);
    expect(db.rows("email_log")[0]).toMatchObject({ status: "failed", error: "mailbox full" });
    expect((await run("2026-10-27T09:00:00Z")).sent).toBe(1);
    expect(marked()).toEqual([7, 3]);
  });

  it("no mailer configured: counted as failed, nothing marked", async () => {
    const r = await run("2026-10-27T05:00:00Z", { mailer: null });
    expect(r.failed).toBe(1);
    expect(marked()).toEqual([]);
  });

  it("only tenders still facing their deadline: not submitted, not decided no-go, not closed", async () => {
    db.rows("opportunities")[0].stage = "submitted";
    expect((await run("2026-10-27T05:00:00Z")).considered).toBe(0);
    db.rows("opportunities")[0].stage = "estimating";
    db.rows("opportunity_tenders")[0].decision = "no_go";
    expect((await run("2026-10-27T05:00:00Z")).considered).toBe(0);
    db.rows("opportunity_tenders")[0].decision = null;
    db.rows("opportunities")[0].outcome = "dropped";
    expect((await run("2026-10-27T05:00:00Z")).considered).toBe(0);
    expect(sent).toEqual([]);
  });

  it("a workspace without the flag is never looked at", async () => {
    db.rows("opportunities").push(deal("d2", { tenant_id: T2 }));
    db.rows("opportunity_tenders").push(tender("d2", { tenant_id: T2, tender_no: "P-1" }));
    await run("2026-10-27T05:00:00Z");
    expect(db.rows("opportunity_tenders").find((r) => r.opportunity_id === "d2")?.reminders_sent).toEqual([]);
    expect(sent.every((s) => !s.subject.includes("P-1"))).toBe(true);
  });

  it("a demo workspace is redirected, never sent to its own people, and sends nothing with no redirect inbox", async () => {
    db.rows("opportunities").push(deal("d3", { tenant_id: T_DEMO }));
    db.rows("opportunity_tenders").push(tender("d3", { tenant_id: T_DEMO, tender_no: "D-1" }));
    db.rows("opportunities")[0].stage = "submitted"; // leave T1 out of it
    const none = await run("2026-10-27T05:00:00Z");
    expect(none).toMatchObject({ sent: 0, failed: 1 });
    expect(sent).toEqual([]);

    db.rows("tenants").find((t) => t.id === T_DEMO)!.config = { email_output: { mode: "redirect", redirect_to: "inbox@bpmsquare.test" } };
    const ok = await run("2026-10-27T09:00:00Z");
    expect(ok.sent).toBe(1);
    expect(sent[0].to).toEqual(["inbox@bpmsquare.test"]);
  });

  it("answers pending_migration, not an error, while 0220 is pending", async () => {
    db.missing.add("opportunity_tenders");
    const r = await run("2026-10-27T05:00:00Z");
    expect(r.pending_migration).toBe(true);
    expect(r.errors).toEqual([]);
    expect(sent).toEqual([]);
  });

  describe("the bid bond line (migration 0221)", () => {
    const bond = { bid_bond_amount: 96000, bid_bond_currency: "SAR", bid_bond_expiry: "2027-01-30" };

    it("a held bond is mentioned in the reminder", async () => {
      Object.assign(db.rows("opportunity_tenders")[0], bond, { bond_status: "held" });
      await run("2026-10-23T05:00:00Z");
      expect(sent[0].text).toContain("Bid bond: SAR 96,000, valid to 2027-01-30");
    });

    it("a released bond is not mentioned", async () => {
      Object.assign(db.rows("opportunity_tenders")[0], bond, { bond_status: "released" });
      await run("2026-10-23T05:00:00Z");
      expect(sent).toHaveLength(1);
      expect(sent[0].text).not.toContain("Bid bond");
    });

    it("while the bond columns are pending the reminder still goes, without a bond line", async () => {
      // A database without the columns has no such data in the row either.
      db.missingColumns.opportunity_tenders = new Set(["bond_status", "bid_bond_amount", "bid_bond_currency", "bid_bond_expiry"]);
      const r = await run("2026-10-23T05:00:00Z");
      expect(r).toMatchObject({ sent: 1, failed: 0, errors: [] });
      expect(sent[0].text).not.toContain("Bid bond");
    });
  });
});
