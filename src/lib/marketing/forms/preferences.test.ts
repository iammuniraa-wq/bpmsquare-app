import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { fakeDb, type Row } from "../testFakeDb";
import { signPreferenceToken, verifyPreferenceToken } from "./preferenceToken";
import { applyPreferenceChanges, loadPreferences, parseChanges, topicOn, type StateRow } from "./preferences";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const C1 = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const C2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";

let savedSecret: string | undefined;
beforeEach(() => { savedSecret = process.env.QUOTE_PUBLIC_LINK_SECRET; process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret"; });
afterEach(() => { process.env.QUOTE_PUBLIC_LINK_SECRET = savedSecret; });

const topics = [{ key: "offers", label: "Offers", hint: "Deals" }, { key: "events", label: "Events", hint: "" }];
const tenant = (id: string, features: Row = { marketing: true, marketing_forms: true }): Row => ({ id, name: "Al Noor", logo_url: null, features, config: { marketing: { topics } } });
const seed = (over: Record<string, Row[]> = {}) => fakeDb({
  tenants: [tenant(T1), tenant(T2)],
  accounts: [{ id: "a1", tenant_id: T1, marketing_opt_out: false, country: "SA" }],
  contacts: [{ id: C1, tenant_id: T1, account_id: "a1", name: "Ali Hassan", do_not_contact: false }],
  consent_state: [
    { tenant_id: T1, contact_id: C1, channel: "email", topic: "offers", status: "granted", since: "2026-10-01T00:00:00Z", basis: "consent" },
  ],
  consent_events: [{ id: "e0", tenant_id: T1, contact_id: C1, channel: "email", topic: "offers", status: "granted", created_at: "2026-10-01T00:00:00Z" }],
  domain_event: [],
  ...over,
});
const meta = { ipHash: "h".repeat(64), uaFamily: "Safari" };

describe("the link", () => {
  it("is valid for the contact it was signed for, and only that one", () => {
    const t = signPreferenceToken(C1)!;
    expect(verifyPreferenceToken(C1, t)).toBe(true);
    expect(verifyPreferenceToken(C2, t)).toBe(false);
    expect(verifyPreferenceToken(C1, t + "x")).toBe(false);
    expect(verifyPreferenceToken(C1, "")).toBe(false);
  });
  it("is not the unsubscribe token and does not verify without the secret", () => {
    const t = signPreferenceToken(C1)!;
    delete process.env.QUOTE_PUBLIC_LINK_SECRET;
    expect(verifyPreferenceToken(C1, t)).toBe(false);
    expect(signPreferenceToken(C1)).toBeNull();
  });
});

describe("topicOn", () => {
  const row = (topic: string, status: StateRow["status"], since: string): StateRow => ({ topic, status, since });
  it("no answer is off", () => expect(topicOn([], "offers")).toBe(false));
  it("the latest answer that applies wins, and an 'all topics' answer applies to every topic", () => {
    expect(topicOn([row("offers", "granted", "2026-01-01"), row("", "withdrawn", "2026-02-01")], "offers")).toBe(false);
    expect(topicOn([row("", "withdrawn", "2026-01-01"), row("offers", "granted", "2026-02-01")], "offers")).toBe(true);
    expect(topicOn([row("", "withdrawn", "2026-01-01"), row("offers", "granted", "2026-02-01")], "events")).toBe(false);
  });
  it("on a tie a withdrawal wins", () => {
    expect(topicOn([row("offers", "granted", "2026-01-01"), row("offers", "withdrawn", "2026-01-01")], "offers")).toBe(false);
  });
});

describe("loadPreferences", () => {
  it("shows the workspace's topics with the person's current answer", async () => {
    const db = seed();
    const r = await loadPreferences(db.client, C1);
    expect(r?.tenantId).toBe(T1);
    expect(r?.view.topics.map((t) => [t.key, t.on])).toEqual([["offers", true], ["events", false]]);
    expect(r?.view.firstName).toBe("Ali");
    expect(r?.view.history[0].text).toBe("Agreed to Offers");
  });
  it("answers nothing for an unknown contact, a workspace without the flag, or a missing ledger", async () => {
    expect(await loadPreferences(seed().client, C2)).toBeNull();
    expect(await loadPreferences(seed({ tenants: [tenant(T1, { marketing: true })] }).client, C1)).toBeNull();
    expect(await loadPreferences(fakeDb({ tenants: [tenant(T1)], contacts: [{ id: C1, tenant_id: T1, account_id: "a1", name: "A" }], accounts: [] }, { missingTables: ["consent_state"] }).client, C1)).toBeNull();
  });
  it("reads only the contact's own workspace, even if another workspace has a row with the same ledger", async () => {
    const db = seed({ consent_state: [{ tenant_id: T2, contact_id: C1, channel: "email", topic: "events", status: "granted", since: "2026-10-01T00:00:00Z" }] });
    const r = await loadPreferences(db.client, C1);
    expect(r?.view.topics.every((t) => !t.on)).toBe(true);
  });
  it("marks a person who is do-not-contact or opted out as unable to switch anything on", async () => {
    const a = await loadPreferences(seed({ accounts: [{ id: "a1", tenant_id: T1, marketing_opt_out: true }] }).client, C1);
    expect(a?.view.blocked).toBe("opted_out");
    expect(a?.view.topics.every((t) => !t.on)).toBe(true);
    const b = await loadPreferences(seed({ contacts: [{ id: C1, tenant_id: T1, account_id: "a1", name: "A", do_not_contact: true }] }).client, C1);
    expect(b?.view.blocked).toBe("do_not_contact");
  });
});

describe("changing a choice appends to the consent history", () => {
  it("switching a topic off adds a withdrawn row with source preference_centre and the evidence, and keeps the old row", async () => {
    const db = seed();
    const loaded = (await loadPreferences(db.client, C1))!;
    const r = await applyPreferenceChanges(db.client, loaded, [{ topic: "offers", on: false }], meta);
    expect(r).toEqual({ ok: true, changed: 1 });
    expect(db.tables.consent_events).toHaveLength(2);
    expect(db.tables.consent_events[0].status).toBe("granted");
    expect(db.tables.consent_events[1]).toMatchObject({
      tenant_id: T1, contact_id: C1, channel: "email", topic: "offers", status: "withdrawn", source: "preference_centre",
      evidence: { via: "preference_centre", ip_hash: meta.ipHash, ua_family: "Safari" },
    });
    expect(db.tables.consent_state.find((s) => s.topic === "offers")?.status).toBe("withdrawn");
    expect(db.tables.domain_event.some((e) => e.name === "consent.withdrawn")).toBe(true);
  });

  it("switching a topic on adds a granted row", async () => {
    const db = seed();
    const loaded = (await loadPreferences(db.client, C1))!;
    await applyPreferenceChanges(db.client, loaded, [{ topic: "events", on: true }], meta);
    expect(db.tables.consent_events.at(-1)).toMatchObject({ topic: "events", status: "granted", source: "preference_centre", basis: "consent" });
  });

  it("a change that matches what is already true writes nothing", async () => {
    const db = seed();
    const loaded = (await loadPreferences(db.client, C1))!;
    const r = await applyPreferenceChanges(db.client, loaded, [{ topic: "offers", on: true }, { topic: "events", on: false }], meta);
    expect(r).toEqual({ ok: true, changed: 0 });
    expect(db.tables.consent_events).toHaveLength(1);
  });

  it("unsubscribe from all writes one all-topics withdrawal, mirrors the legacy opt-out for a sole contact, and emits email.unsubscribed", async () => {
    const db = seed();
    const loaded = (await loadPreferences(db.client, C1))!;
    const r = await applyPreferenceChanges(db.client, loaded, [{ topic: null, on: false }], meta);
    expect(r.ok).toBe(true);
    expect(db.tables.consent_events.at(-1)).toMatchObject({ topic: null, status: "withdrawn", source: "preference_centre" });
    expect(db.tables.accounts[0].marketing_opt_out).toBe(true);
    expect(db.tables.domain_event.some((e) => e.name === "email.unsubscribed")).toBe(true);
    const after = await loadPreferences(db.client, C1);
    expect(after?.view.blocked).toBe("opted_out");
  });

  it("does not mirror the legacy opt-out while a colleague at the account is still subscribed", async () => {
    const db = seed({
      contacts: [
        { id: C1, tenant_id: T1, account_id: "a1", name: "Ali" },
        { id: C2, tenant_id: T1, account_id: "a1", name: "Sara" },
      ],
    });
    const loaded = (await loadPreferences(db.client, C1))!;
    await applyPreferenceChanges(db.client, loaded, [{ topic: null, on: false }], meta);
    expect(db.tables.accounts[0].marketing_opt_out).toBe(false);
  });

  it("refuses to switch a topic on for someone who is blocked, but lets them switch things off", async () => {
    const db = seed({ accounts: [{ id: "a1", tenant_id: T1, marketing_opt_out: true }] });
    const loaded = (await loadPreferences(db.client, C1))!;
    const on = await applyPreferenceChanges(db.client, loaded, [{ topic: "events", on: true }], meta);
    expect(on).toMatchObject({ ok: false, status: 403 });
    expect(db.tables.consent_events).toHaveLength(1);
  });

  it("rejects a topic the workspace does not have", async () => {
    const db = seed();
    const loaded = (await loadPreferences(db.client, C1))!;
    expect(await applyPreferenceChanges(db.client, loaded, [{ topic: "weapons", on: true }], meta)).toMatchObject({ ok: false, status: 422 });
    expect(db.tables.consent_events).toHaveLength(1);
  });

  it("writes only for the contact's own workspace", async () => {
    const db = seed();
    const loaded = (await loadPreferences(db.client, C1))!;
    await applyPreferenceChanges(db.client, loaded, [{ topic: "events", on: true }, { topic: "offers", on: false }], meta);
    for (const row of db.tables.consent_events.slice(1)) expect(row.tenant_id).toBe(T1);
  });
});

describe("parseChanges", () => {
  it("accepts a list of {topic, on} and nothing else", () => {
    expect(parseChanges({ changes: [{ topic: "offers", on: true }, { topic: null, on: false }] })).toEqual([{ topic: "offers", on: true }, { topic: null, on: false }]);
    for (const bad of [null, {}, { changes: [] }, { changes: [{ topic: 1, on: true }] }, { changes: [{ topic: "a", on: "yes" }] }, { changes: "x" }, { changes: Array.from({ length: 50 }, () => ({ topic: "a", on: true })) }]) {
      expect(parseChanges(bad)).toBeNull();
    }
  });
});
