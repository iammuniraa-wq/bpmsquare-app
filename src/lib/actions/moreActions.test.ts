import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.FIELD_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
});

// Assistant actions step 2: supplier, product and tender deal. As in actions.test.ts the REAL routes run against one
// in-memory world, so what is proved is that a pressed card goes through the same route code as the New screens: the
// route's own allow-list, tenant checks, master reference, stage and deal type.
const S = vi.hoisted(() => ({
  db: null as unknown as { client: unknown; tables: Record<string, Record<string, unknown>[]> },
  tenantId: "",
  userId: "",
  features: {} as Record<string, boolean>,
}));

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: S.db.client, tenantId: S.tenantId, userId: S.userId, role: "admin" }),
  getAuthUser: async () => ({ id: S.userId, email: "rep@acme.test" }),
  createAdminSupabase: () => S.db.client,
}));
vi.mock("@/lib/tenant", () => ({
  getTenant: async () => ({ features: S.features, config: {} }),
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!S.features[key],
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/events/emitters", () => ({ emitOpportunityCreated: async () => {} }));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (
    supabase: { from: (t: string) => { insert: (r: unknown) => { select: (s: string) => { single: () => Promise<unknown> } } } },
    table: string, _tenantId: string, record: Record<string, unknown>, select: string,
  ) => {
    const prefix: Record<string, string> = { suppliers: "SUP", products: "PRD", opportunities: "OPP" };
    return supabase.from(table).insert({ ...record, ref: `${prefix[table] ?? "X"}-9001` }).select(select).single();
  },
}));

import { fakeAdmin, T1, T2, type Row } from "@/lib/middleware/testHarness";
import { resetViaColumnCache } from "@/lib/changeLog";
import type { PermissionSet } from "@/lib/permissions";
import type { ConfirmCard } from "@/lib/assistant/cards";
import { createCatalog } from "@/lib/assistant/createTool";
import { initialStage } from "@/lib/sales/opportunity";
import { parseTenderFields, tenderStages } from "@/lib/tender/rules";
import { ACTIONS, actionFor, availableActions, tenderBody } from "./registry";
import { buildCard } from "./card";
import { executeCard, type ExecCtx } from "./execute";

const U1 = "user-1";
const ACME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACME_TRADING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ARAMCO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ARAMCO_FOREIGN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OLD_DEAL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ALL: PermissionSet = { unrestricted: true, grants: new Map() };
const ON = {
  ai_assistant: true, ai_assistant_actions: true, next_experience: true,
  accounts: true, contacts: true, suppliers: true, products: true, pipeline: true, gcc_tender: true,
};

function world(opts: { features?: Record<string, boolean>; config?: Record<string, unknown>; extra?: Record<string, Row[]> } = {}) {
  S.features = opts.features ?? ON;
  const db = fakeAdmin({
    tenants: [{ id: T1, features: S.features, config: opts.config ?? {} }, { id: T2, features: ON, config: {} }],
    accounts: [
      { id: ACME, tenant_id: T1, name: "Acme Industrial", ref: "ACC-0001" },
      { id: ACME_TRADING, tenant_id: T1, name: "Acme Trading", ref: "ACC-0002" },
      { id: ARAMCO, tenant_id: T1, name: "Saudi Aramco", ref: "ACC-0003" },
      { id: ARAMCO_FOREIGN, tenant_id: T2, name: "Aramco Foreign Ltd", ref: "ACC-0009" },
    ],
    suppliers: [
      { id: "s1", tenant_id: T1, name: "Gulf Steel Trading", ref: "SUP-0001" },
      { id: "s2", tenant_id: T2, name: "Gulf Steel Foreign", ref: "SUP-0002" },
    ],
    products: [{ id: "p1", tenant_id: T1, name: "Gate valve 4in", sku: "GV-4", ref: "PRD-0001" }],
    opportunities: [{ id: OLD_DEAL, tenant_id: T1, title: "ARB-1 · Aramco", ref: "OPP-0001", stage: "estimating" }],
    opportunity_tenders: [{ opportunity_id: OLD_DEAL, tenant_id: T1, tender_no: "ARB-1" }],
    deal_types: [],
    custom_fields: [
      { id: "cf-s", tenant_id: T1, object_type: "supplier", field_key: "cf_rating", field_label: "Rating", field_type: "text", options: null, is_required: false, position: 1, field_section: null },
      { id: "cf-p", tenant_id: T1, object_type: "product", field_key: "cf_shelf", field_label: "Shelf", field_type: "text", options: null, is_required: false, position: 1, field_section: null },
    ],
    field_overrides: [], field_rules: [], change_log: [], assistant_actions: [],
    ...opts.extra,
  });
  S.db = db as never;
  S.tenantId = T1;
  S.userId = U1;
  return db;
}

const ctx = (over: Partial<ExecCtx> = {}): ExecCtx => ({
  supabase: S.db.client as never, admin: S.db.client as never, tenantId: S.tenantId, userId: S.userId,
  perms: ALL, features: S.features, baseUrl: "https://acme.test/api/ai/act", ...over,
});

async function tryPropose(object: string, values: Record<string, unknown>, references: Record<string, string> = {}, pageAccountId?: string) {
  return buildCard(
    { supabase: S.db.client as never, tenantId: S.tenantId, userId: S.userId },
    actionFor(object)!,
    { values, references, summary: "Create it.", pageAccountId },
  );
}
async function propose(object: string, values: Record<string, unknown>, references: Record<string, string> = {}, pageAccountId?: string) {
  const built = await tryPropose(object, values, references, pageAccountId);
  if (!built.ok) throw new Error(built.reason);
  return built;
}
const valuesOf = (card: ConfirmCard) => Object.fromEntries(card.fields.map((f) => [f.key, f.value]));
const press = (card: ConfirmCard, values?: Record<string, unknown>, over: Partial<ExecCtx> = {}) =>
  executeCard(ctx(over), { card_id: card.id, token: card.token, values: values ?? valuesOf(card) });
const rows = (t: string) => S.db.tables[t] ?? [];

beforeEach(() => {
  resetViaColumnCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe("supplier", () => {
  it("offers name*, type, city and notes only: no status, no workspace custom field, nothing the route would drop", async () => {
    world();
    const { card, ignored } = await propose("supplier", { name: "Gulf Valves LLC", type: "vendor", status: "blocked", phone: "+966 1 555", cf_rating: "A" });
    expect(card.fields.map((f) => f.key)).toEqual(["name", "type", "city", "notes"]);
    expect(card.fields.find((f) => f.key === "name")).toMatchObject({ required: true, value: "Gulf Valves LLC" });
    expect(card.fields.find((f) => f.key === "type")?.widget).toBe("enum");
    expect(ignored.sort()).toEqual(["cf_rating", "phone", "status"]);
    expect(card).toMatchObject({ action: "create", object: "supplier", primaryLabel: "Create supplier", title: "New supplier: Gulf Valves LLC" });
  });

  it("warns about a similar supplier of this workspace only", async () => {
    world();
    const { card } = await propose("supplier", { name: "Gulf Steel" });
    expect(card.duplicates).toEqual([{ id: "s1", label: "Gulf Steel Trading (SUP-0001)", href: "/suppliers/s1" }]);
    expect(JSON.stringify(card)).not.toContain("Foreign");
  });

  it("a press creates it through the suppliers route: tenant, master ref, active, change history via assistant", async () => {
    world();
    const { card } = await propose("supplier", { name: "Gulf Valves LLC", city: "Dammam", notes: "Approved 2026" });
    const out = await press(card);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, record: { label: "Gulf Valves LLC" } });
    const made = rows("suppliers").find((r) => r.name === "Gulf Valves LLC")!;
    expect(made).toMatchObject({ tenant_id: T1, ref: "SUP-9001", type: "vendor", city: "Dammam", status: "active" });
    expect((out.body.record as { href: string }).href).toBe(`/suppliers/${made.id}`);
    expect(rows("change_log")[0]).toMatchObject({ tenant_id: T1, object_type: "suppliers", action: "create", via: "assistant" });
    expect(rows("assistant_actions")[0]).toMatchObject({ action_key: "create_supplier", route: "/api/suppliers", status: "done" });
  });

  it("the press body is exactly the route's allow-list; a field outside the card is refused, a name is required", async () => {
    world();
    const { card } = await propose("supplier", { name: "Gulf Valves LLC" });
    const smuggled = await press(card, { ...valuesOf(card), status: "blocked" });
    expect(smuggled).toMatchObject({ status: 422, body: { code: "unknown_field" } });
    const empty = await press(card, { ...valuesOf(card), name: "" });
    expect(empty).toMatchObject({ status: 422, body: { code: "missing", missing: ["name"] } });
    expect(rows("suppliers")).toHaveLength(2);
  });
});

describe("product", () => {
  it("offers name*, sku, category, uom and list price; the cost price is on no card and is refused from a press", async () => {
    world();
    const { card, ignored } = await propose("product", { name: "Ball valve 2in", sku: "BV-2", uom: "Nos", list_price: "180.5", cost_price: "90", item_type: "kit" });
    expect(card.fields.map((f) => f.key)).toEqual(["name", "sku", "category", "list_price", "uom"]);
    expect(card.fields.find((f) => f.key === "name")?.required).toBe(true);
    expect(ignored.sort()).toEqual(["cost_price", "item_type"]);
    expect(valuesOf(card).list_price).toBe("180.5");
    expect(JSON.stringify(card)).not.toMatch(/cost/i);

    const forged = await press(card, { ...valuesOf(card), cost_price: "1" });
    expect(forged).toMatchObject({ status: 422, body: { code: "unknown_field" } });
    expect(rows("products")).toHaveLength(1);
  });

  it("a category is a code from the workspace's own tree (name accepted), free text when there is no tree", async () => {
    world({ config: { product_categories: [{ code: "VALVES", name: "Valves", subs: [] }, { code: "PUMPS", name: "Pumps", subs: [] }] } });
    const withTree = await propose("product", { name: "Ball valve 2in", category: "valves" });
    const cat = withTree.card.fields.find((f) => f.key === "category")!;
    expect(cat.widget).toBe("enum");
    expect(cat.options).toEqual([{ value: "VALVES", label: "Valves" }, { value: "PUMPS", label: "Pumps" }]);
    expect(cat.value).toBe("VALVES");
    const wrong = await propose("product", { name: "Ball valve 2in", category: "Fasteners" });
    expect(wrong.card.fields.find((f) => f.key === "category")?.value).toBe("");
    expect(wrong.card.notices.join(" ")).toMatch(/Category.*not one of the options/);

    world();
    const noTree = await propose("product", { name: "Ball valve 2in", category: "Fasteners" });
    expect(noTree.card.fields.find((f) => f.key === "category")).toMatchObject({ widget: "text", value: "Fasteners" });
  });

  it("warns about the same SKU or a similar name, in this workspace only", async () => {
    world();
    const { card } = await propose("product", { name: "Something new", sku: "GV-4" });
    expect(card.duplicates).toEqual([{ id: "p1", label: "Gate valve 4in (PRD-0001)", href: "/products/p1" }]);
  });

  it("a press creates it through the products route: list price stored, cost price left empty, tenant and ref set", async () => {
    world();
    const { card } = await propose("product", { name: "Ball valve 2in", sku: "BV-2", uom: "Nos", list_price: "180.5" });
    const out = await press(card);
    expect(out.status).toBe(200);
    const made = rows("products").find((r) => r.name === "Ball valve 2in")!;
    expect(made).toMatchObject({ tenant_id: T1, ref: "PRD-9001", sku: "BV-2", uom: "Nos", list_price: 180.5, cost_price: null, status: "active" });
    expect(rows("change_log")[0]).toMatchObject({ object_type: "products", via: "assistant" });
    expect(JSON.stringify(rows("assistant_actions")[0])).not.toMatch(/cost/i);
  });
});

describe("tender deal", () => {
  const tender = { tender_no: "ARB-4400123", issuer_name: "Saudi Aramco", portal: "ariba", closing_at: "2026-11-30" };

  it("asks for the account (by name), the tender number and the bid end date; portal is an allow-list", async () => {
    world();
    const { card } = await propose("tender", { ...tender, title: "Pump skids" }, { account: "Saudi Aramco" });
    expect(card.fields.map((f) => f.key)).toEqual(["account_id", "tender_no", "issuer_name", "portal", "closing_at", "title", "source"]);
    const required = card.fields.filter((f) => f.required).map((f) => f.key);
    expect(required).toEqual(["account_id", "tender_no", "closing_at"]);
    expect(card.fields.find((f) => f.key === "account_id")).toMatchObject({ widget: "ref", value: ARAMCO });
    expect(card.fields.find((f) => f.key === "portal")?.options?.map((o) => o.value)).toEqual(["ariba", "email", "excel", "other"]);
    expect(card.fields.find((f) => f.key === "closing_at")?.widget).toBe("date");
    expect(card).toMatchObject({ object: "tender", noun: "tender deal", title: "New tender deal: ARB-4400123 · Saudi Aramco", primaryLabel: "Create tender deal" });
  });

  it("an account name that matches several asks, one that matches none or only another workspace's stops, the open account is the default", async () => {
    world();
    const several = await propose("tender", tender, { account: "Acme" });
    expect(valuesOf(several.card).account_id).toBe("");
    expect(several.card.fields.find((f) => f.key === "account_id")?.options?.map((o) => o.label)).toEqual(["Acme Industrial (ACC-0001)", "Acme Trading (ACC-0002)"]);
    expect(several.card.notices.join(" ")).toMatch(/Several accounts match/);
    expect((await press(several.card)).body).toMatchObject({ code: "missing" });

    expect(await tryPropose("tender", tender, { account: "Foreign" })).toMatchObject({ ok: false });
    expect(await tryPropose("tender", tender, {})).toMatchObject({ ok: false });
    expect(await tryPropose("tender", tender, {}, ARAMCO_FOREIGN)).toMatchObject({ ok: false });
    expect(valuesOf((await propose("tender", tender, {}, ARAMCO)).card).account_id).toBe(ARAMCO);
  });

  it("a portal outside the allow-list and a bid end date that is not a date are refused with a notice, never stored", async () => {
    world();
    const { card } = await propose("tender", { ...tender, portal: "fax", closing_at: "next week" }, { account: "Saudi Aramco" });
    expect(valuesOf(card).portal).toBe("");
    expect(valuesOf(card).closing_at).toBe("");
    expect(card.notices.join(" ")).toMatch(/Portal.*not one of the options/);
    expect(card.notices.join(" ")).toMatch(/Bid end date must be a date/);
  });

  it("the body is the route's: nested tender block, only allow-listed keys, accepted by the route's own parser, no stage or type", () => {
    const body = tenderBody({ account_id: ARAMCO, title: "Pump skids", source: "direct", ...tender });
    expect(Object.keys(body).sort()).toEqual(["account_id", "source", "tender", "title"]);
    expect(body.tender).toEqual({ tender_no: "ARB-4400123", issuer_name: "Saudi Aramco", portal: "ariba", closing_at: "2026-11-30T12:00:00.000Z" });
    const parsed = parseTenderFields(body.tender as Record<string, unknown>);
    expect(parsed).toMatchObject({ ok: true, values: { tender_no: "ARB-4400123", portal: "ariba", closing_at: "2026-11-30T12:00:00.000Z" } });
    for (const k of ["stage", "deal_type_id", "amount", "owner_id", "tenant_id", "decision"]) expect(JSON.stringify(body)).not.toContain(`"${k}"`);
    expect(tenderBody({ account_id: ARAMCO, tender_no: "X" })).toEqual({ account_id: ARAMCO, tender: { tender_no: "X" } });
  });

  it("a press posts to the route New tender uses: the route sets the tender row, the deal type and the first stage", async () => {
    world();
    const { card } = await propose("tender", { ...tender, title: "Pump skids" }, { account: "Saudi Aramco" });
    const out = await press(card);
    expect(out.status).toBe(200);
    const deal = rows("opportunities").find((r) => r.title === "Pump skids")!;
    expect(deal).toMatchObject({ tenant_id: T1, account_id: ARAMCO, ref: "OPP-9001", stage: initialStage(tenderStages()).value, outcome: "open", amount: 0, owner_id: U1, expected_close: "2026-11-30" });
    const t = rows("opportunity_tenders").find((r) => r.opportunity_id === deal.id)!;
    expect(t).toMatchObject({ tenant_id: T1, tender_no: "ARB-4400123", issuer_name: "Saudi Aramco", portal: "ariba", closing_at: "2026-11-30T12:00:00.000Z" });
    expect(t.deal_type_id).toBeTruthy();
    expect(rows("deal_types")).toMatchObject([{ tenant_id: T1, code: "tender" }]);
    expect(out.body.record).toMatchObject({ id: deal.id, href: `/pipeline/${deal.id}` });
    expect((out.body.next as { label: string }[]).map((n) => n.label)).toEqual(["Open ARB-4400123 · Saudi Aramco"]);
    expect(rows("change_log").map((r) => [r.object_type, r.via])).toEqual([["opportunities", "assistant"], ["opportunity_tenders", "assistant"]]);
    expect(rows("assistant_actions")[0]).toMatchObject({ action_key: "create_tender", route: "/api/opportunities/tender", status: "done" });
  });

  it("without the title the route derives it, as the form does", async () => {
    world();
    const { card } = await propose("tender", tender, { account: "Saudi Aramco" });
    expect((await press(card)).status).toBe(200);
    expect(rows("opportunities").some((r) => r.title === "ARB-4400123 · Saudi Aramco")).toBe(true);
  });

  it("a tender number already in the workspace shows on the card and the route still refuses it", async () => {
    world();
    const { card } = await propose("tender", { ...tender, tender_no: "ARB-1" }, { account: "Saudi Aramco" });
    expect(card.duplicates).toEqual([{ id: OLD_DEAL, label: "ARB-1 · Aramco (OPP-0001)", href: `/pipeline/${OLD_DEAL}` }]);
    const out = await press(card);
    expect(out).toMatchObject({ status: 409, body: { code: "route_refused" } });
    expect(rows("opportunities")).toHaveLength(1);
    expect(rows("assistant_actions")[0]).toMatchObject({ status: "failed" });
  });

  it("a forged account id from another workspace is refused before the route sees it", async () => {
    world();
    const { card } = await propose("tender", tender, { account: "Saudi Aramco" });
    const out = await press(card, { ...valuesOf(card), account_id: ARAMCO_FOREIGN });
    expect(out).toMatchObject({ status: 422, body: { code: "ref" } });
    expect(rows("opportunities")).toHaveLength(1);
  });

  it("a required field left empty creates nothing and leaves the card usable", async () => {
    world();
    const { card } = await propose("tender", { ...tender, closing_at: "" }, { account: "Saudi Aramco" });
    expect(await press(card)).toMatchObject({ status: 422, body: { code: "missing", missing: ["closing_at"] } });
    expect(rows("opportunities")).toHaveLength(1);
    expect((await press(card, { ...valuesOf(card), closing_at: "2026-12-01" })).status).toBe(200);
  });

  it("needs the tender flag and Pipeline at press time, not only when the card was shown", async () => {
    world();
    const { card } = await propose("tender", tender, { account: "Saudi Aramco" });
    const off = await press(card, undefined, { features: { ...ON, gcc_tender: false } });
    expect(off).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    const noPipeline = await press(card, undefined, { features: { ...ON, pipeline: false } });
    expect(noPipeline).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    expect(rows("opportunities")).toHaveLength(1);
  });
});

describe("the field catalogue the model sees", () => {
  it("marks required fields, names the tender in one clause, shows the date format, and never mentions a cost price", async () => {
    world();
    const text = await createCatalog(S.db.client as never, T1, availableActions({ features: ON, perms: ALL }));
    expect(text).toContain("- supplier: fields: name* (Name)");
    expect(text).toMatch(/- supplier: fields: name\* \(Name\), type \(Type: /);
    expect(text).toContain("- product: fields: name* (Name), sku (SKU), category (Category), list_price (List price), uom (Unit of measure)");
    expect(text).toMatch(/- tender \(a deal in the Pipeline that carries its tender details[^)]*\): fields: tender_no\* \(Tender number\), issuer_name \(Issuer\), portal \(Portal: ariba\|email\|excel\|other\), closing_at\* \(Bid end date, yyyy-mm-dd\)/);
    expect(text).toContain("references: account* (name of the account)");
    expect(text).not.toMatch(/cost/i);
  });

  it("offers only the objects whose modules are on", async () => {
    world();
    const noTender = availableActions({ features: { ...ON, gcc_tender: false }, perms: ALL }).map((a) => a.object);
    expect(noTender).toEqual(["account", "contact", "supplier", "product"]);
    expect(ACTIONS.filter((a) => a.alsoFeatures).map((a) => a.object)).toEqual(["tender"]);
  });
});
