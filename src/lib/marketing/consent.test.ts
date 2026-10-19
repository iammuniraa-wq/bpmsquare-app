import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { canContact, decideContact, type DecideInput } from "./consent";
import { recordConsent, addSuppression } from "./consentWrite";
import { effectiveBasis, jurisdictionForCountry } from "./jurisdictions";
import { fakeDb } from "./testFakeDb";

const base: DecideInput = {
  channel: "email", topic: "offers", doNotContact: false, suppression: null, accountOptedOut: false,
  states: [], jurisdiction: "SA", tenantDefaults: {}, isExistingCustomer: false,
};
const at = (iso: string) => iso;

describe("decideContact -- the default is strict", () => {
  it("refuses a person with no ledger entry when the tenant has chosen nothing", () => {
    expect(decideContact(base)).toEqual({ ok: false, reason: "no_consent" });
  });

  it("refuses an existing customer too under the strict default", () => {
    expect(decideContact({ ...base, isExistingCustomer: true })).toEqual({ ok: false, reason: "no_consent" });
  });

  it("allows an existing customer only when the tenant chose that for the jurisdiction", () => {
    const r = decideContact({ ...base, isExistingCustomer: true, tenantDefaults: { SA: "existing_customer" } });
    expect(r).toEqual({ ok: true, reason: "existing_customer" });
  });

  it("a prospect still needs consent even where the tenant relaxed the rule", () => {
    expect(decideContact({ ...base, isExistingCustomer: false, tenantDefaults: { SA: "existing_customer" } }).ok).toBe(false);
  });

  it("India never recognises the existing-customer basis, whatever the tenant chose", () => {
    const r = decideContact({ ...base, jurisdiction: "IN", isExistingCustomer: true, tenantDefaults: { IN: "existing_customer" } });
    expect(r.ok).toBe(false);
  });
});

describe("decideContact -- the ledger", () => {
  it("a grant for the topic allows", () => {
    expect(decideContact({ ...base, states: [{ topic: "offers", status: "granted", since: at("2026-10-01T00:00:00Z") }] })).toEqual({ ok: true, reason: "consented" });
  });

  it("a grant for another topic does not", () => {
    expect(decideContact({ ...base, states: [{ topic: "events", status: "granted", since: at("2026-10-01T00:00:00Z") }] }).ok).toBe(false);
  });

  it("a grant for every topic covers any topic", () => {
    expect(decideContact({ ...base, topic: "events", states: [{ topic: "", status: "granted", since: at("2026-10-01T00:00:00Z") }] }).ok).toBe(true);
  });

  it("the most recent answer wins: withdrawn after granted", () => {
    const r = decideContact({
      ...base,
      states: [
        { topic: "offers", status: "granted", since: at("2026-10-01T00:00:00Z") },
        { topic: "", status: "withdrawn", since: at("2026-10-05T00:00:00Z") },
      ],
    });
    expect(r).toEqual({ ok: false, reason: "withdrawn" });
  });

  it("the most recent answer wins: granted after withdrawn", () => {
    const r = decideContact({
      ...base,
      states: [
        { topic: "", status: "withdrawn", since: at("2026-10-01T00:00:00Z") },
        { topic: "offers", status: "granted", since: at("2026-10-05T00:00:00Z") },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("on a tie a withdrawal wins", () => {
    const t = at("2026-10-01T00:00:00Z");
    expect(decideContact({ ...base, states: [{ topic: "offers", status: "granted", since: t }, { topic: "offers", status: "withdrawn", since: t }] }).ok).toBe(false);
  });

  it("an explicit withdrawal beats the existing-customer basis", () => {
    const r = decideContact({ ...base, isExistingCustomer: true, tenantDefaults: { SA: "existing_customer" }, states: [{ topic: "", status: "withdrawn", since: at("2026-10-01T00:00:00Z") }] });
    expect(r.reason).toBe("withdrawn");
  });
});

describe("decideContact -- hard stops come first", () => {
  const granted = [{ topic: "", status: "granted" as const, since: at("2026-10-01T00:00:00Z") }];

  it("do_not_contact beats a grant", () => {
    expect(decideContact({ ...base, states: granted, doNotContact: true }).reason).toBe("do_not_contact");
  });

  it("a suppression beats a grant and says why", () => {
    expect(decideContact({ ...base, states: granted, suppression: { reason: "bounced_hard" } })).toEqual({ ok: false, reason: "suppressed", detail: "bounced_hard" });
  });

  it("the legacy account opt-out still refuses email, even with a grant", () => {
    expect(decideContact({ ...base, states: granted, accountOptedOut: true }).reason).toBe("account_opted_out");
  });

  it("the legacy opt-out is an email rule: it does not block WhatsApp", () => {
    expect(decideContact({ ...base, channel: "whatsapp", states: granted, accountOptedOut: true }).ok).toBe(true);
  });
});

describe("jurisdictions", () => {
  it("maps country names and codes", () => {
    expect(jurisdictionForCountry("Saudi Arabia")).toBe("SA");
    expect(jurisdictionForCountry(" UAE ")).toBe("AE");
    expect(jurisdictionForCountry("Germany")).toBe("EU");
    expect(jurisdictionForCountry("India")).toBe("IN");
    expect(jurisdictionForCountry("Brazil")).toBe("other");
    expect(jurisdictionForCountry(null)).toBe("other");
  });

  it("defaults to consent required everywhere", () => {
    for (const j of ["SA", "AE", "QA", "KW", "OM", "BH", "IN", "EU", "other"] as const) expect(effectiveBasis(j, undefined)).toBe("consent_required");
  });
});

describe("canContact (loads from the database)", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { errSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => errSpy.mockRestore());

  const seed = () => ({
    tenants: [{ id: "t1", config: {} }, { id: "t2", config: {} }],
    accounts: [{ id: "a1", tenant_id: "t1", type: "direct", country: "Saudi Arabia", marketing_opt_out: false }],
    contacts: [
      { id: "c1", tenant_id: "t1", account_id: "a1", do_not_contact: false, email_hash: "h1", country: null },
      { id: "c-other", tenant_id: "t2", account_id: "a-other", do_not_contact: false, email_hash: "h9", country: null },
    ],
    consent_state: [] as Record<string, unknown>[],
    suppressions: [] as Record<string, unknown>[],
  });

  it("refuses a contact with no consent (strict default)", async () => {
    const { client } = fakeDb(seed());
    expect(await canContact("t1", "c1", "email", "offers", client)).toEqual({ ok: false, reason: "no_consent" });
  });

  it("allows after a grant is on the ledger", async () => {
    const s = seed();
    s.consent_state.push({ tenant_id: "t1", contact_id: "c1", channel: "email", topic: "offers", status: "granted", since: "2026-10-01T00:00:00Z" });
    expect((await canContact("t1", "c1", "email", "offers", fakeDb(s).client)).ok).toBe(true);
  });

  it("a contact from another tenant is not found, whatever its id", async () => {
    const { client } = fakeDb(seed());
    expect(await canContact("t1", "c-other", "email", "offers", client)).toEqual({ ok: false, reason: "contact_not_found" });
  });

  it("refuses a suppressed address", async () => {
    const s = seed();
    s.consent_state.push({ tenant_id: "t1", contact_id: "c1", channel: "email", topic: "", status: "granted", since: "2026-10-01T00:00:00Z" });
    s.suppressions.push({ tenant_id: "t1", channel: "email", address_hash: "h1", reason: "complained" });
    expect(await canContact("t1", "c1", "email", "offers", fakeDb(s).client)).toEqual({ ok: false, reason: "suppressed", detail: "complained" });
  });

  it("a suppression recorded for another tenant does not apply", async () => {
    const s = seed();
    s.consent_state.push({ tenant_id: "t1", contact_id: "c1", channel: "email", topic: "", status: "granted", since: "2026-10-01T00:00:00Z" });
    s.suppressions.push({ tenant_id: "t2", channel: "email", address_hash: "h1", reason: "complained" });
    expect((await canContact("t1", "c1", "email", "offers", fakeDb(s).client)).ok).toBe(true);
  });

  it("still honours today's account-level opt-out flag", async () => {
    const s = seed();
    s.accounts[0].marketing_opt_out = true;
    s.consent_state.push({ tenant_id: "t1", contact_id: "c1", channel: "email", topic: "", status: "granted", since: "2026-10-01T00:00:00Z" });
    expect((await canContact("t1", "c1", "email", "offers", fakeDb(s).client)).reason).toBe("account_opted_out");
  });

  it("reads the tenant's chosen default from config", async () => {
    const s = seed();
    s.tenants[0].config = { marketing: { consent_defaults: { SA: "existing_customer" } } };
    expect(await canContact("t1", "c1", "email", "offers", fakeDb(s).client)).toEqual({ ok: true, reason: "existing_customer" });
  });

  it("with the ledger tables missing (migration pending) it is strict, not a crash", async () => {
    const { client } = fakeDb(seed(), { missingTables: ["consent_state", "suppressions"] });
    expect(await canContact("t1", "c1", "email", "offers", client)).toEqual({ ok: false, reason: "no_consent" });
  });

  it("fails closed when it cannot read the contact", async () => {
    const { client } = fakeDb(seed(), { missingTables: ["contacts"] });
    expect(await canContact("t1", "c1", "email", "offers", client)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("fails closed on bad input", async () => {
    const { client } = fakeDb(seed());
    expect((await canContact("", "c1", "email", null, client)).ok).toBe(false);
    expect((await canContact("t1", "c1", "pigeon" as never, null, client)).ok).toBe(false);
  });
});

describe("recordConsent", () => {
  const seed = () => ({
    tenants: [{ id: "t1", config: {} }],
    accounts: [{ id: "a1", tenant_id: "t1", country: "Qatar" }],
    contacts: [{ id: "c1", tenant_id: "t1", account_id: "a1", country: null }, { id: "c2", tenant_id: "t2", account_id: "a2", country: null }],
    consent_events: [] as Record<string, unknown>[],
    consent_state: [] as Record<string, unknown>[],
    domain_event: [] as Record<string, unknown>[],
  });

  it("appends an event, updates the state and emits consent.granted", async () => {
    const { client, tables } = fakeDb(seed());
    const r = await recordConsent("t1", { contactId: "c1", channel: "email", topic: "offers", status: "granted", source: "rep", evidence: { note: "asked on the phone" } }, client);
    expect(r).toEqual({ ok: true });
    expect(tables.consent_events).toHaveLength(1);
    expect(tables.consent_events[0]).toMatchObject({ tenant_id: "t1", contact_id: "c1", jurisdiction: "QA", basis: "consent", status: "granted" });
    expect(tables.consent_state[0]).toMatchObject({ topic: "offers", status: "granted" });
    expect(tables.domain_event[0]).toMatchObject({ name: "consent.granted", tenant_id: "t1" });
  });

  it("a later withdrawal replaces the state but keeps both events (append-only)", async () => {
    const { client, tables } = fakeDb(seed());
    await recordConsent("t1", { contactId: "c1", channel: "email", topic: null, status: "granted", source: "form" }, client);
    await recordConsent("t1", { contactId: "c1", channel: "email", topic: null, status: "withdrawn", source: "unsubscribe_link" }, client);
    expect(tables.consent_events).toHaveLength(2);
    expect(tables.consent_state).toHaveLength(1);
    expect(tables.consent_state[0].status).toBe("withdrawn");
  });

  it("refuses a contact from another tenant", async () => {
    const { client, tables } = fakeDb(seed());
    const r = await recordConsent("t1", { contactId: "c2", channel: "email", topic: null, status: "granted", source: "rep" }, client);
    expect(r).toEqual({ ok: false, error: "Contact not found" });
    expect(tables.consent_events).toHaveLength(0);
  });

  it("refuses a topic the tenant does not offer", async () => {
    const { client } = fakeDb(seed());
    const r = await recordConsent("t1", { contactId: "c1", channel: "email", topic: "gossip", status: "granted", source: "rep" }, client);
    expect(r).toEqual({ ok: false, error: "Unknown topic" });
  });

  it("reports a pending migration instead of throwing", async () => {
    const { client } = fakeDb(seed(), { missingTables: ["consent_events"] });
    const r = await recordConsent("t1", { contactId: "c1", channel: "email", topic: null, status: "granted", source: "rep" }, client);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.pending).toBe(true);
  });
});

describe("addSuppression", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { errSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => errSpy.mockRestore());

  it("is idempotent per tenant, channel and address", async () => {
    const { client, tables } = fakeDb({ suppressions: [] });
    await addSuppression("t1", { channel: "email", addressHash: "h", reason: "bounced_hard" }, client);
    await addSuppression("t1", { channel: "email", addressHash: "h", reason: "manual" }, client);
    expect(tables.suppressions).toHaveLength(1);
    expect(tables.suppressions[0].reason).toBe("bounced_hard");
  });

  it("is silent when the table is missing", async () => {
    const { client } = fakeDb({}, { missingTables: ["suppressions"] });
    expect(await addSuppression("t1", { channel: "email", addressHash: "h", reason: "manual" }, client)).toBe(false);
    expect(errSpy).not.toHaveBeenCalled();
  });
});
