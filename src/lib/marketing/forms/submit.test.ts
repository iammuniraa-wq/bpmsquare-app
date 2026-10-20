import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { decrypt } from "@/lib/encryption";
import { fakeDb, type Row } from "../testFakeDb";
import { emailBlindIndex } from "../blindIndex";
import { signRenderToken } from "./guards";
import { handleSubmission } from "./submit";
import { defaultFields } from "./types";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const F1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const F2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY1 = "frm_AAAAAAAAAAAAAAAAAAAAAAAA";
const KEY2 = "frm_BBBBBBBBBBBBBBBBBBBBBBBB";
const IP = "c".repeat(64);

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { s: process.env.QUOTE_PUBLIC_LINK_SECRET, k: process.env.FIELD_ENCRYPTION_KEY };
  process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret";
  process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);
  vi.spyOn(Math, "random").mockReturnValue(0.99);
});
afterEach(() => {
  process.env.QUOTE_PUBLIC_LINK_SECRET = saved.s;
  process.env.FIELD_ENCRYPTION_KEY = saved.k;
  vi.restoreAllMocks();
});

const topics = [{ key: "offers", label: "Offers", hint: "" }, { key: "events", label: "Events", hint: "" }];
const tenant = (id: string, over: Row = {}): Row => ({
  id, name: id === T1 ? "Al Noor" : "Other Co", custom_domain: id === T1 ? "crm.alnoor.test" : "crm.other.test", is_demo: false,
  features: { marketing: true, marketing_forms: true }, config: { marketing: { topics } }, ...over,
});
const form = (id: string, tenantId: string, key: string, over: Row = {}): Row => ({
  id, tenant_id: tenantId, ref: "FRM-0001", name: "Website contact", slug: "contact", public_key: key, status: "live",
  fields: defaultFields(), consent: { text: "I agree to hear about offers by email.", topics: ["offers"], required: false },
  after_submit: { kind: "message", message: "Thanks, we will call you.", redirect_url: "" }, updated_at: "2026-10-20T08:00:00.000Z", ...over,
});
const seed = (over: Record<string, Row[]> = {}) => fakeDb({
  tenants: [tenant(T1), tenant(T2)],
  forms: [form(F1, T1, KEY1), form(F2, T2, KEY2)],
  accounts: [], contacts: [], leads: [], form_submissions: [], consent_events: [], consent_state: [], domain_event: [],
  ...over,
});

const good = (over: Record<string, unknown> = {}) => ({
  name: "Ali Hassan", company: "Gulf Precast", email: "Ali@Gulf.test", message: "Need a quote", consent: true,
  rt: signRenderToken(KEY1, Date.now() - 10_000), company_website: "", ...over,
});
const send = (db: ReturnType<typeof fakeDb>, body: unknown, key = KEY1, ipHash: string | null = null) =>
  handleSubmission(db.client, { key, rawBody: typeof body === "string" ? body : JSON.stringify(body), ipHash, uaFamily: "Chrome" });

describe("a good submit", () => {
  it("creates the account, contact and lead, and keeps the answers encrypted", async () => {
    const db = seed();
    const r = await send(db, good(), KEY1, IP);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, after: { kind: "message", message: "Thanks, we will call you." } });

    expect(db.tables.accounts).toHaveLength(1);
    expect(db.tables.accounts[0]).toMatchObject({ tenant_id: T1, name: "Gulf Precast", type: "prospect" });
    expect(db.tables.contacts).toHaveLength(1);
    expect(db.tables.contacts[0]).toMatchObject({ tenant_id: T1, account_id: db.tables.accounts[0].id, name: "Ali Hassan" });
    expect(db.tables.contacts[0].email_hash).toBe(emailBlindIndex("ali@gulf.test"));
    expect(String(db.tables.contacts[0].email)).toMatch(/^enc:v1:/);

    expect(db.tables.leads).toHaveLength(1);
    expect(db.tables.leads[0]).toMatchObject({ tenant_id: T1, source: "form", source_form_id: F1, contact_id: db.tables.contacts[0].id, status: "new" });

    const sub = db.tables.form_submissions[0];
    expect(sub).toMatchObject({ tenant_id: T1, form_id: F1, consent_given: true, outcome: "created", ip_hash: IP, ua_family: "Chrome" });
    const answers = sub.answers as Record<string, string>;
    expect(answers.email).toMatch(/^enc:v1:/);
    expect(decrypt(answers.email)).toBe("ali@gulf.test");
    expect(decrypt(answers.message)).toBe("Need a quote");
    expect(JSON.stringify(sub)).not.toContain("Need a quote");
    expect(new Date(String(sub.expires_at)).getTime() - Date.now()).toBeGreaterThan(179 * 86_400_000);
  });

  it("writes the consent rows with the evidence: the exact words, the form, the hashed address", async () => {
    const db = seed();
    await send(db, good(), KEY1, IP);
    expect(db.tables.consent_events).toHaveLength(1);
    const ev = db.tables.consent_events[0];
    expect(ev).toMatchObject({ tenant_id: T1, contact_id: db.tables.contacts[0].id, channel: "email", topic: "offers", status: "granted", basis: "consent", source: "form" });
    expect(ev.evidence).toMatchObject({
      form_id: F1, form_ref: "FRM-0001", text: "I agree to hear about offers by email.", topics: ["offers"], ip_hash: IP, ua_family: "Chrome",
      form_version: "2026-10-20T08:00:00.000Z",
    });
    expect(JSON.stringify(ev.evidence)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(db.tables.consent_state[0]).toMatchObject({ tenant_id: T1, channel: "email", topic: "offers", status: "granted" });
  });

  it("covers every topic when the form names none", async () => {
    const db = seed({ forms: [form(F1, T1, KEY1, { consent: { text: "Send me anything.", topics: [], required: false } })] });
    await send(db, good());
    expect(db.tables.consent_events).toHaveLength(1);
    expect(db.tables.consent_events[0].topic).toBeNull();
  });

  it("writes nothing about consent when the box is not ticked, but still makes the contact and the lead", async () => {
    const db = seed();
    const r = await send(db, good({ consent: false }));
    expect(r.status).toBe(200);
    expect(db.tables.consent_events).toHaveLength(0);
    expect(db.tables.consent_state).toHaveLength(0);
    expect(db.tables.contacts).toHaveLength(1);
    expect(db.tables.leads).toHaveLength(1);
    expect(db.tables.form_submissions[0].consent_given).toBe(false);
  });

  it("emits form.submitted with ids only, no personal data", async () => {
    const db = seed();
    await send(db, good());
    const ev = db.tables.domain_event.find((e) => e.name === "form.submitted")!;
    expect(ev).toMatchObject({ tenant_id: T1, object_type: "form", object_id: F1, source: "public_link", contact_id: db.tables.contacts[0].id, lead_id: db.tables.leads[0].id });
    expect(JSON.stringify(ev.payload)).not.toMatch(/gulf|ali|quote/i);
    expect(db.tables.domain_event.some((e) => e.name === "lead.created")).toBe(true);
  });
});

describe("an existing person", () => {
  it("is found by the email blind index, never duplicated and never changed by the form", async () => {
    const db = seed({
      accounts: [{ id: "acc-1", tenant_id: T1, name: "Gulf Precast LLC", type: "oem" }],
      contacts: [{ id: "con-1", tenant_id: T1, account_id: "acc-1", name: "Ali H.", role: "Director", email: "enc", email_hash: emailBlindIndex("ali@gulf.test"), created_at: "2025-01-01" }],
    });
    const r = await send(db, good({ name: "Someone Else", company: "Other" }));
    expect(r.status).toBe(200);
    expect(db.tables.contacts).toHaveLength(1);
    expect(db.tables.accounts).toHaveLength(1);
    expect(db.tables.contacts[0]).toMatchObject({ name: "Ali H.", role: "Director" });
    expect(db.tables.leads[0]).toMatchObject({ account_id: "acc-1", contact_id: "con-1" });
    expect(db.tables.form_submissions[0].outcome).toBe("matched");
    expect(db.tables.consent_events[0].contact_id).toBe("con-1");
  });

  it("does not match a contact of another workspace with the same address", async () => {
    const db = seed({
      accounts: [{ id: "acc-9", tenant_id: T2, name: "Theirs", type: "oem" }],
      contacts: [{ id: "con-9", tenant_id: T2, account_id: "acc-9", name: "Ali", email: "enc", email_hash: emailBlindIndex("ali@gulf.test") }],
    });
    await send(db, good());
    expect(db.tables.contacts).toHaveLength(2);
    expect(db.tables.contacts.find((c) => c.id !== "con-9")?.tenant_id).toBe(T1);
    expect(db.tables.consent_events[0].contact_id).not.toBe("con-9");
  });

  it("a second submit from the same person updates the open lead instead of piling up copies", async () => {
    const db = seed();
    await send(db, good());
    await send(db, good({ rt: signRenderToken(KEY1, Date.now() - 20_000) }));
    expect(db.tables.contacts).toHaveLength(1);
    expect(db.tables.leads).toHaveLength(1);
    expect(db.tables.form_submissions).toHaveLength(2);
  });
});

describe("the tenant comes from the form's key", () => {
  it("ignores a tenant, form or contact id in the body", async () => {
    const db = seed();
    await send(db, good({ tenant_id: T2, form_id: F2, account_id: "x", contact_id: "y" }));
    for (const t of ["accounts", "contacts", "leads", "form_submissions", "consent_events"]) {
      for (const row of db.tables[t]) expect(row.tenant_id, t).toBe(T1);
    }
    expect(db.tables.form_submissions[0].form_id).toBe(F1);
  });

  it("the other workspace's key writes only to the other workspace", async () => {
    const db = seed();
    await send(db, good({ rt: signRenderToken(KEY2, Date.now() - 10_000) }), KEY2);
    expect(db.tables.contacts[0].tenant_id).toBe(T2);
    expect(db.tables.form_submissions[0]).toMatchObject({ tenant_id: T2, form_id: F2 });
  });

  it("every query on the service-role client that touches a tenant table names a tenant", async () => {
    const db = seed();
    await send(db, good());
    const scoped = new Set(["contacts", "accounts", "leads", "form_submissions", "consent_events", "consent_state", "domain_event"]);
    const unscoped = db.queries.filter((q) => scoped.has(q.table) && q.op !== "insert" && q.op !== "upsert" && !("tenant_id" in q.filters));
    expect(unscoped).toEqual([]);
  });
});

describe("answers 404 unless the form can be reached", () => {
  it("unknown key, malformed key, draft form, flag off, marketing off", async () => {
    expect((await send(seed(), good(), "frm_ZZZZZZZZZZZZZZZZZZZZZZZZ")).status).toBe(404);
    expect((await send(seed(), good(), "nope")).status).toBe(404);
    expect((await send(seed({ forms: [form(F1, T1, KEY1, { status: "draft" })] }), good())).status).toBe(404);
    expect((await send(seed({ tenants: [tenant(T1, { features: { marketing: true } })] }), good())).status).toBe(404);
    expect((await send(seed({ tenants: [tenant(T1, { features: { marketing_forms: true } })] }), good())).status).toBe(404);
    const db = seed({ forms: [form(F1, T1, KEY1, { status: "archived" })] });
    expect((await send(db, good())).status).toBe(404);
    expect(db.tables.contacts).toHaveLength(0);
  });

  it("a missing forms table answers 404, not a crash", async () => {
    const db = fakeDb({}, { missingTables: ["forms"] });
    expect((await send(db, good())).status).toBe(404);
  });
});

describe("abuse guards", () => {
  it("a filled honeypot is told it worked and nothing is kept", async () => {
    const db = seed();
    const r = await send(db, good({ company_website: "http://spam.test" }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, after: { kind: "message", message: "Thanks, we will call you." } });
    for (const t of ["accounts", "contacts", "leads", "form_submissions", "consent_events"]) expect(db.tables[t]).toHaveLength(0);
  });

  it("rejects a post faster than the minimum time", async () => {
    const db = seed();
    const r = await send(db, good({ rt: signRenderToken(KEY1, Date.now() - 500) }));
    expect(r.status).toBe(429);
    expect(db.tables.contacts).toHaveLength(0);
  });

  it("rejects a missing or forged render time", async () => {
    const db = seed();
    expect((await send(db, good({ rt: undefined }))).status).toBe(422);
    expect((await send(db, good({ rt: `${Date.now() - 60_000}.forged` }))).status).toBe(422);
    expect(db.tables.contacts).toHaveLength(0);
  });

  it("rejects an oversized body before reading it", async () => {
    const db = seed();
    const r = await send(db, JSON.stringify(good({ message: "x".repeat(20_000) })));
    expect(r.status).toBe(413);
    expect(db.tables.contacts).toHaveLength(0);
  });

  it("rejects something that is not a JSON object", async () => {
    const db = seed();
    expect((await send(db, "not json")).status).toBe(400);
    expect((await send(db, "[1,2]")).status).toBe(400);
  });

  it("limits a visitor to five kept submits an hour", async () => {
    const recent = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, tenant_id: T1, form_id: F1, ip_hash: IP, created_at: new Date().toISOString() }));
    const db = seed({ form_submissions: recent });
    const r = await send(db, good(), KEY1, IP);
    expect(r.status).toBe(429);
    expect(db.tables.contacts).toHaveLength(0);
    // another visitor is not affected
    expect((await send(db, good({ email: "b@c.test" }), KEY1, "d".repeat(64))).status).toBe(200);
  });

  it("does not count another workspace's submissions against this visitor", async () => {
    const other = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, tenant_id: T2, form_id: F2, ip_hash: IP, created_at: new Date().toISOString() }));
    const db = seed({ form_submissions: other });
    expect((await send(db, good(), KEY1, IP)).status).toBe(200);
  });

  it("a script cannot add a field the form does not ask for", async () => {
    const db = seed();
    await send(db, good({ phone: "+966500000000", custom1: "x" }));
    const answers = db.tables.form_submissions[0].answers as Record<string, string>;
    expect(Object.keys(answers).sort()).toEqual(["company", "email", "message", "name"]);
  });
});

describe("validation and consent rules", () => {
  it("names the field that failed and creates nothing", async () => {
    const db = seed();
    const r = await send(db, good({ email: "not-an-email" }));
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ ok: false, fields: ["Email"] });
    expect(db.tables.contacts).toHaveLength(0);
  });

  it("a form that requires the box refuses an unticked one", async () => {
    const db = seed({ forms: [form(F1, T1, KEY1, { consent: { text: "I agree.", topics: ["offers"], required: true } })] });
    expect((await send(db, good({ consent: false }))).status).toBe(422);
    expect(db.tables.contacts).toHaveLength(0);
    expect((await send(db, good())).status).toBe(200);
  });

  it("markup in an answer is stored as plain text", async () => {
    const db = seed();
    await send(db, good({ name: "<img src=x onerror=alert(1)>Ali", message: "<script>alert(1)</script>Hi" }));
    expect(db.tables.contacts[0].name).toBe("Ali");
    const answers = db.tables.form_submissions[0].answers as Record<string, string>;
    expect(decrypt(answers.message)).toBe("alert(1)Hi");
  });

  it("fails closed when the consent ledger is not there, and says so without keeping a half-made record of consent", async () => {
    const db = fakeDb({
      tenants: [tenant(T1)], forms: [form(F1, T1, KEY1)], accounts: [], contacts: [], leads: [], form_submissions: [],
    }, { missingTables: ["consent_events", "consent_state"] });
    const r = await send(db, good());
    expect(r.status).toBe(503);
    expect(db.tables.leads ?? []).toHaveLength(0);
  });
});

describe("after sending", () => {
  it("redirects to a page on the workspace's own domain, with no query string", async () => {
    const db = seed({ forms: [form(F1, T1, KEY1, { after_submit: { kind: "redirect", message: "", redirect_url: "https://crm.alnoor.test/thanks?x=1" } })] });
    const r = await send(db, good());
    expect(r.body).toEqual({ ok: true, after: { kind: "redirect", url: "https://crm.alnoor.test/thanks" } });
  });

  it("falls back to the message if the stored address is no longer on the workspace's domain", async () => {
    const db = seed({ forms: [form(F1, T1, KEY1, { after_submit: { kind: "redirect", message: "Thanks!", redirect_url: "https://evil.test/x" } })] });
    const r = await send(db, good());
    expect(r.body).toEqual({ ok: true, after: { kind: "message", message: "Thanks!" } });
  });
});

describe("while migrations are pending", () => {
  it("still files the contact and the consent if only the submissions table is missing", async () => {
    const db = fakeDb({
      tenants: [tenant(T1)], forms: [form(F1, T1, KEY1)], accounts: [], contacts: [], leads: [], consent_events: [], consent_state: [], domain_event: [],
    }, { missingTables: ["form_submissions"] });
    const r = await send(db, good(), KEY1, IP);
    expect(r.status).toBe(200);
    expect(db.tables.contacts).toHaveLength(1);
    expect(db.tables.consent_events).toHaveLength(1);
  });
});
