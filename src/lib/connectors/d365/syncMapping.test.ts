import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/encryption", () => ({ encrypt: (v: string | null) => v, decrypt: (v: string | null) => v }));
vi.mock("@/lib/net/safeHost", () => ({ assertSafeHttpsUrl: async (u: string) => new URL(u) }));
vi.mock("@/lib/changeLog", () => ({ logChangeBatch: async () => {} }));
vi.mock("@/lib/masterRef", () => ({
  insertWithMasterRef: async (admin: { from: (t: string) => { insert: (r: unknown) => { select: (c: string) => { single: () => Promise<unknown> } } } }, table: string, _t: string, rec: unknown) =>
    admin.from(table).insert(rec).select("id").single(),
}));

import { runPull } from "./server";
import { fakeDb, seedConnector, stubFetch, TENANT, type Row } from "./syncHarness";
import type { MappingDocument } from "@/lib/middleware/mapping/types";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const doc = (): MappingDocument => ({
  source: { object: "product", registryHash: "h" },
  target: { kind: "adapter", entity: "products", linesPath: null, schema: { fetchedAt: "2026-10-22T00:00:00Z", sourceUrl: null, fields: [] } },
  header: [
    { id: "a", target: "name", source: "name", convert: null, ifEmpty: null, origin: "user", confidence: null },
    { id: "b", target: "productnumber", source: "sku", convert: null, ifEmpty: null, origin: "user", confidence: null },
    { id: "c", target: "new_unit", source: "uom", convert: { kind: "value_list", list: "unit" }, ifEmpty: null, origin: "user", confidence: null },
  ],
  lines: [],
});

const withMapping = (list: Row | null = { tenant_id: TENANT, connection_id: "dynamics365", kind: "unit", label: "Unit", rows: [{ bpm: "Nos", erp: "EA", inbound: true }, { bpm: "Mtr", erp: "M", inbound: true }, { bpm: "Metre", erp: "M", inbound: false }], default_in: null, unknown_in: [] }) => ({
  ...seedConnector(),
  integration_mappings: [{ id: "m1", tenant_id: TENANT, connection_id: "dynamics365", document: "products", direction: "in", version: 1, status: "active", doc: doc() }],
  integration_value_lists: list ? [list] : [],
});

const product = (id: string, unit: string | null) => ({ productid: id, name: `Product ${id}`, productnumber: `S-${id}`, new_unit: unit, modifiedon: "2026-10-01T10:00:00Z" });

describe("pull through a saved inbound mapping", () => {
  it("reads the ERP code back through the value list (the row marked inbound) and asks only for the mapped columns", async () => {
    const db = fakeDb(withMapping());
    const calls = stubFetch(() => ({ value: [product("P1", "M"), product("P2", "EA")] }));
    const r = await runPull(db.client, TENANT, "products", { trigger: "manual", userId: null });
    expect(r.counts).toMatchObject({ read: 2, created: 2, failed: 0 });
    expect(db.tables.products.map((p) => [p.name, p.sku, p.uom])).toEqual([["Product P1", "S-P1", "Mtr"], ["Product P2", "S-P2", "Nos"]]);
    expect(calls[0].searchParams.get("$select")).toContain("new_unit");
    expect(r.counts.unknown_codes).toBeUndefined();
  });

  it("an unknown ERP code is kept raw and counted: the pull never fails on a value, and the list remembers the code", async () => {
    const db = fakeDb(withMapping());
    stubFetch(() => ({ value: [product("P1", "ZZ"), product("P2", "M"), product("P3", "ZZ"), product("P4", "QQ")] }));
    const r = await runPull(db.client, TENANT, "products", { trigger: "manual", userId: null });
    expect(r.counts).toMatchObject({ read: 4, created: 4, failed: 0, unknown_codes: 3 });
    expect(db.tables.products.map((p) => p.uom)).toEqual(["ZZ", "Mtr", "ZZ", "QQ"]);
    expect(db.tables.integration_value_lists[0].unknown_in).toEqual(["ZZ", "QQ"]);
  });

  it("with a default for unknown codes, the default is stored (and the code is still counted)", async () => {
    const db = fakeDb(withMapping({ tenant_id: TENANT, connection_id: "dynamics365", kind: "unit", label: "Unit", rows: [{ bpm: "Mtr", erp: "M", inbound: true }], default_in: "Nos", unknown_in: [] }));
    stubFetch(() => ({ value: [product("P1", "ZZ")] }));
    const r = await runPull(db.client, TENANT, "products", { trigger: "manual", userId: null });
    expect(db.tables.products[0].uom).toBe("Nos");
    expect(r.counts.unknown_codes).toBe(1);
  });

  it("a mapping saved for another workspace is not used", async () => {
    const seed = withMapping();
    seed.integration_mappings[0].tenant_id = "t-other";
    seed.integration_value_lists[0].tenant_id = "t-other";
    const db = fakeDb(seed);
    stubFetch(() => ({ value: [product("P1", "M")] }));
    await runPull(db.client, TENANT, "products", { trigger: "manual", userId: null });
    // the older field map ran: the preset reads the unit from its own column, not new_unit
    expect(db.tables.products[0].uom ?? null).not.toBe("Mtr");
  });

  it("no mapping document, or the tables not there yet: the older field map runs as before", async () => {
    const plain = fakeDb(seedConnector());
    stubFetch(() => ({ value: [product("P1", "M")] }));
    const r = await runPull(plain.client, TENANT, "products", { trigger: "manual", userId: null });
    expect(r.counts).toMatchObject({ created: 1, failed: 0 });
    expect(r.counts.unknown_codes).toBeUndefined();
  });
});
