import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { templateById } from "./definition";
import { runTenant, takeLock, tenantsToRun } from "./runner";
import { sendJourneyNewsletter, type SendStepArgs, type SendStepResult } from "./sendStep";
import { simulateJourney } from "./simulate";
import type { JourneyDefinition } from "./types";
import type { StoredVersion } from "@/lib/newsletter/server";

const VID = "11111111-1111-4111-8111-111111111111";
const T = "t1";
const U = "t2";
// Wednesday 10:00 in Riyadh. The quote was sent on Tuesday 11:00, so "3 days after" is Friday 11:00 local,
// which is the weekly day off: the send waits for Saturday morning.
const WED = new Date("2026-10-21T07:00:00Z");
const SAT = new Date("2026-10-24T07:00:00Z");
const SAT_NIGHT = new Date("2026-10-24T18:00:00Z");
const FRI = new Date("2026-10-23T09:00:00Z");

const def = (): JourneyDefinition => {
  const d = templateById("quote_follow_up")!.build();
  const s = d.steps[1];
  if (s.kind === "send_newsletter") s.newsletter_version_id = VID;
  return d;
};

type Seed = Record<string, Row[]>;
function world(over: { features?: Record<string, boolean>; isDemo?: boolean; config?: Record<string, unknown>; journeyStatus?: string; extra?: Seed } = {}) {
  const seed: Seed = {
    tenants: [
      { id: T, name: "Al Noor", slug: "alnoor", custom_domain: null, company_info: { email: "info@alnoor.example" }, features: { marketing: true, journeys: true, newsletter_studio: true, ...over.features }, config: { wfm: { timezone: "Asia/Riyadh" }, ...over.config }, is_demo: over.isDemo === true },
      { id: U, name: "Other Co", slug: "other", custom_domain: null, company_info: null, features: { marketing: true, journeys: true }, config: {}, is_demo: false },
    ],
    journeys: [{ id: "j1", tenant_id: T, ref: "JNY-0001", name: "Quote follow-up", status: over.journeyStatus ?? "live", definition: def(), trigger_name: "quote.sent", version: 1, entry_from: "2026-10-18T00:00:00.000Z", went_live_at: "2026-10-18T00:00:00.000Z", created_at: "2026-10-18T00:00:00.000Z", updated_at: "2026-10-18T00:00:00.000Z" }],
    accounts: [{ id: "a1", tenant_id: T, name: "Gulf Precast", owner_user_id: "owner1", marketing_opt_out: false }, { id: "a9", tenant_id: U, name: "Rival", owner_user_id: null, marketing_opt_out: false }],
    contacts: [
      { id: "k1", tenant_id: T, account_id: "a1", name: "Layla Hassan", email: "layla@gulf.example", created_at: "2026-01-01" },
      { id: "k2", tenant_id: T, account_id: "a1", name: "Omar Aziz", email: "omar@gulf.example", created_at: "2026-02-01" },
      { id: "kx", tenant_id: U, account_id: "a9", name: "Intruder", email: "x@rival.example", created_at: "2026-01-01" },
    ],
    domain_event: [
      { id: "e1", tenant_id: T, name: "quote.sent", object_type: "standard_quote", object_id: "q1", contact_id: "k1", account_id: "a1", campaign_id: null, source: "app", depth: 0, payload: { ref: "SQ-0042", total: 60000 }, created_at: "2026-10-20T08:00:00.000Z" },
    ],
    journey_runs: [], journey_run_steps: [], journey_tasks: [], journey_cursors: [], journey_runner_lock: [],
    marketing_campaigns: [], marketing_campaign_recipients: [], service_cases: [], invoices: [], email_log: [], record_comments: [],
    ...over.extra,
  };
  const db = fakeDb(seed);
  return { db, T };
}

const okGate = async () => ({ ok: true as const, reason: "consented" as const });
const sentStub = (calls: SendStepArgs[]) => async (_c: unknown, a: SendStepArgs): Promise<SendStepResult> => { calls.push(a); return { status: "sent", reason: "sent", recipientId: "r1" }; };

let jsonLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => { jsonLog = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { jsonLog.mockRestore(); });

describe("enrolment", () => {
  it("enrols a person once, even if the same event is read again and a colleague at the same company also appears", async () => {
    const { db } = world({ extra: { domain_event: [
      { id: "e1", tenant_id: T, name: "quote.sent", object_type: "standard_quote", object_id: "q1", contact_id: "k1", account_id: "a1", campaign_id: null, source: "app", depth: 0, payload: { ref: "SQ-0042" }, created_at: "2026-10-20T08:00:00.000Z" },
      { id: "e2", tenant_id: T, name: "quote.sent", object_type: "standard_quote", object_id: "q2", contact_id: "k2", account_id: "a1", campaign_id: null, source: "app", depth: 0, payload: { ref: "SQ-0043" }, created_at: "2026-10-20T09:00:00.000Z" },
    ] } });
    const deps = { now: () => WED, gate: okGate, send: sentStub([]), owner: async () => "owner1" };
    const r1 = await runTenant(db.client, T, deps);
    expect(r1.status).toBe("ran");
    expect(db.tables.journey_runs).toHaveLength(1);
    expect(db.tables.journey_runs[0].subject_key).toBe("a:a1");

    // The cursor is lost (or a second runner reads the same events): still one run.
    db.tables.journey_cursors.length = 0;
    await runTenant(db.client, T, deps);
    expect(db.tables.journey_runs).toHaveLength(1);
  });

  it("only reads events strictly after the cursor and moves it forward", async () => {
    const { db } = world();
    await runTenant(db.client, T, { now: () => WED, gate: okGate, send: sentStub([]), owner: async () => null });
    expect(db.tables.journey_cursors[0]).toMatchObject({ tenant_id: T, last_event_id: "e1", last_created_at: "2026-10-20T08:00:00.000Z" });
  });

  it("a wait at the start counts from the event, not from when the runner saw it", async () => {
    const { db } = world();
    await runTenant(db.client, T, { now: () => WED, gate: okGate, send: sentStub([]), owner: async () => null });
    expect(db.tables.journey_runs[0]).toMatchObject({ current_step_id: "s2", next_due_at: "2026-10-23T08:00:00.000Z" });
  });

  it("ignores events from before the journey was turned on, and from a journey's own send", async () => {
    const { db } = world({ extra: { domain_event: [
      { id: "old", tenant_id: T, name: "quote.sent", object_type: "standard_quote", object_id: "q0", contact_id: "k1", account_id: "a1", campaign_id: null, source: "app", depth: 0, payload: {}, created_at: "2026-10-01T08:00:00.000Z" },
      { id: "deep", tenant_id: T, name: "quote.sent", object_type: "standard_quote", object_id: "q3", contact_id: "k1", account_id: "a1", campaign_id: null, source: "runner", depth: 3, payload: {}, created_at: "2026-10-20T08:00:00.000Z" },
    ] } });
    await runTenant(db.client, T, { now: () => WED, gate: okGate, send: sentStub([]), owner: async () => null });
    expect(db.tables.journey_runs).toHaveLength(0);
  });

  it("never enrols from another workspace's events or contacts", async () => {
    const { db } = world({ extra: { domain_event: [
      { id: "foreign", tenant_id: U, name: "quote.sent", object_type: "standard_quote", object_id: "q9", contact_id: "kx", account_id: "a9", campaign_id: null, source: "app", depth: 0, payload: {}, created_at: "2026-10-20T08:00:00.000Z" },
      { id: "mixed", tenant_id: T, name: "quote.sent", object_type: "standard_quote", object_id: "q8", contact_id: "kx", account_id: "a1", campaign_id: null, source: "app", depth: 0, payload: {}, created_at: "2026-10-20T09:00:00.000Z" },
    ] } });
    await runTenant(db.client, T, { now: () => WED, gate: okGate, send: sentStub([]), owner: async () => null });
    // The foreign event is never read; the mixed one names a contact from another workspace, which is not found, so the company's own main contact is used.
    expect(db.tables.journey_runs.map((r) => r.contact_id)).toEqual(["k1"]);
    for (const q of db.queries.filter((x) => x.op === "select" && (x.table === "domain_event" || x.table === "journey_runs" || x.table === "contacts"))) expect(q.filters.tenant_id, `${q.table} ${q.op}`).toBe(T);
  });
});

describe("advancing and idempotency", () => {
  async function toSend(over: Parameters<typeof world>[0] = {}, at = SAT) {
    const w = world(over);
    await runTenant(w.db.client, T, { now: () => WED, gate: okGate, send: sentStub([]), owner: async () => "owner1" });
    expect(w.db.tables.journey_runs[0].current_step_id).toBe("s2");
    return { ...w, at };
  }

  it("sends once, creates the task for the owner, writes one step row each, and finishes the run", async () => {
    const { db, at } = await toSend();
    const calls: SendStepArgs[] = [];
    await runTenant(db.client, T, { now: () => at, gate: okGate, send: sentStub(calls), owner: async () => "owner1" });
    expect(calls).toHaveLength(1);
    expect(db.tables.journey_run_steps.map((s) => `${s.step_id}:${s.status}:${s.reason}`)).toEqual(["s1:done:scheduled", "s2:done:sent", "s3:done:done"]);
    expect(db.tables.journey_run_steps.find((s) => s.step_id === "s2")!.sent).toBe(true);
    expect(db.tables.journey_tasks).toHaveLength(1);
    expect(db.tables.journey_tasks[0]).toMatchObject({ owner_user_id: "owner1", title: "Call Layla Hassan about quote SQ-0042", due_on: "2026-10-25", tenant_id: T });
    expect(db.tables.journey_runs[0]).toMatchObject({ status: "done", current_step_id: null, exit_reason: "finished" });
  });

  it("a retried tick does not send again or write a step twice (the step row already exists)", async () => {
    const { db, at } = await toSend();
    const calls: SendStepArgs[] = [];
    await runTenant(db.client, T, { now: () => at, gate: okGate, send: sentStub(calls), owner: async () => "owner1" });
    // The run row is put back as if the process died after writing the step rows.
    Object.assign(db.tables.journey_runs[0], { status: "active", current_step_id: "s2", next_due_at: at.toISOString(), finished_at: null });
    await runTenant(db.client, T, { now: () => new Date(at.getTime() + 300_000), gate: okGate, send: sentStub(calls), owner: async () => "owner1" });
    expect(calls).toHaveLength(1);
    expect(db.tables.journey_run_steps.filter((s) => s.step_id === "s2")).toHaveLength(1);
    expect(db.tables.journey_tasks).toHaveLength(1);
  });

  it("a crash after the email went but before the step row: the recipient row stops a second send", async () => {
    const { db, at } = await toSend();
    const run = db.tables.journey_runs[0];
    db.tables.marketing_campaigns.push({ id: "camp", tenant_id: T, journey_id: "j1", journey_step_id: "s2" });
    db.tables.marketing_campaign_recipients.push({ id: "rcp", tenant_id: T, campaign_id: "camp", contact_id: run.contact_id, status: "sent" });
    db.tables.newsletter_versions = [version()];
    const mailer = vi.fn(async () => ({ data: { id: "re" }, error: null }));
    const send = (c: never, a: SendStepArgs) => sendJourneyNewsletter(c, a, { mailer: { emails: { send: mailer } } as never, gate: okGate });
    await runTenant(db.client, T, { now: () => at, gate: okGate, send, owner: async () => "owner1" });
    expect(mailer).not.toHaveBeenCalled();
    expect(db.tables.journey_run_steps.find((s) => s.step_id === "s2")).toMatchObject({ status: "done", reason: "already_sent", recipient_id: "rcp" });
  });

  it("a failed send is retried with back-off, then the run is stalled and says why", async () => {
    const { db, at } = await toSend();
    const fail = async (): Promise<SendStepResult> => ({ status: "failed", reason: "send_failed", detail: "provider error", recipientId: null });
    let now = at;
    for (let i = 0; i < 3; i++) {
      await runTenant(db.client, T, { now: () => now, gate: okGate, send: fail, owner: async () => "owner1" });
      now = new Date(now.getTime() + 3_600_000);
    }
    expect(db.tables.journey_run_steps.filter((s) => s.step_id === "s2").map((s) => `${s.attempt}:${s.status}`)).toEqual(["1:failed", "2:failed", "3:failed"]);
    expect(db.tables.journey_runs[0]).toMatchObject({ status: "stalled" });
    expect(String(db.tables.journey_runs[0].last_note)).toContain("provider error");
  });

  it("a paused journey is a kill switch: due runs keep their place and nothing is sent", async () => {
    const { db, at } = await toSend();
    db.tables.journeys[0].status = "paused";
    const calls: SendStepArgs[] = [];
    await runTenant(db.client, T, { now: () => at, gate: okGate, send: sentStub(calls), owner: async () => "owner1" });
    expect(calls).toHaveLength(0);
    expect(db.tables.journey_runs[0]).toMatchObject({ status: "active", current_step_id: "s2" });
  });
});

describe("the safety rules at send time", () => {
  async function ready(over: Parameters<typeof world>[0] = {}) {
    const w = world(over);
    await runTenant(w.db.client, T, { now: () => WED, gate: okGate, send: sentStub([]), owner: async () => "owner1" });
    return w;
  }

  it("consent refusal: the message is skipped with the reason, never sent, and the journey carries on to the task", async () => {
    const { db } = await ready();
    const calls: SendStepArgs[] = [];
    await runTenant(db.client, T, { now: () => SAT, gate: async () => ({ ok: false, reason: "no_consent" }), send: sentStub(calls), owner: async () => "owner1" });
    expect(calls).toHaveLength(0);
    expect(db.tables.journey_run_steps.find((s) => s.step_id === "s2")).toMatchObject({ status: "skipped", reason: "no_consent", sent: false });
    expect(db.tables.journey_tasks).toHaveLength(1);
  });

  it("consent is also checked inside the one send path, whatever the runner decided", async () => {
    const { db } = await ready();
    db.tables.newsletter_versions = [version()];
    process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret";
    const mailer = vi.fn(async () => ({ data: { id: "re" }, error: null }));
    const send = (c: never, a: SendStepArgs) => sendJourneyNewsletter(c, a, { mailer: { emails: { send: mailer } } as never, gate: async () => ({ ok: false, reason: "withdrawn" }), delayMs: 0 });
    await runTenant(db.client, T, { now: () => SAT, gate: okGate, send, owner: async () => "owner1" });
    expect(mailer).not.toHaveBeenCalled();
    expect(db.tables.journey_run_steps.find((s) => s.step_id === "s2")).toMatchObject({ status: "skipped", reason: "withdrawn" });
  });

  it("quiet hours: a send at night waits until morning and is not dropped", async () => {
    const { db } = await ready();
    const calls: SendStepArgs[] = [];
    await runTenant(db.client, T, { now: () => SAT_NIGHT, gate: okGate, send: sentStub(calls), owner: async () => "owner1" });
    expect(calls).toHaveLength(0);
    expect(db.tables.journey_runs[0]).toMatchObject({ status: "active", current_step_id: "s2", note_reason: "quiet_hours", next_due_at: "2026-10-25T05:00:00.000Z" });
    expect(db.tables.journey_run_steps.some((s) => s.step_id === "s2")).toBe(false);
  });

  it("the Friday day off: held until Saturday morning", async () => {
    const { db } = await ready();
    db.tables.journey_runs[0].next_due_at = "2026-10-23T08:00:00.000Z";
    const calls: SendStepArgs[] = [];
    await runTenant(db.client, T, { now: () => FRI, gate: okGate, send: sentStub(calls), owner: async () => "owner1" });
    expect(calls).toHaveLength(0);
    expect(db.tables.journey_runs[0]).toMatchObject({ note_reason: "weekly_off", next_due_at: "2026-10-24T05:00:00.000Z" });
  });

  it("daily cap: a person who already had a journey email today waits", async () => {
    const { db } = await ready();
    db.tables.journey_run_steps.push({ id: "old", tenant_id: T, run_id: "other", journey_id: "j2", step_id: "x", step_kind: "send_newsletter", attempt: 1, status: "done", contact_id: "k1", sent: true, at: new Date(SAT.getTime() - 2 * 3_600_000).toISOString() });
    const calls: SendStepArgs[] = [];
    await runTenant(db.client, T, { now: () => SAT, gate: okGate, send: sentStub(calls), owner: async () => "owner1" });
    expect(calls).toHaveLength(0);
    expect(db.tables.journey_runs[0]).toMatchObject({ note_reason: "daily_cap" });
  });

  it("pauses while the company has an old open case or an overdue invoice, and then goes", async () => {
    const { db } = await ready({ extra: { service_cases: [{ id: "c1", tenant_id: T, account_id: "a1", status: "in_repair", intake_at: "2026-08-01T00:00:00Z" }] } });
    const calls: SendStepArgs[] = [];
    await runTenant(db.client, T, { now: () => SAT, gate: okGate, send: sentStub(calls), owner: async () => "owner1" });
    expect(calls).toHaveLength(0);
    expect(db.tables.journey_runs[0]).toMatchObject({ note_reason: "account_in_trouble" });
    db.tables.service_cases[0].status = "closed";
    await runTenant(db.client, T, { now: () => new Date(SAT.getTime() + 7 * 3_600_000), gate: okGate, send: sentStub(calls), owner: async () => "owner1" });
    expect(calls).toHaveLength(1);
  });

  it("a demo workspace sends to the redirect inbox, never to the person", async () => {
    const { db } = await ready({ isDemo: true, config: { email_output: { mode: "redirect", redirect_to: "review@bpmsquare.example" } }, extra: { newsletter_versions: [version()] } });
    process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret";
    const sent: Record<string, unknown>[] = [];
    const mailer = { emails: { send: async (m: Record<string, unknown>) => { sent.push(m); return { data: { id: "re" }, error: null }; } } };
    const send = (c: never, a: SendStepArgs) => sendJourneyNewsletter(c, a, { mailer: mailer as never, gate: okGate, delayMs: 0 });
    await runTenant(db.client, T, { now: () => SAT, gate: okGate, send, owner: async () => "owner1" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["review@bpmsquare.example"]);
    // The journey send emitted its events one level deeper than a person pressing Send, from the runner.
    const emitted = db.tables.domain_event.find((e) => e.name === "email.sent");
    expect(emitted).toMatchObject({ depth: 1, source: "runner" });
    expect(db.tables.marketing_campaigns.find((c) => c.journey_id === "j1")).toMatchObject({ journey_step_id: "s2", tenant_id: T });
  });

  it("a demo workspace with no redirect inbox sends nothing at all", async () => {
    const { db } = await ready({ isDemo: true, extra: { newsletter_versions: [version()] } });
    process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret";
    const mailer = vi.fn(async () => ({ data: { id: "re" }, error: null }));
    const send = (c: never, a: SendStepArgs) => sendJourneyNewsletter(c, a, { mailer: { emails: { send: mailer } } as never, gate: okGate, delayMs: 0 });
    await runTenant(db.client, T, { now: () => SAT, gate: okGate, send, owner: async () => "owner1" });
    expect(mailer).not.toHaveBeenCalled();
  });
});

describe("switches and locks", () => {
  it("a workspace without the Journeys flag does no work at all: no event is read", async () => {
    const { db } = world({ features: { journeys: false } });
    const r = await runTenant(db.client, T, { now: () => WED, gate: okGate, send: sentStub([]) });
    expect(r.status).toBe("disabled");
    expect(db.queries.some((q) => q.table === "domain_event" || q.table.startsWith("journey"))).toBe(false);
    expect(await tenantsToRun(db.client)).toEqual([U]);
  });

  it("two overlapping ticks cannot both work on one workspace", async () => {
    const { db } = world();
    expect(await takeLock(db.client, T, WED)).toBe("taken");
    expect(await takeLock(db.client, T, new Date(WED.getTime() + 1000))).toBe("busy");
    const r = await runTenant(db.client, T, { now: () => new Date(WED.getTime() + 2000), gate: okGate, send: sentStub([]) });
    expect(r.status).toBe("locked");
    expect(db.tables.journey_runs).toHaveLength(0);
    // Once the lock has run out the next tick may take it.
    expect(await takeLock(db.client, T, new Date(WED.getTime() + 10 * 60_000))).toBe("taken");
  });

  it("runs cleanly while the migrations are pending", async () => {
    const seed = fakeDb({ tenants: [{ id: T, name: "Al Noor", slug: "a", features: { marketing: true, journeys: true }, config: {}, is_demo: false }] }, { missingTables: ["journeys", "journey_runner_lock", "journey_runs"] });
    const r = await runTenant(seed.client, T, { now: () => WED });
    expect(["pending_migration", "locked"]).toContain(r.status);
  });
});

describe("try it on one person", () => {
  it("shows the path with the day and the reason, and sends, records and emits nothing", async () => {
    const { db } = world({ extra: { newsletter_versions: [version()] } });
    const env = (await import("./env")).loadTenantEnv;
    const tenantEnv = (await env(db.client, T))!;
    const before = JSON.stringify(db.tables);
    const mailer = vi.fn();
    db.queries.length = 0;
    const r = await simulateJourney(db.client, tenantEnv, def(), "k1", { now: () => WED, gate: okGate, owner: async () => null, sample: { ref: "SQ-0042" } });
    expect(mailer).not.toHaveBeenCalled();
    expect(db.queries.every((q) => q.op === "select")).toBe(true);
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(r!.sendsNothing).toBe(true);
    const titles = r!.lines.map((l) => `${l.day}:${l.outcome}:${l.title}`);
    expect(titles[0]).toBe("0:start:A quote is sent");
    expect(r!.lines.find((l) => l.title === "Wait 3 days")!.day).toBe(3);
    // Three days after Wednesday is Saturday morning in Riyadh: allowed, so it is a real send.
    const send = r!.lines.find((l) => l.title === "Send a newsletter version")!;
    expect(send.outcome).toBe("happens");
    expect(send.detail).toContain("October update");
    expect(send.detail).toContain("version 1");
    const task = r!.lines.find((l) => l.title === "Create a task for the owner")!;
    expect(task.detail).toBe("Call Layla Hassan about quote SQ-0042");
  });

  it("names the refusal: no consent is skipped, and a Friday send is shown as held", async () => {
    const { db } = world({ extra: { newsletter_versions: [version()] } });
    const tenantEnv = (await (await import("./env")).loadTenantEnv(db.client, T))!;
    const refused = await simulateJourney(db.client, tenantEnv, def(), "k1", { now: () => WED, gate: async () => ({ ok: false, reason: "no_consent" }), owner: async () => null });
    expect(refused!.lines.find((l) => l.title === "Send a newsletter version")).toMatchObject({ outcome: "skipped", reason: "no_consent" });
    // Started on a Monday: three days later is the Thursday evening... pick a start so the send lands on a Friday.
    const held = await simulateJourney(db.client, tenantEnv, def(), "k1", { now: () => new Date("2026-10-20T09:00:00Z"), gate: okGate, owner: async () => null });
    expect(held!.lines.some((l) => l.outcome === "held" && l.reason === "weekly_off")).toBe(true);
  });

  it("will not try a person from another workspace", async () => {
    const { db } = world();
    const tenantEnv = (await (await import("./env")).loadTenantEnv(db.client, T))!;
    expect(await simulateJourney(db.client, tenantEnv, def(), "kx", { now: () => WED, gate: okGate, owner: async () => null })).toBeNull();
  });
});

function version(): StoredVersion & Row {
  const lang = (l: string, subject: string) => ({ lang: l, dir: "ltr" as const, subject, preheader: "", texts: {}, review: {}, status: "ready" as const });
  return {
    id: VID, tenant_id: T, newsletter_id: "n1", version: 1,
    snapshot: { name: "October update", blocks: [], languages: [lang("en", "Hello {{account_name}}")], kit: {} as never, topic: "offers", open_pixel: false },
    html: { en: '<p>Hi {{account_name}}</p><a href="{{unsubscribe_url}}">u</a>' }, text: { en: "Hi {{unsubscribe_url}}" }, links: [],
  } as unknown as StoredVersion & Row;
}
