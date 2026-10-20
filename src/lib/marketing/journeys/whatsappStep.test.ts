import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { encrypt } from "@/lib/encryption";
import { readinessProblems, sanitizeJourney } from "./definition";
import { explainStep } from "./explain";
import { runTenant } from "./runner";
import { simulateJourney } from "./simulate";
import { DEFAULT_LIMITS } from "./safety";
import { loadTenantEnv } from "./env";
import type { JourneyDefinition } from "./types";

const T = "t1";
const TPL = "11111111-1111-4111-8111-111111111111";
const WED = new Date("2026-10-21T07:00:00Z"); // Wednesday 10:00 in Riyadh
const WED_NIGHT = new Date("2026-10-21T18:00:00Z"); // 21:00 local: quiet hours

const def = (templateId: string | null = TPL): JourneyDefinition => ({
  version: 1,
  trigger: { event: "quote.sent", condition: null },
  entry: { one_per_account: true, pause_when_in_trouble: true, lookback_days: 3 },
  steps: [{ id: "s1", kind: "send_whatsapp", template_id: templateId }],
});

function world(over: { consent?: boolean; features?: Record<string, boolean>; templateStatus?: string } = {}) {
  const seed: Record<string, Row[]> = {
    tenants: [{ id: T, name: "Al Noor", slug: "alnoor", custom_domain: null, company_info: null, features: { marketing: true, journeys: true, whatsapp_marketing: true, ...over.features }, config: { wfm: { timezone: "Asia/Riyadh" } }, is_demo: false }],
    journeys: [{ id: "j1", tenant_id: T, ref: "JNY-0001", name: "WhatsApp follow-up", status: "live", definition: def(), trigger_name: "quote.sent", version: 1, entry_from: "2026-10-18T00:00:00.000Z", went_live_at: "2026-10-18T00:00:00.000Z", created_at: "2026-10-18T00:00:00.000Z", updated_at: "2026-10-18T00:00:00.000Z" }],
    accounts: [{ id: "a1", tenant_id: T, name: "Gulf Precast", type: "customer", country: "Saudi Arabia", owner_user_id: null, marketing_opt_out: false }],
    contacts: [{ id: "k1", tenant_id: T, account_id: "a1", name: "Layla Hassan", email: null, phone: encrypt("+966501234567"), country: "Saudi Arabia", do_not_contact: false, email_hash: null, created_at: "2026-01-01" }],
    domain_event: [{ id: "e1", tenant_id: T, name: "quote.sent", object_type: "standard_quote", object_id: "q1", contact_id: "k1", account_id: "a1", campaign_id: null, source: "app", depth: 0, payload: { ref: "SQ-0042", total: 60000 }, created_at: "2026-10-20T08:00:00.000Z" }],
    consent_state: over.consent === false ? [] : [{ tenant_id: T, contact_id: "k1", channel: "whatsapp", topic: "", status: "granted", since: "2026-10-01T00:00:00.000Z" }],
    whatsapp_templates: [{ id: TPL, tenant_id: T, name: "Quote ready", language: "en", category: "marketing", body: "Hi {{contact_name}}, quote {{quote_ref}} is ready for you.", provider_template_name: null, status: over.templateStatus ?? "approved", topic: null }],
    whatsapp_identities: [{ id: "i1", tenant_id: T, provider: "sandbox", display_number: encrypt("+966112345678"), credentials: {}, webhook_key: "key_1234567890abcdef", status: "active", updated_at: "2026-10-01" }],
    whatsapp_messages: [], whatsapp_numbers: [], consent_events: [],
    journey_runs: [], journey_run_steps: [], journey_tasks: [], journey_cursors: [], journey_runner_lock: [],
    marketing_campaigns: [], marketing_campaign_recipients: [], service_cases: [], invoices: [], email_log: [], record_comments: [],
  };
  return fakeDb(seed);
}

beforeEach(() => { process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe("the definition", () => {
  it("accepts a WhatsApp step, keeps only a valid template id, and says a template must be chosen", () => {
    const ok = sanitizeJourney(def());
    expect(ok.ok && ok.definition.steps[0]).toEqual({ id: "s1", kind: "send_whatsapp", template_id: TPL });
    const bad = sanitizeJourney({ ...def(), steps: [{ kind: "send_whatsapp", template_id: "not-a-uuid", extra: 1 }] });
    expect(bad.ok && bad.definition.steps[0]).toEqual({ id: "s1", kind: "send_whatsapp", template_id: null });
    expect(readinessProblems(def(null))).toEqual(["Step 1: choose which WhatsApp template to send."]);
  });

  it("explains when it fires and what can stop it, from the step's own settings", () => {
    const e = explainStep(def(), 0, DEFAULT_LIMITS);
    expect(e.fires).toContain("WhatsApp");
    expect(e.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(["no_consent", "template_not_approved", "no_phone", "quiet_hours", "weekly_cap", "account_in_trouble"]));
  });
});

describe("the runner", () => {
  it("sends through the one WhatsApp function: a dry run for the sandbox, the step recorded as sent, the message tied to the journey", async () => {
    const db = world();
    await runTenant(db.client, T, { now: () => WED });
    expect(db.tables.whatsapp_messages).toHaveLength(1);
    expect(db.tables.whatsapp_messages[0]).toMatchObject({ tenant_id: T, origin: "journey", journey_id: "j1", status: "dry_run", client_ref: `${db.tables.journey_runs[0].id}:s1` });
    expect(db.tables.journey_run_steps[0]).toMatchObject({ step_kind: "send_whatsapp", status: "done", reason: "dry_run", sent: true });
    expect(db.tables.journey_runs[0].status).toBe("done");
    expect(db.tables.domain_event.find((e) => e.name === "whatsapp.sent")).toMatchObject({ source: "runner", depth: 1 });
  });

  it("without WhatsApp consent nothing is sent and the step is skipped with the reason", async () => {
    const db = world({ consent: false });
    await runTenant(db.client, T, { now: () => WED });
    expect(db.tables.whatsapp_messages).toHaveLength(0);
    expect(db.tables.journey_run_steps[0]).toMatchObject({ status: "skipped", reason: "no_consent", sent: false });
    expect(db.tables.journey_runs[0].status).toBe("done");
  });

  it("an unapproved template is refused by the send path and the step is skipped", async () => {
    const db = world({ templateStatus: "draft" });
    await runTenant(db.client, T, { now: () => WED });
    expect(db.tables.whatsapp_messages).toHaveLength(0);
    expect(db.tables.journey_run_steps[0]).toMatchObject({ status: "skipped", reason: "template_not_approved" });
  });

  it("quiet hours defer the step instead of dropping it, and nothing is written", async () => {
    const db = world();
    await runTenant(db.client, T, { now: () => WED_NIGHT });
    expect(db.tables.whatsapp_messages).toHaveLength(0);
    expect(db.tables.journey_runs[0]).toMatchObject({ status: "active", current_step_id: "s1", note_reason: "quiet_hours" });
  });

  it("the weekly cap defers to the day the next message is allowed", async () => {
    const db = world();
    db.tables.whatsapp_messages.push({ id: "old", tenant_id: T, direction: "out", contact_id: "k1", category: "marketing", status: "sent", created_at: "2026-10-19T07:00:00.000Z" });
    await runTenant(db.client, T, { now: () => WED });
    expect(db.tables.journey_runs[0]).toMatchObject({ status: "active", note_reason: "weekly_cap", next_due_at: "2026-10-26T07:00:00.000Z" });
    expect(db.tables.whatsapp_messages).toHaveLength(1);
  });

  it("a tick repeated after a crash does not send twice", async () => {
    const db = world();
    await runTenant(db.client, T, { now: () => WED });
    // The crash happened before the run was moved on: the run is back at the step, the message row exists.
    const run = db.tables.journey_runs[0];
    Object.assign(run, { status: "active", current_step_id: "s1", next_due_at: WED.toISOString() });
    db.tables.journey_run_steps.length = 0;
    await runTenant(db.client, T, { now: () => new Date(WED.getTime() + 600_000) });
    expect(db.tables.whatsapp_messages).toHaveLength(1);
    expect(db.tables.journey_run_steps[0]).toMatchObject({ reason: "already_sent" });
  });

  it("with the module off for the workspace the step is skipped and nothing is read from the WhatsApp tables", async () => {
    const db = world({ features: { whatsapp_marketing: false } });
    await runTenant(db.client, T, { now: () => WED });
    expect(db.tables.journey_run_steps[0]).toMatchObject({ status: "skipped", reason: "module_off" });
    expect(db.queries.some((q) => q.table.startsWith("whatsapp_"))).toBe(false);
  });
});

describe("try it on one person", () => {
  it("reads only: says what would happen and writes nothing", async () => {
    const db = world();
    const env = await loadTenantEnv(db.client, T);
    const before = db.queries.length;
    const r = await simulateJourney(db.client, env!, def(), "k1", { now: () => WED });
    expect(r?.lines.find((l) => l.step_id === "s1")).toMatchObject({ outcome: "happens" });
    expect(db.queries.slice(before).every((q) => q.op === "select")).toBe(true);
    expect(db.tables.whatsapp_messages).toHaveLength(0);
  });

  it("shows the consent refusal as a skip", async () => {
    const db = world({ consent: false });
    const env = await loadTenantEnv(db.client, T);
    const r = await simulateJourney(db.client, env!, def(), "k1", { now: () => WED });
    expect(r?.lines.find((l) => l.step_id === "s1")).toMatchObject({ outcome: "skipped", reason: "no_consent" });
  });
});
