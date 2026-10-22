import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.hoisted(() => {
  process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
});

// A card some of whose values came from a web lookup, pressed through the REAL account route. What is held here: the card
// and its signed token say which fields came from the web and under which consent; the press validates every value, web or
// typed, exactly as for a manual create; the audit row says what the person kept, changed and cleared; and the press is
// the one door the web taint rule does not close, because it runs no model and no tool.
const S = vi.hoisted(() => ({
  db: null as unknown as { client: unknown; tables: Record<string, Record<string, unknown>[]> },
  tenantId: "",
  userId: "",
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
    table: string, _tenantId: string, record: Record<string, unknown>, select: string,
  ) => supabase.from(table).insert({ ...record, ref: "ACC-9001" }).select(select).single(),
}));

import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { decrypt } from "@/lib/encryption";
import { resetViaColumnCache } from "@/lib/changeLog";
import type { PermissionSet } from "@/lib/permissions";
import type { ConfirmCard } from "@/lib/assistant/cards";
import { actionFor } from "./registry";
import { buildCard, type WebFill } from "./card";
import { executeCard, type ExecCtx } from "./execute";
import { verifyToken } from "./token";

const U1 = "user-1";
const TESLA_GMBH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TESLA_OTHER_TENANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const ON = { ai_assistant: true, ai_assistant_web: true, ai_assistant_actions: true, next_experience: true, accounts: true, contacts: true };

function world() {
  const db = fakeAdmin({
    tenants: [{ id: T1, features: ON, config: {} }, { id: T2, features: ON, config: {} }],
    accounts: [
      { id: TESLA_GMBH, tenant_id: T1, name: "Tesla GmbH", ref: "ACC-0042", website: "https://www.tesla.com/de" },
      { id: TESLA_OTHER_TENANT, tenant_id: T2, name: "Tesla Foreign Ltd", ref: "ACC-0007", website: "tesla.com" },
    ],
    contacts: [], custom_fields: [], field_overrides: [], field_rules: [], change_log: [], assistant_actions: [],
  } as Record<string, Row[]>);
  S.db = db as never;
  S.tenantId = T1;
  S.userId = U1;
  return db;
}

const ctx = (over: Partial<ExecCtx> = {}): ExecCtx => ({
  supabase: S.db.client as never, admin: S.db.client as never, tenantId: S.tenantId, userId: S.userId,
  perms: ALL, features: ON, baseUrl: "https://acme.test/api/ai/act", ...over,
});

const FILL: WebFill = {
  values: { website: "https://www.tesla.com", industry: "Electric vehicles", city: "Grünheide", country: "Germany", email: "info@tesla.com" },
  confidence: { website: "found", industry: "found", city: "likely", country: "found", email: "found" },
  asked: ["website", "industry", "address_line1", "city", "state", "postal_code", "country", "phone", "email", "employee_count"],
  consentId: "consent-1",
};

async function webCard(fill: WebFill = FILL, values: Record<string, unknown> = { name: "Tesla Germany" }) {
  const built = await buildCard(
    { supabase: S.db.client as never, tenantId: S.tenantId, userId: S.userId },
    actionFor("account")!,
    { values, references: {}, summary: "Create the account Tesla Germany.", web: fill },
  );
  if (!built.ok) throw new Error(built.reason);
  return built.card;
}
const valuesOf = (card: ConfirmCard) => Object.fromEntries(card.fields.map((f) => [f.key, f.value]));
const press = (card: ConfirmCard, values?: Record<string, unknown>, over: Partial<ExecCtx> = {}) =>
  executeCard(ctx(over), { card_id: card.id, token: card.token, values: values ?? valuesOf(card) });
const rows = (t: string) => S.db.tables[t] ?? [];

beforeEach(() => { resetViaColumnCache(); vi.spyOn(console, "error").mockImplementation(() => {}); world(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("the card built from a web lookup", () => {
  it("marks each web value and the fields that were asked but not found, and keeps the person's own words first", async () => {
    const card = await webCard({ ...FILL, values: { ...FILL.values, city: "Munich" } }, { name: "Tesla Germany", city: "Berlin" });
    const f = (k: string) => card.fields.find((x) => x.key === k)!;
    expect(f("city")).toMatchObject({ value: "Berlin" });
    expect(f("city").origin).toBeUndefined();
    expect(f("website")).toMatchObject({ value: "https://www.tesla.com", origin: "web", confidence: "found" });
    expect(f("phone")).toMatchObject({ value: "", confidence: "not_found" });
    expect(f("name").origin).toBeUndefined();
    expect(f("type").confidence).toBeUndefined();
  });

  it("reads only the registry's research keys: a type, a note, a custom or unknown key from the web never reaches the card", async () => {
    const card = await webCard({ ...FILL, values: { ...FILL.values, type: "oem", notes: "hello", cf_segment: "Gold", tenant_id: T2, phone2: "1" }, confidence: FILL.confidence });
    const v = valuesOf(card);
    expect(v.type).toBe("");
    expect(v.notes).toBe("");
    expect(v.phone2).toBe("");
    expect(card.fields.some((x) => x.key === "tenant_id" || x.key === "cf_segment")).toBe(false);
  });

  it("a web value that fails the form's own check is treated as not found, not shown", async () => {
    const card = await webCard({ ...FILL, values: { email: "not-an-email", city: "Berlin" }, confidence: { city: "found" } });
    expect(card.fields.find((x) => x.key === "email")).toMatchObject({ value: "", confidence: "not_found" });
    expect(card.fields.find((x) => x.key === "email")?.origin).toBeUndefined();
  });

  it("finds a duplicate by the looked-up website domain, in this workspace only", async () => {
    const card = await webCard({ ...FILL, values: { website: "https://tesla.com" } });
    expect(card.duplicates.map((d) => d.id)).toEqual([TESLA_GMBH]);
    expect(JSON.stringify(card)).not.toContain("Foreign");
  });

  it("the signed token names the consent and the web fields and hashes the proposed values, without holding any of them", async () => {
    const card = await webCard();
    const v = verifyToken(card.token, { tenantId: T1, userId: U1, cardId: card.id });
    if (!v.ok) throw new Error("should verify");
    expect(v.payload.wb).toEqual({ c: "consent-1", f: ["website", "industry", "city", "country", "email"] });
    expect(Object.keys(v.payload.pv).sort()).toEqual(["city", "country", "email", "industry", "name", "website"]);
    expect(JSON.stringify(v.payload)).not.toMatch(/Grünheide|info@tesla/);
  });

  it("a card with no web lookup has no web mark at all", async () => {
    const built = await buildCard({ supabase: S.db.client as never, tenantId: T1, userId: U1 }, actionFor("account")!, { values: { name: "X", type: "direct" }, references: {}, summary: "s" });
    if (!built.ok) throw new Error("ok");
    const v = verifyToken(built.card.token, { tenantId: T1, userId: U1, cardId: built.card.id });
    if (!v.ok) throw new Error("ok");
    expect(v.payload.wb).toBeUndefined();
  });
});

describe("pressing a card filled from the web", () => {
  it("creates the account through the account route with the web values, validated like typed ones", async () => {
    const card = await webCard();
    const out = await press(card, { ...valuesOf(card), type: "direct" });
    expect(out.status).toBe(200);
    const created = rows("accounts").find((r) => r.name === "Tesla Germany")!;
    expect(created).toMatchObject({ tenant_id: T1, type: "direct", city: "Grünheide", country: "Germany", industry: "Electric vehicles", website: "https://www.tesla.com" });
    expect(decrypt(created.email as string)).toBe("info@tesla.com");
    expect(rows("change_log")[0]).toMatchObject({ object_type: "accounts", via: "assistant" });
  });

  it("the audit row says the values came from the web, under which consent, and what the person kept, changed and cleared", async () => {
    const card = await webCard();
    const out = await press(card, { ...valuesOf(card), type: "direct", city: "Berlin", country: "" });
    expect(out.status).toBe(200);
    const audit = rows("assistant_actions");
    expect(audit).toHaveLength(1);
    const shown = audit[0].card as { web: { consent_id: string; research_card_id: string; fields: string[]; kept: string[]; edited: string[]; cleared: string[] }; edited: string[]; added: string[] };
    expect(shown.web).toEqual({
      consent_id: "consent-1", research_card_id: card.id, fields: ["website", "industry", "city", "country", "email"],
      kept: ["website", "industry", "email"], edited: ["city"], cleared: ["country"],
    });
    expect(shown.edited).toEqual(["city"]);
    expect(shown.added).toEqual(["type"]);
    // Source addresses are in the lookup's own audit row, never here.
    expect(JSON.stringify(audit[0])).not.toMatch(/https?:\/\/(?!www\.tesla\.com")/);
    expect((audit[0].params as Record<string, unknown>).email).toBe("[redacted]");
  });

  it("every web value is untrusted input: a smuggled field, a bad option, a bad email and a missing required field are all refused", async () => {
    const card = await webCard();
    const ok = { ...valuesOf(card), type: "direct" };
    expect(await press(card, { ...ok, tenant_id: T2 })).toMatchObject({ status: 422, body: { code: "unknown_field" } });
    expect(await press(card, { ...ok, type: "admin" })).toMatchObject({ status: 422, body: { code: "invalid" } });
    expect(await press(card, { ...ok, email: "<script>alert(1)</script>" })).toMatchObject({ status: 422, body: { code: "invalid" } });
    expect(await press(card, valuesOf(card))).toMatchObject({ status: 422, body: { code: "missing", missing: ["type"] } });
    expect(rows("accounts")).toHaveLength(2);
    expect(rows("assistant_actions")).toHaveLength(0);
  });

  it("the token cannot be edited to claim or hide a web origin, or used by another person or workspace", async () => {
    const card = await webCard();
    const [body, sig] = card.token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const forged = `${Buffer.from(JSON.stringify({ ...payload, wb: undefined })).toString("base64url")}.${sig}`;
    const values = { ...valuesOf(card), type: "direct" };
    expect(await executeCard(ctx(), { card_id: card.id, token: forged, values })).toMatchObject({ status: 403, body: { code: "token" } });
    expect(await press(card, values, { userId: "user-2" })).toMatchObject({ status: 403 });
    expect(await press(card, values, { tenantId: T2 })).toMatchObject({ status: 403 });
    expect(rows("accounts")).toHaveLength(2);
  });

  it("a card is used once", async () => {
    const card = await webCard();
    const values = { ...valuesOf(card), type: "direct" };
    expect((await press(card, values)).status).toBe(200);
    expect(await press(card, values)).toMatchObject({ status: 409, body: { code: "already_done" } });
    expect(rows("accounts").filter((r) => r.name === "Tesla Germany")).toHaveLength(1);
  });
});

describe("the taint exception: the card's own button works after research", () => {
  it("the press succeeds with the assistant's tools locked, because it is not a tool and runs no model", async () => {
    const card = await webCard();
    const out = await press(card, { ...valuesOf(card), type: "direct" });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, record: { label: "Tesla Germany" } });
  });

  it("the press path and its route contain no taint check, no model client and no tool: the exception is structural", () => {
    const root = process.cwd();
    for (const file of ["src/lib/actions/execute.ts", "src/app/api/ai/act/route.ts"]) {
      const src = readFileSync(join(root, file), "utf8").replace(/\/\/.*$/gm, "");
      expect(src, file).not.toMatch(/WEB_LOCKED_TOOLS|tainted|webHistory|@anthropic-ai|askAssistant|ai\/assistant"/);
    }
  });
});
