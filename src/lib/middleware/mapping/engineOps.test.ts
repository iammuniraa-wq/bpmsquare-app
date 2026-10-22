import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const logged = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v, unsealSecret: (v: string) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u), fetchPublic: async () => new Response("{}") }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {}, logChange: async (_c: unknown, p: Record<string, unknown>) => { logged.push(p); } }));
vi.mock("@/lib/masterRef", () => ({ insertWithMasterRef: async () => ({ data: null, error: null }) }));
vi.mock("../metadataServer", async (orig) => {
  const real = await orig<typeof import("../metadataServer")>();
  const header = [
    { name: "name", label: "Name", type: "String", required: true, creatable: true },
    { name: "description", label: "Description", type: "Memo", required: false, creatable: true },
    { name: "totalamount", label: "Total", type: "Money", required: false, creatable: true },
    { name: "effectiveto", label: "Effective to", type: "DateTime", required: false, creatable: true },
    { name: "customerid", label: "Customer", type: "Customer", required: true, creatable: true, lookup: "account" },
  ];
  const lines = [
    { name: "productdescription", label: "Description", type: "String", required: false, creatable: true },
    { name: "quantity", label: "Quantity", type: "Decimal", required: false, creatable: true },
    { name: "priceperunit", label: "Price per unit", type: "Money", required: false, creatable: true },
    { name: "new_unitcode", label: "Unit code", type: "Picklist", required: false, creatable: true, enum: ["EA", "PC", "M"] },
    { name: "isproductoverridden", label: "Write-in product", type: "Boolean", required: false, creatable: true },
  ];
  return { ...real, getErpMetadata: async (_t: string, entity: string) => ({ ok: true, entity, applicable: true, fields: entity === "quote_line" ? lines : entity === "quote" ? header : [], fetchedAt: "2026-10-22T00:00:00Z", source: "metadata" }) };
});

import { fetchSchema, getView, proposeOp, resetEngine, restoreEngine, saveEngine, tryOp, type OpsCtx } from "./engineOps";
import { deleteListOp, listsView, putList } from "./listOps";
import { dispatchQuoteOutcome } from "../dispatch";
import { classifyIntegrationRow } from "../monitorRows";
import { FakeDataverse } from "../fakeDataverse";
import { fakeAdmin, seedMiddleware, T1, T2, type Row } from "../testHarness";
import { getActive } from "./mappingStore";

beforeEach(() => { logged.length = 0; vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const ctx = (db: ReturnType<typeof fakeAdmin>, tenantId = T1): OpsCtx => ({ supabase: db.client, admin: db.client, tenantId, userId: "u-1" });
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function firstRows(c: OpsCtx) {
  const v = (await getView(c, null, "quote")).body as Body;
  return { header: v.rows.header as Body[], lines: v.rows.lines as Body[], view: v };
}

const unitRow = { id: "u1", target: "new_unitcode", source: "uom", convert: { kind: "value_list", list: "unit" }, ifEmpty: null, origin: "user", confidence: null };

describe("the Mapping tab's answer", () => {
  it("a workspace with no saved mapping gets today's view plus the engine fields, standard rows, nothing saved", async () => {
    const db = fakeAdmin(seedMiddleware());
    const out = await getView(ctx(db), null, "quote");
    expect(out.status).toBe(200);
    const v = out.body as Body;
    expect(v.sections).toBeDefined(); // the older view is still there
    expect(v.engine).toMatchObject({ active: false, version: null, usingStandard: true });
    expect(v.target).toMatchObject({ kind: "adapter", entity: "quotes", linesPath: "quote_details" });
    expect(v.target.schema.counts.total).toBe(10);
    expect(v.rows.header.length).toBeGreaterThan(0);
    expect(v.rows.header.every((r: Body) => r.origin === "standard" && r.id.startsWith("std:header:"))).toBe(true);
    expect(v.sourceFields.header.map((f: Body) => f.key)).toEqual(expect.arrayContaining(["ref", "currency"]));
    expect(v.targetFields.lines.map((f: Body) => f.path)).toContain("new_unitcode");
    expect(v.lists).toEqual([]);
    expect(v.ai).toEqual({ available: false });
    expect(db.tables.integration_mappings ?? []).toHaveLength(0);
  });

  it("while the database update is pending the answer still has the older view and says what to run", async () => {
    const db = fakeAdmin(seedMiddleware(), { missing: ["integration_mappings", "integration_value_lists"] });
    const v = (await getView(ctx(db), null, "quote")).body as Body;
    expect(v.sections).toBeDefined();
    expect(v).toMatchObject({ needsDatabaseUpdate: true, bundle: "scripts/run-bundle-12-mapping-2026-10-21.sql" });
    expect((await saveEngine(ctx(db), { document: "quote", rows: { header: [], lines: [] } })).body).toMatchObject({ needsDatabaseUpdate: true });
    expect((await listsView(ctx(db), null)).body).toMatchObject({ needsDatabaseUpdate: true });
  });

  it("not connected, an unknown document and a webhook of another workspace", async () => {
    const db = fakeAdmin({ ...seedMiddleware(), tenant_connectors: [] });
    expect((await getView(ctx(db), null, "quote")).body).toEqual({ connected: false });
    expect((await getView(ctx(db), null, "nope")).status).toBe(422);
    const other = fakeAdmin({ ...seedMiddleware(), webhooks: [{ id: "11111111-1111-4111-8111-111111111111", tenant_id: T2, kind: "call", name: "x", allow_personal_data: false }] });
    expect((await getView(ctx(other), "webhook:11111111-1111-4111-8111-111111111111", "quote")).status).toBe(404);
    expect((await getView(ctx(other), "webhook:not-a-uuid", "quote")).status).toBe(422);
    expect((await getView(ctx(other), "sap; drop table", "quote")).status).toBe(422);
  });
});

describe("saving, versions, restore, reset", () => {
  it("the first edit materialises the standard rows as version 1; each save is a new version and the old one is kept", async () => {
    const db = fakeAdmin(seedMiddleware());
    const c = ctx(db);
    const { header, lines } = await firstRows(c);
    const saved = await saveEngine(c, { connection: "dynamics365", document: "quote", rows: { header, lines } });
    expect(saved.status).toBe(200);
    expect((saved.body as Body).engine).toMatchObject({ active: true, version: 1, usingStandard: false });
    const changed = header.map((r) => (r.target === "description" ? { ...r, ifEmpty: "No summary", origin: "user" } : r));
    const v2 = (await saveEngine(c, { document: "quote", rows: { header: changed, lines } })).body as Body;
    expect(v2.engine.version).toBe(2);
    expect(v2.engine.versions.map((x: Body) => x.version)).toEqual([2, 1]);
    const rows = db.tables.integration_mappings;
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "previous")).toHaveLength(1);
    expect(logged.map((l) => [l.objectType, l.action])).toEqual([["integration_mapping", "create"], ["integration_mapping", "update"]]);
    expect(JSON.stringify(logged)).not.toMatch(/No summary/);

    const restored = (await restoreEngine(c, { document: "quote", version: 1 })).body as Body;
    expect(restored.engine.version).toBe(3);
    expect(restored.rows.header.find((r: Body) => r.target === "description").ifEmpty).toBeNull();
    expect((await restoreEngine(c, { document: "quote", version: 99 })).status).toBe(404);
    expect((await restoreEngine(c, { document: "quote", version: "1" })).status).toBe(422);
  });

  it("keeps the last 10 previous versions and prunes older ones", async () => {
    const db = fakeAdmin(seedMiddleware());
    const c = ctx(db);
    const { header, lines } = await firstRows(c);
    for (let i = 0; i < 13; i++) await saveEngine(c, { document: "quote", rows: { header: header.map((r) => (r.target === "name" ? { ...r, ifEmpty: `n${i}` } : r)), lines } });
    const rows = db.tables.integration_mappings;
    expect(rows.filter((r) => r.status === "previous")).toHaveLength(10);
    expect(Math.max(...rows.map((r) => r.version as number))).toBe(13);
  });

  it("refuses a row for a field the ERP does not have, a bad converter, a missing list and a field filled twice, naming the row", async () => {
    const db = fakeAdmin(seedMiddleware());
    const c = ctx(db);
    const { header, lines } = await firstRows(c);
    const bad = async (extra: Body[]) => (await saveEngine(c, { document: "quote", rows: { header, lines: [...lines, ...extra] } }));
    const r1 = await bad([{ id: "x1", target: "not_a_field", source: "uom", convert: null, ifEmpty: null }]);
    expect(r1.status).toBe(422);
    expect((r1.body as Body).errors[0]).toMatchObject({ rowId: "x1" });
    expect(((await bad([{ id: "x2", target: "quantity", source: "uom", convert: { kind: "eval", code: "1" } }])).body as Body).errors[0].rowId).toBe("x2");
    expect(((await bad([{ id: "x3", target: "new_unitcode", source: "uom", convert: { kind: "value_list", list: "unit" } }])).body as Body).errors[0].message).toMatch(/list does not exist/);
    expect(((await bad([{ id: "x4", target: "quantity", source: "qty" }, { id: "x5", target: "quantity", source: "rate" }])).body as Body).errors[0].message).toMatch(/filled by two rows/);
    expect((await saveEngine(c, { document: "quote", rows: "nope" })).status).toBe(422);
    expect((await saveEngine(c, { document: "quote", rows: { header: [{ id: "", target: "name" }], lines: [] } })).status).toBe(422);
    expect(db.tables.integration_mappings ?? []).toHaveLength(0);
  });

  it("Reset to standard removes every version, so the next read is the preset again", async () => {
    const db = fakeAdmin(seedMiddleware());
    const c = ctx(db);
    const { header, lines } = await firstRows(c);
    await saveEngine(c, { document: "quote", rows: { header, lines } });
    await saveEngine(c, { document: "quote", rows: { header, lines } });
    const after = (await resetEngine(c, { document: "quote" })).body as Body;
    expect(after.engine).toMatchObject({ active: false, usingStandard: true });
    expect(db.tables.integration_mappings).toHaveLength(0);
    expect(logged.at(-1)).toMatchObject({ objectType: "integration_mapping", action: "delete" });
  });

  it("one workspace never sees or changes another's mapping", async () => {
    const seed = seedMiddleware();
    const db = fakeAdmin(seed);
    const c1 = ctx(db);
    const { header, lines } = await firstRows(c1);
    await saveEngine(c1, { document: "quote", rows: { header, lines } });
    await putList(c1, null, "unit", { rows: [{ bpm: "Nos", erp: "EA" }], default_in: null });
    // T2 has the flag but no connector, and asks for T1's row by every route
    const c2 = ctx(db, T2);
    expect((await getActive(db.client, T2, "dynamics365", "quote"))).toEqual({ pending: false, value: null });
    expect((await restoreEngine(c2, { document: "quote", version: 1 })).status).toBe(400);
    expect((await resetEngine(c2, { document: "quote" })).status).toBe(400);
    expect(((await listsView(c2, null)).body as Body).lists).toEqual([]);
    expect((await deleteListOp(c2, null, "unit")).status).toBe(404);
    expect(db.tables.integration_mappings).toHaveLength(1);
    expect(db.tables.integration_value_lists).toHaveLength(1);
  });
});

describe("schema, proposal", () => {
  it("a pasted sample becomes the field list (kept as a draft), and the proposal fills from it", async () => {
    const db = fakeAdmin({ ...seedMiddleware(), webhooks: [{ id: "11111111-1111-4111-8111-111111111111", tenant_id: T1, kind: "call", name: "Orders", allow_personal_data: false }] });
    const c = ctx(db);
    const conn = "webhook:11111111-1111-4111-8111-111111111111";
    const out = await fetchSchema(c, { connection: conn, document: "quote", source: "sample", sample: JSON.stringify({ ref: "X", total: 12.5, valid_until: "2026-10-21", items: [{ description: "d", qty: 2 }] }) });
    expect(out.status).toBe(200);
    const b = out.body as Body;
    expect(b.target).toMatchObject({ kind: "sample", linesPath: "items" });
    expect(b.targetFields.header.map((f: Body) => f.path).sort()).toEqual(["ref", "total", "valid_until"]);
    expect(db.tables.integration_mappings).toHaveLength(1);
    expect(db.tables.integration_mappings[0]).toMatchObject({ status: "draft", connection_id: conn, tenant_id: T1 });

    const p = (await proposeOp(c, { connection: conn, document: "quote", mode: "fill" })).body as Body;
    expect(p.rows.header.map((r: Body) => [r.target, r.source])).toEqual(expect.arrayContaining([["ref", "ref"], ["total", "total"], ["valid_until", "valid_until"]]));
    expect(p.rows.lines.map((r: Body) => [r.target, r.source])).toEqual(expect.arrayContaining([["description", "description"], ["qty", "qty"]]));
    expect((await proposeOp(c, { connection: conn, document: "quote", mode: "bad" })).status).toBe(422);

    // the GET for a webhook with a field list and no saved mapping shows the proposal, unsaved
    const v = (await getView(c, conn, "quote")).body as Body;
    expect(v.engine).toMatchObject({ active: false, usingStandard: false });
    expect(v.rows.header.length).toBe(3);

    // saving it
    const saved = await saveEngine(c, { connection: conn, document: "quote", rows: v.rows });
    expect(saved.status).toBe(200);
    expect((saved.body as Body).engine.version).toBe(1);
    expect(db.tables.integration_mappings.filter((r) => r.status === "draft")).toHaveLength(0);
  });

  it("an unsafe address is refused and nothing is stored; manual fields work; a webhook of another tenant is not found", async () => {
    const db = fakeAdmin({ ...seedMiddleware(), webhooks: [{ id: "11111111-1111-4111-8111-111111111111", tenant_id: T1, kind: "call", name: "Orders", allow_personal_data: false }] });
    const c = ctx(db);
    const conn = "webhook:11111111-1111-4111-8111-111111111111";
    const keyed = await fetchSchema(c, { connection: conn, document: "quote", source: "openapi", url: "https://example.com/spec.json?api_key=abc" });
    expect(keyed.status).toBe(422);
    expect((keyed.body as Body).error).toMatch(/Put the key in a header/);
    expect((await fetchSchema(c, { connection: conn, document: "quote", source: "wsdl" })).status).toBe(422);
    expect((await fetchSchema(c, { connection: conn, document: "quote", source: "manual", fields: [{ path: "a b" }] })).status).toBe(422);
    expect((await fetchSchema(c, { connection: conn, document: "quote", source: "manual", fields: [{ path: "ref", type: "text", required: true }] })).status).toBe(200);
    expect((await fetchSchema(ctx(db, T2), { connection: conn, document: "quote", source: "manual", fields: [{ path: "ref" }] })).status).toBe(404);
    expect(db.tables.integration_mappings).toHaveLength(1);
  });

  it("the Dynamics adapter refresh keeps nothing dropped silently: a new field is marked new", async () => {
    const db = fakeAdmin(seedMiddleware());
    const c = ctx(db);
    const { header, lines } = await firstRows(c);
    await saveEngine(c, { document: "quote", rows: { header, lines } });
    const out = (await fetchSchema(c, { document: "quote", source: "adapter" })).body as Body;
    expect(out.counts).toEqual({ total: 10, new: 0, missing: 0 });
  });
});

describe("an unmapped value fails the send with the fix, and Restart works after it", () => {
  async function setup() {
    const db = fakeAdmin(seedMiddleware());
    const c = ctx(db);
    await putList(c, null, "unit", { rows: [{ bpm: "Nos", erp: "EA" }], default_in: null });
    const { header, lines } = await firstRows(c);
    expect((await saveEngine(c, { document: "quote", rows: { header, lines: [...lines, unitRow] } })).status).toBe(200);
    return { db, c };
  }

  it("awarded: Monitor row failed with the agreed wording, restartable, nothing sent; add the row, Restart, it goes with the code", async () => {
    const { db, c } = await setup();
    const dv = new FakeDataverse();
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto", http: dv, userId: "u-1" });
    expect(r).toMatchObject({ state: "failed", headline: "Unit 'pcs' has no ERP code.", fix: "Add it in Mapping > Value mapping, then Restart." });
    expect(dv.quotes).toHaveLength(0);
    expect(dv.calls.filter((x) => x.method !== "GET")).toHaveLength(0);
    const msg = db.tables.integration_messages.find((m) => m.status === "failed") as Row;
    expect(msg.summary).toMatchObject({ kind: "mapping_value", unmapped: [{ list: "unit", value: "pcs" }], fix: "Add it in Mapping > Value mapping, then Restart." });
    expect(classifyIntegrationRow(msg as never)).toBe("document");
    expect(db.tables.connector_links.filter((l) => l.entity === "standard_quotes")).toHaveLength(0);

    const lists = ((await listsView(c, null)).body as Body).lists as Body[];
    expect(lists[0].unmapped.out).toEqual(["pcs"]);
    expect(lists[0].counts).toMatchObject({ rows: 1, unused: 0, unmapped: 1 });

    await putList(c, null, "unit", { rows: [{ bpm: "Nos", erp: "EA" }, { bpm: "pcs", erp: "PC" }], default_in: null });
    const again = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "retry", http: dv, userId: "u-1" });
    expect(again.state).toBe("sent");
    expect(dv.quotes).toHaveLength(1);
    expect(dv.quotes[0].lines.map((l) => l.new_unitcode)).toEqual(["PC", "PC"]);
    // the contract steps no mapping can remove
    expect(dv.quotes[0].body["customerid_account@odata.bind"]).toBeTruthy();
    expect(dv.quotes[0].lines.every((l) => l.isproductoverridden === true && !("uomid" in l))).toBe(true);
    expect(String(dv.quotes[0].body.description)).toContain("[bpmsquare:q-1]");
    expect(String(dv.quotes[0].name).startsWith("SQ-0001")).toBe(true);
  });

  it("several values in one send are one sentence", async () => {
    const { db } = await setup();
    const seed = db.tables.standard_quote_lines;
    seed[1].uom = "Box";
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto", http: new FakeDataverse(), userId: "u-1" });
    expect(r).toMatchObject({ state: "failed", headline: "Unit 'pcs', 'Box' have no ERP code." });
  });

  it("Try it shows the same fault as a problem, never a thrown error, and the ZZ sample needs no record", async () => {
    const { c } = await setup();
    const t = (await tryOp(c, { document: "quote" })).body as Body;
    expect(t.request).toMatchObject({ method: "POST", url: "/quotes" });
    expect(t.request.headers).toEqual(expect.arrayContaining(["Authorization"]));
    expect(JSON.stringify(t)).not.toMatch(/tok|Bearer/);
    expect(t.problems.map((p: Body) => p.message)).toEqual(expect.arrayContaining(["Unit 'Mtr' has no ERP code."]));
    expect((await tryOp(c, { document: "quote", record_id: "not-a-uuid" })).status).toBe(422);
    expect((await tryOp(c, { document: "quote", record_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })).status).toBe(404);
  });

  it("a mapping made for another document is refused loudly rather than sent to the wrong place", async () => {
    const { db } = await setup();
    const row = db.tables.integration_mappings.find((m) => m.status === "active") as Row;
    (row.doc as Body).target.entity = "salesorders";
    const r = await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto", http: new FakeDataverse(), userId: "u-1" });
    expect(r).toMatchObject({ state: "failed" });
    expect((r as { headline: string }).headline).toMatch(/mapping is for salesorders/);
  });

  it("no mapping document: the body is the older field maps' and the lines carry no new column", async () => {
    const db = fakeAdmin(seedMiddleware());
    const dv = new FakeDataverse();
    expect((await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto", http: dv })).state).toBe("sent");
    expect(Object.keys(dv.quotes[0].lines[0]).sort()).toEqual(["isproductoverridden", "priceperunit", "productdescription", "quantity"]);
  });

  it("the tables not there yet: a send behaves exactly as before and never crashes", async () => {
    const db = fakeAdmin(seedMiddleware(), { missing: ["integration_mappings", "integration_value_lists"] });
    const dv = new FakeDataverse();
    expect((await dispatchQuoteOutcome(db.client, T1, "q-1", { trigger: "auto", http: dv })).state).toBe("sent");
  });
});

describe("value lists", () => {
  it("save, counters, 422 per row, delete refused while a row uses the list", async () => {
    const db = fakeAdmin(seedMiddleware());
    const c = ctx(db);
    const bad = await putList(c, null, "unit", { rows: [{ bpm: "Mtr", erp: "M" }, { bpm: "Metre", erp: "M" }], default_in: null });
    expect(bad.status).toBe(422);
    expect((bad.body as Body).errors[0]).toMatchObject({ row: 0 });
    expect((await putList(c, null, "not a kind", { rows: [] })).status).toBe(422);
    const ok = await putList(c, null, "unit", { rows: [{ bpm: "Mtr", erp: "M", inbound: true }, { bpm: "Metre", erp: "M", inbound: false }], default_in: "Mtr" });
    expect(ok.status).toBe(200);
    expect((ok.body as Body).counts).toMatchObject({ rows: 2, unused: 2 });
    const { header, lines } = await firstRows(c);
    await saveEngine(c, { document: "quote", rows: { header, lines: [...lines, unitRow] } });
    const v = (await listsView(c, null)).body as Body;
    expect(v.lists[0].counts).toMatchObject({ rows: 2, unused: 0 });
    expect(v.standardKinds.find((k: Body) => k.kind === "unit").created).toBe(true);
    expect(v.standardKinds.find((k: Body) => k.kind === "currency").created).toBe(false);
    const del = await deleteListOp(c, null, "unit");
    expect(del.status).toBe(409);
    expect((del.body as Body).used_by).toEqual([{ document: "quote", field: "new_unitcode" }]);
    expect(logged.filter((l) => l.objectType === "value_list").map((l) => l.action)).toEqual(["create"]);
  });

  it("at most 20 lists of your own", async () => {
    const db = fakeAdmin(seedMiddleware());
    const c = ctx(db);
    for (let i = 0; i < 20; i++) expect((await putList(c, null, `custom:k${i}`, { rows: [] })).status).toBe(200);
    expect((await putList(c, null, "custom:one_too_many", { rows: [] })).status).toBe(422);
    expect((await putList(c, null, "custom:k3", { rows: [{ bpm: "a", erp: "b" }] })).status).toBe(200);
  });
});
