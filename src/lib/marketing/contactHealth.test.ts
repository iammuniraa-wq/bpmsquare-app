import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { runHealthAction, loadContactHealth, emailHealthOn } from "./contactHealth";
import { fakeDb } from "./testFakeDb";
import { emailBlindIndex } from "./blindIndex";
import { encrypt, decrypt } from "@/lib/encryption";

const KEY = "cd".repeat(32);
const T_A = "11111111-1111-4111-8111-111111111111";
const T_B = "22222222-2222-4222-8222-222222222222";
const CID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => { process.env.FIELD_ENCRYPTION_KEY = KEY; });
afterEach(() => { delete process.env.FIELD_ENCRYPTION_KEY; });

const ok = async () => ({ ok: true as const, message: "Looks right." });
const bad = async () => ({ ok: false as const, reason: "This domain does not exist or has no way to receive email." });

function db(status = "unknown", extra: Record<string, unknown> = {}) {
  return fakeDb({
    contacts: [
      { id: CID, tenant_id: T_A, name: "Asha", email: encrypt("old@company.com"), email_hash: emailBlindIndex("old@company.com", KEY), email_status: status, email_status_at: "2026-10-01T00:00:00.000Z", ...extra },
      { id: "99999999-9999-4999-8999-999999999999", tenant_id: T_B, name: "Other", email: encrypt("x@other.com"), email_status: "unknown" },
    ],
  });
}

describe("emailHealthOn", () => {
  it("needs the marketing module AND the studio's platform-admin flag", () => {
    expect(emailHealthOn({ marketing: true, newsletter_studio: true })).toBe(true);
    expect(emailHealthOn({ marketing: true })).toBe(false);
    expect(emailHealthOn({ newsletter_studio: true })).toBe(false);
    expect(emailHealthOn(null)).toBe(false);
  });
});

describe("runHealthAction", () => {
  it("check: a passing check upgrades 'not checked' to working, and is recorded in the history", async () => {
    const { client, tables } = db("unknown");
    const r = await runHealthAction(client, T_A, CID, { action: "check" }, { check: ok, now: () => new Date("2026-10-20T09:00:00Z") });
    expect(r.ok).toBe(true);
    expect(tables.contacts[0]).toMatchObject({ email_status: "valid", email_status_at: "2026-10-20T09:00:00.000Z" });
    if (r.ok) expect(r.changes.map((c) => c.field)).toEqual(["Email check", "Email health"]);
  });

  it("check: a failing check marks the address invalid with a plain reason", async () => {
    const { client, tables } = db("unknown");
    const r = await runHealthAction(client, T_A, CID, { action: "check" }, { check: bad });
    expect(r.ok).toBe(true);
    expect(tables.contacts[0].email_status).toBe("invalid");
    expect(String(tables.contacts[0].email_status_reason)).toContain("does not exist");
  });

  it("check: never overrides a real bounce", async () => {
    const { client, tables } = db("bounced");
    await runHealthAction(client, T_A, CID, { action: "check" }, { check: ok });
    expect(tables.contacts[0].email_status).toBe("bounced");
  });

  it("fix: replaces the address, re-hashes it, resets health and re-checks the new one", async () => {
    const { client, tables } = db("bounced");
    const r = await runHealthAction(client, T_A, CID, { action: "fix", email: "New@Company.com" }, { check: ok });
    expect(r.ok).toBe(true);
    const row = tables.contacts[0];
    expect(decrypt(row.email as string)).toBe("New@Company.com");
    expect(row.email_hash).toBe(emailBlindIndex("new@company.com", KEY));
    expect(row.email_status).toBe("valid");
    // the address is PII: the history never carries it
    if (r.ok) {
      expect(JSON.stringify(r.changes)).not.toContain("company.com");
      expect(r.changes[0]).toMatchObject({ field: "email", redacted: true });
    }
  });

  it("fix: a new address that fails the check is recorded as invalid, not valid", async () => {
    const { client, tables } = db("bounced");
    await runHealthAction(client, T_A, CID, { action: "fix", email: "x@nodomain-here.com" }, { check: bad });
    expect(tables.contacts[0].email_status).toBe("invalid");
  });

  it("fix: refuses a badly formed address and the address already on file", async () => {
    const { client } = db();
    expect((await runHealthAction(client, T_A, CID, { action: "fix", email: "nope" }, { check: ok })).ok).toBe(false);
    const same = await runHealthAction(client, T_A, CID, { action: "fix", email: "OLD@company.com" }, { check: ok });
    expect(same.ok).toBe(false);
  });

  it("confirm: needs a reason, and records it", async () => {
    const { client, tables } = db("invalid");
    const none = await runHealthAction(client, T_A, CID, { action: "confirm", reason: " " }, {});
    expect(none).toMatchObject({ ok: false, status: 400 });
    const r = await runHealthAction(client, T_A, CID, { action: "confirm", reason: "confirmed by phone on 20 Oct" }, {});
    expect(r.ok).toBe(true);
    expect(tables.contacts[0].email_status).toBe("valid");
    expect(String(tables.contacts[0].email_status_reason)).toContain("confirmed by phone on 20 Oct");
  });

  it("confirm: cannot lift a blocked address (bounced or complained)", async () => {
    for (const s of ["bounced", "complained"]) {
      const { client, tables } = db(s);
      const r = await runHealthAction(client, T_A, CID, { action: "confirm", reason: "spoke to them" }, {});
      expect(r).toMatchObject({ ok: false, status: 409 });
      expect(tables.contacts[0].email_status).toBe(s);
    }
  });

  it("another tenant's contact is simply not found", async () => {
    const { client, tables } = db();
    const r = await runHealthAction(client, T_B, CID, { action: "confirm", reason: "spoke to them" }, {});
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(tables.contacts[0].email_status).toBe("unknown");
  });

  it("every query names the tenant", async () => {
    const { client, queries } = db();
    await runHealthAction(client, T_A, CID, { action: "confirm", reason: "spoke to them" }, {});
    for (const q of queries.filter((x) => x.table === "contacts")) expect(q.filters.tenant_id).toBe(T_A);
  });

  it("says 'waiting for a database update' while 0144 is pending", async () => {
    const { client } = fakeDb({}, { missingTables: ["contacts"] });
    const r = await runHealthAction(client, T_A, CID, { action: "check" }, { check: ok });
    expect(r).toMatchObject({ ok: false, status: 503, pending: true });
  });
});

describe("loadContactHealth", () => {
  it("reports the status, whether the address is blocked, and the latest delivery event", async () => {
    const hash = emailBlindIndex("old@company.com", KEY);
    const { client } = fakeDb({
      contacts: [{ id: CID, tenant_id: T_A, email_hash: hash, email_status: "bounced", email_status_at: "2026-10-02T00:00:00.000Z", email_status_reason: "Gone." }],
      suppressions: [{ tenant_id: T_A, channel: "email", address_hash: hash, reason: "bounced_hard" }],
      domain_event: [{ tenant_id: T_A, contact_id: CID, name: "email.bounced", occurred_at: "2026-10-02T00:00:00.000Z" }],
    });
    const h = await loadContactHealth(client, T_A, CID);
    expect(h).toMatchObject({ available: true, status: "bounced", blocked: true, reason: "Gone.", lastEvent: { name: "email.bounced" } });
  });

  it("is unavailable, not an error, while the migration is pending", async () => {
    const { client } = fakeDb({}, { missingTables: ["contacts"] });
    expect((await loadContactHealth(client, T_A, CID)).available).toBe(false);
  });
});
