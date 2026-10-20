import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { checkStaffConsent, offeredBases, type StaffConsentContext } from "./staffConsent";
import { loadContactConsent, recordConsentByStaff } from "./contactConsent";
import { fakeDb } from "./testFakeDb";

const T_A = "11111111-1111-4111-8111-111111111111";
const T_B = "22222222-2222-4222-8222-222222222222";
const CID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REP = "rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr";

const ctx = (over: Partial<StaffConsentContext> = {}): StaffConsentContext => ({ jurisdiction: "SA", tenantDefaults: {}, isExistingCustomer: true, ...over });

describe("checkStaffConsent -- what a person may write down", () => {
  const grant = { channel: "email", status: "granted", basis: "consent", note: "agreed by phone on 20 Oct" };

  it("accepts a grant with a note", () => {
    expect(checkStaffConsent(grant, ctx())).toMatchObject({ ok: true, status: "granted", basis: "consent", channel: "email" });
  });

  it("requires the note, for a grant and for a withdrawal", () => {
    expect(checkStaffConsent({ ...grant, note: "  " }, ctx()).ok).toBe(false);
    expect(checkStaffConsent({ ...grant, status: "withdrawn", note: "" }, ctx()).ok).toBe(false);
    expect(checkStaffConsent({ ...grant, status: "withdrawn", note: "asked by phone" }, ctx()).ok).toBe(true);
  });

  it("refuses web tracking, unknown channels and the bases staff cannot assert", () => {
    expect(checkStaffConsent({ ...grant, channel: "web_tracking" }, ctx()).ok).toBe(false);
    expect(checkStaffConsent({ ...grant, channel: "carrier_pigeon" }, ctx()).ok).toBe(false);
    expect(checkStaffConsent({ ...grant, basis: "legitimate_interest" }, ctx()).ok).toBe(false);
    expect(checkStaffConsent({ ...grant, basis: "contract" }, ctx()).ok).toBe(false);
  });

  it("existing_customer is refused where the country does not recognise it, whatever the workspace chose", () => {
    const india = ctx({ jurisdiction: "IN", tenantDefaults: { IN: "existing_customer" } });
    const r = checkStaffConsent({ ...grant, basis: "existing_customer" }, india);
    expect(r.ok).toBe(false);
    expect(offeredBases(india)).toEqual(["consent"]);
  });

  it("existing_customer needs the workspace to have chosen it, and an account that is a customer", () => {
    expect(checkStaffConsent({ ...grant, basis: "existing_customer" }, ctx()).ok).toBe(false);
    const chosen = ctx({ tenantDefaults: { SA: "existing_customer" } });
    expect(checkStaffConsent({ ...grant, basis: "existing_customer" }, chosen)).toMatchObject({ ok: true, basis: "existing_customer" });
    expect(offeredBases(chosen)).toEqual(["consent", "existing_customer"]);
    expect(checkStaffConsent({ ...grant, basis: "existing_customer" }, { ...chosen, isExistingCustomer: false }).ok).toBe(false);
  });
});

function world(config: Record<string, unknown> = {}, country = "India", accountType = "direct") {
  return fakeDb({
    contacts: [
      { id: CID, tenant_id: T_A, name: "Asha", account_id: "acc-1", country },
      { id: "99999999-9999-4999-8999-999999999999", tenant_id: T_B, name: "Other", account_id: "acc-9", country: "India" },
    ],
    accounts: [{ id: "acc-1", tenant_id: T_A, country, type: accountType }],
    tenants: [{ id: T_A, config }],
  });
}

describe("recordConsentByStaff -- the ledger only grows", () => {
  it("appends an event with source rep, the note and the rep's id as evidence", async () => {
    const { client, tables } = world();
    const r = await recordConsentByStaff(client, T_A, REP, CID, { channel: "email", topic: "offers", status: "granted", basis: "consent", note: "agreed by phone on 20 Oct" });
    expect(r.ok).toBe(true);
    expect(tables.consent_events).toHaveLength(1);
    expect(tables.consent_events[0]).toMatchObject({
      tenant_id: T_A, contact_id: CID, channel: "email", topic: "offers", status: "granted", basis: "consent", source: "rep", created_by: REP,
      evidence: { note: "agreed by phone on 20 Oct", rep_user_id: REP },
    });
    expect(tables.consent_state[0]).toMatchObject({ tenant_id: T_A, contact_id: CID, channel: "email", topic: "offers", status: "granted" });
  });

  it("a later withdrawal adds a second event and never edits or removes the first", async () => {
    const { client, tables } = world();
    await recordConsentByStaff(client, T_A, REP, CID, { channel: "email", topic: null, status: "granted", basis: "consent", note: "agreed by phone" });
    const first = { ...tables.consent_events[0] };
    await recordConsentByStaff(client, T_A, REP, CID, { channel: "email", topic: null, status: "withdrawn", note: "asked by phone to stop" });
    expect(tables.consent_events).toHaveLength(2);
    expect(tables.consent_events[0]).toEqual(first);
    expect(tables.consent_events[1]).toMatchObject({ status: "withdrawn", source: "rep" });
    // the card's current answer is the newest one
    expect(tables.consent_state).toHaveLength(1);
    expect(tables.consent_state[0].status).toBe("withdrawn");
  });

  it("refuses a basis the person's country forbids, and writes nothing", async () => {
    const { client, tables } = world({ marketing: { consent_defaults: { IN: "existing_customer" } } }, "India");
    const r = await recordConsentByStaff(client, T_A, REP, CID, { channel: "email", topic: null, status: "granted", basis: "existing_customer", note: "buys from us" });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(tables.consent_events ?? []).toHaveLength(0);
  });

  it("refuses a missing note and an unknown topic", async () => {
    const { client, tables } = world();
    expect((await recordConsentByStaff(client, T_A, REP, CID, { channel: "email", topic: null, status: "granted", basis: "consent", note: "" })).ok).toBe(false);
    expect((await recordConsentByStaff(client, T_A, REP, CID, { channel: "email", topic: "made_up", status: "granted", basis: "consent", note: "agreed by phone" })).ok).toBe(false);
    expect(tables.consent_events ?? []).toHaveLength(0);
  });

  it("another tenant's contact is not found", async () => {
    const { client, tables } = world();
    const r = await recordConsentByStaff(client, T_B, REP, CID, { channel: "email", topic: null, status: "granted", basis: "consent", note: "agreed by phone" });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(tables.consent_events ?? []).toHaveLength(0);
  });

  it("says it is waiting for a database update while the ledger is pending", async () => {
    const db = fakeDb({
      contacts: [{ id: CID, tenant_id: T_A, name: "Asha", account_id: "acc-1", country: "India" }],
      accounts: [{ id: "acc-1", tenant_id: T_A, country: "India", type: "direct" }],
      tenants: [{ id: T_A, config: {} }],
    }, { missingTables: ["consent_events", "consent_state"] });
    const r = await recordConsentByStaff(db.client, T_A, REP, CID, { channel: "email", topic: null, status: "granted", basis: "consent", note: "agreed by phone" });
    expect(r).toMatchObject({ ok: false, status: 503, pending: true });
    expect((await loadContactConsent(db.client, T_A, CID)).available).toBe(false);
  });
});

describe("loadContactConsent", () => {
  it("joins each current answer with how it was obtained and lists the history newest first", async () => {
    const { client } = world();
    await recordConsentByStaff(client, T_A, REP, CID, { channel: "email", topic: "offers", status: "granted", basis: "consent", note: "agreed by phone on 20 Oct" });
    const c = await loadContactConsent(client, T_A, CID);
    expect(c.available).toBe(true);
    expect(c.rows[0]).toMatchObject({ channel: "email", topic: "offers", status: "granted", source: "rep", note: "agreed by phone on 20 Oct" });
    expect(c.history).toHaveLength(1);
    expect(c.topics.map((t) => t.key)).toContain("offers");
    expect(c.bases).toEqual(["consent"]);
  });
});
