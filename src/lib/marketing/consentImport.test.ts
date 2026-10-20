import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { importConsents, cleanFileName } from "./consentImport";
import { contactsMatchingEmails } from "./recipientLookup";
import { emailBlindIndex } from "./blindIndex";
import { fakeDb } from "./testFakeDb";
import { CONSENTS_SPEC } from "@/lib/import/consentsSchema";
import { validateRow } from "@/lib/import/validate";

const KEY = "ef".repeat(32);
const T_A = "11111111-1111-4111-8111-111111111111";
const T_B = "22222222-2222-4222-8222-222222222222";
const REP = "rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr";
const h = (e: string) => emailBlindIndex(e, KEY);

beforeEach(() => { process.env.FIELD_ENCRYPTION_KEY = KEY; });
afterEach(() => { delete process.env.FIELD_ENCRYPTION_KEY; });

function world(config: Record<string, unknown> = {}) {
  return fakeDb({
    tenants: [{ id: T_A, config }],
    accounts: [
      { id: "acc-sa", tenant_id: T_A, country: "Saudi Arabia", type: "direct" },
      { id: "acc-in", tenant_id: T_A, country: "India", type: "direct" },
      { id: "acc-b", tenant_id: T_B, country: "India", type: "direct" },
    ],
    contacts: [
      { id: "c-asha", tenant_id: T_A, account_id: "acc-sa", name: "Asha", country: null, email_hash: h("asha@company.com") },
      { id: "c-ravi", tenant_id: T_A, account_id: "acc-in", name: "Ravi", country: "India", email_hash: h("ravi@company.in") },
      { id: "c-dup1", tenant_id: T_A, account_id: "acc-sa", name: "Info 1", country: null, email_hash: h("info@shared.com") },
      { id: "c-dup2", tenant_id: T_A, account_id: "acc-sa", name: "Info 2", country: null, email_hash: h("info@shared.com") },
      // the SAME address in another tenant must never be matched
      { id: "c-other", tenant_id: T_B, account_id: "acc-b", name: "Other", country: "India", email_hash: h("other@company.com") },
    ],
  });
}
const row = (rowNum: number, values: Record<string, string>) => ({ rowNum, values });

describe("contactsMatchingEmails", () => {
  it("finds people by the blind index inside the tenant only, case-insensitively", async () => {
    const { client } = world();
    const m = await contactsMatchingEmails(client, T_A, ["ASHA@Company.com", "other@company.com", "nobody@x.com"]);
    expect([...m.keys()]).toEqual(["asha@company.com"]);
    expect(m.get("asha@company.com")?.map((c) => c.id)).toEqual(["c-asha"]);
  });

  it("returns every contact that shares an address", async () => {
    const { client } = world();
    expect((await contactsMatchingEmails(client, T_A, ["info@shared.com"])).get("info@shared.com")).toHaveLength(2);
  });

  it("matches nothing, quietly, when no key is configured", async () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    const { client } = world();
    expect((await contactsMatchingEmails(client, T_A, ["asha@company.com"])).size).toBe(0);
  });
});

describe("importConsents", () => {
  it("appends one event per matched row with source import, the basis and the file name as evidence", async () => {
    const { client, tables } = world();
    const r = await importConsents(client, T_A, REP, [
      row(2, { email: "asha@company.com", channel: "email", topic: "Offers", status: "granted", basis: "consent", given_on: "2026-09-12", note: "Trade show card" }),
    ], "optins-sept.xlsx");
    expect(r.outcomes).toEqual([{ rowNum: 2, status: "inserted" }]);
    expect(tables.consent_events).toHaveLength(1);
    expect(tables.consent_events[0]).toMatchObject({
      tenant_id: T_A, contact_id: "c-asha", account_id: "acc-sa", channel: "email", topic: "offers", status: "granted", basis: "consent",
      source: "import", jurisdiction: "SA", created_by: REP,
      evidence: { file_name: "optins-sept.xlsx", row: 2, given_on: "2026-09-12", note: "Trade show card" },
    });
    // evidence never carries the address
    expect(JSON.stringify(tables.consent_events[0].evidence)).not.toContain("asha@");
    expect(tables.consent_state[0]).toMatchObject({ contact_id: "c-asha", channel: "email", topic: "offers", status: "granted" });
    expect(tables.domain_event?.[0]).toMatchObject({ name: "consent.granted", contact_id: "c-asha" });
    expect(r.changeLog[0]).toMatchObject({ tenantId: T_A, objectType: "contacts", objectId: "c-asha" });
  });

  it("reports an address that is nobody's contact and creates nothing", async () => {
    const { client, tables } = world();
    const contactsBefore = tables.contacts.length;
    const r = await importConsents(client, T_A, REP, [
      row(2, { email: "stranger@nowhere.com", status: "granted", basis: "consent" }),
      row(3, { email: "other@company.com", status: "granted", basis: "consent" }), // another tenant's contact
    ], "f.csv");
    expect(r.outcomes.map((o) => o.status)).toEqual(["skipped", "skipped"]);
    expect(r.outcomes[0].reason).toContain("never create contacts");
    expect(tables.consent_events ?? []).toHaveLength(0);
    expect(tables.contacts).toHaveLength(contactsBefore);
  });

  it("refuses to guess between two contacts that share an address", async () => {
    const { client, tables } = world();
    const r = await importConsents(client, T_A, REP, [row(2, { email: "info@shared.com", status: "granted", basis: "consent" })], "f.csv");
    expect(r.outcomes[0]).toMatchObject({ status: "failed" });
    expect(tables.consent_events ?? []).toHaveLength(0);
  });

  it("requires the basis for an opt-in, but not for a withdrawal", async () => {
    const { client, tables } = world();
    const r = await importConsents(client, T_A, REP, [
      row(2, { email: "asha@company.com", status: "granted" }),
      row(3, { email: "asha@company.com", status: "withdrawn" }),
    ], "f.csv");
    expect(r.outcomes.map((o) => o.status)).toEqual(["failed", "inserted"]);
    expect(tables.consent_events).toHaveLength(1);
    expect(tables.consent_events[0]).toMatchObject({ status: "withdrawn", topic: null });
  });

  it("refuses a basis the person's country forbids", async () => {
    const { client } = world({ marketing: { consent_defaults: { IN: "existing_customer", SA: "existing_customer" } } });
    const r = await importConsents(client, T_A, REP, [
      row(2, { email: "ravi@company.in", status: "granted", basis: "existing_customer" }),
      row(3, { email: "asha@company.com", status: "granted", basis: "existing_customer" }),
    ], "f.csv");
    expect(r.outcomes.map((o) => o.status)).toEqual(["failed", "inserted"]);
  });

  it("is append-only: importing the same sheet twice adds events and edits none", async () => {
    const { client, tables } = world();
    const sheet = [row(2, { email: "asha@company.com", status: "granted", basis: "consent" })];
    await importConsents(client, T_A, REP, sheet, "f.csv");
    const first = { ...tables.consent_events[0] };
    await importConsents(client, T_A, REP, sheet, "f.csv");
    expect(tables.consent_events).toHaveLength(2);
    expect(tables.consent_events[0]).toEqual(first);
    expect(tables.consent_state).toHaveLength(1);
  });

  it("matches a topic by name, treats blank as every topic, and refuses one that is not the workspace's", async () => {
    const { client, tables } = world();
    const r = await importConsents(client, T_A, REP, [
      row(2, { email: "asha@company.com", status: "granted", basis: "consent", topic: "New products" }),
      row(3, { email: "asha@company.com", status: "granted", basis: "consent", topic: "" }),
      row(4, { email: "asha@company.com", status: "granted", basis: "consent", topic: "Cat videos" }),
    ], "f.csv");
    expect(r.outcomes.map((o) => o.status)).toEqual(["inserted", "inserted", "failed"]);
    expect(tables.consent_events.map((e) => e.topic)).toEqual(["new_products", null]);
  });

  it("every contact and account lookup names the tenant", async () => {
    const { client, queries } = world();
    await importConsents(client, T_A, REP, [row(2, { email: "asha@company.com", status: "granted", basis: "consent" })], "f.csv");
    for (const q of queries.filter((x) => ["contacts", "accounts", "tenants"].includes(x.table) && x.op === "select")) {
      expect(q.filters.tenant_id ?? q.filters.id).toBe(T_A);
    }
  });

  it("reports the ledger as waiting for a database update while it is pending", async () => {
    const db = fakeDb({
      tenants: [{ id: T_A, config: {} }],
      accounts: [{ id: "acc-sa", tenant_id: T_A, country: "Saudi Arabia", type: "direct" }],
      contacts: [{ id: "c-asha", tenant_id: T_A, account_id: "acc-sa", name: "Asha", email_hash: h("asha@company.com") }],
    }, { missingTables: ["consent_events"] });
    const r = await importConsents(db.client, T_A, REP, [row(2, { email: "asha@company.com", status: "granted", basis: "consent" })], "f.csv");
    expect(r.outcomes[0]).toMatchObject({ status: "failed", reason: expect.stringContaining("waiting for a database update") });
  });
});

describe("the Consents spec", () => {
  it("is read-only for state columns: they are export-only", () => {
    const exportOnly = CONSENTS_SPEC.fields.filter((f) => f.exportOnly).map((f) => f.key);
    expect(exportOnly).toEqual(expect.arrayContaining(["contact_id", "contact_name", "account_name", "since", "jurisdiction"]));
  });
  it("validates a sheet row the way the workbench does", () => {
    const ok = validateRow(CONSENTS_SPEC, { email: "A@B.com", status: "Granted", basis: "Consent", channel: "Email" }, 2);
    expect(ok.issues).toEqual([]);
    expect(ok.values).toMatchObject({ email: "a@b.com", status: "granted", basis: "consent", channel: "email" });
    expect(validateRow(CONSENTS_SPEC, { status: "granted" }, 3).issues.some((i) => i.field === "email" && i.severity === "error")).toBe(true);
  });
  it("cleans a file name", () => {
    expect(cleanFileName("  a\nb.csv ")).toBe("a b.csv");
    expect(cleanFileName(undefined)).toBe("");
  });
});
