import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { fakeDb, type Row } from "../testFakeDb";
import { canContact } from "../consent";
import { recordPendingConsent } from "../consentWrite";
import { confirmPendingConsent, loadConfirmView, openPending, type LedgerRow } from "./confirm";
import { CONFIRM_DAYS, signConfirmToken, verifyConfirmToken } from "./confirmToken";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const META = { ipHash: "h".repeat(64), uaFamily: "Safari" };
const DAY = 86_400_000;

let saved: string | undefined;
beforeEach(() => { saved = process.env.QUOTE_PUBLIC_LINK_SECRET; process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret"; });
afterEach(() => { process.env.QUOTE_PUBLIC_LINK_SECRET = saved; });

const topics = [{ key: "offers", label: "Offers", hint: "" }, { key: "events", label: "Events", hint: "" }];
const tenant = (id: string, features: Row = { marketing: true, marketing_forms: true }): Row => ({ id, name: "Al Noor", logo_url: null, features, config: { marketing: { topics } } });
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const pendingRow = (id: string, tenantId: string, contactId: string, topic: string | null, at: string): Row => ({
  id, tenant_id: tenantId, contact_id: contactId, channel: "email", topic, status: "pending", basis: "consent", source: "form", created_at: at,
  evidence: { form_id: "f1", form_ref: "FRM-0001", text: "I agree to hear about offers." },
});
const seed = (over: Record<string, Row[]> = {}) => fakeDb({
  tenants: [tenant(T1), tenant(T2)],
  accounts: [{ id: "a1", tenant_id: T1, type: "prospect", country: "DE", marketing_opt_out: false }, { id: "a2", tenant_id: T2, type: "prospect", country: "DE", marketing_opt_out: false }],
  contacts: [
    { id: C1, tenant_id: T1, account_id: "a1", name: "Ali Hassan", do_not_contact: false },
    { id: C2, tenant_id: T2, account_id: "a2", name: "Bea Other", do_not_contact: false },
  ],
  consent_events: [pendingRow("p1", T1, C1, "offers", ago(60_000)), pendingRow("p2", T2, C2, "offers", ago(60_000))],
  consent_state: [], suppressions: [], domain_event: [],
  ...over,
});
const windowOf = (token: string, contactId: string) => {
  const r = verifyConfirmToken(contactId, token);
  if (!r.ok) throw new Error("token should be valid");
  return r.windowStart;
};

describe("the confirm link", () => {
  it("is valid for the contact it was signed for, and only that one", () => {
    const t = signConfirmToken(C1)!;
    expect(verifyConfirmToken(C1, t).ok).toBe(true);
    expect(verifyConfirmToken(C2, t)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyConfirmToken(C1, t + "x")).toEqual({ ok: false, reason: "invalid" });
    expect(verifyConfirmToken(C1, "")).toEqual({ ok: false, reason: "invalid" });
    expect(verifyConfirmToken(C1, "nonsense")).toEqual({ ok: false, reason: "invalid" });
  });

  it("lasts seven days and then says so", () => {
    expect(CONFIRM_DAYS).toBe(7);
    const now = Date.now();
    const t = signConfirmToken(C1, now)!;
    expect(verifyConfirmToken(C1, t, now + 6 * DAY).ok).toBe(true);
    expect(verifyConfirmToken(C1, t, now + 8 * DAY)).toEqual({ ok: false, reason: "expired" });
  });

  it("cannot be stretched: changing the expiry breaks the signature", () => {
    const now = Date.now();
    const t = signConfirmToken(C1, now)!;
    const [exp, sig] = t.split(".");
    const stretched = `${Number(exp) + 30 * 86_400}.${sig}`;
    expect(verifyConfirmToken(C1, stretched, now + 9 * DAY)).toEqual({ ok: false, reason: "invalid" });
  });

  it("is not the preference or unsubscribe token, and does not verify without the secret", async () => {
    const { signPreferenceToken } = await import("./preferenceToken");
    expect(verifyConfirmToken(C1, signPreferenceToken(C1)!).ok).toBe(false);
    const t = signConfirmToken(C1)!;
    delete process.env.QUOTE_PUBLIC_LINK_SECRET;
    expect(verifyConfirmToken(C1, t)).toEqual({ ok: false, reason: "invalid" });
    expect(signConfirmToken(C1)).toBeNull();
  });
});

describe("openPending", () => {
  const row = (id: string, topic: string | null, status: string, at: string): LedgerRow => ({ id, topic, status, created_at: at });
  it("keeps the newest pending row per topic", () => {
    const open = openPending([row("a", "offers", "pending", "2026-10-01T00:00:00Z"), row("b", "offers", "pending", "2026-10-02T00:00:00Z")]);
    expect(open.map((r) => r.id)).toEqual(["b"]);
  });
  it("a later yes or no for the same topic, or for every topic, closes it", () => {
    expect(openPending([row("a", "offers", "pending", "2026-10-01T00:00:00Z"), row("g", "offers", "granted", "2026-10-02T00:00:00Z")])).toHaveLength(0);
    expect(openPending([row("a", "offers", "pending", "2026-10-01T00:00:00Z"), row("w", null, "withdrawn", "2026-10-02T00:00:00Z")])).toHaveLength(0);
  });
  it("an answer about another topic, or an older one, does not", () => {
    expect(openPending([row("a", "offers", "pending", "2026-10-02T00:00:00Z"), row("g", "events", "granted", "2026-10-03T00:00:00Z")])).toHaveLength(1);
    expect(openPending([row("a", "offers", "pending", "2026-10-02T00:00:00Z"), row("g", "offers", "granted", "2026-10-01T00:00:00Z")])).toHaveLength(1);
  });
});

describe("pending is never a yes", () => {
  it("recording a pending answer writes only to the ledger, and canContact still refuses", async () => {
    const db = seed({ consent_events: [] });
    const r = await recordPendingConsent(T1, { contactId: C1, channel: "email", topic: "offers", source: "form", evidence: { form_id: "f1" } }, db.client);
    expect(r).toEqual({ ok: true });
    expect(db.tables.consent_events).toHaveLength(1);
    expect(db.tables.consent_events[0]).toMatchObject({ tenant_id: T1, contact_id: C1, status: "pending", topic: "offers", basis: "consent" });
    expect(db.tables.consent_state).toHaveLength(0);
    expect(db.tables.domain_event).toHaveLength(0);
    const d = await canContact(T1, C1, "email", "offers", db.client);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("no_consent");
  });

  it("a pending row in the state table (should never exist) is ignored, and an earlier real yes is not covered by it", async () => {
    const db = seed({
      consent_state: [
        { tenant_id: T1, contact_id: C1, channel: "email", topic: "", status: "pending", basis: "consent", since: new Date().toISOString() },
        { tenant_id: T1, contact_id: C1, channel: "email", topic: "offers", status: "granted", basis: "consent", since: ago(5 * DAY) },
      ],
    });
    expect((await canContact(T1, C1, "email", "offers", db.client)).ok).toBe(true);
    expect((await canContact(T1, C1, "email", "events", db.client)).ok).toBe(false);
  });

  it("a person who already said yes to the topic is not asked again", async () => {
    const db = seed({
      consent_events: [],
      consent_state: [{ tenant_id: T1, contact_id: C1, channel: "email", topic: "offers", status: "granted", basis: "consent", since: ago(DAY) }],
    });
    const r = await recordPendingConsent(T1, { contactId: C1, channel: "email", topic: "offers", source: "form" }, db.client);
    expect(r).toEqual({ ok: true, skipped: "already_granted" });
    expect(db.tables.consent_events).toHaveLength(0);
  });

  it("refuses another workspace's contact and an unknown topic", async () => {
    const db = seed({ consent_events: [] });
    expect((await recordPendingConsent(T1, { contactId: C2, channel: "email", topic: "offers", source: "form" }, db.client)).ok).toBe(false);
    expect((await recordPendingConsent(T1, { contactId: C1, channel: "email", topic: "nope", source: "form" }, db.client)).ok).toBe(false);
    expect(db.tables.consent_events).toHaveLength(0);
  });

  it("reports a missing check value (migration 0197 pending) as pending, not as a crash", async () => {
    const db = seed({ consent_events: [] });
    const real = db.client.from.bind(db.client);
    (db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = real(t) as { insert: (r: unknown) => unknown };
      if (t === "consent_events") q.insert = () => Promise.resolve({ data: null, error: { code: "23514", message: "violates check constraint" } });
      return q;
    };
    const r = await recordPendingConsent(T1, { contactId: C1, channel: "email", topic: "offers", source: "form" }, db.client);
    expect(r).toMatchObject({ ok: false, pending: true });
  });
});

describe("confirming", () => {
  it("flips the pending answer to granted, records how, announces it once, and canContact then says yes", async () => {
    const db = seed();
    expect((await canContact(T1, C1, "email", "offers", db.client)).ok).toBe(false);
    const token = signConfirmToken(C1)!;
    const r = await confirmPendingConsent(db.client, T1, C1, windowOf(token, C1), META);
    expect(r).toEqual({ ok: true, confirmed: 1 });

    expect(db.tables.consent_state).toHaveLength(1);
    expect(db.tables.consent_state[0]).toMatchObject({ tenant_id: T1, contact_id: C1, channel: "email", topic: "offers", status: "granted" });
    const granted = db.tables.consent_events.find((e) => e.status === "granted")!;
    expect(granted).toMatchObject({ tenant_id: T1, contact_id: C1, topic: "offers", basis: "consent", source: "form" });
    expect(granted.evidence).toMatchObject({ via: "double_opt_in", confirmed_pending_event: "p1", form_id: "f1", text: "I agree to hear about offers.", ip_hash: META.ipHash, ua_family: "Safari" });
    expect(JSON.stringify(granted.evidence)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);

    const names = db.tables.domain_event.filter((e) => e.tenant_id === T1).map((e) => e.name).sort();
    expect(names).toEqual(["consent.confirmed", "consent.granted"]);
    expect((await canContact(T1, C1, "email", "offers", db.client)).ok).toBe(true);
  });

  it("a second press changes nothing", async () => {
    const db = seed();
    const w = windowOf(signConfirmToken(C1)!, C1);
    await confirmPendingConsent(db.client, T1, C1, w, META);
    const events = db.tables.consent_events.length;
    const r = await confirmPendingConsent(db.client, T1, C1, w, META);
    expect(r).toEqual({ ok: true, confirmed: 0 });
    expect(db.tables.consent_events).toHaveLength(events);
  });

  it("does not switch someone back on who unsubscribed after ticking the box", async () => {
    const db = seed({
      consent_events: [pendingRow("p1", T1, C1, "offers", ago(120_000)), { id: "w1", tenant_id: T1, contact_id: C1, channel: "email", topic: null, status: "withdrawn", created_at: ago(60_000) }],
    });
    const r = await confirmPendingConsent(db.client, T1, C1, windowOf(signConfirmToken(C1)!, C1), META);
    expect(r).toEqual({ ok: true, confirmed: 0 });
    expect(db.tables.consent_state).toHaveLength(0);
  });

  it("an answer older than the link's seven days is not covered by it", async () => {
    const db = seed({ consent_events: [pendingRow("old", T1, C1, "offers", ago(20 * DAY))] });
    const r = await confirmPendingConsent(db.client, T1, C1, windowOf(signConfirmToken(C1)!, C1), META);
    expect(r).toEqual({ ok: true, confirmed: 0 });
  });

  it("covers every topic that is waiting, one yes each", async () => {
    const db = seed({ consent_events: [pendingRow("p1", T1, C1, "offers", ago(60_000)), pendingRow("p3", T1, C1, "events", ago(60_000))] });
    const r = await confirmPendingConsent(db.client, T1, C1, windowOf(signConfirmToken(C1)!, C1), META);
    expect(r).toEqual({ ok: true, confirmed: 2 });
    expect(db.tables.consent_state.map((s) => s.topic).sort()).toEqual(["events", "offers"]);
  });

  it("a link made for a contact of workspace A cannot flip workspace B's rows", async () => {
    const db = seed();
    const tokenA = signConfirmToken(C1)!;
    // Wrong contact: the signature does not hold.
    expect(verifyConfirmToken(C2, tokenA)).toEqual({ ok: false, reason: "invalid" });
    // Even past the token, the confirm function only ever reads and writes the workspace it is given.
    const r = await confirmPendingConsent(db.client, T1, C2, windowOf(tokenA, C1), META);
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(db.tables.consent_state.filter((s) => s.tenant_id === T2)).toHaveLength(0);
    expect(db.tables.consent_events.find((e) => e.id === "p2")!.status).toBe("pending");
    // Confirming A leaves B's pending row exactly as it was.
    await confirmPendingConsent(db.client, T1, C1, windowOf(tokenA, C1), META);
    expect(db.tables.consent_state.every((s) => s.tenant_id === T1)).toBe(true);
    expect(db.tables.consent_events.filter((e) => e.tenant_id === T2)).toHaveLength(1);
    expect((await canContact(T2, C2, "email", "offers", db.client)).ok).toBe(false);
  });

  it("every query it makes names the workspace", async () => {
    const db = seed();
    await confirmPendingConsent(db.client, T1, C1, windowOf(signConfirmToken(C1)!, C1), META);
    const own = db.queries.filter((q) => q.op === "select" && ["consent_events", "consent_state", "contacts"].includes(q.table));
    expect(own.length).toBeGreaterThan(0);
    for (const q of own) expect(q.filters.tenant_id, `${q.table} ${q.op}`).toBe(T1);
  });
});

describe("the page's view", () => {
  it("lists what is waiting, by the workspace's own topic names", async () => {
    const db = seed();
    const v = await loadConfirmView(db.client, C1, windowOf(signConfirmToken(C1)!, C1));
    expect(v).toMatchObject({ tenantId: T1, firstName: "Ali", waiting: ["Offers"], alreadyConfirmed: false });
  });
  it("says already confirmed once the yes is in", async () => {
    const db = seed();
    const w = windowOf(signConfirmToken(C1)!, C1);
    await confirmPendingConsent(db.client, T1, C1, w, META);
    const v = await loadConfirmView(db.client, C1, w);
    expect(v).toMatchObject({ waiting: [], alreadyConfirmed: true });
  });
  it("leads nowhere for an unknown contact, a workspace without the flag, or a missing ledger", async () => {
    const w = windowOf(signConfirmToken(C1)!, C1);
    expect(await loadConfirmView(seed().client, "no-such-contact", w)).toBeNull();
    expect(await loadConfirmView(seed({ tenants: [tenant(T1, { marketing: true }), tenant(T2)] }).client, C1, w)).toBeNull();
    const missing = fakeDb({ tenants: [tenant(T1)], contacts: [{ id: C1, tenant_id: T1, account_id: "a1", name: "Ali" }] }, { missingTables: ["consent_events"] });
    expect(await loadConfirmView(missing.client, C1, w)).toBeNull();
  });
});
