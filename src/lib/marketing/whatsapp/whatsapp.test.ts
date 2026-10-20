import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { createHmac } from "crypto";
import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import { normalisePhone, phoneBlindIndex, maskPhone } from "./phone";
import { checkBody, renderTemplate, sanitizeTemplate, variablesOf } from "./template";
import { capCheck, classifyKeyword, sendRule, whatsappOutputFor, windowOpen, SESSION_WINDOW_MS } from "./rules";
import { sendWhatsAppTemplate } from "./send";
import { handleInbound } from "./inbound";
import { sandboxProvider, type WhatsAppProvider } from "./provider";
import { encrypt } from "@/lib/encryption";
import { indexContactNumbers } from "./numbers";

const KEY = "ab".repeat(32);
const T = "t1";
const U = "t2";
const NOW = new Date("2026-10-21T07:00:00Z");
const SECRET = "s3cret-for-the-sandbox";
const WEBHOOK_KEY = "key_1234567890abcdef";

beforeEach(() => { process.env.FIELD_ENCRYPTION_KEY = KEY; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

type Seed = Record<string, Row[]>;
function world(over: { features?: Record<string, boolean>; isDemo?: boolean; config?: Record<string, unknown>; consent?: boolean; templateStatus?: string; extra?: Seed } = {}) {
  const seed: Seed = {
    tenants: [
      { id: T, name: "Al Noor", features: { marketing: true, whatsapp_marketing: true, ...over.features }, config: over.config ?? {}, is_demo: over.isDemo === true },
      { id: U, name: "Rival", features: { marketing: true, whatsapp_marketing: true }, config: {}, is_demo: false },
    ],
    accounts: [{ id: "a1", tenant_id: T, name: "Gulf Precast", type: "customer", country: "Saudi Arabia", marketing_opt_out: false }, { id: "a9", tenant_id: U, name: "Rival Co", type: "customer", country: "Saudi Arabia", marketing_opt_out: false }],
    contacts: [
      { id: "k1", tenant_id: T, account_id: "a1", name: "Layla Hassan", phone: encrypt("0501234567"), country: "Saudi Arabia", do_not_contact: false, email_hash: null },
      { id: "kx", tenant_id: U, account_id: "a9", name: "Intruder", phone: encrypt("+966509999999"), country: "Saudi Arabia", do_not_contact: false, email_hash: null },
    ],
    consent_state: over.consent === false ? [] : [{ tenant_id: T, contact_id: "k1", channel: "whatsapp", topic: "", status: "granted", since: "2026-10-01T00:00:00.000Z" }],
    suppressions: [],
    whatsapp_templates: [
      { id: "p1", tenant_id: T, name: "Quote ready", language: "en", category: "marketing", body: "Hello {{contact_name}}, your quote {{quote_ref}} is ready to review.", provider_template_name: null, status: over.templateStatus ?? "approved", topic: null },
      { id: "p9", tenant_id: U, name: "Rival one", language: "en", category: "marketing", body: "Hello {{contact_name}}, a message from the rival.", provider_template_name: null, status: "approved", topic: null },
    ],
    whatsapp_identities: [{ id: "i1", tenant_id: T, provider: "sandbox", display_number: encrypt("+966112345678"), credentials: { webhook_secret: encrypt(SECRET) }, webhook_key: WEBHOOK_KEY, status: "active", updated_at: "2026-10-01" }],
    whatsapp_messages: [], whatsapp_numbers: [], domain_event: [], consent_events: [],
    ...over.extra,
  };
  return fakeDb(seed);
}

const args = (over: Partial<Parameters<typeof sendWhatsAppTemplate>[1]> = {}) => ({
  tenantId: T, contactId: "k1", templateId: "p1", origin: "rep" as const, values: { contact_name: "Layla", quote_ref: "SQ-0042" }, ...over,
});

const liveProvider = (calls: unknown[]): WhatsAppProvider => ({
  ...sandboxProvider, id: "sandbox", live: true,
  async sendTemplate(_i, m) { calls.push(m); return { ok: true, providerMessageId: `wamid-${calls.length}` }; },
});

describe("phone numbers", () => {
  it("normalises international forms, Arabic-Indic digits and a local 0 number with a known country", () => {
    expect(normalisePhone("+966 50 123 4567")).toBe("+966501234567");
    expect(normalisePhone("00966501234567")).toBe("+966501234567");
    expect(normalisePhone("٠٥٠١٢٣٤٥٦٧", "Saudi Arabia")).toBe("+966501234567");
    expect(normalisePhone("0501234567", "UAE")).toBe("+971501234567");
  });
  it("refuses what it would have to guess", () => {
    expect(normalisePhone("0501234567")).toBeNull();
    expect(normalisePhone("0501234567", "Atlantis")).toBeNull();
    expect(normalisePhone("12345")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });
  it("hashes with a key, never reveals the number, and masks for display", () => {
    const h = phoneBlindIndex("+966501234567", KEY);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(phoneBlindIndex("+966501234567", KEY));
    expect(h).not.toBe(phoneBlindIndex("+966501234567", "cd".repeat(32)));
    expect(() => phoneBlindIndex("+966501234567", "")).toThrow();
    expect(maskPhone("+966501234567")).not.toContain("501234567");
  });
});

describe("template body", () => {
  it("lists variables in order and renders both the text and the provider's positional values", () => {
    const body = "Hello {{contact_name}}, your quote {{quote_ref}} for {{contact_name}} is ready.";
    expect(variablesOf(body)).toEqual(["contact_name", "quote_ref"]);
    expect(renderTemplate(body, { contact_name: "Layla", quote_ref: "SQ-1" })).toEqual({ text: "Hello Layla, your quote SQ-1 for Layla is ready.", params: ["Layla", "SQ-1"] });
    expect(renderTemplate("Hi {{contact_name}}, hello.", {}).text).toBe("Hi there, hello.");
  });
  it("enforces the rules a provider enforces", () => {
    expect(checkBody("").ok).toBe(false);
    expect(checkBody("{{contact_name}} hello").ok).toBe(false);
    expect(checkBody("hello {{contact_name}}").ok).toBe(false);
    expect(checkBody("Hi {{contact_name}}{{quote_ref}} ok").ok).toBe(false);
    expect(checkBody("Hi {{password}} ok").ok).toBe(false);
    expect(checkBody("Hi {{contact_name}}, welcome.").ok).toBe(true);
  });
  it("a save keeps only the closed shape, and a topic must be the workspace's own", () => {
    const r = sanitizeTemplate({ name: " Quote ", language: "ar", category: "bogus", body: "Hi {{contact_name}}, ok", topic: "nope", provider_template_name: "Quote Ready!", status: "approved", extra: 1 }, ["offers"]);
    expect(r).toEqual({ ok: true, value: { name: "Quote", language: "ar", category: "marketing", body: "Hi {{contact_name}}, ok", topic: null, provider_template_name: "quote_ready_" } });
  });
});

describe("the rules", () => {
  it("the 24-hour window", () => {
    expect(windowOpen("2026-10-21T06:00:00Z", NOW)).toBe(true);
    expect(windowOpen(new Date(NOW.getTime() - SESSION_WINDOW_MS - 1), NOW)).toBe(false);
    expect(windowOpen(null, NOW)).toBe(false);
    expect(windowOpen("2026-10-22T06:00:00Z", NOW)).toBe(false);
  });
  it("a template needs approval; free text needs an open window and a person, never a journey", () => {
    expect(sendRule({ kind: "template", actor: "journey", lastInboundAt: null, templateStatus: "approved", now: NOW })).toEqual({ ok: true });
    expect(sendRule({ kind: "template", actor: "rep", lastInboundAt: null, templateStatus: "draft", now: NOW })).toEqual({ ok: false, reason: "template_not_approved" });
    expect(sendRule({ kind: "session", actor: "rep", lastInboundAt: "2026-10-21T06:00:00Z", now: NOW })).toEqual({ ok: true });
    expect(sendRule({ kind: "session", actor: "rep", lastInboundAt: "2026-10-19T06:00:00Z", now: NOW })).toEqual({ ok: false, reason: "window_closed" });
    expect(sendRule({ kind: "session", actor: "journey", lastInboundAt: "2026-10-21T06:00:00Z", now: NOW })).toEqual({ ok: false, reason: "session_needs_person" });
  });
  it("the weekly cap says when the next one is allowed", () => {
    const sent = [new Date("2026-10-18T07:00:00Z")];
    expect(capCheck([], NOW, 1)).toEqual({ ok: true });
    expect(capCheck(sent, NOW, 1)).toEqual({ ok: false, resumeAt: new Date("2026-10-25T07:00:00Z") });
    expect(capCheck(sent, NOW, 2)).toEqual({ ok: true });
    expect(capCheck([new Date("2026-10-01T07:00:00Z")], NOW, 1)).toEqual({ ok: true });
  });
  it("STOP and START are only the keyword on its own, in English or Arabic", () => {
    expect(classifyKeyword("STOP")).toBe("stop");
    expect(classifyKeyword(" stop. ")).toBe("stop");
    expect(classifyKeyword("إيقاف")).toBe("stop");
    expect(classifyKeyword("Start")).toBe("start");
    expect(classifyKeyword("please stop calling me")).toBeNull();
    expect(classifyKeyword("thanks")).toBeNull();
  });
  it("a demo workspace goes to its test number or is only logged, never live", () => {
    expect(whatsappOutputFor({ isDemo: false, config: {} })).toEqual({ mode: "live" });
    expect(whatsappOutputFor({ isDemo: true, config: {} })).toEqual({ mode: "dry_run" });
    expect(whatsappOutputFor({ isDemo: true, config: { whatsapp: { redirect_number: "+971 50 111 2222" } } })).toEqual({ mode: "redirect", to: "+971501112222" });
    expect(whatsappOutputFor({ isDemo: true, config: { whatsapp: { redirect_number: "garbage" } } })).toEqual({ mode: "dry_run" });
  });
});

describe("sending", () => {
  it("refuses without WhatsApp consent: nothing is sent and no message row is written", async () => {
    const db = world({ consent: false });
    const calls: unknown[] = [];
    const r = await sendWhatsAppTemplate(db.client, args(), { now: () => NOW, provider: liveProvider(calls) });
    expect(r).toMatchObject({ status: "skipped", reason: "no_consent" });
    expect(calls).toHaveLength(0);
    expect(db.tables.whatsapp_messages).toHaveLength(0);
  });

  it("email consent is not WhatsApp consent", async () => {
    const db = world({ consent: false, extra: { consent_state: [{ tenant_id: T, contact_id: "k1", channel: "email", topic: "", status: "granted", since: "2026-10-01T00:00:00.000Z" }] } });
    const r = await sendWhatsAppTemplate(db.client, args(), { now: () => NOW, provider: liveProvider([]) });
    expect(r).toMatchObject({ status: "skipped", reason: "no_consent" });
  });

  it("a withdrawal after a grant refuses, and so does do-not-contact", async () => {
    const withdrawn = world({ extra: { consent_state: [
      { tenant_id: T, contact_id: "k1", channel: "whatsapp", topic: "", status: "granted", since: "2026-10-01T00:00:00.000Z" },
      { tenant_id: T, contact_id: "k1", channel: "whatsapp", topic: "", status: "withdrawn", since: "2026-10-10T00:00:00.000Z" },
    ] } });
    expect(await sendWhatsAppTemplate(withdrawn.client, args(), { now: () => NOW })).toMatchObject({ reason: "withdrawn" });
    const dnc = world();
    dnc.tables.contacts[0].do_not_contact = true;
    expect(await sendWhatsAppTemplate(dnc.client, args(), { now: () => NOW })).toMatchObject({ reason: "do_not_contact" });
  });

  it("asks consent before it looks at anything else: an unapproved template and no number set up still say no_consent", async () => {
    const db = world({ consent: false, templateStatus: "draft", extra: { whatsapp_identities: [] } });
    expect(await sendWhatsAppTemplate(db.client, args(), { now: () => NOW })).toMatchObject({ reason: "no_consent" });
  });

  it("refuses an unapproved template and a workspace with no number", async () => {
    const draft = world({ templateStatus: "draft" });
    expect(await sendWhatsAppTemplate(draft.client, args(), { now: () => NOW })).toMatchObject({ status: "skipped", reason: "template_not_approved" });
    const noId = world({ extra: { whatsapp_identities: [] } });
    expect(await sendWhatsAppTemplate(noId.client, args(), { now: () => NOW })).toMatchObject({ reason: "no_identity" });
  });

  it("with the sandbox it logs a dry run, writes the message and the event, and calls nothing", async () => {
    const db = world();
    const r = await sendWhatsAppTemplate(db.client, args(), { now: () => NOW });
    expect(r).toMatchObject({ status: "dry_run", reason: "dry_run" });
    expect(db.tables.whatsapp_messages).toHaveLength(1);
    expect(db.tables.whatsapp_messages[0]).toMatchObject({ tenant_id: T, direction: "out", status: "dry_run", contact_id: "k1", category: "marketing" });
    const ev = db.tables.domain_event[0];
    expect(ev).toMatchObject({ name: "whatsapp.sent", tenant_id: T, contact_id: "k1", account_id: "a1" });
    expect(JSON.stringify(ev.payload)).not.toContain("Layla");
    expect(JSON.stringify(ev.payload)).not.toContain("501234567");
    expect(db.tables.whatsapp_numbers).toHaveLength(1);
  });

  it("a live provider gets the positional values and the real number; the row says sent", async () => {
    const db = world();
    const calls: { to: string; params: string[]; templateName: string }[] = [];
    const r = await sendWhatsAppTemplate(db.client, args(), { now: () => NOW, provider: liveProvider(calls) });
    expect(r).toMatchObject({ status: "sent" });
    expect(calls).toEqual([expect.objectContaining({ to: "+966501234567", params: ["Layla", "SQ-0042"], templateName: "Quote ready" })]);
    expect(db.tables.whatsapp_messages[0]).toMatchObject({ status: "sent", provider_message_id: "wamid-1" });
  });

  it("a demo workspace never reaches the real number: test number when set, otherwise only logged", async () => {
    const calls: { to: string }[] = [];
    const redirected = world({ isDemo: true, config: { whatsapp: { redirect_number: "+971501112222" } } });
    await sendWhatsAppTemplate(redirected.client, args(), { now: () => NOW, provider: liveProvider(calls) });
    expect(calls.map((c) => c.to)).toEqual(["+971501112222"]);
    expect(redirected.tables.whatsapp_messages[0].redirected_to).toBeTruthy();

    const logged = world({ isDemo: true });
    const more: unknown[] = [];
    const r = await sendWhatsAppTemplate(logged.client, args(), { now: () => NOW, provider: liveProvider(more) });
    expect(r.status).toBe("dry_run");
    expect(more).toHaveLength(0);
  });

  it("one marketing message per person per week; a utility template is not counted", async () => {
    const db = world();
    const first = await sendWhatsAppTemplate(db.client, args(), { now: () => NOW });
    expect(first.status).toBe("dry_run");
    db.tables.whatsapp_messages[0].created_at = "2026-10-20T07:00:00.000Z";
    const second = await sendWhatsAppTemplate(db.client, args(), { now: () => NOW });
    expect(second).toMatchObject({ status: "skipped", reason: "weekly_cap" });
    expect(second.retryAt?.toISOString()).toBe("2026-10-27T07:00:00.000Z");
    db.tables.whatsapp_templates[0].category = "utility";
    expect((await sendWhatsAppTemplate(db.client, args(), { now: () => NOW })).status).toBe("dry_run");
  });

  it("the same client_ref never sends twice, and a failed one is retried on the same row", async () => {
    const db = world();
    const calls: unknown[] = [];
    const provider = liveProvider(calls);
    const a = args({ clientRef: "run1:s2" });
    await sendWhatsAppTemplate(db.client, a, { now: () => NOW, provider });
    const again = await sendWhatsAppTemplate(db.client, a, { now: () => NOW, provider });
    expect(again).toMatchObject({ reason: "already_sent" });
    expect(calls).toHaveLength(1);
    expect(db.tables.whatsapp_messages).toHaveLength(1);

    db.tables.whatsapp_messages[0].status = "failed";
    db.tables.whatsapp_messages[0].created_at = "2026-09-01T00:00:00.000Z";
    await sendWhatsAppTemplate(db.client, a, { now: () => NOW, provider });
    expect(calls).toHaveLength(2);
    expect(db.tables.whatsapp_messages).toHaveLength(1);
  });

  it("a provider failure is recorded and emitted as whatsapp.failed", async () => {
    const db = world();
    const failing: WhatsAppProvider = { ...sandboxProvider, live: true, async sendTemplate() { return { ok: false, error: "rate limited", retryable: true }; } };
    const r = await sendWhatsAppTemplate(db.client, args(), { now: () => NOW, provider: failing });
    expect(r).toMatchObject({ status: "failed", reason: "send_failed" });
    expect(db.tables.whatsapp_messages[0]).toMatchObject({ status: "failed", error: "rate limited" });
    expect(db.tables.domain_event[0].name).toBe("whatsapp.failed");
  });

  it("tenant isolation: another workspace's template or contact is simply not found, and every query names the tenant", async () => {
    const db = world();
    expect(await sendWhatsAppTemplate(db.client, args({ templateId: "p9" }), { now: () => NOW })).toMatchObject({ reason: "template_missing" });
    expect(await sendWhatsAppTemplate(db.client, args({ contactId: "kx" }), { now: () => NOW })).toMatchObject({ status: "skipped", reason: "contact_not_found" });
    await sendWhatsAppTemplate(db.client, args(), { now: () => NOW });
    const tenantOwned = ["whatsapp_templates", "whatsapp_messages", "whatsapp_identities", "contacts", "accounts", "consent_state", "whatsapp_numbers", "domain_event"];
    for (const q of db.queries.filter((x) => tenantOwned.includes(x.table))) {
      if (q.op === "upsert" || q.op === "insert") continue;
      expect(q.filters, `${q.op} ${q.table}`).toMatchObject({ tenant_id: T });
    }
  });

  it("with the module off for the workspace, nothing is read past the tenant row and nothing is sent", async () => {
    const db = world({ features: { whatsapp_marketing: false } });
    expect(await sendWhatsAppTemplate(db.client, args(), { now: () => NOW })).toMatchObject({ reason: "module_off" });
    expect(db.tables.whatsapp_messages).toHaveLength(0);
    expect(db.queries.every((q) => q.table === "tenants")).toBe(true);
  });

  it("a pending migration (missing tables) is a skip, not a crash", async () => {
    const seed = world();
    const db = fakeDb({ tenants: seed.tables.tenants }, { missingTables: ["whatsapp_templates"] });
    expect(await sendWhatsAppTemplate(db.client, args(), { now: () => NOW })).toMatchObject({ status: "skipped", reason: "module_off" });
  });
});

describe("the inbound webhook", () => {
  const sign = (raw: string, secret = SECRET, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
  const headers = (sig: string | null) => ({ get: (n: string) => (n.toLowerCase() === "x-bpmsquare-signature" ? sig : null) });
  const msg = (text: string, id = "wamid.in1", from = "+966501234567") => JSON.stringify({ messages: [{ id, from, text, timestamp: Math.floor(Date.now() / 1000) }] });

  async function ready() {
    const db = world();
    await sendWhatsAppTemplate(db.client, args(), { now: () => NOW });
    db.tables.domain_event.length = 0;
    return db;
  }

  it("refuses a request with no signature, a wrong one, or one signed with another secret", async () => {
    const db = await ready();
    const raw = msg("hello");
    expect((await handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(null), rawBody: raw })).status).toBe(401);
    expect((await handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers("t=1,v1=00"), rawBody: raw })).status).toBe(401);
    expect((await handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(sign(raw, "another-secret")), rawBody: raw })).status).toBe(401);
    expect(db.tables.whatsapp_messages.filter((m) => m.direction === "in")).toHaveLength(0);
  });

  it("answers 404 for an unknown key, a disabled number and a workspace without the module", async () => {
    const raw = msg("hello");
    const db = await ready();
    expect((await handleInbound(db.client, { key: "nope_nope_nope_nope", headers: headers(sign(raw)), rawBody: raw })).status).toBe(404);
    expect((await handleInbound(db.client, { key: "bad key!", headers: headers(sign(raw)), rawBody: raw })).status).toBe(404);
    db.tables.whatsapp_identities[0].status = "disabled";
    expect((await handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(sign(raw)), rawBody: raw })).status).toBe(404);
    db.tables.whatsapp_identities[0].status = "active";
    (db.tables.tenants[0].features as Record<string, boolean>).whatsapp_marketing = false;
    expect((await handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(sign(raw)), rawBody: raw })).status).toBe(404);
  });

  it("takes the tenant from the stored identity row, never from the body", async () => {
    const db = await ready();
    const raw = JSON.stringify({ tenant_id: U, contact_id: "kx", messages: [{ id: "wamid.in9", from: "+966501234567", text: "hello", timestamp: 1 }] });
    const r = await handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(sign(raw)), rawBody: raw });
    expect(r.status).toBe(200);
    const inbound = db.tables.whatsapp_messages.filter((m) => m.direction === "in");
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({ tenant_id: T, contact_id: "k1" });
  });

  it("a reply becomes whatsapp.replied once, even if the provider retries", async () => {
    const db = await ready();
    const raw = msg("Yes, send the details");
    const send = () => handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(sign(raw)), rawBody: raw });
    expect((await send()).body).toMatchObject({ replied: 1 });
    expect((await send()).body).toMatchObject({ replied: 0, duplicate: 1 });
    const replied = db.tables.domain_event.filter((e) => e.name === "whatsapp.replied");
    expect(replied).toHaveLength(1);
    expect(replied[0]).toMatchObject({ tenant_id: T, contact_id: "k1", source: "provider_webhook", payload: expect.objectContaining({ template_id: "p1" }) });
  });

  it("STOP withdraws WhatsApp consent in the ledger, and the next send is refused; START restores it", async () => {
    const db = await ready();
    const stop = msg("STOP", "wamid.stop");
    const r = await handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(sign(stop)), rawBody: stop });
    expect(r.body).toMatchObject({ opted_out: 1 });
    const ledger = db.tables.consent_events.at(-1)!;
    expect(ledger).toMatchObject({ tenant_id: T, contact_id: "k1", channel: "whatsapp", status: "withdrawn", source: "provider_webhook", topic: null });
    expect(db.tables.domain_event.map((e) => e.name)).toEqual(expect.arrayContaining(["whatsapp.opted_out", "consent.withdrawn"]));
    // the ledger's own state row is now newer than the original grant
    db.tables.consent_state.find((s) => s.channel === "whatsapp" && s.status === "withdrawn")!.since = "2026-10-21T08:00:00.000Z";
    db.tables.whatsapp_messages.find((m) => m.direction === "out")!.created_at = "2026-08-01T00:00:00.000Z";
    expect(await sendWhatsAppTemplate(db.client, args(), { now: () => new Date("2026-10-22T07:00:00Z") })).toMatchObject({ status: "skipped", reason: "withdrawn" });

    const start = msg("start", "wamid.start");
    const r2 = await handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(sign(start)), rawBody: start });
    expect(r2.body).toMatchObject({ opted_in: 1 });
    expect(db.tables.consent_events.at(-1)).toMatchObject({ status: "granted", channel: "whatsapp", source: "provider_webhook" });
  });

  it("a sentence that merely contains stop is a reply, not an opt-out", async () => {
    const db = await ready();
    const raw = msg("Can you stop by tomorrow?", "wamid.s2");
    const r = await handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(sign(raw)), rawBody: raw });
    expect(r.body).toMatchObject({ replied: 1, opted_out: 0 });
    expect(db.tables.consent_events).toHaveLength(0);
  });

  it("a number we hold no hash for creates nothing: no contact, no message, no event", async () => {
    const db = await ready();
    const raw = msg("hello", "wamid.u1", "+966555000111");
    const r = await handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(sign(raw)), rawBody: raw });
    expect(r.body).toMatchObject({ ignored: 1, replied: 0 });
    expect(db.tables.contacts).toHaveLength(2);
    expect(db.tables.whatsapp_messages.filter((m) => m.direction === "in")).toHaveLength(0);
    expect(db.tables.domain_event).toHaveLength(0);
  });

  it("another workspace's contact with the same number is never matched", async () => {
    const db = await ready();
    // the other workspace also hashed +966501234567 for its own contact
    db.tables.whatsapp_numbers.push({ tenant_id: U, contact_id: "kx", phone_hash: phoneBlindIndex("+966501234567", KEY), created_at: "2026-10-22T00:00:00Z" });
    const raw = msg("hello", "wamid.x1");
    await handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(sign(raw)), rawBody: raw });
    const inbound = db.tables.whatsapp_messages.filter((m) => m.direction === "in");
    expect(inbound[0]).toMatchObject({ tenant_id: T, contact_id: "k1" });
  });

  it("status callbacks only move a message forward and emit delivered / read once", async () => {
    const db = world();
    await sendWhatsAppTemplate(db.client, args(), { now: () => NOW, provider: liveProvider([]) });
    db.tables.domain_event.length = 0;
    const status = (s: string) => JSON.stringify({ statuses: [{ id: "wamid-1", status: s, timestamp: Math.floor(Date.now() / 1000) }] });
    const post = (raw: string) => handleInbound(db.client, { key: WEBHOOK_KEY, headers: headers(sign(raw)), rawBody: raw });
    expect((await post(status("read"))).body).toMatchObject({ status: 1 });
    expect((await post(status("delivered"))).body).toMatchObject({ status: 0, ignored: 1 });
    expect((await post(status("failed"))).body).toMatchObject({ ignored: 1 });
    expect(db.tables.whatsapp_messages[0].status).toBe("read");
    expect(db.tables.domain_event.map((e) => e.name)).toEqual(["whatsapp.read"]);
  });
});

describe("matching contacts' numbers", () => {
  it("hashes only this workspace's contacts, in slices, and skips what is not a usable number", async () => {
    const db = world();
    db.tables.contacts.push({ id: "k2", tenant_id: T, account_id: "a1", name: "No Phone", phone: null, country: "Saudi Arabia" });
    const r = await indexContactNumbers(db.client, T, null);
    expect(r).toMatchObject({ scanned: 2, matched: 1, skipped: 1, done: true });
    expect(db.tables.whatsapp_numbers).toEqual([expect.objectContaining({ tenant_id: T, contact_id: "k1", phone_hash: phoneBlindIndex("+966501234567", KEY) })]);
  });
});
