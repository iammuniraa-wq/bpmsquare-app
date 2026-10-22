import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
});

// One in-memory world stands in for the database AND for the person's session; the REAL account and contact routes
// run against it. That is the point: what is checked here is that a pressed card goes through the very same route
// code as the New form, not a re-implementation of it.
const S = vi.hoisted(() => ({
  db: null as unknown as { client: unknown; tables: Record<string, Record<string, unknown>[]> },
  tenantId: "",
  userId: "",
  masterRefCalls: [] as { table: string; tenantId: string; record: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: S.db.client, tenantId: S.tenantId, userId: S.userId, role: "admin" }),
  getAuthUser: async () => ({ id: S.userId, email: "rep@acme.test" }),
  createAdminSupabase: () => S.db.client,
}));
vi.mock("@/lib/tenant", () => ({ getTenant: async () => ({ features: {} }) }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/marketing/contactEmailHash", () => ({ stampContactEmailHash: vi.fn(async () => {}) }));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (
    supabase: { from: (t: string) => { insert: (r: unknown) => { select: (s: string) => { single: () => Promise<unknown> } } } },
    table: string, tenantId: string, record: Record<string, unknown>, select: string,
  ) => {
    S.masterRefCalls.push({ table, tenantId, record });
    return supabase.from(table).insert({ ...record, ref: `${table === "accounts" ? "ACC" : "CON"}-9001` }).select(select).single();
  },
}));

import { NextRequest } from "next/server";
import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { decrypt } from "@/lib/encryption";
import { logChange, resetViaColumnCache } from "@/lib/changeLog";
import type { PermissionSet } from "@/lib/permissions";
import type { ConfirmCard } from "@/lib/assistant/cards";
import { actionFor } from "./registry";
import { buildCard } from "./card";
import { executeCard, type ExecCtx } from "./execute";
import { signToken, verifyToken } from "./token";
import { currentVia, runVia } from "./via";
import { POST as accountsPost } from "@/app/api/accounts/route";

const ACCOUNTS_AT_START = 4;
const U1 = "user-1";
const U2 = "user-2";
const ACME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TESLA_GMBH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TESLA_OTHER_TENANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const ON = { ai_assistant: true, ai_assistant_actions: true, next_experience: true, accounts: true, contacts: true };

function world(opts: Parameters<typeof fakeAdmin>[1] = {}, extra: Record<string, Row[]> = {}) {
  const db = fakeAdmin({
    tenants: [{ id: T1, features: ON, config: {} }, { id: T2, features: ON, config: {} }],
    accounts: [
      { id: ACME, tenant_id: T1, name: "Acme Industrial", ref: "ACC-0001", website: null },
      { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", tenant_id: T1, name: "Acme Trading", ref: "ACC-0002", website: null },
      { id: TESLA_GMBH, tenant_id: T1, name: "Tesla GmbH", ref: "ACC-0042", website: "https://www.tesla.com/de" },
      { id: TESLA_OTHER_TENANT, tenant_id: T2, name: "Tesla Foreign Ltd", ref: "ACC-0007", website: "tesla.com" },
    ],
    contacts: [],
    custom_fields: [
      { id: "cf-1", tenant_id: T1, object_type: "account", field_key: "cf_segment", field_label: "Segment", field_type: "select", options: ["Gold", "Silver"], is_required: false, position: 1, field_section: null },
    ],
    field_overrides: [], field_rules: [], change_log: [], assistant_actions: [],
    ...extra,
  }, opts);
  S.db = db as never;
  S.tenantId = T1;
  S.userId = U1;
  S.masterRefCalls = [];
  return db;
}

const ctx = (over: Partial<ExecCtx> = {}): ExecCtx => ({
  supabase: S.db.client as never, admin: S.db.client as never, tenantId: S.tenantId, userId: S.userId,
  perms: ALL, features: ON, baseUrl: "https://acme.test/api/ai/act", ...over,
});

async function propose(values: Record<string, unknown>, references: Record<string, string> = {}, object = "account", pageAccountId?: string) {
  const built = await buildCard(
    { supabase: S.db.client as never, tenantId: S.tenantId, userId: S.userId },
    actionFor(object)!,
    { values, references, summary: "Create it.", pageAccountId },
  );
  if (!built.ok) throw new Error(built.reason);
  return built;
}
const valuesOf = (card: ConfirmCard) => Object.fromEntries(card.fields.map((f) => [f.key, f.value]));
const press = (card: ConfirmCard, values?: Record<string, unknown>, extra: Record<string, unknown> = {}, over: Partial<ExecCtx> = {}) =>
  executeCard(ctx(over), { card_id: card.id, token: card.token, values: values ?? valuesOf(card), ...extra });
const rows = (t: string) => S.db.tables[t] ?? [];

beforeEach(() => {
  resetViaColumnCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe("the card", () => {
  it("lists the workspace's own fields: required ones flagged, custom fields in, computed and hidden ones out", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany" });
    const byKey = new Map(card.fields.map((f) => [f.key, f]));
    expect(byKey.get("name")).toMatchObject({ label: "Name", value: "Tesla Germany", required: true });
    expect(byKey.get("type")).toMatchObject({ required: true, widget: "enum", value: "" });
    expect(byKey.get("type")?.options?.map((o) => o.value)).toEqual(["prospect", "oem", "direct", "end_customer"]);
    expect(byKey.get("cf_segment")).toMatchObject({ label: "Segment", widget: "enum", required: false });
    expect(byKey.get("cf_segment")?.options?.map((o) => o.value)).toEqual(["Gold", "Silver"]);
    expect(byKey.has("ref")).toBe(false);
    expect(byKey.has("created_at")).toBe(false);
    expect(byKey.has("referred_by_account_id")).toBe(false);
    expect(card).toMatchObject({ action: "create", object: "account", primaryLabel: "Create account", risk: "write" });
  });

  it("never invents a value: what was not given is empty, a key that is not a field is dropped, a bad option is refused", async () => {
    world();
    const built = await propose({ name: "Tesla Germany", tenant_id: T2, city: "", type: "end customer", industry: "   ", cf_segment: "Platinum" });
    const v = valuesOf(built.card);
    expect(v.name).toBe("Tesla Germany");
    expect(v.city).toBe("");
    expect(v.industry).toBe("");
    expect(v.type).toBe("");
    expect(v.cf_segment).toBe("");
    expect(built.ignored).toEqual(["tenant_id"]);
    expect(built.card.notices.join(" ")).toMatch(/Type.*not one of the options/);
    expect(built.card.fields.some((f) => f.key === "tenant_id")).toBe(false);
  });

  it("matches an option by its label as well as its value", async () => {
    world();
    const { card } = await propose({ name: "X", type: "Direct customer" });
    expect(valuesOf(card).type).toBe("direct");
  });

  it("looks for similar records in this workspace only, by name and by website, before anything is created", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", website: "https://tesla.com" });
    expect(card.duplicates).toEqual([{ id: TESLA_GMBH, label: "Tesla GmbH (ACC-0042)", href: `/accounts/${TESLA_GMBH}` }]);
    expect(JSON.stringify(card)).not.toContain("Tesla Foreign");
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START);
  });

  it("a contact's account comes from the name given, the open account, or a pick list; never from a guess", async () => {
    world();
    const named = await propose({ name: "Jane Roe" }, { account: "Acme Industrial" }, "contact");
    expect(valuesOf(named.card).account_id).toBe(ACME);
    expect(named.card.fields.find((f) => f.key === "account_id")).toMatchObject({ widget: "ref", required: true });

    const onPage = await propose({ name: "Jane Roe" }, {}, "contact", ACME);
    expect(valuesOf(onPage.card).account_id).toBe(ACME);

    const ambiguous = await propose({ name: "Jane Roe" }, { account: "Acme" }, "contact");
    expect(valuesOf(ambiguous.card).account_id).toBe("");
    expect(ambiguous.card.fields.find((f) => f.key === "account_id")?.options?.map((o) => o.label)).toEqual(["Acme Industrial (ACC-0001)", "Acme Trading (ACC-0002)"]);
    expect(ambiguous.card.notices.join(" ")).toMatch(/Several accounts match/);

    const none = await buildCard({ supabase: S.db.client as never, tenantId: T1, userId: U1 }, actionFor("contact")!, { values: { name: "Jane" }, references: { account: "Nonexistent Co" }, summary: "s" });
    expect(none).toMatchObject({ ok: false });
    const unnamed = await buildCard({ supabase: S.db.client as never, tenantId: T1, userId: U1 }, actionFor("contact")!, { values: { name: "Jane" }, references: {}, summary: "s" });
    expect(unnamed).toMatchObject({ ok: false });
  });

  it("another workspace's account never appears as a candidate or as the open account", async () => {
    world();
    const foreign = await buildCard({ supabase: S.db.client as never, tenantId: T1, userId: U1 }, actionFor("contact")!, { values: { name: "Jane" }, references: { account: "Foreign" }, summary: "s" });
    expect(foreign).toMatchObject({ ok: false });
    const page = await buildCard({ supabase: S.db.client as never, tenantId: T1, userId: U1 }, actionFor("contact")!, { values: { name: "Jane" }, references: {}, summary: "s", pageAccountId: TESLA_OTHER_TENANT });
    expect(page).toMatchObject({ ok: false });
  });
});

describe("pressing the button", () => {
  it("creates the account through the account route: tenant, master ref, encrypted phone and email, custom field", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "end_customer", phone: "+49 30 123456", email: "info@tesla.test", city: "Grünheide", cf_segment: "Gold" });
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START);
    const out = await press(card);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, record: { label: "Tesla Germany" } });

    expect(S.masterRefCalls).toHaveLength(1);
    expect(S.masterRefCalls[0]).toMatchObject({ table: "accounts", tenantId: T1 });
    const created = rows("accounts").find((r) => r.name === "Tesla Germany")!;
    expect(created).toMatchObject({ tenant_id: T1, ref: "ACC-9001", type: "end_customer", city: "Grünheide", custom_data: { cf_segment: "Gold" } });
    expect(created.phone).not.toBe("+49 30 123456");
    expect(String(created.phone)).toMatch(/^enc:/);
    expect(decrypt(created.phone as string)).toBe("+49 30 123456");
    expect(decrypt(created.email as string)).toBe("info@tesla.test");
    expect((out.body.record as { href: string }).href).toBe(`/accounts/${created.id}`);
  });

  it("offers next steps: open it, add a contact", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "end_customer" });
    const out = await press(card);
    const next = out.body.next as { label: string; kind: string; target?: string; question?: string }[];
    expect(next.map((n) => n.label)).toEqual(["Open Tesla Germany", "Add a contact"]);
    expect(next[0]).toMatchObject({ kind: "navigate" });
    expect(next[1]).toMatchObject({ kind: "ask", question: "Add a contact to the account Tesla Germany" });
  });

  it("writes Change History as 'via assistant' with the encrypted fields redacted, and an audit row without them", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "end_customer", phone: "+49 30 123456" });
    const out = await press(card, { ...valuesOf(card), city: "Berlin" });
    expect(out.status).toBe(200);

    const log = rows("change_log");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ tenant_id: T1, object_type: "accounts", action: "create", actor_id: U1, via: "assistant" });
    expect(JSON.stringify(log[0].changes)).not.toContain("123456");
    expect(JSON.stringify(log[0].changes)).toContain("[redacted]");

    const audit = rows("assistant_actions");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ id: card.id, tenant_id: T1, user_id: U1, kind: "create", action_key: "create_account", route: "/api/accounts", status: "done" });
    expect(JSON.stringify(audit[0])).not.toContain("123456");
    expect((audit[0].params as Record<string, unknown>).phone).toBe("[redacted]");
    const shown = audit[0].card as { edited: string[]; added: string[]; summary: string };
    expect(shown.added).toEqual(["city"]);
    expect(shown.edited).toEqual([]);
    expect(shown.summary).toBe("Create it.");
    expect(audit[0].result).toMatchObject({ label: "Tesla Germany" });
  });

  it("records which proposed values the person changed", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "end_customer" });
    const out = await press(card, { ...valuesOf(card), name: "Tesla Deutschland" });
    expect(out.body.record).toMatchObject({ label: "Tesla Deutschland" });
    expect(rows("accounts").some((r) => r.name === "Tesla Deutschland")).toBe(true);
    expect((rows("assistant_actions")[0].card as { edited: string[] }).edited).toEqual(["name"]);
  });

  it("a plain manual call to the route does not carry the mark", async () => {
    world();
    expect(currentVia()).toBeNull();
    const forged = new NextRequest("https://acme.test/api/accounts", {
      method: "POST", headers: { "content-type": "application/json", "x-bpmsquare-via": "assistant" },
      body: JSON.stringify({ name: "By hand", type: "direct" }),
    });
    expect((await accountsPost(forged)).status).toBe(201);
    expect(rows("change_log")).toHaveLength(1);
    expect(rows("change_log")[0].via).toBeUndefined();
  });

  it("the mark exists only inside the assistant's own run", async () => {
    world();
    await runVia("assistant", async () => { expect(currentVia()).toBe("assistant"); });
    expect(currentVia()).toBeNull();
    await logChange(S.db.client as never, { tenantId: T1, objectType: "accounts", objectId: "x", action: "create" });
    expect(rows("change_log")[0].via).toBeUndefined();
  });

  it("is refused when a required field is empty, creates nothing, and leaves the card usable", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany" });
    const out = await press(card);
    expect(out).toMatchObject({ status: 422, body: { code: "missing", missing: ["type"] } });
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START);
    expect(rows("assistant_actions")).toHaveLength(0);
    const fixed = await press(card, { ...valuesOf(card), type: "direct" });
    expect(fixed.status).toBe(200);
  });

  it("applies the workspace's require rules like the form does", async () => {
    world({}, {
      field_rules: [{
        id: "r1", tenant_id: T1, object_type: "account", target_field_key: "city", effect: "require", is_active: true, position: 1,
        conditions: { type: "condition", field_key: "type", operator: "equals", value: "oem" },
      }],
    });
    const { card } = await propose({ name: "Maker Ltd", type: "oem" });
    expect(card.fields.find((f) => f.key === "city")?.required).toBe(true);
    const out = await press(card);
    expect(out).toMatchObject({ status: 422, body: { code: "missing", missing: ["city"] } });
    expect((await press(card, { ...valuesOf(card), city: "Pune" })).status).toBe(200);
  });

  it("refuses a field that is not on the card, and a value the form would refuse", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    const smuggled = await press(card, { ...valuesOf(card), tenant_id: T2, referred_by_account_id: ACME });
    expect(smuggled).toMatchObject({ status: 422, body: { code: "unknown_field" } });
    const badEnum = await press(card, { ...valuesOf(card), type: "partner" });
    expect(badEnum).toMatchObject({ status: 422, body: { code: "invalid" } });
    const badEmail = await press(card, { ...valuesOf(card), email: "not-an-email" });
    expect(badEmail).toMatchObject({ status: 422, body: { code: "invalid" } });
    const nested = await press(card, { ...valuesOf(card), notes: { $ne: 1 } });
    expect(nested).toMatchObject({ status: 422, body: { code: "invalid" } });
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START);
  });

  it("creates a contact on an account of this workspace, with its email encrypted", async () => {
    world();
    const { card } = await propose({ name: "Jane Roe", email: "jane@acme.test" }, { account: "Acme Industrial" }, "contact");
    const out = await press(card);
    expect(out.status).toBe(200);
    const c = rows("contacts")[0];
    expect(c).toMatchObject({ tenant_id: T1, account_id: ACME, name: "Jane Roe", ref: "CON-9001" });
    expect(decrypt(c.email as string)).toBe("jane@acme.test");
    expect(rows("change_log")[0]).toMatchObject({ object_type: "contacts", via: "assistant" });
  });

  it("a forged account id from another workspace is refused before the route sees it", async () => {
    world();
    const { card } = await propose({ name: "Jane Roe" }, { account: "Acme Industrial" }, "contact");
    const out = await press(card, { ...valuesOf(card), account_id: TESLA_OTHER_TENANT });
    expect(out).toMatchObject({ status: 422, body: { code: "ref" } });
    expect(rows("contacts")).toHaveLength(0);
    expect(rows("assistant_actions")).toHaveLength(0);
  });

  it("a route that refuses is reported, recorded as failed, and the same card can be pressed again", async () => {
    let fail = true;
    world({ failInsert: (table) => (table === "accounts" && fail ? { message: "insert failed: boom", code: "XX000" } : null) });
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    const first = await press(card);
    expect(first.status).toBe(502);
    expect(first.body).toMatchObject({ code: "route_refused" });
    expect(rows("assistant_actions")[0]).toMatchObject({ status: "failed" });
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START);
    fail = false;
    const again = await press(card);
    expect(again.status).toBe(200);
    expect(rows("assistant_actions")).toHaveLength(1);
    expect(rows("assistant_actions")[0]).toMatchObject({ status: "done" });
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START + 1);
  });
});

describe("one execution per card", () => {
  it("a second press creates nothing and hands back the first result", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    const first = await press(card);
    const second = await press(card);
    expect(first.status).toBe(200);
    expect(second).toMatchObject({ status: 409, body: { code: "already_done", result: first.body.record } });
    expect(rows("accounts").filter((r) => r.name === "Tesla Germany")).toHaveLength(1);
    expect(rows("change_log")).toHaveLength(1);
  });

  it("two presses at the same moment create one record", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    const [a, b] = await Promise.all([press(card), press(card)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(rows("accounts").filter((r) => r.name === "Tesla Germany")).toHaveLength(1);
  });

  it("creates nothing while the audit table is not there yet (audit 2026-10-22 L3): a plain 503, no record, no history row", async () => {
    world({ missing: ["assistant_actions"] });
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    for (let i = 0; i < 2; i++) {
      const out = await press(card);
      expect(out).toMatchObject({ status: 503, body: { ok: false, code: "unavailable" } });
      expect(String(out.body.error)).toMatch(/cannot make changes yet/);
    }
    expect(rows("accounts").filter((r) => r.name === "Tesla Germany")).toHaveLength(0);
    expect(rows("change_log")).toHaveLength(0);
  });

  it("creates nothing when the ledger insert fails for another reason", async () => {
    world({ failInsert: (table) => (table === "assistant_actions" ? { message: "connection reset", code: "08006" } : null) });
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    expect((await press(card)).status).toBe(503);
    expect(rows("accounts").filter((r) => r.name === "Tesla Germany")).toHaveLength(0);
  });

  it("keeps the change-history row when the 'via' column is not there yet", async () => {
    world({ failInsert: (table, row) => (table === "change_log" && "via" in row ? { message: 'column "via" of relation "change_log" does not exist', code: "42703" } : null) });
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    expect((await press(card)).status).toBe(200);
    expect(rows("change_log")).toHaveLength(1);
    expect(rows("change_log")[0]).toMatchObject({ object_type: "accounts", action: "create" });
    expect(rows("change_log")[0].via).toBeUndefined();
  });
});

describe("the token", () => {
  it("is useless to another person or another workspace", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    S.userId = U2;
    expect(await press(card)).toMatchObject({ status: 403, body: { code: "token" } });
    S.userId = U1; S.tenantId = T2;
    expect(await press(card)).toMatchObject({ status: 403, body: { code: "token" } });
    S.tenantId = T1;
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START);
    expect((await press(card)).status).toBe(200);
  });

  it("is useless for a different card id, a tampered body or a forged signature", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    const other = await propose({ name: "Other", type: "direct" });
    expect(await executeCard(ctx(), { card_id: other.card.id, token: card.token, values: valuesOf(card) })).toMatchObject({ status: 403 });
    const [body, sig] = card.token.split(".");
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), uid: U2 })).toString("base64url");
    expect(await executeCard(ctx({ userId: U2 }), { card_id: card.id, token: `${edited}.${sig}`, values: valuesOf(card) })).toMatchObject({ status: 403 });
    expect(await executeCard(ctx(), { card_id: card.id, token: `${body}.${sig.slice(0, -2)}xx`, values: valuesOf(card) })).toMatchObject({ status: 403 });
    expect(await executeCard(ctx(), { card_id: card.id, token: "garbage", values: valuesOf(card) })).toMatchObject({ status: 403 });
    expect(await executeCard(ctx(), { card_id: card.id, values: valuesOf(card) })).toMatchObject({ status: 403 });
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START);
  });

  it("expires", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    const later = Date.now() + 31 * 60 * 1000;
    expect(await press(card, undefined, {}, { now: later })).toMatchObject({ status: 410, body: { code: "expired" } });
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START);
  });

  it("carries ids and hashes only, never a value", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "direct", phone: "+49301234567" });
    const decoded = Buffer.from(card.token.split(".")[0], "base64url").toString();
    expect(decoded).not.toContain("Tesla");
    expect(decoded).not.toContain("1234567");
    expect(verifyToken(card.token, { tenantId: T1, userId: U1, cardId: card.id }).ok).toBe(true);
    expect(verifyToken(signToken({ cid: "c", tid: T1, uid: U1, act: "create_account", h: "x", dup: "y", sm: "", pv: {} }), { tenantId: T1, userId: U1, cardId: "c" }).ok).toBe(true);
  });

  it("a card for a structure that changed since is stale, not silently different", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    rows("custom_fields").push({ id: "cf-2", tenant_id: T1, object_type: "account", field_key: "cf_region", field_label: "Region", field_type: "text", options: null, is_required: false, position: 2, field_section: null });
    expect(await press(card)).toMatchObject({ status: 409, body: { code: "stale" } });
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START);
  });
});

describe("who may press", () => {
  const NO_CREATE: PermissionSet = {
    unrestricted: false,
    grants: new Map([["accounts", { workcenter: "accounts", canView: true, canCreate: false, canEdit: true, canDelete: false }]]),
  };

  it("the Business Role must still grant create when the button is pressed", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    expect(await press(card, undefined, {}, { perms: NO_CREATE })).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START);
  });

  it("the flag, Nova and the module are checked again at the press", async () => {
    world();
    const { card } = await propose({ name: "Tesla Germany", type: "direct" });
    for (const features of [{ ...ON, ai_assistant_actions: false }, { ...ON, next_experience: false }, { ...ON, ai_assistant: false }, { ...ON, accounts: false }, {}]) {
      expect(await press(card, undefined, {}, { features }), JSON.stringify(features)).toMatchObject({ status: 403 });
    }
    expect(rows("accounts")).toHaveLength(ACCOUNTS_AT_START);
    expect(rows("assistant_actions")).toHaveLength(0);
  });
});

describe("similar records", () => {
  it("shown on the card, the press goes ahead without asking again", async () => {
    world();
    const { card } = await propose({ name: "Tesla GmbH Germany", type: "direct" });
    expect(card.duplicates).toHaveLength(1);
    expect((await press(card)).status).toBe(200);
  });

  it("a different set at the press asks the person to look again, then goes ahead on a second press", async () => {
    world();
    const { card } = await propose({ name: "Globex Italy", type: "direct" });
    expect(card.duplicates).toHaveLength(0);
    rows("accounts").push({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", tenant_id: T1, name: "Globex Italy Srl", ref: "ACC-0099", website: null });
    const first = await press(card);
    expect(first).toMatchObject({ status: 422, body: { code: "duplicates_changed" } });
    expect((first.body.duplicates as { label: string }[])[0].label).toBe("Globex Italy Srl (ACC-0099)");
    expect(rows("accounts").some((r) => r.name === "Globex Italy")).toBe(false);
    const second = await press(card, undefined, { confirm_duplicates: true });
    expect(second.status).toBe(200);
  });

  it("a name edited into a match of another record is caught too", async () => {
    world();
    const { card } = await propose({ name: "Brand New Co", type: "direct" });
    const out = await press(card, { ...valuesOf(card), name: "Acme Industrial" });
    expect(out).toMatchObject({ status: 422, body: { code: "duplicates_changed" } });
  });
});
