import { describe, expect, it, vi } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";

// Replaced: the listing of the leads module (it reads a database) and the modules the assistant's sources import.
const { leadCalls } = vi.hoisted(() => ({ leadCalls: [] as string[] }));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => { throw new Error("no database in this test"); } }));
vi.mock("@/lib/api/listSources", () => ({ LIST_SOURCES: {} }));
vi.mock("@/lib/marketing/leads/queries", () => ({
  listScoredLeads: async (_admin: unknown, tenantId: string) => {
    leadCalls.push(tenantId);
    return {
      pending: false,
      leads: [
        { id: "l1", title: "Hospital fit-out", account_name: "Riyadh Hospital", status: "qualified", stage: "ready", owner_user_id: "u1", ready_at: "2026-10-19T08:00:00Z", created_at: "2026-10-01T00:00:00Z" },
        { id: "l2", title: "Someone else's", account_name: "Other", status: "qualified", stage: "ready", owner_user_id: "u2", ready_at: "2026-10-19T08:00:00Z", created_at: "2026-10-01T00:00:00Z" },
        { id: "l3", title: "Fresh enquiry", account_name: "Acme", status: "new", stage: "new", owner_user_id: "u1", ready_at: null, created_at: "2026-10-18T08:00:00Z" },
      ],
    };
  },
}));

import { addDays, dayKey, dayStartUtc, dayWindow, daysFromToday, validTimeZone } from "./day";
import { RULES, groupOpen, rankFocus, scoreCandidate, valueFactor } from "./score";
import {
  abmCandidates, dealCandidates, invoiceCandidates, leadCandidates, mentionCandidates, quoteCandidates, taskCandidates, wfmCandidates,
} from "./rules";
import { yesterdayLines } from "./yesterday";
import { loadOpen, loadYesterday, type BriefingCtx } from "./load";
import { buildBriefing, getBriefing } from "./compute";
import type { BriefingStore, StoredBriefing } from "./store";
import { BRIEFING_EMPTY, BRIEFING_TIPS } from "./tips";
import { objectDef } from "@/lib/assistant/objects";
import type { Candidate } from "./types";

type Row = Record<string, unknown>;

// ── A tiny database: applies eq / in / contains / date filters to rows and records every query ────────────────────
type Call = { table: string; eq: Record<string, unknown>; ins: Record<string, unknown[]> };
function fakeAdmin(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, eq: {}, ins: {} };
    calls.push(call);
    const gte: [string, string][] = [], lt: [string, string][] = [], lte: [string, string][] = [];
    let contains: [string, unknown[]] | null = null;
    const b: Record<string, unknown> = {};
    const chain = () => b;
    Object.assign(b, {
      select: chain, order: chain, limit: chain, not: chain, or: chain,
      eq: (k: string, v: unknown) => { call.eq[k] = v; return b; },
      in: (k: string, v: unknown[]) => { call.ins[k] = v; return b; },
      gte: (k: string, v: string) => { gte.push([k, v]); return b; },
      lt: (k: string, v: string) => { lt.push([k, v]); return b; },
      lte: (k: string, v: string) => { lte.push([k, v]); return b; },
      contains: (k: string, v: unknown[]) => { contains = [k, v]; return b; },
      then: (resolve: (r: unknown) => void) => {
        const source = tables[table];
        if (!source) return resolve({ data: null, count: null, error: { code: "42P01", message: `relation "${table}" does not exist` } });
        const rows = source.filter((r) =>
          Object.entries(call.eq).every(([k, v]) => r[k] === v)
          && Object.entries(call.ins).every(([k, v]) => v.includes(r[k]))
          && gte.every(([k, v]) => String(r[k]) >= v) && lt.every(([k, v]) => String(r[k]) < v) && lte.every(([k, v]) => String(r[k]) <= v)
          && (!contains || (Array.isArray(r[contains[0]]) && contains[1].every((x) => (r[contains![0]] as unknown[]).includes(x)))));
        return resolve({ data: rows, count: rows.length, error: null });
      },
    });
    return b;
  };
  return { admin: { from } as never, calls };
}

const ctxOf = (over: Partial<BriefingCtx> = {}): BriefingCtx => ({
  tenantId: "t1", userId: "u1", email: "u1@x.com", isAdmin: true,
  perms: { unrestricted: true, grants: new Map() },
  features: { quotations: true, pipeline: true, invoices: true, leads: true, abm: true, journeys: true, wfm: true, next_experience: true, integration_middleware: true, ai_assistant: true },
  wfm: { isSupervisor: true, unrestricted: true, employeeIds: null },
  ...over,
});

const NOW = new Date("2026-10-22T10:00:00Z");
const win = dayWindow(NOW, "UTC");

// ── Day boundaries ────────────────────────────────────────────────────────────────────────────────────────────────
describe("the day in the workspace's time zone", () => {
  it("reads the calendar day where the person is, not in UTC", () => {
    const at = new Date("2026-10-22T21:30:00Z");
    expect(dayKey(at, "UTC")).toBe("2026-10-22");
    expect(dayKey(at, "Asia/Kolkata")).toBe("2026-10-23");
    expect(dayKey(at, "America/Los_Angeles")).toBe("2026-10-22");
  });
  it("yesterday is the half-open window between two local midnights", () => {
    const w = dayWindow(new Date("2026-10-22T21:30:00Z"), "Asia/Kolkata");
    expect(w.today).toBe("2026-10-23");
    expect(w.yesterday).toBe("2026-10-22");
    expect(w.yesterdayStart).toBe("2026-10-21T18:30:00.000Z");
    expect(w.todayStart).toBe("2026-10-22T18:30:00.000Z");
  });
  it("a day with a clock change is 25 or 23 hours long, not 24", () => {
    const fall = dayWindow(new Date("2026-11-02T15:00:00Z"), "America/New_York");
    expect(fall.yesterday).toBe("2026-11-01");
    expect(Date.parse(fall.todayStart) - Date.parse(fall.yesterdayStart)).toBe(25 * 3_600_000);
    expect(dayStartUtc("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });
  it("an unknown zone falls back to UTC instead of failing", () => {
    expect(validTimeZone("Mars/Olympus")).toBe("UTC");
    expect(validTimeZone(undefined)).toBe("UTC");
    expect(dayWindow(NOW, "Mars/Olympus").timeZone).toBe("UTC");
  });
  it("counts whole days to a date or a timestamp, in the zone", () => {
    expect(daysFromToday("2026-10-22", "2026-10-23", "UTC")).toBe(1);
    expect(daysFromToday("2026-10-22", "2026-10-19", "UTC")).toBe(-3);
    expect(daysFromToday("2026-10-23", "2026-10-22T20:00:00Z", "Asia/Kolkata")).toBe(0);
    expect(daysFromToday("2026-10-22", "garbage", "UTC")).toBeNull();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

// ── Scoring ───────────────────────────────────────────────────────────────────────────────────────────────────────
const cand = (over: Partial<Candidate> & Pick<Candidate, "id" | "kind">): Candidate => ({
  objectType: "quote", label: over.id, href: `/x/${over.id}`, days: 0, ownership: "own", ...over,
});

describe("where to focus: the rubric", () => {
  it("scores urgency x value x ownership and hands back its working", () => {
    const s = scoreCandidate(cand({ id: "a", kind: "quote_expiring", days: 1, value: 420000 }), (n) => `₹${n}`);
    expect(s.working.urgency).toBe(75);
    expect(s.working.valueFactor).toBe(valueFactor(420000));
    expect(s.working.ownership).toBe(1);
    expect(s.score).toBe(Math.round(75 * s.working.valueFactor * 10) / 10);
    expect(s.why).toBe("Expires tomorrow · ₹420000");
  });
  it("something waiting for the person's decision counts at 0.6 and says so", () => {
    const own = scoreCandidate(cand({ id: "a", kind: "wfm_leave", days: 2, count: 1 }));
    const theirs = scoreCandidate(cand({ id: "b", kind: "wfm_leave", days: 2, count: 1, ownership: "approver" }));
    expect(theirs.score).toBeCloseTo(own.score * 0.6, 1);
    expect(theirs.why).toContain("waiting for your decision");
  });
  it("urgency rises with lateness, is capped, and never leaves 0 to 100", () => {
    for (const kind of Object.keys(RULES) as (keyof typeof RULES)[]) {
      for (const days of [0, 1, 7, 30, 400]) {
        const u = scoreCandidate(cand({ id: "x", kind, days, count: 3 })).working.urgency;
        expect(u, `${kind} ${days}`).toBeGreaterThanOrEqual(0);
        expect(u, `${kind} ${days}`).toBeLessThanOrEqual(100);
      }
    }
    const a = scoreCandidate(cand({ id: "a", kind: "quote_expired", days: 2 })).score;
    const b = scoreCandidate(cand({ id: "b", kind: "quote_expired", days: 10 })).score;
    expect(b).toBeGreaterThan(a);
    expect(scoreCandidate(cand({ id: "c", kind: "quote_expired", days: 90 })).working.urgency).toBe(90);
  });
  it("value helps a little and never more than half again", () => {
    expect(valueFactor(undefined)).toBe(1);
    expect(valueFactor(0)).toBe(1);
    expect(valueFactor(1e15)).toBeLessThanOrEqual(1.5);
    expect(valueFactor(1000)).toBeGreaterThan(valueFactor(10));
  });
  it("ranks the same way however the input is ordered, and breaks ties by age then id", () => {
    const list: Candidate[] = [
      cand({ id: "q:b", kind: "quote_expiring", days: 3 }),
      cand({ id: "q:a", kind: "quote_expiring", days: 3 }),
      cand({ id: "d:1", kind: "deal_late", days: 12, value: 50000 }),
      cand({ id: "l:1", kind: "lead_ready", days: 2 }),
      cand({ id: "m:1", kind: "mention", days: 1, ownership: "approver" }),
      cand({ id: "q:old", kind: "quote_draft", days: 40 }),
    ];
    const first = rankFocus(list).map((f) => f.id);
    for (let i = 0; i < 20; i++) {
      const shuffled = [...list].sort(() => Math.random() - 0.5);
      expect(rankFocus(shuffled).map((f) => f.id)).toEqual(first);
    }
    expect(first.indexOf("q:a")).toBeLessThan(first.indexOf("q:b"));
    expect(first[0]).toBe("d:1");
  });
  it("keeps five and only five, each with its reason", () => {
    const many = Array.from({ length: 9 }, (_, i) => cand({ id: `q:${i}`, kind: "quote_expired", days: i + 1 }));
    const top = rankFocus(many);
    expect(top).toHaveLength(5);
    expect(top.every((f) => f.why.length > 0 && f.working.urgencyWhy.length > 0)).toBe(true);
    expect(top[0].id).toBe("q:8");
  });
  it("groups the open items by kind, most pressing first, with counts and a list link", () => {
    const lines = groupOpen([
      cand({ id: "q:1", kind: "quote_expiring", days: 1 }), cand({ id: "q:2", kind: "quote_expiring", days: 2 }),
      cand({ id: "l:1", kind: "lead_ready", days: 1 }),
      cand({ id: "w", kind: "wfm_leave", days: 2, count: 4, ownership: "approver" }),
    ]);
    expect(lines.map((l) => l.label)).toEqual(["2 quotes expiring", "1 lead ready for sales", "4 leave requests to decide"]);
    expect(lines[0].href).toBe("/quotations");
    expect(lines[1].href).toBe("/x/l:1");
  });
});

// ── The rules ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("the open-today rules", () => {
  const today = "2026-10-22";
  it("one candidate per quote, the most pressing reading wins, closed ones are ignored", () => {
    const out = quoteCandidates([
      { id: "a", ref: "Q-A", status: "sent", outcome: "open", valid_until: "2026-10-20", total: 10, created_at: "2026-09-01T00:00:00Z" },
      { id: "b", ref: "Q-B", status: "sent", outcome: "open", valid_until: "2026-10-29", total: 10, created_at: "2026-10-01T00:00:00Z" },
      { id: "c", ref: "Q-C", status: "sent", outcome: "open", valid_until: "2026-10-30", total: 10, created_at: "2026-10-01T00:00:00Z" },
      { id: "d", ref: "Q-D", status: "draft", outcome: "open", valid_until: null, total: 10, created_at: "2026-10-10T00:00:00Z" },
      { id: "e", ref: "Q-E", status: "draft", outcome: "open", valid_until: null, total: 10, created_at: "2026-10-21T00:00:00Z" },
      { id: "f", ref: "Q-F", status: "sent", outcome: "won", valid_until: "2026-10-20", total: 10, created_at: "2026-09-01T00:00:00Z" },
    ], today, "UTC");
    expect(out.map((c) => [c.id, c.kind, c.days])).toEqual([
      ["quote:a", "quote_expired", 2], ["quote:b", "quote_expiring", 7], ["quote:d", "quote_draft", 12],
    ]);
  });
  it("leads: the person's own ready leads and new ones older than two days, never another owner's", () => {
    const rows = [
      { id: "l1", title: "T", account_name: "A", status: "qualified", stage: "ready", owner_user_id: "u1", ready_at: "2026-10-19T08:00:00Z", created_at: "2026-10-01T00:00:00Z" },
      { id: "l2", title: "T", account_name: "A", status: "qualified", stage: "ready", owner_user_id: "u2", ready_at: null, created_at: "2026-10-01T00:00:00Z" },
      { id: "l3", title: "T", account_name: "A", status: "new", stage: "new", owner_user_id: "u1", ready_at: null, created_at: "2026-10-18T08:00:00Z" },
      { id: "l4", title: "T", account_name: "A", status: "new", stage: "new", owner_user_id: "u1", ready_at: null, created_at: "2026-10-21T08:00:00Z" },
    ];
    expect(leadCandidates(rows, "u1", today, "UTC").map((c) => [c.id, c.kind, c.days])).toEqual([["lead:l1", "lead_ready", 3], ["lead:l3", "lead_new", 4]]);
    expect(leadCandidates(rows, "", today, "UTC")).toEqual([]);
  });
  it("deals past the close date or closing within a week; far-off and decided ones are left out", () => {
    const out = dealCandidates([
      { id: "d1", ref: "OPP-1", title: "A", expected_close: "2026-10-18", amount: 500, outcome: "open" },
      { id: "d2", ref: "OPP-2", title: "B", expected_close: "2026-10-24", amount: 0, outcome: "open" },
      { id: "d3", ref: "OPP-3", title: "C", expected_close: "2026-11-24", amount: 5, outcome: "open" },
      { id: "d4", ref: "OPP-4", title: "D", expected_close: "2026-10-18", amount: 5, outcome: "won" },
    ], today, "UTC");
    expect(out.map((c) => [c.id, c.kind, c.days])).toEqual([["deal:d1", "deal_late", 4], ["deal:d2", "deal_closing", 2]]);
  });
  it("ABM steps and tasks due today or earlier; invoices only when unpaid and past due", () => {
    expect(abmCandidates([{ id: "a", next_step_due: "2026-10-22", accounts: { name: "Acme" } }, { id: "b", next_step_due: "2026-10-23" }], today, "UTC").map((c) => c.id)).toEqual(["abm:a"]);
    expect(taskCandidates([{ id: "t1", title: "Call", due_on: "2026-10-20", status: "open" }, { id: "t2", title: "Done", due_on: "2026-10-20", status: "done" }, { id: "t3", title: "Later", due_on: "2026-10-30", status: "open" }], today, "UTC").map((c) => c.id)).toEqual(["task:t1"]);
    const inv = invoiceCandidates([
      { id: "i1", ref: "INV-1", status: "overdue", due_date: "2026-10-01", total: 1000, paid_amount: 250 },
      { id: "i2", ref: "INV-2", status: "paid", due_date: "2026-10-01", total: 1000, paid_amount: 1000 },
      { id: "i3", ref: "INV-3", status: "sent", due_date: "2026-10-30", total: 1000, paid_amount: 0 },
      { id: "i4", ref: "INV-4", status: "partial", due_date: "2026-10-01", total: 1000, paid_amount: 1000 },
    ], today, "UTC");
    expect(inv.map((c) => [c.id, c.days, c.value])).toEqual([["invoice:i1", 21, 750]]);
  });
  it("mentions: unread ones on records the person may open; the text is never carried", () => {
    const rows = [
      { id: "m1", object_type: "quotes", object_id: "q1", body: "secret text", created_at: "2026-10-21T08:00:00Z" },
      { id: "m2", object_type: "quotes", object_id: "q2", created_at: "2026-10-21T08:00:00Z" },
      { id: "m3", object_type: "accounts", object_id: "a1", created_at: "2026-10-21T08:00:00Z" },
      { id: "m4", object_type: "webhooks", object_id: "w1", created_at: "2026-10-21T08:00:00Z" },
    ];
    const out = mentionCandidates(rows, new Set(["m2"]), today, "UTC", (def) => def.type === "quote");
    expect(out.map((c) => c.id)).toEqual(["mention:m1"]);
    expect(JSON.stringify(out)).not.toContain("secret text");
  });
  it("supervisor queues are counts and age only", () => {
    const out = wfmCandidates({ leave: { count: 2, oldestDays: 3 }, correction: { count: 0, oldestDays: 0 } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "wfm_leave", count: 2, days: 3, ownership: "approver", label: "2 leave requests to decide" });
  });
});

describe("yesterday: what you did", () => {
  const allow = () => true;
  const rows = [
    { object_type: "quotes", object_id: "q1", object_label: "SQ-1", action: "create", created_at: "x" },
    { object_type: "quotes", object_id: "q2", object_label: "SQ-2", action: "create", created_at: "x" },
    ...["a1", "a2", "a3", "a1", "a1"].map((id) => ({ object_type: "accounts", object_id: id, object_label: `Acc ${id}`, action: "update", created_at: "x" })),
    { object_type: "cases", object_id: "c1", object_label: "CS-1", action: "update", created_at: "x" },
    { object_type: "webhooks", object_id: "w1", object_label: "Hook", action: "update", created_at: "x" },
    { object_type: "contacts", object_id: "k1", object_label: "K", action: "delete", created_at: "x" },
  ];
  it("groups by object and action, counting each record once, and names the first few", () => {
    const lines = yesterdayLines(rows, [], allow);
    expect(lines.map((l) => l.label)).toEqual(["Created 2 quotes", "Updated 3 accounts", "Updated 1 case", "Deleted 1 contact"]);
    expect(lines[0].items?.map((i) => i.label)).toEqual(["SQ-1", "SQ-2"]);
    expect(lines[2].href).toBe("/cases/c1");
    expect(lines[3].items).toBeUndefined();
  });
  it("never lists configuration history", () => {
    expect(JSON.stringify(yesterdayLines(rows, [], allow))).not.toContain("Hook");
  });
  it("drops record families the person may not open", () => {
    const lines = yesterdayLines(rows, [], (def) => def.type !== "account" && def.type !== "contact");
    expect(lines.map((l) => l.label)).toEqual(["Created 2 quotes", "Updated 1 case"]);
  });
  it("counts the comments written, without their text", () => {
    const lines = yesterdayLines([], [
      { object_type: "quotes", object_id: "q1", created_at: "2026-10-21T09:00:00Z" },
      { object_type: "quotes", object_id: "q1", created_at: "2026-10-21T10:00:00Z" },
      { object_type: "accounts", object_id: "a9", created_at: "2026-10-21T08:00:00Z" },
    ], allow);
    expect(lines).toEqual([{ id: "yesterday:comments", label: "Wrote 3 comments", href: "/quotations/q1", objectType: "quote", count: 3 }]);
  });
});

// ── Tenant isolation, ownership and permission filtering at the query ──────────────────────────────────────────────
const tables = (): Record<string, Row[]> => ({
  change_log: [
    { tenant_id: "t1", actor_id: "u1", object_type: "quotes", object_id: "q1", object_label: "SQ-1", action: "create", created_at: "2026-10-21T09:00:00Z" },
    { tenant_id: "t1", actor_id: "u2", object_type: "quotes", object_id: "q9", object_label: "SQ-OTHER-USER", action: "create", created_at: "2026-10-21T09:00:00Z" },
    { tenant_id: "t2", actor_id: "u1", object_type: "quotes", object_id: "q8", object_label: "SQ-OTHER-TENANT", action: "create", created_at: "2026-10-21T09:00:00Z" },
    { tenant_id: "t1", actor_id: "u1", object_type: "quotes", object_id: "q7", object_label: "SQ-TOO-OLD", action: "create", created_at: "2026-10-20T09:00:00Z" },
    { tenant_id: "t1", actor_id: "u1", object_type: "quotes", object_id: "q6", object_label: "SQ-TODAY", action: "create", created_at: "2026-10-22T00:00:00Z" },
  ],
  record_comments: [
    { id: "m1", tenant_id: "t1", author_id: "u1", object_type: "quotes", object_id: "q1", mentions: [], created_at: "2026-10-21T10:00:00Z" },
    { id: "m2", tenant_id: "t1", author_id: "u2", object_type: "quotes", object_id: "q1", mentions: ["u1@x.com"], created_at: "2026-10-20T10:00:00Z" },
    { id: "m3", tenant_id: "t1", author_id: "u2", object_type: "quotes", object_id: "q1", mentions: ["someone@x.com"], created_at: "2026-10-20T10:00:00Z" },
    { id: "m4", tenant_id: "t2", author_id: "u2", object_type: "quotes", object_id: "q1", mentions: ["u1@x.com"], created_at: "2026-10-20T10:00:00Z" },
  ],
  nova_inbox_reads: [],
  quotes: [
    { id: "q1", tenant_id: "t1", created_by: "u1", ref: "SQ-1", status: "sent", outcome: "open", valid_until: "2026-10-23", total: 420000, created_at: "2026-10-01T00:00:00Z" },
    { id: "q2", tenant_id: "t1", created_by: "u2", ref: "SQ-OTHER-USER", status: "sent", outcome: "open", valid_until: "2026-10-23", total: 1, created_at: "2026-10-01T00:00:00Z" },
    { id: "q3", tenant_id: "t2", created_by: "u1", ref: "SQ-OTHER-TENANT", status: "sent", outcome: "open", valid_until: "2026-10-23", total: 1, created_at: "2026-10-01T00:00:00Z" },
  ],
  opportunities: [
    { id: "d1", tenant_id: "t1", owner_id: "u1", ref: "OPP-1", title: "Plant", expected_close: "2026-10-20", amount: 900, outcome: "open" },
    { id: "d2", tenant_id: "t1", owner_id: "u2", ref: "OPP-OTHER-USER", title: "x", expected_close: "2026-10-20", amount: 900, outcome: "open" },
  ],
  abm_target_accounts: [
    { id: "a1", tenant_id: "t1", owner_user_id: "u1", next_step_due: "2026-10-21", accounts: { name: "Acme" } },
    { id: "a2", tenant_id: "t1", owner_user_id: "u2", next_step_due: "2026-10-21", accounts: { name: "Other" } },
  ],
  journey_tasks: [
    { id: "k1", tenant_id: "t1", owner_user_id: "u1", status: "open", title: "Call back", due_on: "2026-10-22", account_id: null },
    { id: "k2", tenant_id: "t1", owner_user_id: "u2", status: "open", title: "Not mine", due_on: "2026-10-22", account_id: null },
  ],
  accounts: [
    { id: "acc1", tenant_id: "t1", owner_user_id: "u1" },
    { id: "acc2", tenant_id: "t1", owner_user_id: "u2" },
  ],
  invoices: [
    { id: "i1", tenant_id: "t1", account_id: "acc1", ref: "INV-1", status: "overdue", due_date: "2026-10-01", total: 1000, paid_amount: 0 },
    { id: "i2", tenant_id: "t1", account_id: "acc2", ref: "INV-OTHER-OWNER", status: "overdue", due_date: "2026-10-01", total: 1000, paid_amount: 0 },
  ],
  wfm_leave_requests: [
    { tenant_id: "t1", status: "pending", employee_id: "e1", created_at: "2026-10-19T08:00:00Z" },
    { tenant_id: "t1", status: "pending", employee_id: "e2", created_at: "2026-10-15T08:00:00Z" },
  ],
  wfm_correction_requests: [],
  wfm_ot_sessions: [{ tenant_id: "t1", status: "pending", employee_id: "e1", started_at: "2026-10-21T08:00:00Z" }],
  integration_messages: [
    { tenant_id: "t1", status: "failed", created_at: "2026-10-22T06:00:00Z" },
    { tenant_id: "t1", status: "failed", created_at: "2026-10-10T06:00:00Z" },
    { tenant_id: "t2", status: "failed", created_at: "2026-10-22T06:00:00Z" },
  ],
});

describe("tenant isolation and ownership", () => {
  it("yesterday reads only this person's rows in this workspace inside the window", async () => {
    const { admin, calls } = fakeAdmin(tables());
    const out = await loadYesterday(admin, ctxOf(), win);
    expect(out.changes.map((c) => c.object_label)).toEqual(["SQ-1"]);
    expect(out.comments.map((c) => c.object_id)).toEqual(["q1"]);
    for (const c of calls) {
      expect(c.eq.tenant_id, c.table).toBe("t1");
      expect(c.eq.actor_id ?? c.eq.author_id, c.table).toBe("u1");
    }
  });

  it("every open-today query carries the workspace, and the person's own column", async () => {
    const { admin, calls } = fakeAdmin(tables());
    const out = await loadOpen(admin, ctxOf(), win, NOW);
    for (const c of calls) expect(c.eq.tenant_id, `${c.table} must be filtered by the session's workspace`).toBe("t1");
    expect(leadCalls.every((t) => t === "t1")).toBe(true);

    const byTable = (t: string) => calls.filter((c) => c.table === t);
    expect(byTable("quotes")[0].eq.created_by).toBe("u1");
    expect(byTable("opportunities")[0].eq.owner_id).toBe("u1");
    expect(byTable("abm_target_accounts")[0].eq.owner_user_id).toBe("u1");
    expect(byTable("journey_tasks")[0].eq.owner_user_id).toBe("u1");
    expect(byTable("accounts")[0].eq.owner_user_id).toBe("u1");
    expect(byTable("nova_inbox_reads")[0].eq.user_id).toBe("u1");

    const ids = out.map((c) => c.id).sort();
    expect(ids).toEqual([
      "abm:a1", "deal:d1", "invoice:i1", "lead:l1", "lead:l3", "mention:m2", "quote:q1", "sync:failed", "task:k1", "wfm:wfm_leave", "wfm:wfm_overtime",
    ].sort());
    const text = JSON.stringify(out);
    for (const leak of ["OTHER-USER", "OTHER-TENANT", "OTHER-OWNER", "Not mine", "Someone else", "Other"]) expect(text, leak).not.toContain(leak);
  });

  it("two people in one workspace get different briefings and never each other's rows", async () => {
    const t = tables();
    const a = await loadOpen(fakeAdmin(t).admin, ctxOf({ userId: "u1" }), win, NOW);
    const b = await loadOpen(fakeAdmin(t).admin, ctxOf({ userId: "u2", email: "u2@x.com", wfm: null, isAdmin: false }), win, NOW);
    expect(a.some((c) => c.id === "quote:q2")).toBe(false);
    expect(b.map((c) => c.id).filter((id) => !id.startsWith("lead:")).sort()).toEqual(["abm:a2", "deal:d2", "invoice:i2", "quote:q2", "task:k2"].sort());
    expect(JSON.stringify(b)).not.toContain("SQ-1");
  });

  it("a supervisor's queues stay inside their own scope", async () => {
    const { admin } = fakeAdmin(tables());
    const out = await loadOpen(admin, ctxOf({ wfm: { isSupervisor: true, unrestricted: false, employeeIds: ["e2"] } }), win, NOW);
    const leave = out.find((c) => c.kind === "wfm_leave")!;
    expect(leave.count).toBe(1);
    expect(leave.days).toBe(7);
    expect(out.some((c) => c.kind === "wfm_overtime")).toBe(false);
    const none = await loadOpen(fakeAdmin(tables()).admin, ctxOf({ wfm: { isSupervisor: true, unrestricted: false, employeeIds: [] } }), win, NOW);
    expect(none.some((c) => c.kind.startsWith("wfm_"))).toBe(false);
  });
});

describe("permission filtering", () => {
  const touched = async (ctx: BriefingCtx) => {
    const { admin, calls } = fakeAdmin(tables());
    await loadOpen(admin, ctx, win, NOW);
    return new Set(calls.map((c) => c.table));
  };
  it("a module the workspace did not buy is not read", async () => {
    const t = await touched(ctxOf({ features: { ai_assistant: true } }));
    expect([...t]).toEqual([]);
  });
  it("a Business Role without view on a workcenter hides that source", async () => {
    const features = { quotations: true, pipeline: true, invoices: true, leads: true, abm: true, journeys: true, wfm: true };
    const t = await touched(ctxOf({ features, perms: { unrestricted: false, grants: new Map([["quotations", { canView: true, canEdit: false, canCreate: false }]]) as never } }));
    expect([...t]).toEqual(["quotes"]);
  });
  it("WFM queues are for supervisors, failed syncs for admins, mentions for Nova workspaces", async () => {
    const t = await touched(ctxOf({ wfm: { isSupervisor: false, unrestricted: false, employeeIds: ["e1"] }, isAdmin: false, features: { wfm: true, integration_middleware: true, next_experience: false } }));
    expect(t.has("wfm_leave_requests")).toBe(false);
    expect(t.has("integration_messages")).toBe(false);
    expect(t.has("record_comments")).toBe(false);
  });
  it("yesterday drops families the person cannot open", () => {
    const lines = yesterdayLines(
      [{ object_type: "quotes", object_id: "q1", object_label: "SQ-1", action: "create", created_at: "x" }],
      [], (def) => def.type !== objectDef("quote").type,
    );
    expect(lines).toEqual([]);
  });
  it("a missing table (migration pending) is an empty source, not an error", async () => {
    const t = tables();
    delete (t as Record<string, unknown>).journey_tasks;
    delete (t as Record<string, unknown>).abm_target_accounts;
    const out = await loadOpen(fakeAdmin(t).admin, ctxOf(), win, NOW);
    expect(out.some((c) => c.kind === "task_due" || c.kind === "abm_step")).toBe(false);
    expect(out.some((c) => c.kind === "quote_expiring")).toBe(true);
  });
});

// ── Caching and refresh ───────────────────────────────────────────────────────────────────────────────────────────
function memoryStore(opts: { pending?: boolean } = {}) {
  const rows = new Map<string, StoredBriefing>();
  const writes: string[] = [];
  const store: BriefingStore = {
    async read(tenantId, userId, day) {
      if (opts.pending) return { row: null, pending: true };
      return { row: rows.get(`${tenantId}|${userId}|${day}`) ?? null, pending: false };
    },
    async write(r) {
      if (opts.pending) return { pending: true };
      writes.push(`${r.tenantId}|${r.userId}|${r.day}`);
      rows.set(`${r.tenantId}|${r.userId}|${r.day}`, { data: r.data, lang: r.lang, computedAt: r.data.computedAt });
      return { pending: false };
    },
  };
  return { store, rows, writes };
}
const sources = (cands: Candidate[] = [cand({ id: "quote:q1", kind: "quote_expiring", days: 1, label: "SQ-1" })]) => ({
  yesterday: vi.fn(async () => ({ changes: [], comments: [] })),
  open: vi.fn(async () => cands),
});

describe("caching and refresh", () => {
  it("works the briefing out on the first open of the day and reads the stored row after", async () => {
    const { store, writes } = memoryStore();
    const src = sources();
    const first = await getBriefing({ admin: {} as never, ctx: ctxOf(), timeZone: "UTC", now: NOW, store, sources: src });
    expect(first).toMatchObject({ day: "2026-10-22", cached: false, stored: true, empty: false });
    expect(first.focus[0]).toMatchObject({ label: "SQ-1", why: "Expires tomorrow" });
    const second = await getBriefing({ admin: {} as never, ctx: ctxOf(), timeZone: "UTC", now: new Date(NOW.getTime() + 3_600_000), store, sources: src });
    expect(second.cached).toBe(true);
    expect(src.open).toHaveBeenCalledTimes(1);
    expect(writes).toEqual(["t1|u1|2026-10-22"]);
  });
  it("Refresh recomputes, but at most once every five minutes", async () => {
    const { store } = memoryStore();
    const src = sources();
    const args = { admin: {} as never, ctx: ctxOf(), timeZone: "UTC", store, sources: src };
    await getBriefing({ ...args, now: NOW });
    const early = await getBriefing({ ...args, now: new Date(NOW.getTime() + 2 * 60_000), refresh: true });
    expect(early.cached).toBe(true);
    expect(early.refreshableAt).toBe(new Date(NOW.getTime() + 5 * 60_000).toISOString());
    expect(src.open).toHaveBeenCalledTimes(1);
    const later = await getBriefing({ ...args, now: new Date(NOW.getTime() + 6 * 60_000), refresh: true });
    expect(later.cached).toBe(false);
    expect(src.open).toHaveBeenCalledTimes(2);
  });
  it("a new day in the workspace's zone is a new briefing", async () => {
    const { store, writes } = memoryStore();
    const src = sources();
    const args = { admin: {} as never, ctx: ctxOf(), timeZone: "Asia/Kolkata", store, sources: src };
    await getBriefing({ ...args, now: new Date("2026-10-22T17:00:00Z") });
    await getBriefing({ ...args, now: new Date("2026-10-22T19:00:00Z") });
    expect(writes).toEqual(["t1|u1|2026-10-22", "t1|u1|2026-10-23"]);
  });
  it("is stored per person and per workspace", async () => {
    const { store, writes } = memoryStore();
    const src = sources();
    await getBriefing({ admin: {} as never, ctx: ctxOf(), timeZone: "UTC", now: NOW, store, sources: src });
    await getBriefing({ admin: {} as never, ctx: ctxOf({ userId: "u2" }), timeZone: "UTC", now: NOW, store, sources: src });
    await getBriefing({ admin: {} as never, ctx: ctxOf({ tenantId: "t2" }), timeZone: "UTC", now: NOW, store, sources: src });
    expect(writes).toEqual(["t1|u1|2026-10-22", "t1|u2|2026-10-22", "t2|u1|2026-10-22"]);
    expect(src.open).toHaveBeenCalledTimes(3);
  });
  it("without the table it still answers, on every open, and says it is not stored", async () => {
    const { store } = memoryStore({ pending: true });
    const src = sources();
    const a = await getBriefing({ admin: {} as never, ctx: ctxOf(), timeZone: "UTC", now: NOW, store, sources: src });
    const b = await getBriefing({ admin: {} as never, ctx: ctxOf(), timeZone: "UTC", now: NOW, store, sources: src, refresh: true });
    expect([a.stored, b.stored, a.refreshableAt, b.cached]).toEqual([false, false, null, false]);
    expect(a.focus).toHaveLength(1);
    expect(src.open).toHaveBeenCalledTimes(2);
  });
  it("a store that throws never takes the briefing down", async () => {
    const store: BriefingStore = { read: async () => { throw new Error("boom"); }, write: async () => { throw new Error("boom"); } };
    const out = await getBriefing({ admin: {} as never, ctx: ctxOf(), timeZone: "UTC", now: NOW, store, sources: sources() });
    expect(out.stored).toBe(false);
    expect(out.focus).toHaveLength(1);
  });
  it("a new user gets the empty state", () => {
    const b = buildBriefing({ win, now: NOW, changes: [], comments: [], candidates: [], canSee: () => true });
    expect(b).toMatchObject({ empty: true, yesterday: [], today: [], focus: [] });
  });
});

describe("the explanations behind the i", () => {
  it("fit the InfoTip limit", () => {
    for (const [k, v] of Object.entries(BRIEFING_TIPS)) expect(tipTextProblems(v), k).toEqual([]);
    expect(BRIEFING_EMPTY.length).toBeGreaterThan(0);
  });
});
